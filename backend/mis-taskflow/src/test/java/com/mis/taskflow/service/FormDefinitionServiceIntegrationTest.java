package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.BizCategory;
import com.mis.taskflow.domain.entity.FormDefinition;
import com.mis.taskflow.domain.entity.WfDefinition;
import com.mis.taskflow.domain.repository.FormDefinitionRepository;
import com.mis.taskflow.domain.repository.WfDefinitionRepository;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.UpsertBizCategoryRequest;
import com.mis.taskflow.dto.UpsertFormDefinitionRequest;
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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 业务表单注册表集成测试（form_definition + 取消发布 + 白名单强校验）。真实库，事务回滚。
 *
 * <p>V133 起表单不再有树：分类是表单的属性（{@code categoryId}，可空），
 * 「树 / 父子 / 防环 / 删除子项」用例已随分类拆表平移到
 * {@code FormCategoryServiceIntegrationTest}（意图保留、不弱化、不 skip）。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class FormDefinitionServiceIntegrationTest {

    private static final long TENANT = 900006L;

    @Autowired private FormDefinitionService formService;
    @Autowired private FormDefinitionRepository formRepository;
    @Autowired private BizCategoryService categoryService;
    @Autowired private WfDefinitionService definitionService;
    @Autowired private WfDefinitionRepository definitionRepository;
    @Autowired private ProcessService processService;

    private String uniqCode(String prefix) {
        return prefix + "_" + System.nanoTime();
    }

    /** 登记一个未分类的表单。 */
    private Long newForm(String code, String name) {
        return formService.create(TENANT, 1L, new UpsertFormDefinitionRequest(
                null, code, name, null, FormDefinition.STATUS_ENABLED, 0, "{}"));
    }

    /** 登记一个挂在指定分类下的表单。 */
    private Long newFormInCategory(Long categoryId, String code, String name) {
        return formService.create(TENANT, 1L, new UpsertFormDefinitionRequest(
                categoryId, code, name, null, FormDefinition.STATUS_ENABLED, 0, "{}"));
    }

    /** 造一个测试分类。 */
    private Long newCategory(String name) {
        return categoryService.create(TENANT, 1L, new UpsertBizCategoryRequest(
                BizCategory.ROOT_PARENT_ID, uniqCode("CAT"), name, null, 0, "{}"));
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
    @DisplayName("T1.4：新增后可读回，code 大小写精确匹配（默认未分类）")
    void createAndGet() {
        String code = uniqCode("FORM");
        Long id = newForm(code, "采购表单");

        var vo = formService.get(id, TENANT);
        assertEquals(code, vo.code());
        assertEquals("采购表单", vo.name());
        assertEquals(FormDefinition.STATUS_ENABLED, vo.status());
        assertNull(vo.categoryId(), "未指定分类时应为「未分类」");
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
                null, code, "改名", "说明", FormDefinition.STATUS_DISABLED, 9, "{}"));
        var vo = formService.get(id, TENANT);
        assertEquals("改名", vo.name());
        assertEquals(FormDefinition.STATUS_DISABLED, vo.status());
        assertEquals(9, vo.sortOrder());

        BusinessException e = assertThrows(BusinessException.class, () -> formService.update(id, TENANT,
                new UpsertFormDefinitionRequest(null, uniqCode("OTHER"),
                        "再改", null, null, 0, "{}")));
        assertTrue(e.getMessage().contains("编码不可修改"));
    }

    // ------------------------------------------------------------------
    // V133 分类属性（分类是表单的属性，不再是父级）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("V133：新增表单可关联分类，categoryId 读回一致")
    void createWithCategoryAssignsCategoryId() {
        Long catId = newCategory("采购类");
        String code = uniqCode("FORM");
        Long id = newFormInCategory(catId, code, "挂分类表单");

        var vo = formService.get(id, TENANT);
        assertEquals(catId, vo.categoryId(), "表单应记住所属分类 id");
    }

    @Test
    @DisplayName("V133：更新可改分类（含改为未分类）")
    void updateCanChangeCategory() {
        Long catA = newCategory("分类A");
        Long catB = newCategory("分类B");
        String code = uniqCode("FORM");
        Long id = newFormInCategory(catA, code, "改分类表单");

        formService.update(id, TENANT, new UpsertFormDefinitionRequest(
                catB, code, "改分类表单", null, FormDefinition.STATUS_ENABLED, 0, "{}"));
        assertEquals(catB, formService.get(id, TENANT).categoryId());

        formService.update(id, TENANT, new UpsertFormDefinitionRequest(
                null, code, "改分类表单", null, FormDefinition.STATUS_ENABLED, 0, "{}"));
        assertNull(formService.get(id, TENANT).categoryId(), "可改回「未分类」");
    }

    @Test
    @DisplayName("V133：关联不存在的分类被拒")
    void createWithUnknownCategoryRejected() {
        BusinessException e = assertThrows(BusinessException.class,
                () -> newFormInCategory(999999999L, uniqCode("FORM"), "孤儿表单"));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), e.getCode());
        assertTrue(e.getMessage().contains("分类不存在"));
    }

    @Test
    @DisplayName("V133：list 按 categoryId 精确过滤")
    void listFiltersByCategory() {
        Long catA = newCategory("过滤分类A");
        Long catB = newCategory("过滤分类B");
        newFormInCategory(catA, uniqCode("FORM"), "A1");
        newFormInCategory(catA, uniqCode("FORM"), "A2");
        newFormInCategory(catB, uniqCode("FORM"), "B1");

        assertEquals(2, formService.list(TENANT, null, List.of(catA)).size(), "分类 A 下应有 2 个表单");
        assertEquals(1, formService.list(TENANT, null, List.of(catB)).size(), "分类 B 下应有 1 个表单");
        assertTrue(formService.list(TENANT, null, List.of(catA)).stream()
                        .allMatch(v -> catA.equals(v.categoryId())),
                "过滤结果应全部属于分类 A");
    }

    @Test
    @DisplayName("V133：list 多值分类过滤——勾 2 个分类只返回属于这 2 类的表单（精确匹配、不含子分类）")
    void listFiltersByMultipleCategories() {
        Long catA = newCategory("多值分类A");
        Long catB = newCategory("多值分类B");
        Long catC = newCategory("多值分类C");
        Long a1 = newFormInCategory(catA, uniqCode("FORM"), "MA1");
        Long b1 = newFormInCategory(catB, uniqCode("FORM"), "MB1");
        newFormInCategory(catC, uniqCode("FORM"), "MC1");
        // 未分类表单不应被任何分类集合命中
        newForm(uniqCode("FORM"), "未分类表单");

        var result = formService.list(TENANT, null, List.of(catA, catB));
        assertEquals(2, result.size(), "勾选 A、B 应只返回这 2 个分类下的表单（集合 IN 的 OR）");
        assertTrue(result.stream().allMatch(v -> catA.equals(v.categoryId()) || catB.equals(v.categoryId())),
                "结果应只属于分类 A 或 B");
        assertTrue(result.stream().anyMatch(v -> a1.equals(Long.valueOf(v.id()))), "应含 A 类表单");
        assertTrue(result.stream().anyMatch(v -> b1.equals(Long.valueOf(v.id()))), "应含 B 类表单");
        assertTrue(result.stream().noneMatch(v -> catC.equals(v.categoryId())),
                "未勾选的分类 C 的表单不得混入（精确匹配，不含子分类）");
    }

    @Test
    @DisplayName("V133：list 多值分类过滤 + status=ENABLED 只返回启用项")
    void listFiltersByMultipleCategoriesAndStatus() {
        Long catA = newCategory("多值+状态A");
        Long catB = newCategory("多值+状态B");
        String enabledA = uniqCode("FORM");
        String disabledA = uniqCode("FORM");
        Long enA = newFormInCategory(catA, enabledA, "启用A");
        Long disA = newFormInCategory(catA, disabledA, "停用A");
        formService.update(disA, TENANT, new UpsertFormDefinitionRequest(
                catA, disabledA, "停用A", null, FormDefinition.STATUS_DISABLED, 0, "{}"));
        newFormInCategory(catB, uniqCode("FORM"), "启用B");

        var enabled = formService.list(TENANT, "ENABLED", List.of(catA, catB));
        assertEquals(2, enabled.size(), "只应返回 2 条启用项（A 的停用项被过滤）");
        assertTrue(enabled.stream().anyMatch(v -> enA.equals(Long.valueOf(v.id()))));
        assertTrue(enabled.stream().noneMatch(v -> disA.equals(Long.valueOf(v.id()))), "停用项不应返回");
    }

    @Test
    @DisplayName("T1.4：listEnabled 只返回启用项")
    void listEnabledFiltersDisabled() {
        String enabledCode = uniqCode("FORM");
        String disabledCode = uniqCode("FORM");
        newForm(enabledCode, "启用");
        Long off = newForm(disabledCode, "停用");
        formService.update(off, TENANT, new UpsertFormDefinitionRequest(
                null, disabledCode, "停用", null, FormDefinition.STATUS_DISABLED, 0, "{}"));

        var codes = formService.listEnabled(TENANT).stream().map(v -> v.code()).toList();
        assertTrue(codes.contains(enabledCode));
        assertTrue(!codes.contains(disabledCode), "停用项不应出现在候选清单里");
        assertEquals(2, formService.list(TENANT).size(), "平铺列表应含启用 + 停用两项");
    }

    // ------------------------------------------------------------------
    // T1.4 删除引用校验
    // ------------------------------------------------------------------

    @Test
    @DisplayName("T1.4：仅 LOCAL 绑定、无实例时仍可删（关联真相源在表单侧）")
    void deleteAllowedWhenOnlyLocalBound() {
        String code = uniqCode("FORM");
        Long formId = newForm(code, "被引用表单");
        definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "引用流程", "APPROVAL", null,
                        List.of(code), "{}", nodes()));

        formService.delete(formId, TENANT);
        assertEquals(1, formRepository.findById(formId).orElseThrow().getDeleted());
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
    // T1.5 表单侧 LOCAL 绑定（创建流程时可兼容传入 codes → 回写 form_definition）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("T1.5：创建时带未注册 formCode ⇒ VALIDATION_ERROR")
    void createRejectsUnregisteredFormCode() {
        BusinessException e = assertThrows(BusinessException.class, () -> definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "含未注册表单", "APPROVAL", null,
                        List.of(uniqCode("NOPE")), "{}", nodes())));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), e.getCode());
        assertTrue(e.getMessage().contains("未注册") || e.getMessage().contains("停用"));
    }

    @Test
    @DisplayName("T1.5：创建时带已停用 formCode ⇒ VALIDATION_ERROR")
    void createRejectsDisabledFormCode() {
        String code = uniqCode("FORM");
        Long formId = newForm(code, "将被停用");
        formService.update(formId, TENANT, new UpsertFormDefinitionRequest(
                null, code, "将被停用", null, FormDefinition.STATUS_DISABLED, 0, "{}"));

        BusinessException e = assertThrows(BusinessException.class, () -> definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "含停用表单", "APPROVAL", null,
                        List.of(code), "{}", nodes())));
        assertTrue(e.getMessage().contains("停用") || e.getMessage().contains("未注册"));
    }

    @Test
    @DisplayName("T1.5：编排 update 不改关联；关联靠 updateSupportedForms / 表单注册")
    void canvasUpdateDoesNotTouchBindings() {
        String code = uniqCode("FORM");
        newForm(code, "表单");
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "更新校验流程", "APPROVAL", null,
                        List.of(code), "{}", nodes()));
        assertEquals(List.of(code), definitionService.get(defId, TENANT).supportedFormCodes());

        definitionService.update(defId, TENANT, new CreateDefinitionRequest(
                "FLOW_" + System.nanoTime(), "改名", "APPROVAL", null, List.of(), "{}", nodes()));
        assertEquals("改名", definitionService.get(defId, TENANT).name());
        // 编排保存传空白名单也不卸绑
        assertEquals(List.of(code), definitionService.get(defId, TENANT).supportedFormCodes());
    }

    @Test
    @DisplayName("T1.5：无关联 codes 时可创建流程")
    void emptyWhitelistSkipsValidation() {
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "无白名单流程", "APPROVAL", null,
                        List.of(), "{}", nodes()));
        assertNotNull(defId);
    }

    @Test
    @DisplayName("T1.5：已注册启用的表单可在创建时绑定并反查")
    void createAcceptsRegisteredFormCode() {
        String code = uniqCode("FORM");
        FormTestFixtures.register(formService, TENANT, code, "合法表单");
        Long defId = definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqCode("FLOW"), "合法流程", "APPROVAL", null,
                        List.of(code), "{}", nodes()));
        assertEquals(List.of(code), definitionService.get(defId, TENANT).supportedFormCodes());
        var vo = formService.list(TENANT).stream().filter(f -> code.equals(f.code())).findFirst().orElseThrow();
        assertEquals("LOCAL", vo.workflowBindingType());
        assertEquals(String.valueOf(defId), vo.workflowDefinitionId());
    }

    @Test
    @DisplayName("T1.6：列表默认不带 formData；includeFormData=true 才填充")
    void detailCarriesFormDataOnlyInDetail() {
        String code = uniqCode("FORM");
        FormTestFixtures.register(formService, TENANT, code, "带数据表单");
        String flowCode = uniqCode("FLOW");
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                flowCode, "表单数据流程", "APPROVAL", null, List.of(code), "{}", nodes()));
        definitionService.activate(defId, TENANT);

        Long instId = processService.startProcess(TENANT, new StartProcessRequest(
                flowCode, "PURCHASE_ORDER", "PO-" + System.nanoTime(), code,
                "{\"amount\":128000,\"orderNo\":\"PO-2026-0001\"}", 100L, "发起人", null, null, "测试标题", null, null));

        var detail = processService.detail(instId, TENANT);
        assertNotNull(detail.formData(), "detail 必须带 formData");
        assertTrue(detail.formData().contains("128000"), "formData 应原样透出表单 JSON: " + detail.formData());

        var page = processService.myInitiated(TENANT, 100L, null, 1, 50);
        var vo = page.getList().stream().filter(v -> v.id().equals(String.valueOf(instId))).findFirst().orElseThrow();
        assertEquals(code, vo.startedFormCode());
        assertNull(vo.formData(), "默认列表不带 formData");

        var withForm = processService.myInitiated(TENANT, 100L, null, null, null, null, null, null, 1, 50, true);
        var voForm = withForm.getList().stream().filter(v -> v.id().equals(String.valueOf(instId))).findFirst().orElseThrow();
        assertNotNull(voForm.formData(), "includeFormData=true 应带 formData");
        assertTrue(voForm.formData().contains("128000"), "列表 formData 应原样透出: " + voForm.formData());
    }
}
