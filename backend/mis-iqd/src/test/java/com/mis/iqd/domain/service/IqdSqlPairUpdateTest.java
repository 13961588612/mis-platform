package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.iqd.api.dto.IqdSqlPairSaveRequest;
import com.mis.iqd.api.dto.IqdSqlPairVO;
import com.mis.iqd.domain.entity.IqdSqlPair;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 「样本对」编辑（POST /sql-pairs 带 id）语义单测。
 *
 * <p><b>为什么值得钉</b>（2026-09-28 真机实测踩到）：{@code saveSqlPair} 原先**只在新建时**
 * 置 {@code pending}，更新分支沿用旧的 {@code synced}，且更新不发变更事件。后果是
 * 「编辑样本」在界面上显示成功且「已同步」，**wren 侧却永远是旧 SQL**（不会重推），
 * 「停用」也不会被回收（Worker 配置缓存不失效）。而知识条目那条路径有
 * {@code markKnowledgePending} —— 样本对漏了，属同口径缺口。
 *
 * <p>本用例守住三条：① 改 wren_sql → 回 pending + 清回填；② 停用 → 同样回 pending
 * （下游据此回收 wren 侧文件）；③ 无实质变化 → 保留 synced，不制造无谓重推。
 */
@ExtendWith(MockitoExtension.class)
class IqdSqlPairUpdateTest {

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
    private static final long PAIR_ID = 501L;
    private static final Instant SYNCED_AT = Instant.parse("2024-01-15T08:30:00Z");
    private static final String QUESTION = "月活多少";
    private static final String OLD_SQL = "SELECT count(*) FROM users";

    /** 一条已同步的既有样本。 */
    private IqdSqlPair syncedPair() {
        IqdSqlPair pair = new IqdSqlPair();
        pair.setId(PAIR_ID);
        pair.setConnectionId(CONNECTION_ID);
        pair.setQuestion(QUESTION);
        pair.setWrenSql(OLD_SQL);
        pair.setSourceDialect("mysql");
        pair.setNativeSql(OLD_SQL);
        pair.setRemark("r");
        pair.setEnabled(1);
        pair.setSyncStatus("synced");
        pair.setWrenRefId("mdl_old");
        pair.setSyncedAt(SYNCED_AT);
        pair.setCreatedAt(SYNCED_AT);
        pair.setUpdatedAt(SYNCED_AT);
        return pair;
    }

    private IqdSqlPairSaveRequest request(String wrenSql, Boolean enabled) {
        return new IqdSqlPairSaveRequest(
                CONNECTION_ID, QUESTION, "mysql", wrenSql, wrenSql, "r", enabled, PAIR_ID);
    }

    @Test
    @DisplayName("改 wren_sql：按主键更新，且回到 pending 并清空上次回填")
    void changedSql_updatesInPlace_andResetsSyncState() {
        IqdSqlPair entity = syncedPair();
        when(connectionRepository.existsById(CONNECTION_ID)).thenReturn(true);
        when(sqlPairRepository.findById(PAIR_ID)).thenReturn(Optional.of(entity));
        when(sqlPairRepository.save(any(IqdSqlPair.class))).thenAnswer(inv -> inv.getArgument(0));

        IqdSqlPairVO vo = service.saveSqlPair(request("SELECT count(DISTINCT uid) FROM users", true));

        assertEquals("pending", vo.getSyncStatus(), "wren_sql 变更必须回到 pending，否则改了不再下发");
        assertNull(entity.getWrenRefId(), "回填位需清空，等待下次 build 重新回填");
        assertNull(entity.getSyncedAt());
        verify(changeEventPublisher)
                .publish(eq("iqd.enhancement.changed"), eq("sql_pair_updated=" + PAIR_ID));
    }

    @Test
    @DisplayName("停用样本：同样回到 pending（下游据此回收 wren 侧样本文件）")
    void disable_resetsSyncState() {
        IqdSqlPair entity = syncedPair();
        when(connectionRepository.existsById(CONNECTION_ID)).thenReturn(true);
        when(sqlPairRepository.findById(PAIR_ID)).thenReturn(Optional.of(entity));
        when(sqlPairRepository.save(any(IqdSqlPair.class))).thenAnswer(inv -> inv.getArgument(0));

        IqdSqlPairVO vo = service.saveSqlPair(request(OLD_SQL, false));

        assertEquals(0, entity.getEnabled());
        assertEquals("pending", vo.getSyncStatus());
        assertNull(entity.getWrenRefId());
        verify(changeEventPublisher)
                .publish(eq("iqd.enhancement.changed"), eq("sql_pair_updated=" + PAIR_ID));
    }

    @Test
    @DisplayName("无实质变化：保留 synced，不制造无谓的重新下发")
    void unchanged_keepsSyncedState() {
        IqdSqlPair entity = syncedPair();
        when(connectionRepository.existsById(CONNECTION_ID)).thenReturn(true);
        when(sqlPairRepository.findById(PAIR_ID)).thenReturn(Optional.of(entity));
        when(sqlPairRepository.save(any(IqdSqlPair.class))).thenAnswer(inv -> inv.getArgument(0));

        IqdSqlPairVO vo = service.saveSqlPair(request(OLD_SQL, true));

        assertEquals("synced", vo.getSyncStatus());
        assertEquals("mdl_old", entity.getWrenRefId());
    }
}
