package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iqd.domain.entity.IqdCatalogItem;
import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.entity.IqdEditIdempotency;
import com.mis.iqd.domain.entity.IqdSyncJob;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdEditIdempotencyRepository;
import com.mis.iqd.domain.repository.IqdKnowledgeRepository;
import com.mis.iqd.domain.repository.IqdSqlPairRepository;
import com.mis.iqd.domain.repository.IqdSyncJobRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * mis-iqd 二期「语义模型编辑能力」Java 逻辑单测（契约守卫）。
 *
 * <p>纯 Mockito 单测（不加载 Spring 容器，不依赖活体 DB / WrenAI），聚焦本期
 * IqdAdminService 新增的编辑写回核心逻辑（设计 §六 T03 / PRD P0-1~P0-12）：
 * <ul>
 *   <li>{@code updateCatalogNode}：正常 200（bump edit_revision / 置 platform_edit）、
 *       base_revision 过期 409、改名被引用 422；</li>
 *   <li>{@code validateCatalogRefs}：返回直接引用方（不递归）；</li>
 *   <li>{@code backfillCatalogSync}：按 revision 批量盖章 + 推进 built 态；</li>
 *   <li>{@code getCatalogSyncStatus} / {@code checkExternalDrift} / {@code reconcileCatalog}：状态机与漂移；</li>
 *   <li>{@code getCatalogFull}：契约守卫——必须返回 current_edit_revision 供 backfill 断点续盖。</li>
 * </ul>
 *
 * <p>末条 {@code getCatalogFull_includes_current_edit_revision} 是契约证明用例：
 * 设计 §7.2 / §九.1 要求 build 成功后按 connection 的 current_edit_revision 回填
 * （stampCatalogSync WHERE edit_revision <= :built）。该 revision 由
 * ai-platform {@code trigger_model_build} 从 get_catalog_full 响应读取；若 Java
 * getCatalogFull 不返回该字段，ai-platform 回填 edit_revision=0，stampCatalogSync 的
 * {@code edit_revision <= 0} 永远匹配不到平台已编辑节点（edit_revision >= 1），
 * 导致 stamped_count 恒为 0、built_edit_revision 被重置为 0、current > built 永久成立、
 * 同步状态机永不收敛 SYNCED（违反 PRD G-B / G6）。修复（补返回该字段）前该用例失败，
 * 作为回归守卫与本次源码缺陷的精确定位点。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class IqdAdminEditTest {

    @Mock IqdConnectionRepository connectionRepository;
    @Mock IqdCatalogItemRepository catalogItemRepository;
    @Mock IqdSqlPairRepository sqlPairRepository;
    @Mock IqdKnowledgeRepository knowledgeRepository;
    @Mock IqdSyncJobRepository syncJobRepository;
    @Mock IqdEditIdempotencyRepository editIdempotencyRepository;

    // 其余构造参数（本期测试不直接触达，mock 以满足 InjectMocks 构造）
    @Mock com.mis.iqd.domain.repository.IqdAskLogRepository askLogRepository;
    @Mock com.mis.iqd.domain.repository.IqdScopePolicyRepository scopePolicyRepository;
    @Mock com.mis.iqd.domain.repository.IqdTableAclRepository tableAclRepository;
    @Mock com.mis.iqd.domain.repository.IqdMaskRuleRepository maskRuleRepository;
    @Mock com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository dimensionRepository;
    @Mock com.mis.iqd.domain.service.IqdChangeEventPublisher changeEventPublisher;
    @Mock ObjectMapper objectMapper;

    @InjectMocks
    IqdAdminService service;

    private static final long CONN_ID = 7L;

    private IqdConnection primaryConn() {
        IqdConnection c = new IqdConnection();
        c.setId(CONN_ID);
        c.setCurrentEditRevision(12L);
        c.setBuiltEditRevision(12L);
        c.setMdlWritebackEnabled(true);
        c.setMdlRaw("{\"models\":[]}");
        c.setStaleDrift(false);
        return c;
    }

    private IqdCatalogItem item(String itemKey, String kind, String displayName, String expression) {
        IqdCatalogItem it = new IqdCatalogItem();
        it.setItemKey(itemKey);
        it.setKind(kind);
        it.setDisplayName(displayName);
        it.setExpression(expression);
        return it;
    }

    // ------------------------------------------------------------ P0-1 updateCatalogNode 正常 200

    @Test
    void updateCatalogNode_success_bumpsRevision_and_returnsEditStatus() {
        IqdConnection conn = primaryConn();
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(conn));
        when(editIdempotencyRepository.findByConnectionIdAndIdempotencyKey(CONN_ID, "key-1"))
                .thenReturn(Optional.empty());
        IqdCatalogItem it = item("mdl:model:orders", "model", "订单", null);
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, "mdl:model:orders"))
                .thenReturn(Optional.of(it));
        when(connectionRepository.save(any(IqdConnection.class))).thenAnswer(inv -> inv.getArgument(0));
        when(catalogItemRepository.save(any(IqdCatalogItem.class))).thenAnswer(inv -> inv.getArgument(0));
        when(editIdempotencyRepository.save(any(IqdEditIdempotency.class))).thenAnswer(inv -> inv.getArgument(0));

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("description", "订单主表");
        Map<String, Object> result = service.updateCatalogNode(
                CONN_ID, "mdl:model:orders", "model", patch, 12L, "key-1");

        assertEquals(13L, result.get("edit_revision"));
        assertEquals("EDITED_UNSYNCED", result.get("edit_status"));
        assertNull(result.get("wren_ref_id"));
        // 落库副作用
        assertEquals(13L, conn.getCurrentEditRevision());
        assertEquals("platform_edit", it.getSource());
        assertEquals(13L, it.getEditRevision());
        assertEquals("订单主表", it.getDescription());
        verify(editIdempotencyRepository, times(1)).save(any(IqdEditIdempotency.class));
    }

    // ------------------------------------------------------------ P0-3 base_revision 冲突 409

    @Test
    void updateCatalogNode_baseRevisionMismatch_throws409_withCurrentRevision() {
        IqdConnection conn = primaryConn(); // current=12
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(conn));
        when(editIdempotencyRepository.findByConnectionIdAndIdempotencyKey(CONN_ID, "key-2"))
                .thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class, () ->
                service.updateCatalogNode(CONN_ID, "mdl:model:orders", "model",
                        new LinkedHashMap<>(), 99L, "key-2"));

        assertEquals(40900, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertNotNull(data);
        assertEquals(12L, data.get("current_edit_revision"));
    }

    // ------------------------------------------------------------ U1 改名被引用 422

    @Test
    void updateCatalogNode_renameReferencedNode_throws422_withDependents() {
        IqdConnection conn = primaryConn(); // current=12, mdlWritebackEnabled=true
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(conn));
        when(editIdempotencyRepository.findByConnectionIdAndIdempotencyKey(CONN_ID, "key-3"))
                .thenReturn(Optional.empty());
        IqdCatalogItem it = item("mdl:model:orders", "model", "orders", null);
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, "mdl:model:orders"))
                .thenReturn(Optional.of(it));
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true); // validateCatalogRefs→ensureConnection
        // 直接引用方：其 expression 含本 item_key
        IqdCatalogItem ref = item("mdl:cube:revenue", "cube", "营收", "uses mdl:model:orders");
        when(catalogItemRepository.findByConnectionId(CONN_ID)).thenReturn(List.of(ref));
        when(sqlPairRepository.findByConnectionIdOrderByIdDesc(CONN_ID)).thenReturn(List.of());
        when(knowledgeRepository.findByConnectionIdOrderByIdDesc(CONN_ID)).thenReturn(List.of());

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("display_name", "orders_renamed"); // 改名 → 触发引用校验
        BusinessException ex = assertThrows(BusinessException.class, () ->
                service.updateCatalogNode(CONN_ID, "mdl:model:orders", "model", patch, 12L, "key-3"));

        assertEquals(42200, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertNotNull(data);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> deps = (List<Map<String, Object>>) data.get("dependents");
        assertNotNull(deps);
        assertFalse(deps.isEmpty(), "被引用节点应返回依赖方列表");
        assertEquals("mdl:cube:revenue", deps.get(0).get("item_key"));
        // 422 阻断：版本不应 bump
        assertEquals(12L, conn.getCurrentEditRevision());
    }

    // ------------------------------------------------------------ P0-4 validateCatalogRefs 直接引用方

    @Test
    void validateCatalogRefs_returnsDirectDependents_only() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);
        IqdCatalogItem ref = item("mdl:cube:revenue", "cube", "营收", "uses mdl:model:orders");
        when(catalogItemRepository.findByConnectionId(CONN_ID)).thenReturn(List.of(ref));
        when(sqlPairRepository.findByConnectionIdOrderByIdDesc(CONN_ID)).thenReturn(List.of());
        when(knowledgeRepository.findByConnectionIdOrderByIdDesc(CONN_ID)).thenReturn(List.of());

        List<Map<String, Object>> deps = service.validateCatalogRefs(CONN_ID, "mdl:model:orders", "DELETE");

        assertEquals(1, deps.size());
        assertEquals("mdl:cube:revenue", deps.get(0).get("item_key"));
        assertEquals("cube", deps.get(0).get("kind"));
    }

    // ------------------------------------------------------------ P0-8 backfillCatalogSync 批量盖章

    @Test
    void backfillCatalogSync_stampsUpToBuiltRevision_and_advancesConnection() {
        IqdConnection conn = primaryConn();
        when(catalogItemRepository.stampCatalogSync(eq(CONN_ID), eq("hash_abc"), eq(13L))).thenReturn(5);
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(conn));
        when(connectionRepository.save(any(IqdConnection.class))).thenAnswer(inv -> inv.getArgument(0));

        int stamped = service.backfillCatalogSync(CONN_ID, "hash_abc", 13L);

        assertEquals(5, stamped);
        assertEquals(13L, conn.getBuiltEditRevision());
        assertEquals("hash_abc", conn.getBuiltMdlHash());
        assertFalse(conn.getStaleDrift());
    }

    // ------------------------------------------------------------ P0-6 getCatalogSyncStatus 派生

    @Test
    void getCatalogSyncStatus_derives_EDITED_UNSYNCED_when_ahead() {
        IqdConnection conn = primaryConn(); // current=12, built=12
        conn.setCurrentEditRevision(13L);   // current > built
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(conn));
        IqdSyncJob job = new IqdSyncJob();
        job.setBuildStatus("success");
        when(syncJobRepository.findTopByConnectionIdOrderByIdDesc(CONN_ID)).thenReturn(Optional.of(job));

        Map<String, Object> status = service.getCatalogSyncStatus(CONN_ID);

        assertEquals("EDITED_UNSYNCED", status.get("edit_status"));
        assertEquals(13L, status.get("current_edit_revision"));
        assertEquals(12L, status.get("built_edit_revision"));
    }

    @Test
    void getCatalogSyncStatus_derives_STALE_DRIFT_when_flagged() {
        IqdConnection conn = primaryConn();
        conn.setStaleDrift(true);
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(conn));
        when(syncJobRepository.findTopByConnectionIdOrderByIdDesc(CONN_ID)).thenReturn(Optional.empty());

        Map<String, Object> status = service.getCatalogSyncStatus(CONN_ID);

        assertEquals("STALE_DRIFT", status.get("edit_status"));
        assertEquals(true, status.get("stale_drift"));
    }

    // ------------------------------------------------------------ S3 checkExternalDrift

    @Test
    void checkExternalDrift_true_when_stale_or_ahead() {
        IqdConnection stale = primaryConn();
        stale.setStaleDrift(true);
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(stale));
        assertTrue(service.checkExternalDrift(CONN_ID));

        IqdConnection ahead = primaryConn();
        ahead.setCurrentEditRevision(5L);
        ahead.setBuiltEditRevision(3L);
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(ahead));
        assertTrue(service.checkExternalDrift(CONN_ID));

        IqdConnection synced = primaryConn();
        synced.setCurrentEditRevision(3L);
        synced.setBuiltEditRevision(3L);
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(synced));
        assertFalse(service.checkExternalDrift(CONN_ID));
    }

    // ------------------------------------------------------------ P0-10 reconcileCatalog 清漂移

    @Test
    void reconcileCatalog_clearsStaleDrift_and_returnsTriggered() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);
        when(connectionRepository.setStaleDrift(CONN_ID, false)).thenReturn(1);

        Map<String, Object> result = service.reconcileCatalog(CONN_ID);

        assertEquals(true, result.get("triggered"));
        verify(connectionRepository, times(1)).setStaleDrift(CONN_ID, false);
    }

    // ------------------------------------------------------------ 契约守卫（本次源码缺陷定位点）

    @Test
    void getCatalogFull_includes_current_edit_revision_for_backfill() {
        IqdConnection conn = primaryConn();
        conn.setCurrentEditRevision(13L);
        conn.setMdlRaw("{\"models\":[{\"name\":\"orders\",\"source\":\"db.public.orders\"}]}");
        when(connectionRepository.findPrimary(CONN_ID)).thenReturn(Optional.of(conn));
        when(catalogItemRepository.findEditedItems(CONN_ID)).thenReturn(List.of());

        Map<String, Object> body = service.getCatalogFull(CONN_ID);

        assertTrue(body.containsKey("current_edit_revision"),
                "getCatalogFull 必须返回 current_edit_revision，否则 ai-platform 回填 edit_revision=0 致 stamped 恒为 0（违反 PRD G-B/G6）");
        assertEquals(13L, body.get("current_edit_revision"));
    }
}
