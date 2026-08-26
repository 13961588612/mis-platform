package com.mis.iqd.domain.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.mis.iqd.api.dto.IqdSyncJobVO;
import com.mis.iqd.domain.entity.IqdKnowledge;
import com.mis.iqd.domain.entity.IqdSqlPair;
import com.mis.iqd.domain.entity.IqdSyncJob;
import com.mis.iqd.domain.repository.IqdAskLogRepository;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdKnowledgeRepository;
import com.mis.iqd.domain.repository.IqdMaskRuleRepository;
import com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository;
import com.mis.iqd.domain.repository.IqdScopePolicyRepository;
import com.mis.iqd.domain.repository.IqdSqlPairRepository;
import com.mis.iqd.domain.repository.IqdSyncJobRepository;
import com.mis.iqd.domain.repository.IqdTableAclRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 问数 APP × WrenAI 闭环补全（一期）Java 逻辑单测（第二层验证）。
 *
 * <p>纯 Mockito 单测，不加载 Spring 容器；聚焦三处核心逻辑：
 * <ul>
 *   <li>{@code reportSyncJob}：ai-platform 回调上报作业的落库字段映射 + 终态时间戳</li>
 *   <li>{@code backfillEnhancementSync}：回填 wren_ref_id / sync_status=synced / synced_at</li>
 *   <li>{@code toSyncJobVO} / {@code isTerminalStatus}：字段映射与终态判定</li>
 * </ul>
 *
 * <p>末条 {@code iqdSyncJobVO_serializes_snake_case_wire_names} 是契约证明用例：
 * 在项目「VO 显式 @JsonProperty snake_case、无全局 snake_case 策略」的约定下，
 * IqdSyncJobVO 当前漏标 connectionId / buildStatus / indexStatus 三字段，会序列化为
 * camelCase，导致前端 IqdSyncStatus 取到 undefined。修复（补 @JsonProperty）前该用例失败，
 * 作为回归守卫。
 */
@ExtendWith(MockitoExtension.class)
class IqdAdminServiceCloseLoopTest {

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
    @Mock IqdChangeEventPublisher changeEventPublisher;
    @Mock ObjectMapper objectMapper;

    @InjectMocks
    IqdAdminService service;

    @Captor ArgumentCaptor<IqdSyncJob> jobCaptor;
    @Captor ArgumentCaptor<IqdSqlPair> pairCaptor;
    @Captor ArgumentCaptor<IqdKnowledge> knowledgeCaptor;

    private static final long CONNECTION_ID = 42L;
    private static final Instant SYNCED_AT = Instant.parse("2024-01-15T08:30:00Z");

    /**
     * 令 ensureConnection(connectionId) 通过：仅本测试真正调用服务方法（走 ensureConnection）时才打桩，
     * 避免对纯反射/直接构造 VO 的用例产生 UnnecessaryStubbing（严格桩）。
     */
    private void givenConnectionExists() {
        when(connectionRepository.existsById(CONNECTION_ID)).thenReturn(true);
    }

    // ------------------------------------------------------------ P1-1 reportSyncJob

    @Test
    void reportSyncJob_createsNewJob_withCorrectFields_andTerminalTimestamps() {
        givenConnectionExists();
        when(syncJobRepository.findTopByConnectionIdOrderByIdDesc(CONNECTION_ID)).thenReturn(Optional.empty());
        when(syncJobRepository.save(any(IqdSyncJob.class))).thenAnswer(inv -> inv.getArgument(0));

        Map<String, Object> payload = new HashMap<>();
        payload.put("connection_id", CONNECTION_ID);
        payload.put("build_status", "success");
        payload.put("index_status", "failed");
        payload.put("build_mdl_hash", "mdl_abc123");
        payload.put("synced_sql_pair_count", 3);
        payload.put("synced_knowledge_count", 2);
        payload.put("index_error", "idx boom");
        // build_error 故意缺省 -> 必须映射为 null

        IqdSyncJobVO vo = service.reportSyncJob(payload);

        verify(syncJobRepository).save(jobCaptor.capture());
        IqdSyncJob saved = jobCaptor.getValue();
        assertEquals(CONNECTION_ID, saved.getConnectionId());
        assertEquals("success", saved.getBuildStatus());
        assertEquals("failed", saved.getIndexStatus());
        assertEquals("mdl_abc123", saved.getBuildMdlHash());
        assertEquals(3, saved.getSyncedSqlPairCount());
        assertEquals(2, saved.getSyncedKnowledgeCount());
        assertEquals("idx boom", saved.getIndexError());
        assertNull(saved.getBuildError(), "缺省的 build_error 必须映射为 null");
        assertNotNull(saved.getBuildAt(), "build_status=success 为终态 -> build_at 打戳");
        assertNotNull(saved.getIndexAt(), "index_status=failed 为终态 -> index_at 打戳");
        // 返回 VO 与实体映射一致
        assertEquals("success", vo.getBuildStatus());
        assertEquals("mdl_abc123", vo.getBuildMdlHash());
        assertEquals(3, vo.getSyncedSqlPairCount());
    }

