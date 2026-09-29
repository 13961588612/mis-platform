package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.iqd.api.dto.IqdModelingCreateResponse;
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
import static org.junit.jupiter.api.Assertions.assertNull;
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

    // ============================================================ T03 createModel（空白模型）

    @Test
    void createModel_writesModelNode_bumpsRevision_andPublishes() {
        IqdConnection c = conn(12L);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        stubNoExistingNodes();

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("display_name", "orders_new");
        patch.put("description", "空模型");

        IqdModelingCreateResponse result = service.createModel(
                CONN_ID, "mdl:model:orders_new", patch, 12L, "1:model:create:uuid");

        assertEquals(13L, result.getEditRevision());
        assertEquals("EDITED_UNSYNCED", result.getEditStatus());
        verify(connectionRepository).save(c);

        ArgumentCaptor<IqdCatalogItem> captor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(1)).save(captor.capture());
        IqdCatalogItem saved = captor.getValue();
        assertEquals("model", saved.getKind());
        assertEquals("mdl:model:orders_new", saved.getItemKey());
        assertEquals("orders_new", saved.getDisplayName());
        assertEquals("modeling", saved.getSource());
        assertEquals(13L, saved.getEditRevision());
        assertEquals(0, saved.getInScope().intValue(), "语义对象默认不自动纳入问数范围");
        verify(idempotencyRepository).save(any(IqdEditIdempotency.class));
        verify(changeEventPublisher).publish(eq("iqd.catalog.changed"), anyString());
    }

    @Test
    void createModel_requiresMdlModelItemKeyPrefix_throws42200() {
        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createModel(CONN_ID, "mdl:cube:revenue", Map.of(), 12L, "k"));
        assertEquals(42200, ex.getCode());
    }

    /**
     * 回归守卫：语义键的「名字」取**最后一个冒号之后**，不是最后一个点之后。
     *
     * <p>{@code mdl:model:orders} 里没有点，若用按 {@code .} 切分的 lastSegment 会得到整串
     * {@code mdl:model:orders} 当 display_name（并进一步污染 cube 子节点键，如
     * {@code mdl:measure:mdl:cube:revenue.total}）。
     */
    @Test
    void createModel_defaultsDisplayNameToSemanticKeyTail() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        stubNoExistingNodes();

        service.createModel(CONN_ID, "mdl:model:orders", Map.of(), 12L, "k-tail");

        ArgumentCaptor<IqdCatalogItem> captor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository).save(captor.capture());
        assertEquals("orders", captor.getValue().getDisplayName());
    }

    @Test
    void createModel_staleBaseRevision_throws40900_withCurrentRevision() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        stubNoExistingNodes();

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createModel(CONN_ID, "mdl:model:orders", Map.of(), 11L, "k"));

        assertEquals(40900, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals(12L, data.get("current_edit_revision"));
    }

    // ============================================================ T03 createRelationship

    @Test
    void createRelationship_writesEnvelopeNode_bumpsRevision() {
        IqdConnection c = conn(12L);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        stubNoExistingNodes();
        stubOrderAndCustomerModels();

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("join_type", "inner");
        patch.put("cardinality", "1:N");
        patch.put("condition", "orders.customer_id = customers.id");
        patch.put("source_model", "mdl:model:orders");
        patch.put("target_model", "mdl:model:customers");

        IqdModelingCreateResponse result = service.createRelationship(
                CONN_ID, "mdl:relationship:orders_customers", patch, 12L, "1:relationship:create:u");

        assertEquals(13L, result.getEditRevision());

        ArgumentCaptor<IqdCatalogItem> captor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(1)).save(captor.capture());
        IqdCatalogItem saved = captor.getValue();
        assertEquals("relationship", saved.getKind());
        assertEquals("mdl:relationship:orders_customers", saved.getItemKey());
        assertEquals("orders_customers", saved.getDisplayName(), "语义键末段（冒号后），非整串");
        assertEquals("mdl:model:orders", saved.getParentKey(), "parent_key = 源模型键（血缘）");
        assertTrue(saved.getExpression().contains("\"join_type\":\"inner\""));
        assertTrue(saved.getExpression().contains("\"source_model\":\"mdl:model:orders\""));
        assertTrue(saved.getExpression().contains("\"target_model\":\"mdl:model:customers\""));
        assertTrue(saved.getExpression().contains("orders.customer_id = customers.id"));
        assertEquals(0, saved.getInScope().intValue());
    }

    @Test
    void createRelationship_conditionReferencesUnknownField_throws42200() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        stubNoExistingNodes();
        stubOrderAndCustomerModels();

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("condition", "orders.customer_id = customers.ghost_col");
        patch.put("source_model", "mdl:model:orders");
        patch.put("target_model", "mdl:model:customers");

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createRelationship(CONN_ID, "mdl:relationship:r", patch, 12L, "k"));

        assertEquals(42200, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertTrue(String.valueOf(data.get("unknown_fields")).contains("ghost_col"));
    }

    @Test
    void createRelationship_missingTargetModel_throws42200() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        stubNoExistingNodes();
        stubOrderAndCustomerModels();

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("condition", "orders.customer_id = customers.id");
        patch.put("source_model", "mdl:model:orders");
        patch.put("target_model", "mdl:model:ghost");

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createRelationship(CONN_ID, "mdl:relationship:r", patch, 12L, "k"));

        assertEquals(42200, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals("target_model", data.get("field"));
        assertEquals("mdl:model:ghost", data.get("model_item_key"));
    }

    // ============================================================ T03 createCube（model_ref 落库）

    @Test
    void createCube_writesModelRef_andMeasureDimensionChildren() {
        IqdConnection c = conn(12L);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        stubNoExistingNodes();
        stubOrderModelWithFields();

        Map<String, Object> measure = new LinkedHashMap<>();
        measure.put("name", "total");
        measure.put("expression", "SUM(amount)");
        measure.put("format", "¥#,##0.00");
        Map<String, Object> dimension = new LinkedHashMap<>();
        dimension.put("name", "store_id");
        dimension.put("ref_model_field", "orders.store_id");
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("display_name", "营收");
        patch.put("model_ref", "mdl:model:orders");
        patch.put("measures", List.of(measure));
        patch.put("dimensions", List.of(dimension));

        IqdModelingCreateResponse result = service.createCube(
                CONN_ID, "mdl:cube:revenue", patch, 12L, "1:cube:create:u");

        assertEquals(13L, result.getEditRevision());

        ArgumentCaptor<IqdCatalogItem> captor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(3)).save(captor.capture());
        List<IqdCatalogItem> saved = captor.getAllValues();

        IqdCatalogItem cube = saved.stream().filter(i -> "cube".equals(i.getKind())).findFirst().orElseThrow();
        assertEquals("mdl:cube:revenue", cube.getItemKey());
        assertEquals("营收", cube.getDisplayName());
        assertEquals("mdl:model:orders", cube.getModelRef(), "★ cube 必须写入 model_ref（V89）");
        assertEquals("mdl:model:orders", cube.getParentKey());
        assertEquals(null, cube.getExpression(), "cube 的 expression 是二义列，不写");

        IqdCatalogItem m = saved.stream().filter(i -> "measure".equals(i.getKind())).findFirst().orElseThrow();
        assertEquals("mdl:measure:revenue.total", m.getItemKey());
        assertEquals("mdl:cube:revenue", m.getParentKey());
        assertEquals("SUM(amount)", m.getExpression());
        assertEquals("¥#,##0.00", m.getDataType());

        IqdCatalogItem d = saved.stream().filter(i -> "dimension".equals(i.getKind())).findFirst().orElseThrow();
        assertEquals("mdl:dimension:revenue.store_id", d.getItemKey());
        assertEquals("mdl:cube:revenue", d.getParentKey());
        assertEquals("orders.store_id", d.getExpression());

        for (IqdCatalogItem item : saved) {
            assertEquals("modeling", item.getSource());
            assertEquals(13L, item.getEditRevision());
        }
    }

    @Test
    void createCube_missingModelRefTarget_throws42200() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        stubNoExistingNodes();
        stubOrderModelWithFields();

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("model_ref", "mdl:model:ghost");

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createCube(CONN_ID, "mdl:cube:revenue", patch, 12L, "k"));

        assertEquals(42200, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals("model_ref", data.get("field"));
    }

    @Test
    void createCube_measureExpressionReferencesUnknownField_throws42201() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        stubNoExistingNodes();
        stubOrderModelWithFields();

        Map<String, Object> measure = new LinkedHashMap<>();
        measure.put("name", "bad");
        measure.put("expression", "SUM(ghost_amount)");
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("model_ref", "mdl:model:orders");
        patch.put("measures", List.of(measure));

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createCube(CONN_ID, "mdl:cube:bad", patch, 12L, "k"));

        assertEquals(42201, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertTrue(String.valueOf(data.get("errors")).contains("ghost_amount"));
        assertEquals("mdl:model:orders", data.get("model_ref"));
    }

    // ============================================================ T03 createCalculatedColumn

    @Test
    void createCalculatedColumn_writesKindColumnUnderModel_validatedTrue() {
        IqdConnection c = conn(12L);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        stubNoExistingNodes();
        stubOrderModelWithFields();
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);

        Map<String, Object> result = service.createCalculatedColumn(
                CONN_ID, "mdl:model:orders", "margin", "amount * 0.2", 12L, "1:column:create:u");

        assertEquals(13L, result.get("edit_revision"));
        assertEquals("EDITED_UNSYNCED", result.get("edit_status"));
        assertEquals("calc:orders.margin", result.get("item_key"), "§8.6 calc:<model>.<column_name>");
        assertEquals(Boolean.TRUE, result.get("validated"));

        ArgumentCaptor<IqdCatalogItem> captor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(1)).save(captor.capture());
        IqdCatalogItem saved = captor.getValue();
        assertEquals("column", saved.getKind());
        assertEquals("calc:orders.margin", saved.getItemKey());
        assertEquals("mdl:model:orders", saved.getParentKey());
        assertEquals("margin", saved.getDisplayName());
        assertEquals("amount * 0.2", saved.getExpression());
        assertEquals(0, saved.getInScope().intValue());
    }

    @Test
    void createCalculatedColumn_expressionReferencesUnknownField_throws42201() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        stubNoExistingNodes();
        stubOrderModelWithFields();
        when(connectionRepository.existsById(CONN_ID)).thenReturn(true);

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createCalculatedColumn(
                        CONN_ID, "mdl:model:orders", "margin", "ghost_col * 2", 12L, "k"));

        assertEquals(42201, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertTrue(String.valueOf(data.get("errors")).contains("ghost_col"));
        assertEquals("calc:orders.margin", data.get("item_key"));
    }

    @Test
    void createCalculatedColumn_writebackDisabled_throws40300() {
        IqdConnection c = conn(12L);
        c.setMdlWritebackEnabled(false);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.createCalculatedColumn(
                        CONN_ID, "mdl:model:orders", "margin", "amount * 2", null, "k"));

        assertEquals(40300, ex.getCode());
    }

    // ============================================================ T04a upsertCube（更新既有 Cube）

    /**
     * 正常更新：cube 自身字段（display_name / model_ref）+ 子节点增删改齐全。
     *
     * <p>既有：measure {@code total} + dimension {@code store_id}；
     * patch：度量 {@code total}（改表达式）+ 新增度量 {@code cnt}；{@code dimensions=[]}
     * （→ 本端点 PUT 全量替换语义 ⇒ 既有 {@code store_id} 被孤儿清理）。
     */
    @Test
    void upsertCube_happyPath_updatesSelf_upsertsChildren_prunesOrphans_bumpsRevision() {
        IqdConnection c = conn(12L);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();
        stubOrderModelWithFields();
        stubExistingCubeWithChildren();

        Map<String, Object> measureTotal = new LinkedHashMap<>();
        measureTotal.put("name", "total");
        measureTotal.put("expression", "SUM(amount) * 1.1");
        measureTotal.put("format", "¥#,##0.00");
        Map<String, Object> measureCnt = new LinkedHashMap<>();
        measureCnt.put("name", "cnt");
        measureCnt.put("expression", "COUNT(amount)");
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("display_name", "营收(更新)");
        patch.put("model_ref", "mdl:model:orders");
        patch.put("measures", List.of(measureTotal, measureCnt));
        patch.put("dimensions", List.of());

        IqdModelingCreateResponse result = service.upsertCube(
                CONN_ID, "mdl:cube:revenue", patch, 12L, "1:cube:update:u");

        // ① edit_revision 确实被 bump
        assertEquals(13L, result.getEditRevision());
        assertEquals("EDITED_UNSYNCED", result.getEditStatus());
        assertEquals(13L, c.getCurrentEditRevision());
        verify(connectionRepository).save(c);

        // ② cube 自身字段被更新 + 两个 measure upsert（共 3 次 save）
        ArgumentCaptor<IqdCatalogItem> captor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(3)).save(captor.capture());
        List<IqdCatalogItem> saved = captor.getAllValues();

        IqdCatalogItem cube = saved.stream()
                .filter(i -> "cube".equals(i.getKind()) && "mdl:cube:revenue".equals(i.getItemKey()))
                .findFirst().orElseThrow();
        assertEquals("营收(更新)", cube.getDisplayName());
        assertEquals("mdl:model:orders", cube.getModelRef(), "★ model_ref 保持/更新为所属模型");
        assertEquals(13L, cube.getEditRevision());
        assertEquals(0, cube.getInScope().intValue(), "语义对象不自动纳入问数范围");
        assertNull(cube.getExpression(), "cube 的 expression 是二义列，保持 NULL");

        assertEquals(2, saved.stream().filter(i -> "measure".equals(i.getKind())).count(),
                "total（更新）+ cnt（新增）");
        assertTrue(saved.stream().anyMatch(i -> "measure".equals(i.getKind())
                        && "SUM(amount) * 1.1".equals(i.getExpression())),
                "既有 measure total 的表达式被更新");
        assertTrue(saved.stream().anyMatch(i -> "measure".equals(i.getKind())
                        && "mdl:measure:revenue.cnt".equals(i.getItemKey())),
                "新增 measure cnt 落库");

        // ③ 孤儿清理：本次未出现的既有 dimension store_id 被物理删除
        ArgumentCaptor<IqdCatalogItem> delCaptor = ArgumentCaptor.forClass(IqdCatalogItem.class);
        verify(catalogItemRepository, times(1)).delete(delCaptor.capture());
        assertEquals("mdl:dimension:revenue.store_id", delCaptor.getValue().getItemKey());

        // ④ 幂等键落库 + 变更事件
        verify(idempotencyRepository).save(any(IqdEditIdempotency.class));
        verify(changeEventPublisher).publish(eq("iqd.catalog.changed"), anyString());
    }

    /** 孤儿清理：仅删本次未出现的子节点；本次仍出现的既有子节点不得被删。 */
    @Test
    void upsertCube_keepsResubmittedChildren_andPrunesOnlyMissingOnes() {
        IqdConnection c = conn(12L);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();
        stubOrderModelWithFields();
        stubExistingCubeWithChildren();

        // 既有 total（measure）/ store_id（dimension）两个都在 patch 里 → 无孤儿
        Map<String, Object> measureTotal = new LinkedHashMap<>();
        measureTotal.put("name", "total");
        measureTotal.put("expression", "SUM(amount)");
        Map<String, Object> dimension = new LinkedHashMap<>();
        dimension.put("name", "store_id");
        dimension.put("ref_model_field", "orders.store_id");
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("model_ref", "mdl:model:orders");
        patch.put("measures", List.of(measureTotal));
        patch.put("dimensions", List.of(dimension));

        service.upsertCube(CONN_ID, "mdl:cube:revenue", patch, 12L, "k");

        verify(catalogItemRepository, never()).delete(any(IqdCatalogItem.class));
    }

    @Test
    void upsertCube_staleBaseRevision_throws40900_withCurrentRevision() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();
        stubOrderModelWithFields();
        stubExistingCubeWithChildren();

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.upsertCube(CONN_ID, "mdl:cube:revenue",
                        Map.of("model_ref", "mdl:model:orders"), 11L, "k"));

        assertEquals(40900, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals(12L, data.get("current_edit_revision"));
    }

    @Test
    void upsertCube_duplicateIdempotencyKeyConcurrently_throws40901() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();
        stubOrderModelWithFields();
        stubExistingCubeWithChildren();
        // 竞态：查重为空，但落库撞 iqd_edit_idempotency 主键 (connection_id, idempotency_key)
        when(idempotencyRepository.save(any(IqdEditIdempotency.class)))
                .thenThrow(new DataIntegrityViolationException("duplicate key"));

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.upsertCube(CONN_ID, "mdl:cube:revenue",
                        Map.of("model_ref", "mdl:model:orders"), 12L, "key-race"));

        assertEquals(40901, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals("key-race", data.get("idempotency_key"));
    }

    @Test
    void upsertCube_missingCube_throws42200() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.upsertCube(CONN_ID, "mdl:cube:ghost",
                        Map.of("model_ref", "mdl:model:orders"), 12L, "k"));

        assertEquals(42200, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals("mdl:cube:ghost", data.get("item_key"));
    }

    @Test
    void upsertCube_modelRefTargetMissing_throws42200() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();
        stubOrderModelWithFields();
        stubExistingCubeWithChildren();

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.upsertCube(CONN_ID, "mdl:cube:revenue",
                        Map.of("model_ref", "mdl:model:ghost"), 12L, "k"));

        assertEquals(42200, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertEquals("model_ref", data.get("field"));
        assertEquals("mdl:model:ghost", data.get("model_item_key"));
    }

    @Test
    void upsertCube_measureExpressionReferencesUnknownField_throws42201() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();
        stubOrderModelWithFields();
        stubExistingCubeWithChildren();

        Map<String, Object> bad = new LinkedHashMap<>();
        bad.put("name", "bad");
        bad.put("expression", "SUM(ghost_amount)");
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("model_ref", "mdl:model:orders");
        patch.put("measures", List.of(bad));

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.upsertCube(CONN_ID, "mdl:cube:revenue", patch, 12L, "k"));

        assertEquals(42201, ex.getCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) ex.getData();
        assertTrue(String.valueOf(data.get("errors")).contains("ghost_amount"));
        assertEquals("mdl:model:orders", data.get("model_ref"));
    }

    /**
     * T04a 加固契约守卫：既有 cube 的 {@code model_ref} 为 NULL 且 patch 未补时，
     * **必须 42200 打回**（否则派生侧 {@code _materialize_missing_nodes} 会产出无
     * {@code baseObject} 的非法 cube —— 静默降级）。
     */
    @Test
    void upsertCube_existingCubeWithoutModelRef_andPatchOmitsIt_throws42200() {
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(conn(12L)));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(eq(CONN_ID), anyString()))
                .thenReturn(Optional.empty());
        stubNoExistingNodes();
        stubOrderModelWithFields();
        // 既有 cube 存在，但 model_ref = NULL
        IqdCatalogItem cube = catalogNode("mdl:cube:revenue", "cube", "revenue", null);
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, "mdl:cube:revenue"))
                .thenReturn(Optional.of(cube));

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(BusinessException.class,
                () -> service.upsertCube(CONN_ID, "mdl:cube:revenue",
                        Map.of("display_name", "营收"), 12L, "k"));

        assertEquals(42200, ex.getCode());
        assertTrue(ex.getMessage().contains("model_ref"));
    }

    // ------------------------------------------------------------ 测试装配辅助（T03）

    /** 覆盖既有「空库」桩（先 generic 后 specific，specific 生效）。 */
    private void stubOrderModelWithFields() {
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, "mdl:model:orders"))
                .thenReturn(Optional.of(catalogNode("mdl:model:orders", "model", "orders", null)));
        when(catalogItemRepository.findByConnectionId(CONN_ID)).thenReturn(orderFields());
    }

    private void stubOrderAndCustomerModels() {
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, "mdl:model:orders"))
                .thenReturn(Optional.of(catalogNode("mdl:model:orders", "model", "orders", null)));
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, "mdl:model:customers"))
                .thenReturn(Optional.of(catalogNode("mdl:model:customers", "model", "customers", null)));
        when(catalogItemRepository.findByConnectionId(CONN_ID)).thenReturn(orderAndCustomerFields());
    }

    private List<IqdCatalogItem> orderFields() {
        List<IqdCatalogItem> items = new ArrayList<>();
        items.add(catalogNode("mdl:model:orders", "model", "orders", null));
        items.add(catalogNode("pg_main.public.orders", "table", "orders", null));
        items.add(catalogNode("pg_main.public.orders.amount", "column", "amount", "pg_main.public.orders"));
        items.add(catalogNode("pg_main.public.orders.store_id", "column", "store_id", "pg_main.public.orders"));
        items.add(catalogNode("pg_main.public.orders.customer_id", "column", "customer_id", "pg_main.public.orders"));
        return items;
    }

    /**
     * 桩：既有 cube {@code mdl:cube:revenue}（{@code model_ref=mdl:model:orders}）+ 两个子节点
     * （measure {@code total} / dimension {@code store_id}）。
     *
     * <p>覆盖 {@link #stubNoExistingNodes()} 对 cube / 子节点键的 generic 空桩
     * （Mockito：后定义的更具体桩生效）。
     */
    private void stubExistingCubeWithChildren() {
        IqdCatalogItem cube = catalogNode("mdl:cube:revenue", "cube", "revenue", "mdl:model:orders");
        cube.setModelRef("mdl:model:orders");
        cube.setEditRevision(5L);
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, "mdl:cube:revenue"))
                .thenReturn(Optional.of(cube));

        IqdCatalogItem total = catalogNode("mdl:measure:revenue.total", "measure", "total", "mdl:cube:revenue");
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, "mdl:measure:revenue.total"))
                .thenReturn(Optional.of(total));

        List<IqdCatalogItem> children = new ArrayList<>();
        children.add(total);
        children.add(catalogNode("mdl:dimension:revenue.store_id", "dimension", "store_id", "mdl:cube:revenue"));
        when(catalogItemRepository.findByConnectionIdAndParentKey(CONN_ID, "mdl:cube:revenue"))
                .thenReturn(children);
    }

    private List<IqdCatalogItem> orderAndCustomerFields() {
        List<IqdCatalogItem> items = orderFields();
        items.add(catalogNode("mdl:model:customers", "model", "customers", null));
        items.add(catalogNode("pg_main.public.customers", "table", "customers", null));
        items.add(catalogNode("pg_main.public.customers.id", "column", "id", "pg_main.public.customers"));
        items.add(catalogNode("pg_main.public.customers.name", "column", "name", "pg_main.public.customers"));
        return items;
    }


    // ------------------------------------------------------------ 删除关系（T03c，2026-09-29）

    /** 造一条既有关系节点（kind=relationship）。 */
    private IqdCatalogItem relationshipNode() {
        IqdCatalogItem item = new IqdCatalogItem();
        item.setId(9001L);
        item.setConnectionId(CONN_ID);
        item.setItemKey("mdl:relationship:sale_ord_store");
        item.setKind("relationship");
        item.setParentKey("mdl:model:a");
        item.setDisplayName("sale_ord_store");
        return item;
    }

    @Test
    void deleteRelationship_happyPath_deletes_bumpsRevision_and_publishes() {
        IqdConnection c = conn(3);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        IqdCatalogItem item = relationshipNode();
        when(catalogItemRepository.findByConnectionIdAndItemKey(CONN_ID, item.getItemKey()))
                .thenReturn(Optional.of(item));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());
        when(adminService.validateCatalogRefs(eq(CONN_ID), eq(item.getItemKey()), eq("DELETE")))
                .thenReturn(new ArrayList<>());
        when(connectionRepository.save(any(IqdConnection.class))).thenAnswer(inv -> inv.getArgument(0));

        Map<String, Object> result = service.deleteRelationship(CONN_ID, item.getItemKey(), 3L, "idem-1");

        verify(catalogItemRepository).delete(item);
        assertEquals(4L, c.getCurrentEditRevision());
        assertEquals(4L, result.get("edit_revision"));
        assertEquals(item.getItemKey(), result.get("deleted_item_key"));
        verify(changeEventPublisher).publish(eq("iqd.catalog.changed"), anyString());
    }

    @Test
    void deleteRelationship_wrongPrefix_throws42200() {
        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(
                BusinessException.class,
                () -> service.deleteRelationship(CONN_ID, "mdl:model:orders", null, null));
        assertEquals(42200, ex.getCode());
    }

    @Test
    void deleteRelationship_notFound_throws40400() {
        IqdConnection c = conn(1);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        when(catalogItemRepository.findByConnectionIdAndItemKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(
                BusinessException.class,
                () -> service.deleteRelationship(CONN_ID, "mdl:relationship:ghost", null, null));
        assertEquals(40400, ex.getCode());
        verify(catalogItemRepository, never()).delete(any(IqdCatalogItem.class));
    }

    @Test
    void deleteRelationship_notRelationshipKind_throws42200() {
        IqdConnection c = conn(1);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        IqdCatalogItem cube = new IqdCatalogItem();
        cube.setItemKey("mdl:relationship:x");
        cube.setKind("cube");
        when(catalogItemRepository.findByConnectionIdAndItemKey(anyLong(), anyString()))
                .thenReturn(Optional.of(cube));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(
                BusinessException.class,
                () -> service.deleteRelationship(CONN_ID, "mdl:relationship:x", null, null));
        assertEquals(42200, ex.getCode());
    }

    @Test
    void deleteRelationship_baseRevisionMismatch_throws40900() {
        IqdConnection c = conn(5);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        when(catalogItemRepository.findByConnectionIdAndItemKey(anyLong(), anyString()))
                .thenReturn(Optional.of(relationshipNode()));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(
                BusinessException.class,
                () -> service.deleteRelationship(CONN_ID, "mdl:relationship:sale_ord_store", 3L, null));
        assertEquals(40900, ex.getCode());
        verify(catalogItemRepository, never()).delete(any(IqdCatalogItem.class));
    }

    @Test
    void deleteRelationship_referenced_throws42200_withDependents() {
        IqdConnection c = conn(2);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        IqdCatalogItem item = relationshipNode();
        when(catalogItemRepository.findByConnectionIdAndItemKey(anyLong(), anyString()))
                .thenReturn(Optional.of(item));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());
        Map<String, Object> dep = new LinkedHashMap<>();
        dep.put("item_key", "mdl:cube:x");
        dep.put("kind", "cube");
        when(adminService.validateCatalogRefs(anyLong(), anyString(), eq("DELETE")))
                .thenReturn(List.of(dep));

        BusinessException ex = org.junit.jupiter.api.Assertions.assertThrows(
                BusinessException.class,
                () -> service.deleteRelationship(CONN_ID, item.getItemKey(), null, null));
        assertEquals(42200, ex.getCode());
        verify(catalogItemRepository, never()).delete(any(IqdCatalogItem.class));
    }

    @Test
    void deleteRelationship_idempotentHit_returnsFirstRevision_withoutDelete() {
        IqdConnection c = conn(3);
        when(connectionRepository.findById(CONN_ID)).thenReturn(Optional.of(c));
        when(idempotencyRepository.findByConnectionIdAndIdempotencyKey(CONN_ID, "idem-9"))
                .thenReturn(Optional.of(new IqdEditIdempotency(CONN_ID, "idem-9", 4L)));

        Map<String, Object> result = service.deleteRelationship(
                CONN_ID, "mdl:relationship:sale_ord_store", null, "idem-9");

        assertEquals(4L, result.get("edit_revision"));
        verify(catalogItemRepository, never()).delete(any(IqdCatalogItem.class));
    }

}
