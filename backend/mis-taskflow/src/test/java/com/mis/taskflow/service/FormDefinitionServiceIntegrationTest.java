package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.FormDefinition;
import com.mis.taskflow.domain.entity.WfDefinition;
import com.mis.taskflow.domain.repository.FormDefinitionRepository;
import com.mis.taskflow.domain.repository.WfDefinitionRepository;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.UpsertFormDefinitionRequest;
import com.mis.taskflow.dto.WfInstanceVO;
import com.mis.taskflow.dto.WfNodeDTO;
import com.mis.taskflow.support.FormTestFixtures;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 业务表单注册表集成测试（form_definition + 取消发布 + 白名单强校验）。真实库，事务回滚。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class FormDefinitionServiceIntegrationTest {

    private static final long TENANT = 900006L;

    @Autowired private FormDefinitionService formService;
    @Autowired private FormDefinitionRepository formRepository;
    @Autowired private WfDefinitionService definitionService;
    @Autowired private WfDefinitionRepository definitionRepository;
    @Autowired private ProcessService processService;

    private String uniqCode(String prefix) {
        return prefix + "_" + System.nanoTime();
    }

    private Long newForm(String code, String name) {
        return formService.create(TENANT, 1L, new UpsertFormDefinitionRequest(
                FormDefinition.ROOT_PARENT_ID, code, name, null, FormDefinition.STATUS_ENABLED, 0, "{}"));
    }

    private Long newFormUnder(Long parentId, String code, String name) {
        return formService.create(TENANT, 1L, new UpsertFormDefinitionRequest(
                parentId, code, name, null, FormDefinition.STATUS_ENABLED, 0, "{}"));
    }

    private List<WfNodeDTO> nodes() {
        return List.of(
                new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                new WfNodeDTO("approve", "主管审批", "APPROVAL", 1, null, null, null,
                        "{\"type\":\"FIXED\",\"value\":700001}", 24, "{}"),
                new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}"));
    }

    // ------------------------------------------------------------------
    // T1.4 CRUD
    // ------------------------------------------------------------------

    @Test
    @DisplayName("T1.4：新增后可读回，code 大小写精确匹配")
    void createAndGet() {
        String code = uniqCode("FORM");
        Long id = newForm(code, "采购表单");

        var vo = formService.get(id, TENANT);
        assertEquals(code, vo.code());
        assertEquals("采购表单", vo.name());
        assertEquals(FormDefinition.STATUS_ENABLED, vo.status());
        assertEquals(FormDefinition.ROOT_PARENT_ID, vo.parentId());
        assertNotNull(vo.createdAt());
    }

    @Test
    @DisplayName("T1.4：code 重复被拒")
    void duplicateCodeRejected() {
        String code = uniqCode("FORM");
        newForm(code, "表单A");

        BusinessException e = assertThrows(BusinessException.class, () -> newForm(code, "表单B"));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), e.getCode());
    }

    @Test
    @DisplayName("T1.4：软删后 code 不可复用（历史实例仍按此编码渲染）")
    void codeNotReusableAfterSoftDelete() {
        String code = uniqCode("FORM");
        Long id = newForm(code, "临时表单");
        formService.delete(id, TENANT);

        assertEquals(1, formRepository.findByTenantIdAndCode(TENANT, code).orElseThrow().getDeleted());

        BusinessException e = assertThrows(BusinessException.class, () -> newForm(code, "再来一个"));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), e.getCode());
        assertTrue(e.getMessage().contains("不可复用"));
    }

    @Test
    @DisplayName("T1.4：更新可改名称/状态，但 code 不可改")
    void updateChangesFieldsButNotCode() {
        String code = uniqCode("FORM");
        Long id = newForm(code, "原名");

        formService.update(id, TENANT, new UpsertFormDefinitionRequest(
                FormDefinition.ROOT_PARENT_ID, code, "改名", "说明", FormDefinition.STATUS_DISABLED, 9, "{}"));
        var vo = formService.get(id, TENANT);
        assertEquals("改名", vo.name());
        assertEquals(FormDefinition.STATUS_DISABLED, vo.status());
        assertEquals(9, vo.sortOrder());

        BusinessException e = assertThrows(BusinessException.class, () -> formService.update(id, TENANT,
                new UpsertFormDefinitionRequest(FormDefinition.ROOT_PARENT_ID, uniqCode("OTHER"),
                        "再改", null, null, 0, "{}")));
        assertTrue(e.getMessage().contains("编码不可修改"));
    }

    @Test
    @DisplayName("T1.4：分类树三层收敛——第四层被拒")
    void treeDepthLimitedToThree() {
        String root = uniqCode("CAT");
        Long l1 = newFormUnder(FormDefinition.ROOT_PARENT_ID, root, "一级分类");
        Long l2 = newFormUnder(l1, uniqCode("GRP"), "二级分类");
        Long l3 = newFormUnder(l2, uniqCode("FORM"), "表单");

        assertNotNull(l3, "根 → 分类 → 表单三层应允许");
        BusinessException e = assertThrows(BusinessException.class,
                () -> newFormUnder(l3, uniqCode("FORM"), "第四层"));
        assertTrue(e.getMessage().contains("层级最多三层"));
    }

    @Test
    @DisplayName("T1.4：父分类不存在被拒；父分类不能是自己")
    void invalidParentRejected() {
        assertThrows(BusinessException.class,
                () -> newFormUnder(999999999L, uniqCode("FORM"), "孤儿"));

        Long self = newFormUnder(FormDefinition.ROOT_PARENT_ID, uniqCode("CAT"), "分类");
        assertThrows(BusinessException.class, () -> formService.update(self, TENANT,
                new UpsertFormDefinitionRequest(self, uniqCode("CAT"), "自环", null, null, 0, "{}")));
    }

    @Test
    @DisplayName("T1.4：tree 接口按父子组装 children")
    void treeAssemblesChildren() {
        Long rootId = newFormUnder(FormDefinition.ROOT_PARENT_ID, uniqCode("CAT"), "分类");
        newFormUnder(rootId, uniqCode("FORM"), "子表单A");
        newFormUnder(rootId, uniqCode("FORM"), "子表单B");

        var roots = formService.tree(TENANT);
        var root = roots.stream().filter(f -> rootId.toString().equals(f.id())).findFirst().orElseThrow();
        assertEquals(2, root.children().size(), "该分类下应有 2 个子表单");
        assertTrue(root.children().stream().allMatch(c -> c.children() == null), "叶子节点不应再挂 children");
    }

    @Test
    @DisplayName("T1.4：listEnabled 只返回启用项")
    void listEnabledFiltersDisabled() {
        String enabledCode = uniqCode("FORM");
        String disabledCode = uniqCode("FORM");
        newForm(enabledCode, "启用");
        Long off = newForm(disabledCode, "停用");
        formService.update(off, TENANT, new UpsertFormDefinitionRequest(
                FormDefinition.ROOT_PARENT_ID, disabledCode, "停用", null, FormDefinition.STATUS_DISABLED, 0, "{}"));

        var codes = formService.listEnabled(TENANT).stream().map(v -> v.code()).toList();
        assertTrue(codes.contains(enabledCode));
        assertTrue(!codes.contains(disabledCode), "停用项不应出现在候选清单里");
        assertEquals(2, formService.list(TENANT).size(), "平铺列表应含启用 + 停用两项");
    }

    // ------------------------------------------------------------------
    // T1.4 删除引用校验
    // ------------------------------------------------------------------

    @Test
    @DisplayName("T1.4：被流程白名单引用时删除被拒")
    void deleteRejectedWhenReferencedByDefinition() {
        String code = uniqCode("FORM");
        Long formId = newForm(code, "被引用表单");
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "引用流程", "APPROVAL", null,
                        List.of(code), "{}", nodes()));

        BusinessException e = assertThrows(BusinessException.class, () -> formService.delete(formId, TENANT));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), e.getCode());
        assertTrue(e.getMessage().contains("流程定义引用"));

        // 清掉引用后可删
        definitionService.update(defId, TENANT, new CreateDefinitionRequest(
                "FLOW_" + System.nanoTime(), "引用流程", "APPROVAL", null, List.of(), "{}", nodes()));
        formService.delete(formId, TENANT);
        assertEquals(1, formRepository.findById(formId).orElseThrow().getDeleted());
    }

    @Test
    @DisplayName("T1.4：有子项时删除分类被拒")
    void deleteRejectedWhenHasChildren() {
        Long parentId = newFormUnder(FormDefinition.ROOT_PARENT_ID, uniqCode("CAT"), "有子项的分类");
        newFormUnder(parentId, uniqCode("FORM"), "子表单");

        BusinessException e = assertThrows(BusinessException.class, () -> formService.delete(parentId, TENANT));
        assertTrue(e.getMessage().contains("子项"));
    }

    // ------------------------------------------------------------------
    // T1.3 取消发布
    // ------------------------------------------------------------------

    @Test
    @DisplayName("T1.3：deactivate 把 ACTIVE 改回 DRAFT，且之后可编辑")
    void deactivateAllowsEditingAfterwards() {
        String code = uniqCode("FLOW");
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(code, "可编辑流程", "APPROVAL", null, List.of(), "{}", nodes()));
        definitionService.activate(defId, TENANT);
        assertEquals(WfDefinition.STATUS_ACTIVE, definitionService.get(defId, TENANT).status());

        // ACTIVE 状态下编辑被拒
        assertThrows(BusinessException.class, () -> definitionService.update(defId, TENANT,
                new CreateDefinitionRequest(code, "改名", "APPROVAL", null, List.of(), "{}", nodes())));

        definitionService.deactivate(defId, TENANT);
        assertEquals(WfDefinition.STATUS_DRAFT, definitionService.get(defId, TENANT).status());

        // 取消发布后必须能编辑
        definitionService.update(defId, TENANT, new CreateDefinitionRequest(
                code, "改名成功", "APPROVAL", null, List.of(), "{}", nodes()));
        assertEquals("改名成功", definitionService.get(defId, TENANT).name());
    }

    @Test
    @DisplayName("T1.3：deactivate 幂等——非 ACTIVE 重复调用不抛错、不改状态")
    void deactivateIsIdempotent() {
        String code = uniqCode("FLOW");
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(code, "幂等流程", "APPROVAL", null, List.of(), "{}", nodes()));

        // DRAFT 状态直接 deactivate
        definitionService.deactivate(defId, TENANT);
        assertEquals(WfDefinition.STATUS_DRAFT, definitionService.get(defId, TENANT).status());

        definitionService.activate(defId, TENANT);
        definitionService.deactivate(defId, TENANT);
        definitionService.deactivate(defId, TENANT);
        assertEquals(WfDefinition.STATUS_DRAFT, definitionService.get(defId, TENANT).status());
    }

    @Test
    @DisplayName("T1.3：deactivate 只改 status，不删定义（同 code 多版本并存语义）")
    void deactivateDoesNotDeleteDefinition() {
        String code = uniqCode("FLOW");
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(code, "留存流程", "APPROVAL", null, List.of(), "{}", nodes()));
        definitionService.activate(defId, TENANT);
        definitionService.deactivate(defId, TENANT);

        assertTrue(definitionRepository.findById(defId).isPresent(), "定义行必须仍在");
        assertEquals(0, definitionRepository.findById(defId).orElseThrow().getDeleted(), "不得被软删");
    }

    // ------------------------------------------------------------------
    // T1.5 白名单强校验
    // ------------------------------------------------------------------

    @Test
    @DisplayName("T1.5：白名单含未注册 formCode ⇒ VALIDATION_ERROR")
    void createRejectsUnregisteredFormCode() {
        BusinessException e = assertThrows(BusinessException.class, () -> definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "含未注册表单", "APPROVAL", null,
                        List.of(uniqCode("NOPE")), "{}", nodes())));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), e.getCode());
        assertTrue(e.getMessage().contains("未注册或已停用"));
    }

    @Test
    @DisplayName("T1.5：白名单含已停用 formCode ⇒ VALIDATION_ERROR")
    void createRejectsDisabledFormCode() {
        String code = uniqCode("FORM");
        Long formId = newForm(code, "将被停用");
        formService.update(formId, TENANT, new UpsertFormDefinitionRequest(
                FormDefinition.ROOT_PARENT_ID, code, "将被停用", null, FormDefinition.STATUS_DISABLED, 0, "{}"));

        BusinessException e = assertThrows(BusinessException.class, () -> definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "含停用表单", "APPROVAL", null,
                        List.of(code), "{}", nodes())));
        assertTrue(e.getMessage().contains("未注册或已停用"));
    }

    @Test
    @DisplayName("T1.5：update 同样强校验；已停用后重新启用即可保存")
    void updateAlsoValidatesWhitelist() {
        String code = uniqCode("FORM");
        newForm(code, "表单");
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "更新校验流程", "APPROVAL", null,
                        List.of(code), "{}", nodes()));

        //换成未注册的 code
        assertThrows(BusinessException.class, () -> definitionService.update(defId, TENANT,
                new CreateDefinitionRequest("FLOW_" + System.nanoTime(), "更新校验流程", "APPROVAL", null,
                        List.of(uniqCode("NOPE")), "{}", nodes())));

        // 停用该表单后，保留它的 update 也应被拒
        Long formId = formRepository.findByTenantIdAndCode(TENANT, code).orElseThrow().getId();
        formService.update(formId, TENANT, new UpsertFormDefinitionRequest(
                FormDefinition.ROOT_PARENT_ID, code, "表单", null, FormDefinition.STATUS_DISABLED, 0, "{}"));
        assertThrows(BusinessException.class, () -> definitionService.update(defId, TENANT,
                new CreateDefinitionRequest("FLOW_" + System.nanoTime(), "更新校验流程", "APPROVAL", null,
                        List.of(code), "{}", nodes())));

        // 重新启用后放行
        formService.update(formId, TENANT, new UpsertFormDefinitionRequest(
                FormDefinition.ROOT_PARENT_ID, code, "表单", null, FormDefinition.STATUS_ENABLED, 0, "{}"));
        definitionService.update(defId, TENANT, new CreateDefinitionRequest(
                "FLOW_" + System.nanoTime(), "改名", "APPROVAL", null, List.of(code), "{}", nodes()));
        assertEquals("改名", definitionService.get(defId, TENANT).name());
    }

    @Test
    @DisplayName("T1.5：白名单为空时不做校验（老流程定义可继续编辑）")
    void emptyWhitelistSkipsValidation() {
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "无白名单流程", "APPROVAL", null,
                        List.of(), "{}", nodes()));
        assertNotNull(defId);
    }

    @Test
    @DisplayName("T1.5：已注册启用的表单可正常保存")
    void createAcceptsRegisteredFormCode() {
        String code = uniqCode("FORM");
        FormTestFixtures.register(formService, TENANT, code, "合法表单");
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "合法流程", "APPROVAL", null,
                        List.of(code), "{}", nodes()));
        assertEquals(List.of(code), definitionService.get(defId, TENANT).supportedFormCodes());
    }

    @Test
    @DisplayName("T1.6：ProcessDetailVO.formData 只在 detail 填，列表接口不含")
    void detailCarriesFormDataOnlyInDetail() {
        String code = uniqCode("FORM");
        FormTestFixtures.register(formService, TENANT, code, "带数据表单");
        String flowCode = uniqCode("FLOW");
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                flowCode, "表单数据流程", "APPROVAL", null, List.of(code), "{}", nodes()));
        definitionService.activate(defId, TENANT);

        Long instId = processService.startProcess(TENANT, new StartProcessRequest(
                flowCode, "PURCHASE_ORDER", "PO-" + System.nanoTime(), code,
                "{\"amount\":128000,\"orderNo\":\"PO-2026-0001\"}", 100L, "发起人"));

        var detail = processService.detail(instId, TENANT);
        assertNotNull(detail.formData(), "detail 必须带 formData");
        assertTrue(detail.formData().contains("128000"), "formData 应原样透出表单 JSON: " + detail.formData());

        // WfInstanceVO 里没有 formData 分量 ⇒ my 分页 20 条不会多传 20 份表单 JSON
        assertEquals(0, java.util.Arrays.stream(WfInstanceVO.class.getRecordComponents())
                        .filter(c -> "formData".equals(c.getName())).count(),
                "WfInstanceVO 不应有 formData 分量");
        var page = processService.myInitiated(TENANT, 100L, null, 1, 50);
        var vo = page.getList().stream().filter(v -> v.id().equals(String.valueOf(instId))).findFirst().orElseThrow();
        assertEquals(code, vo.startedFormCode());
    }
}