    @Test
    void reportSyncJob_updatesExistingJob_withoutOverwritingOmittedFields() {
        givenConnectionExists();
        IqdSyncJob existing = new IqdSyncJob();
        existing.setId(7L);
        existing.setConnectionId(CONNECTION_ID);
        existing.setBuildStatus("running");
        existing.setIndexStatus("running");
        existing.setBuildMdlHash("mdl_old");
        when(syncJobRepository.findTopByConnectionIdOrderByIdDesc(CONNECTION_ID)).thenReturn(Optional.of(existing));
        when(syncJobRepository.save(any(IqdSyncJob.class))).thenAnswer(inv -> inv.getArgument(0));

        Map<String, Object> payload = new HashMap<>();
        payload.put("connection_id", CONNECTION_ID);
        payload.put("build_status", "success");
        // index_status / build_mdl_hash 缺省 -> 必须保留原值

        service.reportSyncJob(payload);

        verify(syncJobRepository).save(jobCaptor.capture());
        IqdSyncJob saved = jobCaptor.getValue();
        assertEquals(7L, saved.getId());
        assertEquals("success", saved.getBuildStatus());
        assertEquals("running", saved.getIndexStatus(), "缺省的 index_status 保留原值");
        assertEquals("mdl_old", saved.getBuildMdlHash(), "缺省的 build_mdl_hash 保留原值");
        assertNotNull(saved.getBuildAt());
    }

    // ------------------------------------------------------------ P1 isTerminalStatus

    @Test
    void isTerminalStatus_classifiesSuccessFailedAsTerminal() throws Exception {
        Method m = IqdAdminService.class.getDeclaredMethod("isTerminalStatus", String.class);
        m.setAccessible(true);
        assertTrue((Boolean) m.invoke(null, "success"));
        assertTrue((Boolean) m.invoke(null, "failed"));
        assertFalse((Boolean) m.invoke(null, "pending"));
        assertFalse((Boolean) m.invoke(null, "running"));
        assertFalse((Boolean) m.invoke(null, (Object) null));
        assertFalse((Boolean) m.invoke(null, ""));
    }

    // ------------------------------------------------------------ P1-2 backfillEnhancementSync

    @Test
    void backfillEnhancementSync_writesWrenRefIdAndSyncedStatus() {
        givenConnectionExists();
        IqdSqlPair p10 = new IqdSqlPair();
        p10.setId(10L);
        p10.setConnectionId(CONNECTION_ID);
        p10.setSyncStatus("pending");
        IqdSqlPair p11 = new IqdSqlPair();
        p11.setId(11L);
        p11.setConnectionId(CONNECTION_ID);
        p11.setSyncStatus("pending");
        IqdKnowledge k20 = new IqdKnowledge();
        k20.setId(20L);
        k20.setConnectionId(CONNECTION_ID);
        k20.setSyncStatus("pending");

        when(sqlPairRepository.findAllById(List.of(10L, 11L))).thenReturn(List.of(p10, p11));
        when(knowledgeRepository.findAllById(List.of(20L))).thenReturn(List.of(k20));
        when(sqlPairRepository.save(any(IqdSqlPair.class))).thenAnswer(inv -> inv.getArgument(0));
        when(knowledgeRepository.save(any(IqdKnowledge.class))).thenAnswer(inv -> inv.getArgument(0));

        int count = service.backfillEnhancementSync(
                CONNECTION_ID, "mdl_xyz", List.of(10L, 11L), List.of(20L), SYNCED_AT);

        assertEquals(3, count);
        assertEquals("mdl_xyz", p10.getWrenRefId());
        assertEquals("synced", p10.getSyncStatus());
        assertEquals(SYNCED_AT, p10.getSyncedAt());
        assertEquals("synced", p11.getSyncStatus());
        assertEquals("mdl_xyz", k20.getWrenRefId());
        assertEquals("synced", k20.getSyncStatus());
        assertEquals(SYNCED_AT, k20.getSyncedAt());
        verify(sqlPairRepository, times(2)).save(any());
        verify(knowledgeRepository, times(1)).save(any());
    }

