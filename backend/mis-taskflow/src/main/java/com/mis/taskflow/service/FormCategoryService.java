package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.FormCategory;
import com.mis.taskflow.domain.repository.FormCategoryRepository;
import com.mis.taskflow.dto.FormCategoryVO;
import com.mis.taskflow.dto.UpsertFormCategoryRequest;
import com.mis.taskflow.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 表单分类管理（决策 B：独立 form_category 邻接树）。
 *
 * <p>分类是表单的属性（{@code form_definition.category_id}），不再与表单共用一张表。
 * 分类自身保留层级（邻接树，可任意深度）——旧表单模型的「三层上限」已随 MAX_DEPTH 一并作废。
 *
 * <p>删除前校验：分类下有子节点、或已被 {@code form_definition.category_id} 引用时拒绝
 * （软引用无外键，只能在此挡）。
 */
@Service
public class FormCategoryService {

    private final FormCategoryRepository categoryRepository;

    public FormCategoryService(FormCategoryRepository categoryRepository) {
        this.categoryRepository = categoryRepository;
    }

    // ------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------

    /** 全量列表，平铺。 */
    @Transactional(readOnly = true)
    public List<FormCategoryVO> list(Long tenantId) {
        return categoryRepository.findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(tenantId, 0)
                .stream().map(c -> toVo(c, null)).toList();
    }

    /** 分类树（邻接表在内存组装）。 */
    @Transactional(readOnly = true)
    public List<FormCategoryVO> tree(Long tenantId) {
        List<FormCategory> all = categoryRepository
                .findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(tenantId, 0);
        Map<Long, List<FormCategory>> byParent = new HashMap<>();
        for (FormCategory c : all) {
            byParent.computeIfAbsent(c.getParentId(), k -> new ArrayList<>()).add(c);
        }
        return buildLevel(FormCategory.ROOT_PARENT_ID, byParent);
    }

    private List<FormCategoryVO> buildLevel(Long parentId, Map<Long, List<FormCategory>> byParent) {
        List<FormCategoryVO> out = new ArrayList<>();
        for (FormCategory c : byParent.getOrDefault(parentId, List.of())) {
            List<FormCategoryVO> children = buildLevel(c.getId(), byParent);
            out.add(toVo(c, children.isEmpty() ? null : children));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public FormCategoryVO get(Long id, Long tenantId) {
        return toVo(require(id, tenantId), null);
    }

    // ------------------------------------------------------------------
    // 写入
    // ------------------------------------------------------------------

    @Transactional
    public Long create(Long tenantId, Long operatorId, UpsertFormCategoryRequest req) {
        String code = req.code().trim();
        categoryRepository.findByTenantIdAndCode(tenantId, code).ifPresent(existing -> {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    existing.getDeleted() == 1
                            ? "分类编码「" + code + "」已被删除，不可复用"
                            : "分类编码「" + code + "」已存在");
        });
        validateParent(tenantId, req.parentId(), null);

        LocalDateTime now = LocalDateTime.now();
        FormCategory c = new FormCategory();
        c.setId(IdGenerator.nextId());
        c.setTenantId(tenantId);
        c.setParentId(req.parentId() == null ? FormCategory.ROOT_PARENT_ID : req.parentId());
        c.setCode(code);
        c.setName(req.name().trim());
        c.setDescription(req.description());
        c.setSortOrder(req.sortOrder() == null ? 0 : req.sortOrder());
        c.setConfig(StringUtils.hasText(req.config()) ? req.config() : "{}");
        c.setDeleted(0);
        c.setCreatedBy(operatorId);
        c.setCreatedAt(now);
        c.setUpdatedAt(now);
        categoryRepository.save(c);
        return c.getId();
    }

    @Transactional
    public void update(Long id, Long tenantId, UpsertFormCategoryRequest req) {
        FormCategory c = require(id, tenantId);

        String code = req.code().trim();
        if (!code.equals(c.getCode())) {
            categoryRepository.findByTenantIdAndCode(tenantId, code).ifPresent(existing -> {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "分类编码「" + code + "」已存在或已被占用");
            });
        }
        validateParent(tenantId, req.parentId(), id);

        c.setParentId(req.parentId() == null ? FormCategory.ROOT_PARENT_ID : req.parentId());
        c.setCode(code);
        c.setName(req.name().trim());
        c.setDescription(req.description());
        c.setSortOrder(req.sortOrder() == null ? 0 : req.sortOrder());
        c.setConfig(StringUtils.hasText(req.config()) ? req.config() : "{}");
        c.setUpdatedAt(LocalDateTime.now());
        categoryRepository.save(c);
    }

    /**
     * 软删分类。
     *
     * <p>⚠️ 有子节点、或已被 {@code form_definition.category_id} 引用 ⇒ 拒绝
     * （要删分类须先把子分类/表单迁移走）。
     */
    @Transactional
    public void delete(Long id, Long tenantId) {
        FormCategory c = require(id, tenantId);

        long children = categoryRepository.countByTenantIdAndParentIdAndDeleted(tenantId, id, 0);
        if (children > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "分类「" + c.getName() + "」下还有 " + children + " 个子分类，请先删除子项");
        }
        long usedByForms = categoryRepository.countByTenantIdAndCategoryIdAndDeleted(tenantId, id);
        if (usedByForms > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "分类「" + c.getName() + "」已被 " + usedByForms + " 个表单引用，请先修改表单的分类");
        }

        c.setDeleted(1);
        c.setUpdatedAt(LocalDateTime.now());
        categoryRepository.save(c);
    }

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    /**
     * 父节点校验：必须存在、未软删；且挂上去后不得成环。
     *
     * <p>防环：沿父链向上回溯，若遇到 {@code selfId} 说明成环。分类树无深度上限。
     */
    private void validateParent(Long tenantId, Long parentId, Long selfId) {
        if (parentId == null || FormCategory.ROOT_PARENT_ID.equals(parentId)) {
            return;
        }
        if (parentId.equals(selfId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "父分类不能是自己");
        }
        FormCategory parent = categoryRepository
                .findByIdAndTenantIdAndDeleted(parentId, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "父分类不存在: " + parentId));
        // 防环：沿父链向上回溯，若遇到 selfId 说明成环
        Long cursor = parent.getParentId();
        while (cursor != null && !FormCategory.ROOT_PARENT_ID.equals(cursor)) {
            if (cursor.equals(selfId)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "父分类选择会形成环");
            }
            cursor = categoryRepository.findByIdAndTenantIdAndDeleted(cursor, tenantId, 0)
                    .map(FormCategory::getParentId).orElse(null);
        }
    }

    private FormCategory require(Long id, Long tenantId) {
        return categoryRepository.findByIdAndTenantIdAndDeleted(id, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "表单分类不存在"));
    }

    private FormCategoryVO toVo(FormCategory c, List<FormCategoryVO> children) {
        return new FormCategoryVO(
                String.valueOf(c.getId()), String.valueOf(c.getTenantId()), c.getParentId(),
                c.getCode(), c.getName(), c.getDescription(), c.getSortOrder(),
                c.getConfig(), children, c.getCreatedAt(), c.getUpdatedAt());
    }
}
