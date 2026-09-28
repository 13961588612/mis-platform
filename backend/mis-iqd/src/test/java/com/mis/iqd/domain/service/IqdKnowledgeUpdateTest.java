package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.iqd.api.dto.IqdKnowledgeSaveRequest;
import com.mis.iqd.api.dto.IqdKnowledgeVO;
import com.mis.iqd.domain.entity.IqdKnowledge;
import com.mis.iqd.domain.repository.IqdAskLogRepository;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdEditIdempotencyRepository;
import com.mis.iqd.domain.repository.IqdKnowledgeRepository;
import com.mis.iqd.domain.repository.IqdMaskRuleRepository;
import com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository;
import com.mis.iqd.domain.repository.IqdScopePolicyRepository;
import com.mis.iqd.domain.repository.IqdSqlPairRepository;
import com.mis.iqd.domain.repository.IqdSyncJobRepository;
import com.mis.iqd.domain.repository.IqdTableAclRepository;
import com.mis.common.core.exception.BusinessException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 「知识/术语」编辑（PUT /knowledge/{id}）语义单测。
 *
 * <p>守住三条容易退化的规则：
 * <ul>
 *   <li>改名撞同连接内已有 (kind,title) → 42200，不静默合并（"编辑"变"删一条长一条"）；</li>
 *   <li>内容/关联/类型变化 → 回到 {@code pending} 并清空 wren_ref_id / synced_at
 *       （否则界面显示"已同步"但实际永不再下发）；</li>
 *   <li>内容未变 → 保留 {@code synced}，不制造无谓的重新下发。</li>
 * </ul>
 *
 * <p>注意：{@code updateKnowledge} 按主键定位，**不**经 {@code ensureConnection}，
 * 故这些用例不桩 {@code connectionRepository.existsById}（严格桩下多余桩会失败）。
 */
@ExtendWith(MockitoExtension.class)
class IqdKnowledgeUpdateTest {

    @Mock IqdConnectionRepository connectionRepository;
    @Mock IqdAskLogRepository askLogRepository;
    @Mock IqdCatalogItemRepository catalogItemRepository;
    @Mock IqdScopePolicyRepository scopePolicyRepository;
    @Mock IqdTableAclRepository tableAclRepository;
    @Mock IqdMaskRuleRepository maskRuleRepository;
    @Mock IqdRowScopeDimensionRepository dimensionRepository;
    @Mock IqdSqlPairRepository sqlPairRepository;
    @Mock IqdKnowledgeRepository knowledgeRepository;
    @Mock IqdSyncJobRepository syncJobRepository;
    @Mock IqdEditIdempotencyRepository editIdempotencyRepository;
    @Mock IqdChangeEventPublisher changeEventPublisher;
    @Mock ObjectMapper objectMapper;

    @InjectMocks
    IqdAdminService service;

    private static final long CONNECTION_ID = 42L;
    private static final long KNOWLEDGE_ID = 77L;
    private static final Instant SYNCED_AT = Instant.parse("2024-01-15T08:30:00Z");

    /** 一条已同步的既有条目。 */
    private IqdKnowledge syncedKnowledge() {
        IqdKnowledge entity = new IqdKnowledge();
        entity.setId(KNOWLEDGE_ID);
        entity.setConnectionId(CONNECTION_ID);
        entity.setKind("term");
        entity.setTitle("GMV");
        entity.setContent("原口径");
        entity.setEnabled(1);
        entity.setSource("local");
        entity.setSyncStatus("synced");
        entity.setWrenRefId("mdl_old");
        entity.setSyncedAt(SYNCED_AT);
        entity.setCreatedAt(SYNCED_AT);
        entity.setUpdatedAt(SYNCED_AT);
        return entity;
    }

    private IqdKnowledgeSaveRequest request(String kind, String title, String content) {
        return new IqdKnowledgeSaveRequest(CONNECTION_ID, kind, title, content, null, null, null, null);
    }

