package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.BizCategory;
import com.mis.taskflow.domain.entity.FormDefinition;
import com.mis.taskflow.domain.repository.BizCategoryRepository;
import com.mis.taskflow.dto.BizCategoryVO;
import com.mis.taskflow.dto.UpsertBizCategoryRequest;
import com.mis.taskflow.dto.UpsertFormDefinitionRequest;
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
 * 统一业务分类服务集成测试（biz_category 邻接树）—— 真实库，事务回滚。
 *
 * <p>由旧 {@code FormCategoryServiceIntegrationTest}（form_category）平移而来（随业务分类统一化）：
 * 意图保留、不弱化、不 skip。新增「兜底节点保护」与「定义双引用计数」用例。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class BizCategoryServiceIntegrationTest {

    private static final long TENANT = 900007L;

    @Autowired private BizCategoryService categoryService;
    @Autowired private BizCategoryRepository categoryRepository;
    @Autowired private FormDefinitionService formService;

    private String uniqCode(String prefix) {
        return prefix + "_" + System.nanoTime();
    }

    private Long newCategory(Long parentId, String code, String name) {
        return categoryService.create(TENANT, 1L,
                new UpsertBizCategoryRequest(parentId, code, name, null, 0, "{}"));
    }

    private BizCategoryVO findNode(List<BizCategoryVO> nodes, Long id) {
        for (BizCategoryVO n : nodes) {
            if (n.id().equals(String.valueOf(id))) {
                return n;
            }
            if (n.children() != null) {
                BizCategoryVO hit = findNode(n.children(), id);
                if (hit != null) {
                    return hit;
                }
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    // CRUD
    // ------------------------------------------------------------------

    @Test
    @DisplayName("分类：新增后可读回（根分类 parentId=0）")
    void createAndGet() {
        String code = uniqCode("CAT");
        Long id = newCategory(BizCategory.ROOT_PARENT_ID, code, "根分类");

        BizCategoryVO vo = categoryService.get(id, TENANT);
        assertEquals(code, vo.code());
        assertEquals("根分类", vo.name());
        assertEquals(BizCategory.ROOT_PARENT_ID, vo.parentId());
        assertNotNull(vo.createdAt());
    }

    @Test
    @DisplayName("分类：code 重复被拒")
    void duplicateCodeRejected() {
        String code = uniqCode("CAT");
        newCategory(BizCategory.ROOT_PARENT_ID, code, "分类A");

        BusinessException e = assertThrows(BusinessException.class,
                () -> newCategory(BizCategory.ROOT_PARENT_ID, code, "分类B"));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), e.getCode());
    }

    @Test
    @DisplayName("分类：软删后 code 不可复用")
    void codeNotReusableAfterSoftDelete() {
        String code = uniqCode("CAT");
        Long id = newCategory(BizCategory.ROOT_PARENT_ID, code, "临时分类");
        categoryService.delete(id, TENANT);

        assertEquals(1, categoryRepository.findByTenantIdAndCode(TENANT, code).orElseThrow().getDeleted());

        BusinessException e = assertThrows(BusinessException.class,
                () -> newCategory(BizCategory.ROOT_PARENT_ID, code, "再来一个"));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), e.getCode());
        assertTrue(e.getMessage().contains("不可复用"));
    }

    // ------------------------------------------------------------------
    // 树结构
    // ------------------------------------------------------------------

    @Test
    @DisplayName("分类：tree 接口按父子组装 children（叶子不再挂 children）")
    void treeAssemblesChildren() {
        Long rootId = newCategory(BizCategory.ROOT_PARENT_ID, uniqCode("CAT"), "父分类");
        newCategory(rootId, uniqCode("S1"), "子分类A");
        newCategory(rootId, uniqCode("S2"), "子分类B");

        var roots = categoryService.tree(TENANT);
        var root = findNode(roots, rootId);
        assertNotNull(root, "树里应能找到父分类");
        assertEquals(2, root.children().size(), "该分类下应有 2 个子分类");
        assertTrue(root.children().stream().allMatch(c -> c.children() == null), "叶子节点不应再挂 children");
    }

    @Test
    @DisplayName("分类：支持多层嵌套")
    void multiLevelNestingAllowed() {
        Long l1 = newCategory(BizCategory.ROOT_PARENT_ID, uniqCode("L1"), "一级");
        Long l2 = newCategory(l1, uniqCode("L2"), "二级");
        Long l3 = newCategory(l2, uniqCode("L3"), "三级");
        Long l4 = newCategory(l3, uniqCode("L4"), "四级");

        assertNotNull(l4, "任意深度嵌套应被允许");

        var roots = categoryService.tree(TENANT);
        var n1 = findNode(roots, l1);
        assertEquals(1, n1.children().size());
        var n2 = n1.children().get(0);
        assertEquals(1, n2.children().size());
        var n3 = n2.children().get(0);
        assertEquals(1, n3.children().size());
        var n4 = n3.children().get(0);
        assertNull(n4.children(), "第四层为叶子，children 应为 null");
    }

    @Test
    @DisplayName("分类：父分类不存在被拒；父分类不能是自己")
    void invalidParentRejected() {
        assertThrows(BusinessException.class,
                () -> newCategory(999999999L, uniqCode("CAT"), "孤儿"));

        Long self = newCategory(BizCategory.ROOT_PARENT_ID, uniqCode("CAT"), "分类");
        BusinessException e = assertThrows(BusinessException.class, () -> categoryService.update(self, TENANT,
                new UpsertBizCategoryRequest(self, uniqCode("CAT"), "自环", null, 0, "{}")));
        assertTrue(e.getMessage().contains("父分类不能是自己"));
    }

    @Test
    @DisplayName("分类：选择会成环的父分类被拒（防环）")
    void cycleFormationRejected() {
        Long a = newCategory(BizCategory.ROOT_PARENT_ID, uniqCode("A"), "A");
        Long b = newCategory(a, uniqCode("B"), "B");

        BusinessException e = assertThrows(BusinessException.class, () -> categoryService.update(a, TENANT,
                new UpsertBizCategoryRequest(b, uniqCode("A"), "A", null, 0, "{}")));
        assertTrue(e.getMessage().contains("形成环"), "应检测到环，实际: " + e.getMessage());
    }

    // ------------------------------------------------------------------
    // 删除引用校验
    // ------------------------------------------------------------------

    @Test
    @DisplayName("分类：有子分类时删除被拒")
    void deleteRejectedWhenHasChildren() {
        Long parentId = newCategory(BizCategory.ROOT_PARENT_ID, uniqCode("CAT"), "有子项的分类");
        newCategory(parentId, uniqCode("SUB"), "子分类");

        BusinessException e = assertThrows(BusinessException.class, () -> categoryService.delete(parentId, TENANT));
        assertTrue(e.getMessage().contains("子分类"));
    }

    @Test
    @DisplayName("分类：被表单引用时删除被拒（引用计数统计 form_definition.category_id）")
    void deleteRejectedWhenReferencedByForm() {
        Long catId = newCategory(BizCategory.ROOT_PARENT_ID, uniqCode("CAT"), "被表单引用");
        formService.create(TENANT, 1L, new UpsertFormDefinitionRequest(
                catId, uniqCode("FORM"), "挂在该分类下的表单", null, FormDefinition.STATUS_ENABLED, 0, "{}"));

        BusinessException e = assertThrows(BusinessException.class, () -> categoryService.delete(catId, TENANT));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), e.getCode());
        assertTrue(e.getMessage().contains("表单"), "实际: " + e.getMessage());
    }

    @Test
    @DisplayName("分类：无引用时可软删，且不再出现在列表")
    void deleteSoftDeletesCategory() {
        Long catId = newCategory(BizCategory.ROOT_PARENT_ID, uniqCode("CAT"), "可删分类");
        categoryService.delete(catId, TENANT);

        assertTrue(categoryRepository.findByIdAndTenantIdAndDeleted(catId, TENANT, 0).isEmpty(),
                "软删后不应再查到未软删行");
        assertTrue(categoryService.list(TENANT).stream().noneMatch(v -> v.id().equals(String.valueOf(catId))),
                "软删分类不应出现在列表");
    }

    // ------------------------------------------------------------------
    // 兜底节点保护（V138：id=991001）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("兜底节点：不可删除（须命中兜底保护，而非被引用拒绝）")
    void uncategorizedCannotBeDeleted() {
        BusinessException e = assertThrows(BusinessException.class,
                () -> categoryService.delete(BizCategoryService.UNCATEGORIZED_ID, 1L));
        // QA 强化：兜底节点名称即「未分类」，若仅断言含「未分类」会被「已被 N 个定义引用」的
        //   拒绝消息（同样含「未分类」）误判通过；改为断言兜底保护专有措辞「不可删除」。
        assertTrue(e.getMessage().contains("不可删除"),
                "应命中兜底节点保护（区别于被引用拒绝），实际: " + e.getMessage());
    }
}
