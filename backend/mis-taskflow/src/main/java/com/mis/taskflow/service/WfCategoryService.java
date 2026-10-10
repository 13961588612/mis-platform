package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.WfCategory;
import com.mis.taskflow.domain.repository.WfCategoryRepository;
import com.mis.taskflow.dto.UpsertWfCategoryRequest;
import com.mis.taskflow.dto.WfCategoryVO;
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
 * 流程分类管理（决策 B：独立 wf_category 邻接树）。
 *
 * <p>删除前校验：分类下有子节点、或已被 {@code wf_definition.category_id} 引用时拒绝
 * （软引用无外键，只能在此挡）。默认「未分类」节点（id=990001）由迁移 V132 建好并回填，
 * 业务代码不应对其做删除/改名。
 */
@Service
public class WfCategoryService {

    private final WfCategoryRepository categoryRepository;

    public WfCategoryService(WfCategoryRepository categoryRepository) {
        this.categoryRepository = categoryRepository;
    }

    // ------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------

    /** 全量列表，平铺。 */
    @Transactional(readOnly = true)
    public List<WfCategoryVO> list(Long tenantId) {
        return categoryRepository.findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(tenantId, 0)
                .stream().map(c -> toVo(c, null)).toList();
    }

    /** 分类树（邻接表在内存组装）。 */
    @Transactional(readOnly = true)
    public List<WfCategoryVO> tree(Long tenantId) {
        List<WfCategory> all = categoryRepository
                .findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(tenantId, 0);
        Map<Long, List<WfCategory>> byParent = new HashMap<>();
        for (WfCategory c : all) {
            byParent.computeIfAbsent(c.getParentId(), k -> new ArrayList<>()).add(c);
        }
        return buildLevel(WfCategory.ROOT_PARENT_ID, byParent);
    }

    private List<WfCategoryVO> buildLevel(Long parentId, Map<Long, List<WfCategory>> byParent) {
        List<WfCategoryVO> out = new ArrayList<>();
        for (WfCategory c : byParent.getOrDefault(parentId, List.of())) {
            List<WfCategoryVO> children = buildLevel(c.getId(), byParent);
            out.add(toVo(c, children.isEmpty() ? null : children));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public WfCategoryVO get(Long id, Long tenantId) {
        return toVo(require(id, tenantId), null);
    }

    // ------------------------------------------------------------------
    // 写入
    // ------------------------------------------------------------------

    @Transactional
    public Long create(Long tenantId, Long operatorId, UpsertWfCategoryRequest req) {
        String code = req.code().trim();
        categoryRepository.findByTenantIdAndCode(tenantId, code).ifPresent(existing -> {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    existing.getDeleted() == 1
                            ? "分类编码「" + code + "」已被删除，不可复用"
                            : "分类编码「" + code + "」已存在");
        });
        validateParent(tenantId, req.parentId(), null);

        LocalDateTime now = LocalDateTime.now();
        WfCategory c = new WfCategory();
        c.setId(IdGenerator.nextId());
        c.setTenantId(tenantId);
        c.setParentId(req.parentId() == null ? WfCategory.ROOT_PARENT_ID : req.parentId());
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
    public void update(Long id, Long tenantId, UpsertWfCategoryRequest req) {
        WfCategory c = require(id, tenantId);

        String code = req.code().trim();
        if (!code.equals(c.getCode())) {
            categoryRepository.findByTenantIdAndCode(tenantId, code).ifPresent(existing -> {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "分类编码「" + code + "」已存在或已被占用");
            });
        }
        validateParent(tenantId, req.parentId(), id);

        c.setParentId(req.parentId() == null ? WfCategory.ROOT_PARENT_ID : req.parentId());
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
     * <p>⚠️ 有子节点、或已被 wf_definition 引用 ⇒ 拒绝（迁移已把历史定义回填到「未分类」，新定义
     * 一旦挂到某分类就不允许删分类，除非先把定义迁移走）。
     */
    @Transactional
    public void delete(Long id, Long tenantId) {
        WfCategory c = require(id, tenantId);

        long children = categoryRepository.countByTenantIdAndParentIdAndDeleted(tenantId, id, 0);
        if (children > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "分类「" + c.getName() + "」下还有 " + children + " 个子分类，请先删除子项");
        }
        long usedByDefs = categoryRepository.countByTenantIdAndCategoryIdAndDeleted(tenantId, id);
        if (usedByDefs > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "分类「" + c.getName() + "」已被 " + usedByDefs + " 个流程定义引用，请先修改流程的分类");
        }

        c.setDeleted(1);
        c.setUpdatedAt(LocalDateTime.now());
        categoryRepository.save(c);
    }

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    private void validateParent(Long tenantId, Long parentId, Long selfId) {
        if (parentId == null || WfCategory.ROOT_PARENT_ID.equals(parentId)) {
            return;
        }
        if (parentId.equals(selfId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "父分类不能是自己");
        }
        WfCategory parent = categoryRepository
                .findByIdAndTenantIdAndDeleted(parentId, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "父分类不存在: " + parentId));
        // 防环：沿父链向上回溯，若遇到 selfId 说明成环
        Long cursor = parent.getParentId();
        while (cursor != null && !WfCategory.ROOT_PARENT_ID.equals(cursor)) {
            if (cursor.equals(selfId)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "父分类选择会形成环");
            }
            cursor = categoryRepository.findByIdAndTenantIdAndDeleted(cursor, tenantId, 0)
                    .map(WfCategory::getParentId).orElse(null);
        }
    }

    private WfCategory require(Long id, Long tenantId) {
        return categoryRepository.findByIdAndTenantIdAndDeleted(id, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "流程分类不存在"));
    }

    private WfCategoryVO toVo(WfCategory c, List<WfCategoryVO> children) {
        return new WfCategoryVO(
                String.valueOf(c.getId()), String.valueOf(c.getTenantId()), c.getParentId(),
                c.getCode(), c.getName(), c.getDescription(), c.getSortOrder(),
                c.getConfig(), children, c.getCreatedAt(), c.getUpdatedAt());
    }
}