    @Test
    @DisplayName("改标题：按主键更新，且回到 pending 并清空上次回填")
    void renameTitle_updatesInPlace_andResetsSyncState() {
        IqdKnowledge entity = syncedKnowledge();
        when(knowledgeRepository.findById(KNOWLEDGE_ID)).thenReturn(Optional.of(entity));
        when(knowledgeRepository.findByConnectionIdAndKindAndTitle(CONNECTION_ID, "term", "GMV 口径"))
                .thenReturn(Optional.empty());
        when(knowledgeRepository.save(any(IqdKnowledge.class))).thenAnswer(inv -> inv.getArgument(0));

        IqdKnowledgeVO vo = service.updateKnowledge(
                KNOWLEDGE_ID, request("term", "GMV 口径", "新口径"));

        assertEquals("GMV 口径", vo.getTitle());
        assertEquals("新口径", vo.getContent());
        assertEquals("pending", vo.getSyncStatus(), "内容变更必须回到 pending，否则改了不再下发");
        assertNull(entity.getWrenRefId(), "回填位需清空，等待下次 build 重新回填");
        assertNull(entity.getSyncedAt());
        verify(changeEventPublisher).publish(eq("iqd.enhancement.changed"), eq("knowledge_updated=" + KNOWLEDGE_ID));
    }

    @Test
    @DisplayName("内容未变：保留 synced，不制造无谓的重新下发")
    void unchangedContent_keepsSyncedState() {
        IqdKnowledge entity = syncedKnowledge();
        when(knowledgeRepository.findById(KNOWLEDGE_ID)).thenReturn(Optional.of(entity));
        when(knowledgeRepository.findByConnectionIdAndKindAndTitle(CONNECTION_ID, "term", "GMV"))
                .thenReturn(Optional.of(entity));
        when(knowledgeRepository.save(any(IqdKnowledge.class))).thenAnswer(inv -> inv.getArgument(0));

        IqdKnowledgeVO vo = service.updateKnowledge(KNOWLEDGE_ID, request("term", "GMV", "原口径"));

        assertEquals("synced", vo.getSyncStatus());
        assertEquals("mdl_old", entity.getWrenRefId());
    }

    @Test
    @DisplayName("改名撞同连接内已有条目 → 42200（不静默合并）")
    void renameTitle_conflictingWithAnotherRow_fails42200() {
        IqdKnowledge entity = syncedKnowledge();
        IqdKnowledge other = syncedKnowledge();
        other.setId(88L);
        when(knowledgeRepository.findById(KNOWLEDGE_ID)).thenReturn(Optional.of(entity));
        when(knowledgeRepository.findByConnectionIdAndKindAndTitle(CONNECTION_ID, "term", "同比"))
                .thenReturn(Optional.of(other));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateKnowledge(KNOWLEDGE_ID, request("term", "同比", "口径")));

        assertEquals(42200, ex.getCode());
        assertTrue(ex.getMessage().contains("已存在同类型同标题"));
        verify(knowledgeRepository, never()).save(any());
    }

    @Test
    @DisplayName("id 不存在 → NOT_FOUND，且不落库")
    void unknownId_failsNotFound() {
        when(knowledgeRepository.findById(999L)).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.updateKnowledge(999L, request("term", "任意", "内容")));

        assertTrue(ex.getMessage().contains("知识条目不存在"));
        verify(knowledgeRepository, never()).save(any());
    }

    @Test
    @DisplayName("kind/title 为空 → 校验失败，不落库")
    void blankTitle_rejected() {
        when(knowledgeRepository.findById(KNOWLEDGE_ID)).thenReturn(Optional.of(syncedKnowledge()));

        assertThrows(BusinessException.class,
                () -> service.updateKnowledge(KNOWLEDGE_ID, request("term", "   ", "内容")));
        verify(knowledgeRepository, never()).save(any());
    }

    @Test
    @DisplayName("POST 幂等 upsert：同名表单重存改了内容也要回到 pending")
    void postUpsert_changedContent_alsoResetsToPending() {
        when(connectionRepository.existsById(CONNECTION_ID)).thenReturn(true);
        IqdKnowledge entity = syncedKnowledge();
        when(knowledgeRepository.findByConnectionIdAndKindAndTitle(CONNECTION_ID, "term", "GMV"))
                .thenReturn(Optional.of(entity));
        when(knowledgeRepository.save(any(IqdKnowledge.class))).thenAnswer(inv -> inv.getArgument(0));

        IqdKnowledgeVO vo = service.saveKnowledge(request("term", "GMV", "改写后的口径"));

        assertEquals("pending", vo.getSyncStatus());
        assertNull(entity.getWrenRefId());
    }
}
