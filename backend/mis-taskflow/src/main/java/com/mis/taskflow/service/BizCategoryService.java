package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.BizCategory;
import com.mis.taskflow.domain.repository.BizCategoryRepository;
import com.mis.taskflow.dto.BizCategoryVO;
import com.mis.taskflow.dto.UpsertBizCategoryRequest;
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
 * 统一「业务分类」管理（租户通用邻接树 {@code biz_category}）。
 *
 * <p><b>删除前校验</b>：分类下有子节点、或已被 {@code wf_definition} / {@code form_definition}
 * 的 {@code category_id} 引用时拒绝（软引用无外键，只能在此挡）。
 *
 * <p><b>兜底节点保护</b>：固定「未分类」节点（id=991001，由迁移 V138 建好）由业务代码保护，
 * 禁止删除、禁止改 code / name（避免运行侧软引用 {@code code} 断裂）。
 */
@Service
public class BizCategoryService {

    /** 「未分类」兜底节点固定 id（对齐 V138 种子）。 */
    public static final Long UNCATEGORIZED_ID = 991001L;

    private final BizCategoryRepository categoryRepository;

    public BizCategoryService(BizCategoryRepository categoryRepository) {
        this.categoryRepository = categoryRepository;
    }

    // ------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------

    /** 全量列表，平铺。 */
    @Transactional(readOnly = true)
    public List<BizCategoryVO> list(Long tenantId) {
        return categoryRepository.findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(tenantId, 0)
                .stream().map(c -> toVo(c, null)).toList();
    }

    /** 分类树（邻接表在内存组装）。 */
    @Transactional(readOnly = true)
    public List<BizCategoryVO> tree(Long tenantId) {
        List<BizCategory> all = categoryRepository
                .findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(tenantId, 0);
        Map<Long, List<BizCategory>> byParent = new HashMap<>();
        for (BizCategory c : all) {
            byParent.computeIfAbsent(c.getParentId(), k -> new ArrayList<>()).add(c);
        }
        return buildLevel(BizCategory.ROOT_PARENT_ID, byParent);
    }

    private List<BizCategoryVO> buildLevel(Long parentId, Map<Long, List<BizCategory>> byParent) {
        List<BizCategoryVO> out = new ArrayList<>();
        for (BizCategory c : byParent.getOrDefault(parentId, List.of())) {
            List<BizCategoryVO> children = buildLevel(c.getId(), byParent);
            out.add(toVo(c, children.isEmpty() ? null : children));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public BizCategoryVO get(Long id, Long tenantId) {
        return toVo(require(id, tenantId), null);
    }

    // ------------------------------------------------------------------
    // 写入
    // ------------------------------------------------------------------

    @Transactional
    public Long create(Long tenantId, Long operatorId, UpsertBizCategoryRequest req) {
        String code = req.code().trim();
        categoryRepository.findByTenantIdAndCode(tenantId, code).ifPresent(existing -> {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    existing.getDeleted() == 1
                            ? "业务分类编码「" + code + "」已被删除，不可复用"
                            : "业务分类编码「" + code + "」已存在");
        });
        validateParent(tenantId, req.parentId(), null);

        LocalDateTime now = LocalDateTime.now();
        BizCategory c = new BizCategory();
        c.setId(IdGenerator.nextId());
        c.setTenantId(tenantId);
        c.setParentId(req.parentId() == null ? BizCategory.ROOT_PARENT_ID : req.parentId());
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
    public void update(Long id, Long tenantId, UpsertBizCategoryRequest req) {
        BizCategory c = require(id, tenantId);

        String code = req.code().trim();
        String name = req.name().trim();

        // 兜底节点保护：不可改 code / 改 name（运行侧软引用 code）
        if (UNCATEGORIZED_ID.equals(id)) {
            if (!code.equals(c.getCode())) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "「未分类」兜底节点不可修改编码");
            }
            if (!name.equals(c.getName())) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "「未分类」兜底节点不可修改名称");
            }
        }

        if (!code.equals(c.getCode())) {
            categoryRepository.findByTenantIdAndCode(tenantId, code).ifPresent(existing -> {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "业务分类编码「" + code + "」已存在或已被占用");
            });
        }
        validateParent(tenantId, req.parentId(), id);

        c.setParentId(req.parentId() == null ? BizCategory.ROOT_PARENT_ID : req.parentId());
        c.setCode(code);
        c.setName(name);
        c.setDescription(req.description());
        c.setSortOrder(req.sortOrder() == null ? 0 : req.sortOrder());
        c.setConfig(StringUtils.hasText(req.config()) ? req.config() : "{}");
        c.setUpdatedAt(LocalDateTime.now());
        categoryRepository.save(c);
    }

    /**
     * 软删业务分类。
     *
     * <p>⚠️ 兜底节点、有子节点、或已被 {@code wf_definition} / {@code form_definition} 引用 ⇒ 拒绝。
     */
    @Transactional
    public void delete(Long id, Long tenantId) {
        BizCategory c = require(id, tenantId);

        if (UNCATEGORIZED_ID.equals(id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "「未分类」兜底节点不可删除");
        }

        long children = categoryRepository.countByTenantIdAndParentIdAndDeleted(tenantId, id, 0);
        if (children > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "业务分类「" + c.getName() + "」下还有 " + children + " 个子分类，请先删除子项");
        }
        long usedByWf = categoryRepository.countWfDefinitionsByCategoryId(tenantId, id);
        long usedByForm = categoryRepository.countFormDefinitionsByCategoryId(tenantId, id);
        long usedByDefs = usedByWf + usedByForm;
        if (usedByDefs > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "业务分类「" + c.getName() + "」已被 " + usedByDefs
                            + " 个定义引用（流程 " + usedByWf + " / 表单 " + usedByForm + "），请先修改其分类");
        }

        c.setDeleted(1);
        c.setUpdatedAt(LocalDateTime.now());
        categoryRepository.save(c);
    }

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    private void validateParent(Long tenantId, Long parentId, Long selfId) {
        if (parentId == null || BizCategory.ROOT_PARENT_ID.equals(parentId)) {
            return;
        }
        if (parentId.equals(selfId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "父分类不能是自己");
        }
        BizCategory parent = categoryRepository
                .findByIdAndTenantIdAndDeleted(parentId, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "父分类不存在: " + parentId));
        // 防环：沿父链向上回溯，若遇到 selfId 说明成环
        Long cursor = parent.getParentId();
        while (cursor != null && !BizCategory.ROOT_PARENT_ID.equals(cursor)) {
            if (cursor.equals(selfId)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "父分类选择会形成环");
            }
            cursor = categoryRepository.findByIdAndTenantIdAndDeleted(cursor, tenantId, 0)
                    .map(BizCategory::getParentId).orElse(null);
        }
    }

    private BizCategory require(Long id, Long tenantId) {
        return categoryRepository.findByIdAndTenantIdAndDeleted(id, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "业务分类不存在"));
    }

    private BizCategoryVO toVo(BizCategory c, List<BizCategoryVO> children) {
        return new BizCategoryVO(
                String.valueOf(c.getId()), String.valueOf(c.getTenantId()), c.getParentId(),
                c.getCode(), c.getName(), c.getDescription(), c.getSortOrder(),
                c.getConfig(), children, c.getCreatedAt(), c.getUpdatedAt());
    }
}
