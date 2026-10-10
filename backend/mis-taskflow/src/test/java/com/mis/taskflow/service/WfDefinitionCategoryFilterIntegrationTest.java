package com.mis.taskflow.service;

import com.mis.taskflow.domain.entity.WfCategory;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.UpsertWfCategoryRequest;
import com.mis.taskflow.dto.WfNodeDTO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 流程定义「多值分类过滤」集成测试（真实库，事务回滚）。
 *
 * <p>覆盖 {@code WfDefinitionService.list(tenantId, page, size, List<Long> categoryIds)}：
 * 勾选 N 个分类 ⇒ 只返回 {@code categoryId ∈ 集合} 的项（精确匹配、不含子分类、集合 IN 的 OR）；
 * 集合为空 ⇒ 不过滤（走原分页路径）。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class WfDefinitionCategoryFilterIntegrationTest {

    private static final long TENANT = 900007L;

    @Autowired private WfDefinitionService definitionService;
    @Autowired private WfCategoryService categoryService;

    private String uniqCode(String prefix) {
        return prefix + "_" + System.nanoTime();
    }

    /** 造一个测试流程分类。 */
    private Long newCategory(String name) {
        return categoryService.create(TENANT, 1L, new UpsertWfCategoryRequest(
                WfCategory.ROOT_PARENT_ID, uniqCode("WFCAT"), name, null, 0, "{}"));
    }

    /** 造一个挂在指定分类（可为 null=未分类）下的流程定义。 */
    private Long createDef(Long categoryId, String name) {
        // 用规范 9 参构造：categoryId 是第 9 个分量（7 参便捷构造不含 categoryId）。
        return definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                uniqCode("FLOW"), name, "APPROVAL", null, List.of(), "{}", nodes(), null, categoryId));
    }

    private List<WfNodeDTO> nodes() {
        return List.of(
                new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                new WfNodeDTO("approve", "主管审批", "APPROVAL", 1, null, null, null,
                        "{\"type\":\"FIXED\",\"value\":700001}", 24, "{}"),
                new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}"));
    }

    @Test
    @DisplayName("多值流程分类过滤：勾选 2 个分类 → 只返回属于这 2 类的流程定义")
    void listFiltersDefinitionsByMultipleCategories() {
        Long catA = newCategory("流程多值A");
        Long catB = newCategory("流程多值B");
        Long catC = newCategory("流程多值C");
        Long defA = createDef(catA, "多值流程A");
        Long defB = createDef(catB, "多值流程B");
        Long defC = createDef(catC, "多值流程C");
        createDef(null, "未分类流程");

        var page = definitionService.list(TENANT, 1, 20, List.of(catA, catB));
        assertEquals(2L, page.getTotal(), "总数应为 2（集合 IN 的 OR）");
        assertEquals(2, page.getList().size());
        assertTrue(page.getList().stream()
                        .allMatch(d -> catA.equals(d.categoryId()) || catB.equals(d.categoryId())),
                "结果应只属于分类 A 或 B");
        assertTrue(page.getList().stream().anyMatch(d -> String.valueOf(defA).equals(d.id())), "应含 A 类定义");
        assertTrue(page.getList().stream().anyMatch(d -> String.valueOf(defB).equals(d.id())), "应含 B 类定义");
        assertTrue(page.getList().stream().noneMatch(d -> catC.equals(d.categoryId())),
                "未勾选的分类 C 不得混入（精确匹配，不含子分类）");
    }

    @Test
    @DisplayName("空集合 = 不过滤：返回本租户全部未软删流程定义")
    void emptyCategoryIdsReturnAll() {
        createDef(newCategory("空集合A"), "空集合流程A");
        createDef(newCategory("空集合B"), "空集合流程B");
        createDef(null, "空集合未分类");

        var all = definitionService.list(TENANT, 1, 50, List.of());
        assertTrue(all.getTotal() >= 3, "空集合应返回全部（至少本轮造的 3 条）");
    }
}