    @Test
    void backfillEnhancementSync_skipsOtherConnection_andReturnsZeroForNullArgs() {
        givenConnectionExists();
        // null connectionId / null syncedAt -> 提前返回 0
        assertEquals(0,
                service.backfillEnhancementSync(null, "mdl", List.of(1L), List.of(), SYNCED_AT));
        assertEquals(0,
                service.backfillEnhancementSync(CONNECTION_ID, "mdl", List.of(1L), List.of(), null));

        IqdSqlPair p10 = new IqdSqlPair();
        p10.setId(10L);
        p10.setConnectionId(CONNECTION_ID);
        p10.setSyncStatus("pending");
        IqdSqlPair p99 = new IqdSqlPair();
        p99.setId(99L);
        p99.setConnectionId(999L);
        p99.setSyncStatus("pending");

        when(sqlPairRepository.findAllById(List.of(10L, 99L))).thenReturn(List.of(p10, p99));
        when(sqlPairRepository.save(any(IqdSqlPair.class))).thenAnswer(inv -> inv.getArgument(0));

        int count = service.backfillEnhancementSync(
                CONNECTION_ID, "mdl", List.of(10L, 99L), List.of(), SYNCED_AT);
        assertEquals(1, count, "跨连接物料必须被跳过");
        assertEquals("synced", p10.getSyncStatus());
        assertEquals("pending", p99.getSyncStatus());
    }

    // ------------------------------------------------------------ P1-3 toSyncJobVO field mapping

    @Test
    void getLatestSyncJob_mapsAllEntityFieldsToVO() {
        givenConnectionExists();
        IqdSyncJob job = new IqdSyncJob();
        job.setId(7L);
        job.setConnectionId(CONNECTION_ID);
        job.setBuildStatus("success");
        job.setBuildMdlHash("mdl_zzz");
        job.setIndexStatus("failed");
        job.setBuildAt(SYNCED_AT);
        job.setIndexAt(SYNCED_AT);
        job.setSyncedSqlPairCount(5);
        job.setSyncedKnowledgeCount(4);
        job.setBuildError("b-err");
        job.setIndexError("i-err");
        job.setUpdatedAt(SYNCED_AT);

        when(syncJobRepository.findTopByConnectionIdOrderByIdDesc(CONNECTION_ID)).thenReturn(Optional.of(job));

        IqdSyncJobVO vo = service.getLatestSyncJob(CONNECTION_ID);
        assertNotNull(vo);
        assertEquals(7L, vo.getId());
        assertEquals(CONNECTION_ID, vo.getConnectionId());
        assertEquals("success", vo.getBuildStatus());
        assertEquals("mdl_zzz", vo.getBuildMdlHash());
        assertEquals("failed", vo.getIndexStatus());
        assertEquals(SYNCED_AT, vo.getBuildAt());
        assertEquals(SYNCED_AT, vo.getIndexAt());
        assertEquals(5, vo.getSyncedSqlPairCount());
        assertEquals(4, vo.getSyncedKnowledgeCount());
        assertEquals("b-err", vo.getBuildError());
        assertEquals("i-err", vo.getIndexError());
        assertEquals(SYNCED_AT, vo.getUpdatedAt());
    }

    // ------------------------------------------------------------ P2 契约证明（已知 Bug）

    /**
     * 契约证明：IqdSyncJobVO 经 GET /api/v1/iqd/enhance/sync-status 返回前端，
     * 前端 IqdSyncStatus 按 snake_case 读取 connection_id / build_status / index_status。
     * 项目 VO 统一用显式 @JsonProperty("snake_case")（见 IqdConnectionVO 等），
     * 且无全局 snake_case 策略。当前 IqdSyncJobVO 漏标这 3 个字段 -> 序列化为
     * camelCase，前端取到 undefined。修复（补 @JsonProperty）前本用例失败，作为回归守卫。
     */
    @Test
    void iqdSyncJobVO_serializes_snake_case_wire_names() throws Exception {
        IqdSyncJobVO vo = new IqdSyncJobVO();
        vo.setId(7L);
        vo.setConnectionId(CONNECTION_ID);
        vo.setBuildStatus("success");
        vo.setBuildMdlHash("mdl_zzz");
        vo.setIndexStatus("failed");
        vo.setBuildAt(SYNCED_AT);
        vo.setIndexAt(SYNCED_AT);
        vo.setSyncedSqlPairCount(5);
        vo.setSyncedKnowledgeCount(4);
        vo.setBuildError("b-err");
        vo.setIndexError("i-err");
        vo.setUpdatedAt(SYNCED_AT);

        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        String json = mapper.writeValueAsString(vo);
        Map<String, Object> node = mapper.readValue(json, new TypeReference<Map<String, Object>>() {});

        assertTrue(node.containsKey("connection_id"),
                "wire JSON 必须含 snake_case 的 connection_id（前端按此读取），实际: " + json);
        assertTrue(node.containsKey("build_status"),
                "wire JSON 必须含 snake_case 的 build_status，实际: " + json);
        assertTrue(node.containsKey("index_status"),
                "wire JSON 必须含 snake_case 的 index_status，实际: " + json);
        assertTrue(node.containsKey("build_mdl_hash"));
        assertTrue(node.containsKey("synced_sql_pair_count"));
    }
}
