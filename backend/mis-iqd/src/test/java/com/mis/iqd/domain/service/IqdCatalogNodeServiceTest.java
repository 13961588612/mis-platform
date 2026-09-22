package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.iqd.api.dto.ValidateExprResult;
import com.mis.iqd.domain.entity.IqdCatalogItem;
import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.entity.IqdEditIdempotency;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdEditIdempotencyRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 建模台 T02a「由表生成模型 + 表达式校验」Java 逻辑单测（契约守卫）。
 *
 * <p>纯 Mockito 单测（不加载 Spring、不依赖活体 DB / WrenAI），聚焦 T02a 新增逻辑：
 * <ul>
 *   <li>{@code createModelFromTable} 正常路径：一次事务落 {@code kind=table/model/column}
 *       + bump {@code current_edit_revision} + 写幂等键 + 发 {@code iqd.catalog.changed}；</li>
 *   <li>幂等双通道：① 幂等键命中 ② 语义幂等（同源表重复导入）—— 均**不 bump**；</li>
 *   <li>错误码三条：<b>40900</b>（base_revision 不符）/ <b>42200</b>（源表不存在/参数非法）/
 *       <b>40901</b>（同 key 并发双提交撞幂等表 PK）；</li>
 *   <li>{@code validateExpression}：合法表达式通过；含未知字段则列出 errors。</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class IqdCatalogNodeServiceTest {

    @Mock IqdConnectionRepository connectionRepository;
    @Mock IqdCatalogItemRepository catalogItemRepository;
    @Mock IqdEditIdempotencyRepository idempotencyRepository;
    @Mock IqdAdminService adminService;
    @Mock IqdChangeEventPublisher changeEventPublisher;
    @Mock ObjectMapper objectMapper;

    @InjectMocks
    IqdCatalogNodeService service;

    private static final long CONN_ID = 7L;

    private IqdConnection conn(long revision) {
        IqdConnection c = new IqdConnection();
        c.setId(CONN_ID);
        c.setCurrentEditRevision(revision);
        c.setBuiltEditRevision(revision);
        c.setMdlWritebackEnabled(true);
        c.setStaleDrift(false);
        return c;
    }

    /** 请求体：source_table 自带 columns（导入路径主用，免去「先同步 MDL」硬依赖）。 */
    private Map<String, Object> bodyWithColumns() {
        List<Map<String, Object>> cols = new ArrayList<>();
        Map<String, Object> id = new LinkedHashMap<>();
        id.put("name", "order_id");
        id.put("type", "bigint");
        id.put("is_primary_key", true);
        Map<String, Object> amount = new LinkedHashMap<>();
        amount.put("name", "amount");
        amount.put("type", "numeric");
        cols.add(id);
        cols.add(amount);

        Map<String, Object> sourceTable = new LinkedHashMap<>();
        sourceTable.put("schema", "public");
        sourceTable.put("name", "orders");
        sourceTable.put("columns", cols);
        return sourceTable;
    }

    private void stubNoExistingNodes() {
        when(catalogItemRepository.findByConnectionId(anyLong())).thenReturn(new ArrayList<>());
        when(catalogItemRepository.findByConnectionIdAndItemKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());
        when(catalogItemRepository.findByConnectionIdAndParentKey(anyLong(), anyString()))
                .thenReturn(new ArrayList<>());
        when(catalogItemRepository.save(any(IqdCatalogItem.class))).thenAnswer(inv -> inv.getArgument(0));
        when(connectionRepository.save(any(IqdConnection.class))).thenAnswer(inv -> inv.getArgument(0));
        when(idempotencyRepository.save(any(IqdEditIdempotency.class))).thenAnswer(inv -> inv.getArgument(0));
        when(adminService.validateCatalogRefs(anyLong(), anyString(), anyString()))
                .thenReturn(new ArrayList<>());
    }

    // ------------------------------------------------------------ 正常路径

    @Test
    void createModelFromTable_happyPath_writesTableModelColumn_bumpsRevision_and_publishes() {
        IqdConnection c = conn(12L);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(CONN_ID, "key-1"))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();

        Map<String, Object> result = service.createModelFromTable(
                CONN_ID, bodyWithColumns(), "mdl:model:orders", 12L, "key-1");

        assertEquals(13L, result.get("edit_revision"));
        assertEquals("EDITED_UNSYNCED", result.get("edit_status"));
        assertEquals("mdl:model:orders", result.get("item_key"));
        assertEquals("pg_main.public.orders", result.get("table_key"));
        @SuppressWarnings("unchecked")
        Map<String, String> mapping = (Map<String, String>) result.get("column_mapping");
        assertEquals(2, mapping.size());
        assertEquals("pg_main.public.orders.order_id", mapping.get("order_id"));

        // bump 到 13 并落库
        assertEquals(13L, c.getCurrentEditRevision());
        verify(connectionRepository).save(c);

        // table + 2 columns + model = 4 行 upsert，全部 source='modeling'、edit_revision=13
        ArgumentCaptor<IqdCatalogItem> captor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(4)).save(captor.capture());
        List<String> kinds = captor.getAllValues().stream().map(IqdCatalogItem::getKind).toList();
        assertTrue(kinds.contains("table"));
        assertTrue(kinds.contains("model"));
        assertEquals(2, kinds.stream().filter("column"::equals).count());
        for (IqdCatalogItem saved : captor.getAllValues()) {
            assertEquals("modeling", saved.getSource());
            assertEquals(13L, saved.getEditRevision());
            // 未显式传 in_scope ⇒ 默认 false（PRD §6.3「导入 ≠ 可问」）
            assertEquals(0, saved.getInScope().intValue());
        }

        // 幂等键落库 + 变更事件
        verify(idempotencyRepository).save(any(IqdEditIdempotency.class));
        verify(changeEventPublisher).publish(eq("iqd.catalog.changed"), anyString());
    }

    // ------------------------------------------------------------ 幂等双通道（均不 bump）

    @Test
    void createModelFromTable_idempotencyKeyHit_returnsFirstResult_withoutBump() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(CONN_ID, "key-dup"))
                .thenReturn(Optional.of(new IqdEditIdempotency(CONN_ID, "key-dup", 9L)));
        when(catalogItemRepository.findByConnectionId(anyLong())).thenReturn(new ArrayList<>());

        Map<String, Object> result = service.createModelFromTable(
                CONN_ID, bodyWithColumns(), "mdl:model:orders", null, "key-dup");

        assertEquals(9L, result.get("edit_revision"));
        verify(connectionRepository, never()).save(any(IqdConnection.class));
        verify(changeEventPublisher, never()).publish(anyString(), anyString());
    }

    @Test
    void createModelFromTable_sameSourceTableRepeat_semanticIdempotent_withoutBump() {
        IqdConnection c = conn(12L);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        IqdCatalogItem existingModel = new IqdCatalogItem();
        existingModel.setItemKey("mdl:model:orders");
        existingModel.setKind("model");
        existingModel.setDisplayName("orders");
        existingModel.setEditRevision(5L);
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, "mdl:model:orders"))
                .thenReturn(Optional.of(existingModel));
        when(catalogItemRepository.findByConnectionId(anyLong())).thenReturn(new ArrayList<>());

        Map<String, Object> result = service.createModelFromTable(
                CONN_ID, bodyWithColumns(), "mdl:model:orders", 12L, "key-new-uuid");

        assertEquals(5L, result.get("edit_revision"));
        verify(connectionRepository, never()).save(any(IqdConnection.class));
    }

    // ------------------------------------------------------------ in_scope 治理边界（PRD §6.3）

    /**
     * 契约守卫：`in_scope` **默认 false**，仅显式 true 才纳入问数范围。
     *
     * <p>PRD §6.3：「导入的表不自动纳入问数范围（in_scope 默认 false，引导去 /iqd/scope 勾选
     * —— 导入 ≠ 可问，权限边界不因建模便利而放松）」。若此处回归成「默认 true」，
     * 建模型动作会顺手把表开给所有持有问数权限的人，属**静默治理边界扩大**。
     */
    @Test
    void createModelFromTable_inScopeDefaultsFalse_andOnlyExplicitTrueOptsIn() {
        // ① 缺省（options = null）→ 全部节点 in_scope = 0
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();

        service.createModelFromTable(CONN_ID, bodyWithColumns(), "mdl:model:orders", 12L, "k-default");

        ArgumentCaptor<IqdCatalogItem> defCaptor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(4)).save(defCaptor.capture());
        for (IqdCatalogItem saved : defCaptor.getAllValues()) {
            assertEquals(0, saved.getInScope().intValue(),
                    "未显式传 in_scope ⇒ 必须为 0（导入 ≠ 可问）");
        }

        // ② 显式 in_scope=true → 全部节点 in_scope = 1（保留覆盖能力）
        org.mockito.Mockito.reset(catalogItemRepository, connectionRepository, idempotencyRepository);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();

        service.createModelFromTable(CONN_ID, bodyWithColumns(), "mdl:model:orders2", 12L, "k-true",
                Map.of("in_scope", true));

        ArgumentCaptor<IqdCatalogItem> trueCaptor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(4)).save(trueCaptor.capture());
        for (IqdCatalogItem saved : trueCaptor.getAllValues()) {
            assertEquals(1, saved.getInScope().intValue(),
                    "显式 in_scope=true ⇒ 必须纳入范围");
        }

        // ③ 显式 in_scope=false 与缺省等价（不纳入）
        org.mockito.Mockito.reset(catalogItemRepository, connectionRepository, idempotencyRepository);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();

        service.createModelFromTable(CONN_ID, bodyWithColumns(), "mdl:model:orders3", 12L, "k-false",
                Map.of("in_scope", false));

        ArgumentCaptor<IqdCatalogItem> falseCaptor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(4)).save(falseCaptor.capture());
        for (IqdCatalogItem saved : falseCaptor.getAllValues()) {
            assertEquals(0, saved.getInScope().intValue());
        }
    }

    // ------------------------------------------------------------ 错误码 40900 / 42200 / 40901

    @Test
    void createModelFromTable_staleBaseRevision_throws40900_withCurrentRevision() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        when(catalogItemRepository.findByConnectionIdAndItemKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createModelFromTable(CONN_ID, bodyWithColumns(), "mdl:model:orders", 11L, "key-1"));

        assertEquals(40900, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals(12L, data.get("current_edit_revision"));
    }

    @Test
    void createModelFromTable_sourceTableMissing_throws42200() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        // 无既有 model / 无 table 行 / 无 column 行 / mdl_raw 为空 → 三级回退全落空
        when(catalogItemRepository.findByConnectionIdAndItemKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());
        when(catalogItemRepository.findByConnectionId(anyLong())).thenReturn(new ArrayList<>());
        when(catalogItemRepository.findByConnectionIdAndParentKey(anyLong(), anyString()))
                .thenReturn(new ArrayList<>());

        Map<String, Object> sourceTable = new LinkedHashMap<>();
        sourceTable.put("schema", "public");
        sourceTable.put("name", "ghost_table");

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createModelFromTable(CONN_ID, sourceTable, "mdl:model:ghost", 12L, "key-1"));

        assertEquals(42200, ex.getCode());
        assertTrue(ex.getMessage().contains("ghost_table"));
    }

    @Test
    void createModelFromTable_blankTableName_throws42200() {
        Map<String, Object> sourceTable = new LinkedHashMap<>();
        sourceTable.put("schema", "public");
        sourceTable.put("name", "  ");

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createModelFromTable(CONN_ID, sourceTable, "mdl:model:x", 12L, "key-1"));

        assertEquals(42200, ex.getCode());
    }

    @Test
    void createModelFromTable_duplicateIdempotencyKeyConcurrently_throws40901() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();
        // 竞态：查重为空，但落库时撞 iqd_edit_idempotency 主键 (connection_id, idempotency_key)
        when(idempotencyRepository.save(any(IqdEditIdempotency.class)))
                .thenThrow(new DataIntegrityViolationException("duplicate key"));

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createModelFromTable(CONN_ID, bodyWithColumns(), "mdl:model:orders", 12L, "key-race"));

        assertEquals(40901, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals("key-race", data.get("idempotency_key"));
    }

    @Test
    void createModelFromTable_writebackDisabled_throws40300() {
        IqdConnection c = conn(12L);
        c.setMdlWritebackEnabled(false);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createModelFromTable(CONN_ID, bodyWithColumns(), "mdl:model:orders", null, "k"));

        assertEquals(40300, ex.getCode());
    }

    // ------------------------------------------------------------ validateExpression

    @Test
    void validateExpression_knownFields_valid() {
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);
        List<IqdCatalogItem> items = new ArrayList<>();
        items.add(catalogNode("mdl:model:orders", "model", "orders", null));
        items.add(catalogNode("pg_main.public.orders", "table", "orders", null));
        items.add(catalogNode("pg_main.public.orders.amount", "column", "amount", "pg_main.public.orders"));
        when(catalogItemRepository.findByConnectionId(CONN_ID)).thenReturn(items);

        ValidateExprResult ok = service.validateExpression(CONN_ID, "mdl:model:orders", "SUM(amount)");
        assertTrue(ok.isValid(), () -> "expected valid, errors=" + ok.getErrors());
        assertTrue(ok.getErrors().isEmpty());

        ValidateExprResult bad = service.validateExpression(CONN_ID, "mdl:model:orders", "SUM(nonexistent_col)");
        assertFalse(bad.isValid());
        assertTrue(bad.getErrors().stream().anyMatch(e -> e.contains("nonexistent_col")));
    }

    @Test
    void validateExpression_blank_and_unbalanced_reported() {
        ValidateExprResult blank = service.validateExpression(CONN_ID, "mdl:model:orders", "   ");
        assertFalse(blank.isValid());

        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);
        List<IqdCatalogItem> items = new ArrayList<>();
        items.add(catalogNode("mdl:model:orders", "model", "orders", null));
        items.add(catalogNode("pg_main.public.orders.amount", "column", "amount", "pg_main.public.orders"));
        when(catalogItemRepository.findByConnectionId(CONN_ID)).thenReturn(items);

        ValidateExprResult unbalanced = service.validateExpression(CONN_ID, "mdl:model:orders", "SUM(amount");
        assertFalse(unbalanced.isValid());
        assertTrue(unbalanced.getErrors().stream().anyMatch(e -> e.contains("括号")));
    }

    private IqdCatalogItem catalogNode(String itemKey, String kind, String displayName, String parentKey) {
        IqdCatalogItem it = new IqdCatalogItem();
        it.setItemKey(itemKey);
        it.setKind(kind);
        it.setDisplayName(displayName);
        it.setParentKey(parentKey);
        return it;
    }

    // ------------------------------------------------------------ listDependents（复用既有扫描）

    @Test
    void listDependents_delegatesTo_referenceScan() {
        List<Map<String, Object>> deps = new ArrayList<>();
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("item_key", "mdl:cube:revenue");
        d.put("kind", "cube");
        deps.add(d);
        when(adminService.validateCatalogRefs(CONN_ID, "mdl:model:orders", "EDIT")).thenReturn(deps);

        var out = service.listDependents(CONN_ID, "mdl:model:orders");

        assertNotNull(out);
        assertEquals(1, out.getTotal());
        assertEquals("mdl:cube:revenue", out.getDependents().get(0).getItemKey());
        assertEquals("cube", out.getDependents().get(0).getKind());
    }
}
