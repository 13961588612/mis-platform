package com.mis.aireport.domain.service;

import com.mis.aireport.api.dto.AiParamSourceVO;
import com.mis.aireport.api.dto.AiReportAclSaveRequest;
import com.mis.aireport.api.dto.AiReportAclVO;
import com.mis.aireport.api.dto.AiReportCategorySaveRequest;
import com.mis.aireport.api.dto.AiReportCategoryVO;
import com.mis.aireport.api.dto.AiReportDefSaveRequest;
import com.mis.aireport.api.dto.AiReportDefVO;
import com.mis.aireport.api.dto.AiWorkflowPlatformSaveRequest;
import com.mis.aireport.api.dto.AiWorkflowPlatformVO;
import com.mis.aireport.domain.entity.AiParamSource;
import com.mis.aireport.domain.entity.AiReportAcl;
import com.mis.aireport.domain.entity.AiReportCategory;
import com.mis.aireport.domain.entity.AiReportDef;
import com.mis.aireport.domain.entity.AiWorkflowPlatform;
import com.mis.aireport.domain.param.ParamSourceCodes;
import com.mis.aireport.domain.repository.AiParamSourceRepository;
import com.mis.aireport.domain.repository.AiReportAclRepository;
import com.mis.aireport.domain.repository.AiReportCategoryRepository;
import com.mis.aireport.domain.repository.AiReportDefRepository;
import com.mis.aireport.domain.repository.AiWorkflowPlatformRepository;
import com.mis.aireport.support.IdGenerator;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class AiReportAdminService {

    private final AiReportCategoryRepository categoryRepository;
    private final AiParamSourceRepository paramSourceRepository;
    private final AiWorkflowPlatformRepository workflowPlatformRepository;
    private final AiReportDefRepository reportDefRepository;
    private final AiReportAclRepository aclRepository;

    public AiReportAdminService(
            AiReportCategoryRepository categoryRepository,
            AiParamSourceRepository paramSourceRepository,
            AiWorkflowPlatformRepository workflowPlatformRepository,
            AiReportDefRepository reportDefRepository,
            AiReportAclRepository aclRepository) {
        this.categoryRepository = categoryRepository;
        this.paramSourceRepository = paramSourceRepository;
        this.workflowPlatformRepository = workflowPlatformRepository;
        this.reportDefRepository = reportDefRepository;
        this.aclRepository = aclRepository;
    }

    // ------------------------------------------------------------------ category

    @Transactional(readOnly = true)
    public List<AiReportCategoryVO> listCategoryTree() {
        List<AiReportCategory> all = categoryRepository.findAllByOrderBySortOrderAscIdAsc();
        Map<Long, List<AiReportCategory>> byParent = new HashMap<>();
        for (AiReportCategory c : all) {
            byParent.computeIfAbsent(c.getParentId(), k -> new ArrayList<>()).add(c);
        }
        return buildCategoryLevel(AiReportCategory.ROOT_PARENT_ID, byParent);
    }

    @Transactional
    public AiReportCategoryVO createCategory(AiReportCategorySaveRequest dto) {
        String code = dto.code().trim();
        if (categoryRepository.findByCode(code).isPresent()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "分类编号已存在: " + code);
        }
        Long parentId = normalizeParentId(dto.parentId());
        validateParent(parentId, null);

        Instant now = Instant.now();
        AiReportCategory c = new AiReportCategory();
        c.setId(IdGenerator.nextId());
        c.setParentId(parentId);
        c.setCode(code);
        c.setName(dto.name().trim());
        c.setIsGroup(Boolean.TRUE.equals(dto.isGroup()) ? 1 : 0);
        c.setSortOrder(dto.sortOrder() != null ? dto.sortOrder() : 0);
        c.setEnabled(dto.enabled() == null || dto.enabled() ? 1 : 0);
        c.setCreatedBy(currentUserId());
        c.setCreatedAt(now);
        c.setUpdatedAt(now);
        categoryRepository.save(c);
        return toCategoryVO(c, null);
    }

    @Transactional
    public AiReportCategoryVO updateCategory(Long id, AiReportCategorySaveRequest dto) {
        AiReportCategory c = categoryRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "分类不存在"));
        String code = dto.code().trim();
        categoryRepository.findByCode(code).ifPresent(other -> {
            if (!other.getId().equals(id)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "分类编号已存在: " + code);
            }
        });
        Long parentId = normalizeParentId(dto.parentId());
        validateParent(parentId, id);

        c.setParentId(parentId);
        c.setCode(code);
        c.setName(dto.name().trim());
        c.setIsGroup(Boolean.TRUE.equals(dto.isGroup()) ? 1 : 0);
        if (dto.sortOrder() != null) {
            c.setSortOrder(dto.sortOrder());
        }
        if (dto.enabled() != null) {
            c.setEnabled(dto.enabled() ? 1 : 0);
        }
        c.setUpdatedAt(Instant.now());
        categoryRepository.save(c);
        return toCategoryVO(c, null);
    }

    @Transactional
    public void deleteCategory(Long id) {
        AiReportCategory c = categoryRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "分类不存在"));
        if (categoryRepository.existsByParentId(id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "存在子分类，无法删除");
        }
        if (reportDefRepository.existsByCategoryId(id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "分类下仍有报告，无法删除");
        }
        categoryRepository.delete(c);
    }

    // ------------------------------------------------------------------ param source / workflow

    @Transactional(readOnly = true)
    public List<AiParamSourceVO> listParamSources() {
        return paramSourceRepository.findAllByOrderBySortOrderAscIdAsc().stream()
                .map(this::toParamSourceVO)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<AiWorkflowPlatformVO> listWorkflowPlatforms() {
        return workflowPlatformRepository.findAllByOrderByPlatformCodeAsc().stream()
                .map(this::toWorkflowVO)
                .toList();
    }

    @Transactional
    public AiWorkflowPlatformVO createWorkflowPlatform(AiWorkflowPlatformSaveRequest dto) {
        String code = dto.platformCode().trim();
        if (workflowPlatformRepository.findByPlatformCode(code).isPresent()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "平台编号已存在: " + code);
        }
        Instant now = Instant.now();
        AiWorkflowPlatform p = new AiWorkflowPlatform();
        p.setId(IdGenerator.nextId());
        p.setPlatformCode(code);
        p.setName(dto.name().trim());
        p.setEnabled(dto.enabled() == null || dto.enabled() ? 1 : 0);
        p.setCreatedAt(now);
        p.setUpdatedAt(now);
        workflowPlatformRepository.save(p);
        return toWorkflowVO(p);
    }

    @Transactional
    public AiWorkflowPlatformVO updateWorkflowPlatform(Long id, AiWorkflowPlatformSaveRequest dto) {
        AiWorkflowPlatform p = workflowPlatformRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "工作流平台不存在"));
        String code = dto.platformCode().trim();
        workflowPlatformRepository.findByPlatformCode(code).ifPresent(other -> {
            if (!other.getId().equals(id)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "平台编号已存在: " + code);
            }
        });
        p.setPlatformCode(code);
        p.setName(dto.name().trim());
        if (dto.enabled() != null) {
            p.setEnabled(dto.enabled() ? 1 : 0);
        }
        p.setUpdatedAt(Instant.now());
        workflowPlatformRepository.save(p);
        return toWorkflowVO(p);
    }

    // ------------------------------------------------------------------ report def

    @Transactional(readOnly = true)
    public List<AiReportDefVO> listReports(Long categoryId, boolean uncategorizedOnly) {
        List<AiReportDef> rows;
        if (uncategorizedOnly) {
            rows = reportDefRepository.findByCategoryIdIsNullOrderBySortOrderAscIdAsc();
        } else if (categoryId != null) {
            rows = reportDefRepository.findByCategoryIdOrderBySortOrderAscIdAsc(categoryId);
        } else {
            rows = reportDefRepository.findAllByOrderBySortOrderAscIdAsc();
        }
        return rows.stream().map(this::toReportVO).toList();
    }

    @Transactional(readOnly = true)
    public AiReportDefVO getReport(Long id) {
        return toReportVO(requireReport(id));
    }

    @Transactional
    public AiReportDefVO createReport(AiReportDefSaveRequest dto) {
        String code = dto.reportCode().trim();
        if (reportDefRepository.findByReportCode(code).isPresent()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "报告编号已存在: " + code);
        }
        List<Map<String, Object>> slots = normalizeAndValidateSlots(dto.slots());
        validateWorkflowFields(dto.useAiWorkflow(), dto.workflowPlatformCode(), dto.workflowCode());
        if (dto.categoryId() != null) {
            ensureCategoryExists(dto.categoryId());
        }

        Instant now = Instant.now();
        AiReportDef r = new AiReportDef();
        r.setId(IdGenerator.nextId());
        applyReportFields(r, dto, slots);
        r.setCreatedBy(currentUserId());
        r.setCreatedAt(now);
        r.setUpdatedAt(now);
        reportDefRepository.save(r);
        return toReportVO(r);
    }

    @Transactional
    public AiReportDefVO updateReport(Long id, AiReportDefSaveRequest dto) {
        AiReportDef r = requireReport(id);
        String code = dto.reportCode().trim();
        reportDefRepository.findByReportCode(code).ifPresent(other -> {
            if (!other.getId().equals(id)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "报告编号已存在: " + code);
            }
        });
        List<Map<String, Object>> slots = normalizeAndValidateSlots(dto.slots());
        validateWorkflowFields(dto.useAiWorkflow(), dto.workflowPlatformCode(), dto.workflowCode());
        if (dto.categoryId() != null) {
            ensureCategoryExists(dto.categoryId());
        }
        applyReportFields(r, dto, slots);
        r.setUpdatedAt(Instant.now());
        reportDefRepository.save(r);
        return toReportVO(r);
    }

    @Transactional
    public void deleteReport(Long id) {
        AiReportDef r = requireReport(id);
        aclRepository.deleteByReportCode(r.getReportCode());
        reportDefRepository.delete(r);
    }

    // ------------------------------------------------------------------ ACL

    @Transactional(readOnly = true)
    public List<AiReportAclVO> listAcls(String reportCode) {
        return aclRepository.findByReportCodeOrderByIdAsc(reportCode.trim()).stream()
                .map(this::toAclVO)
                .toList();
    }

    @Transactional
    public AiReportAclVO createAcl(AiReportAclSaveRequest dto) {
        String reportCode = dto.reportCode().trim();
        if (reportDefRepository.findByReportCode(reportCode).isEmpty()) {
            throw new BusinessException(ResultCode.NOT_FOUND, "报告不存在: " + reportCode);
        }
        String subjectType = dto.subjectType().trim().toUpperCase();
        String subjectId = dto.subjectId().trim();
        if (aclRepository.existsByReportCodeAndSubjectTypeAndSubjectId(reportCode, subjectType, subjectId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "ACL 已存在");
        }
        AiReportAcl acl = new AiReportAcl();
        acl.setId(IdGenerator.nextId());
        acl.setReportCode(reportCode);
        acl.setSubjectType(subjectType);
        acl.setSubjectId(subjectId);
        acl.setCreatedAt(Instant.now());
        aclRepository.save(acl);
        return toAclVO(acl);
    }

    @Transactional
    public void deleteAcl(Long id) {
        AiReportAcl acl = aclRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "ACL 不存在"));
        aclRepository.delete(acl);
    }

    // ------------------------------------------------------------------ helpers

    private void applyReportFields(AiReportDef r, AiReportDefSaveRequest dto, List<Map<String, Object>> slots) {
        r.setReportCode(dto.reportCode().trim());
        r.setTitle(dto.title().trim());
        r.setDescription(StringUtils.hasText(dto.description()) ? dto.description().trim() : null);
        r.setCategoryId(dto.categoryId());
        r.setSlotsJson(slots);
        boolean useWf = Boolean.TRUE.equals(dto.useAiWorkflow());
        r.setUseAiWorkflow(useWf ? 1 : 0);
        r.setWorkflowPlatformCode(useWf && StringUtils.hasText(dto.workflowPlatformCode())
                ? dto.workflowPlatformCode().trim() : null);
        r.setWorkflowCode(useWf && StringUtils.hasText(dto.workflowCode())
                ? dto.workflowCode().trim() : null);
        r.setSortOrder(dto.sortOrder() != null ? dto.sortOrder() : 0);
        r.setEnabled(dto.enabled() == null || dto.enabled() ? 1 : 0);
    }

    private List<Map<String, Object>> normalizeAndValidateSlots(List<Map<String, Object>> raw) {
        List<Map<String, Object>> slots = raw == null ? List.of() : raw;
        Set<String> seen = new HashSet<>();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> slot : slots) {
            if (slot == null) {
                continue;
            }
            Object sc = slot.get("source_code");
            if (sc == null || !StringUtils.hasText(String.valueOf(sc))) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "槽位缺少 source_code");
            }
            String sourceCode = ParamSourceCodes.canonical(String.valueOf(sc));
            if (!seen.add(sourceCode)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "槽位重复: " + sourceCode);
            }
            if (paramSourceRepository.findBySourceCode(sourceCode).isEmpty()) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "未知参数来源: " + sourceCode);
            }
            Map<String, Object> normalized = new HashMap<>();
            normalized.put("source_code", sourceCode);
            if (slot.get("required") != null) {
                normalized.put("required", Boolean.TRUE.equals(slot.get("required"))
                        || "true".equalsIgnoreCase(String.valueOf(slot.get("required"))));
            } else {
                normalized.put("required", true);
            }
            if (slot.get("label_override") != null && StringUtils.hasText(String.valueOf(slot.get("label_override")))) {
                normalized.put("label_override", String.valueOf(slot.get("label_override")).trim());
            }
            out.add(normalized);
        }
        return out;
    }

    private void validateWorkflowFields(Boolean useAiWorkflow, String platformCode, String workflowCode) {
        if (!Boolean.TRUE.equals(useAiWorkflow)) {
            return;
        }
        if (!StringUtils.hasText(workflowCode)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "启用工作流时必须填写 workflow_code");
        }
        if (StringUtils.hasText(platformCode)
                && workflowPlatformRepository.findByPlatformCode(platformCode.trim()).isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "未知工作流平台: " + platformCode);
        }
    }

    private AiReportDef requireReport(Long id) {
        return reportDefRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "报告不存在"));
    }

    private void ensureCategoryExists(Long categoryId) {
        if (categoryRepository.findById(categoryId).isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "分类不存在: " + categoryId);
        }
    }

    private Long normalizeParentId(Long parentId) {
        if (parentId == null || parentId <= 0) {
            return AiReportCategory.ROOT_PARENT_ID;
        }
        return parentId;
    }

    private void validateParent(Long parentId, Long selfId) {
        if (parentId.equals(AiReportCategory.ROOT_PARENT_ID)) {
            return;
        }
        AiReportCategory parent = categoryRepository.findById(parentId)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "父分类不存在"));
        Long cursor = parent.getId();
        while (cursor != null && !cursor.equals(AiReportCategory.ROOT_PARENT_ID)) {
            if (selfId != null && selfId.equals(cursor)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "不能将分类挂到自身子树下");
            }
            cursor = categoryRepository.findById(cursor)
                    .map(AiReportCategory::getParentId)
                    .orElse(AiReportCategory.ROOT_PARENT_ID);
        }
    }

    private List<AiReportCategoryVO> buildCategoryLevel(
            Long parentId, Map<Long, List<AiReportCategory>> byParent) {
        List<AiReportCategoryVO> out = new ArrayList<>();
        for (AiReportCategory c : byParent.getOrDefault(parentId, List.of())) {
            List<AiReportCategoryVO> children = buildCategoryLevel(c.getId(), byParent);
            out.add(toCategoryVO(c, children.isEmpty() ? null : children));
        }
        return out;
    }

    private AiReportCategoryVO toCategoryVO(AiReportCategory c, List<AiReportCategoryVO> children) {
        AiReportCategoryVO vo = new AiReportCategoryVO();
        vo.setId(c.getId());
        vo.setParentId(c.getParentId());
        vo.setCode(c.getCode());
        vo.setName(c.getName());
        vo.setIsGroup(c.getIsGroup() != null && c.getIsGroup() == 1);
        vo.setSortOrder(c.getSortOrder());
        vo.setEnabled(c.getEnabled() != null && c.getEnabled() == 1);
        vo.setChildren(children);
        vo.setCreatedAt(c.getCreatedAt());
        vo.setUpdatedAt(c.getUpdatedAt());
        return vo;
    }

    private AiParamSourceVO toParamSourceVO(AiParamSource s) {
        AiParamSourceVO vo = new AiParamSourceVO();
        vo.setId(s.getId());
        vo.setSourceCode(s.getSourceCode());
        vo.setName(s.getName());
        vo.setValueType(s.getValueType());
        vo.setWireKey(s.getWireKey());
        vo.setHandlerBean(s.getHandlerBean());
        vo.setConfig(s.getConfigJson());
        vo.setEnabled(s.getEnabled() != null && s.getEnabled() == 1);
        vo.setSortOrder(s.getSortOrder());
        return vo;
    }

    private AiWorkflowPlatformVO toWorkflowVO(AiWorkflowPlatform p) {
        AiWorkflowPlatformVO vo = new AiWorkflowPlatformVO();
        vo.setId(p.getId());
        vo.setPlatformCode(p.getPlatformCode());
        vo.setName(p.getName());
        vo.setEnabled(p.getEnabled() != null && p.getEnabled() == 1);
        return vo;
    }

    private AiReportDefVO toReportVO(AiReportDef r) {
        AiReportDefVO vo = new AiReportDefVO();
        vo.setId(r.getId());
        vo.setReportCode(r.getReportCode());
        vo.setTitle(r.getTitle());
        vo.setDescription(r.getDescription());
        vo.setCategoryId(r.getCategoryId());
        vo.setSlots(r.getSlotsJson());
        vo.setUseAiWorkflow(r.getUseAiWorkflow() != null && r.getUseAiWorkflow() == 1);
        vo.setWorkflowPlatformCode(r.getWorkflowPlatformCode());
        vo.setWorkflowCode(r.getWorkflowCode());
        vo.setEnabled(r.getEnabled() != null && r.getEnabled() == 1);
        vo.setSortOrder(r.getSortOrder());
        vo.setCreatedAt(r.getCreatedAt());
        vo.setUpdatedAt(r.getUpdatedAt());
        return vo;
    }

    private AiReportAclVO toAclVO(AiReportAcl acl) {
        AiReportAclVO vo = new AiReportAclVO();
        vo.setId(acl.getId());
        vo.setReportCode(acl.getReportCode());
        vo.setSubjectType(acl.getSubjectType());
        vo.setSubjectId(acl.getSubjectId());
        return vo;
    }

    private Long currentUserId() {
        try {
            return SecurityContextHolder.getOptional()
                    .map(u -> u.getUserId())
                    .orElse(null);
        } catch (Exception ignored) {
            return null;
        }
    }
}
