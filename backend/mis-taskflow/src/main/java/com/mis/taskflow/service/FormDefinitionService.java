package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.FormDefinition;
import com.mis.taskflow.domain.entity.WfDefinition;
import com.mis.taskflow.domain.repository.BizCategoryRepository;
import com.mis.taskflow.domain.repository.FormDefinitionRepository;
import com.mis.taskflow.domain.repository.WfDefinitionRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import com.mis.taskflow.dto.FormDefinitionVO;
import com.mis.taskflow.dto.UpsertFormDefinitionRequest;
import com.mis.taskflow.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 业务表单注册表管理。
 *
 * <p>V149 起：工作流关联（NONE/LOCAL/EXTERNAL）落在 {@code form_definition}，
 * 本服务是唯一写入口；流程定义侧只反查。
 */
@Service
public class FormDefinitionService {

    private final FormDefinitionRepository formRepository;
    private final BizCategoryRepository categoryRepository;
    private final WfDefinitionRepository definitionRepository;
    private final WfInstanceRepository instanceRepository;

    public FormDefinitionService(FormDefinitionRepository formRepository,
                                 BizCategoryRepository categoryRepository,
                                 WfDefinitionRepository definitionRepository,
                                 WfInstanceRepository instanceRepository) {
        this.formRepository = formRepository;
        this.categoryRepository = categoryRepository;
        this.definitionRepository = definitionRepository;
        this.instanceRepository = instanceRepository;
    }

    // ------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------

    /** 全量列表（含停用），平铺。 */
    @Transactional(readOnly = true)
    public List<FormDefinitionVO> list(Long tenantId) {
        return list(tenantId, null, List.of());
    }

    /** 启用中的表单——编排弹窗的候选项来源。 */
    @Transactional(readOnly = true)
    public List<FormDefinitionVO> listEnabled(Long tenantId) {
        return formRepository.findByTenantIdAndStatusAndDeletedOrderBySortOrderAscIdAsc(
                        tenantId, FormDefinition.STATUS_ENABLED, 0)
                .stream().map(FormDefinitionService::toVo).toList();
    }

    /**
     * 列表（可选 status / categoryIds 过滤）。
     */
    @Transactional(readOnly = true)
    public List<FormDefinitionVO> list(Long tenantId, String status, List<Long> categoryIds) {
        List<FormDefinition> all;
        boolean enabledOnly = "ENABLED".equalsIgnoreCase(status);
        if (categoryIds != null && !categoryIds.isEmpty()) {
            all = formRepository.findByTenantIdAndCategoryIdInAndDeletedOrderBySortOrderAscIdAsc(
                            tenantId, categoryIds, 0).stream()
                    .filter(f -> !enabledOnly || FormDefinition.STATUS_ENABLED.equals(f.getStatus()))
                    .toList();
        } else if (enabledOnly) {
            all = formRepository.findByTenantIdAndStatusAndDeletedOrderBySortOrderAscIdAsc(
                    tenantId, FormDefinition.STATUS_ENABLED, 0);
        } else {
            all = formRepository.findByTenantIdAndDeletedOrderBySortOrderAscIdAsc(tenantId, 0);
        }
        return all.stream().map(FormDefinitionService::toVo).toList();
    }

    @Transactional(readOnly = true)
    public FormDefinitionVO get(Long id, Long tenantId) {
        return toVo(require(id, tenantId));
    }

    /** 流程定义侧反查：挂在该本地流程上的表单 code 列表（按排序）。 */
    @Transactional(readOnly = true)
    public List<String> listFormCodesByWorkflowDefinitionId(Long tenantId, Long workflowDefinitionId) {
        if (workflowDefinitionId == null) {
            return List.of();
        }
        return formRepository
                .findByTenantIdAndWorkflowDefinitionIdAndDeletedOrderBySortOrderAscIdAsc(
                        tenantId, workflowDefinitionId, 0)
                .stream()
                .filter(f -> FormDefinition.BINDING_LOCAL.equals(f.getWorkflowBindingType()))
                .map(FormDefinition::getCode)
                .toList();
    }

    // ------------------------------------------------------------------
    // 写入
    // ------------------------------------------------------------------

    @Transactional
    public Long create(Long tenantId, Long operatorId, UpsertFormDefinitionRequest req) {
        String code = req.code().trim();
        formRepository.findByTenantIdAndCode(tenantId, code).ifPresent(existing -> {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    existing.getDeleted() == 1
                            ? "表单编码「" + code + "」已被删除，不可复用（历史实例仍按此编码渲染）"
                            : "表单编码「" + code + "」已存在");
        });
        validateCategory(tenantId, req.categoryId());
        BindingSpec binding = resolveBinding(tenantId, req);

        LocalDateTime now = LocalDateTime.now();
        FormDefinition f = new FormDefinition();
        f.setId(IdGenerator.nextId());
        f.setTenantId(tenantId);
        f.setCategoryId(req.categoryId());
        f.setCode(code);
        f.setName(req.name().trim());
        f.setDescription(req.description());
        f.setStatus(normalizeStatus(req.status()));
        f.setSortOrder(req.sortOrder() == null ? 0 : req.sortOrder());
        f.setConfig(StringUtils.hasText(req.config()) ? req.config() : "{}");
        applyBinding(f, binding);
        f.setDeleted(0);
        f.setCreatedBy(operatorId);
        f.setCreatedAt(now);
        f.setUpdatedAt(now);
        formRepository.save(f);
        return f.getId();
    }

    @Transactional
    public void update(Long id, Long tenantId, UpsertFormDefinitionRequest req) {
        FormDefinition f = require(id, tenantId);

        String code = req.code().trim();
        if (!code.equals(f.getCode())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "表单编码不可修改（它是历史实例的引用标识）");
        }

        validateCategory(tenantId, req.categoryId());
        BindingSpec binding = resolveBinding(tenantId, req);

        f.setCategoryId(req.categoryId());
        f.setName(req.name().trim());
        f.setDescription(req.description());
        f.setStatus(normalizeStatus(req.status()));
        f.setSortOrder(req.sortOrder() == null ? 0 : req.sortOrder());
        f.setConfig(StringUtils.hasText(req.config()) ? req.config() : "{}");
        applyBinding(f, binding);
        f.setUpdatedAt(LocalDateTime.now());
        formRepository.save(f);
    }

    /**
     * 兼容旧「流程白名单」写入口：把指定本地流程的关联表单集合替换为 {@code codes}
     *（写 {@code form_definition}，不写 {@code supported_form_codes}）。
     *
     * <p>UI 应以表单注册为准；本方法仅供过渡期 / 测试夹具。
     */
    @Transactional
    public void replaceLocalBindings(Long tenantId, Long workflowDefinitionId, List<String> codes) {
        requireLocalDefinition(tenantId, workflowDefinitionId);
        Set<String> wanted = new HashSet<>();
        if (codes != null) {
            for (String c : codes) {
                if (StringUtils.hasText(c)) {
                    wanted.add(c.trim());
                }
            }
        }
        for (String code : wanted) {
            assertEnabled(tenantId, code);
            FormDefinition f = formRepository.findByTenantIdAndCode(tenantId, code)
                    .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR,
                            "表单「" + code + "」未注册"));
            if (f.getDeleted() == 1) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "表单「" + code + "」已删除");
            }
            // 已挂其它本地流程 → 拒绝（一表单一流程）
            if (FormDefinition.BINDING_LOCAL.equals(f.getWorkflowBindingType())
                    && f.getWorkflowDefinitionId() != null
                    && !f.getWorkflowDefinitionId().equals(workflowDefinitionId)) {
                WfDefinition other = definitionRepository.findByIdAndDeleted(f.getWorkflowDefinitionId(), 0)
                        .orElse(null);
                String otherName = other != null ? other.getName() : String.valueOf(f.getWorkflowDefinitionId());
                throw new BusinessException(ResultCode.VALIDATION_ERROR,
                        "表单「" + code + "」已关联流程「" + otherName + "」，一个表单只能关联一个流程");
            }
            if (FormDefinition.BINDING_EXTERNAL.equals(f.getWorkflowBindingType())) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR,
                        "表单「" + code + "」已关联外部工作流，不能再挂本地流程");
            }
            f.setWorkflowBindingType(FormDefinition.BINDING_LOCAL);
            f.setWorkflowDefinitionId(workflowDefinitionId);
            f.setExternalWorkflowSystem(null);
            f.setExternalWorkflowRef(null);
            f.setUpdatedAt(LocalDateTime.now());
            formRepository.save(f);
        }
        // 卸下：曾挂本流程但不在 wanted 中的
        for (FormDefinition f : formRepository
                .findByTenantIdAndWorkflowDefinitionIdAndDeletedOrderBySortOrderAscIdAsc(
                        tenantId, workflowDefinitionId, 0)) {
            if (!wanted.contains(f.getCode())
                    && FormDefinition.BINDING_LOCAL.equals(f.getWorkflowBindingType())) {
                f.setWorkflowBindingType(FormDefinition.BINDING_NONE);
                f.setWorkflowDefinitionId(null);
                f.setExternalWorkflowSystem(null);
                f.setExternalWorkflowRef(null);
                f.setUpdatedAt(LocalDateTime.now());
                formRepository.save(f);
            }
        }
    }

    /**
     * 软删表单定义。有历史实例引用则拒绝；本地/外部关联本身不阻止删除（可先解绑或直接删）。
     */
    @Transactional
    public void delete(Long id, Long tenantId) {
        FormDefinition f = require(id, tenantId);

        long usedByInstances = instanceRepository.countByStartedFormCode(tenantId, f.getCode());
        if (usedByInstances > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "表单「" + f.getCode() + "」已被 " + usedByInstances + " 条流程实例使用，不可删除（可改为停用）");
        }

        f.setDeleted(1);
        f.setUpdatedAt(LocalDateTime.now());
        formRepository.save(f);
    }

    /** 校验 formCode 是否已注册且启用。 */
    @Transactional(readOnly = true)
    public void assertEnabled(Long tenantId, String formCode) {
        FormDefinition f = formRepository.findByTenantIdAndCode(tenantId, formCode)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR,
                        "表单「" + formCode + "」未注册"));
        if (f.getDeleted() == 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "表单「" + formCode + "」已删除");
        }
        if (!FormDefinition.STATUS_ENABLED.equals(f.getStatus())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "表单「" + formCode + "」已停用");
        }
    }

    /**
     * 启动本地流程时校验：表单须启用，且 {@code LOCAL} 绑定到该流程定义。
     */
    @Transactional(readOnly = true)
    public void assertBoundToLocalDefinition(Long tenantId, String formCode, Long definitionId) {
        assertEnabled(tenantId, formCode);
        FormDefinition f = formRepository.findByTenantIdAndCode(tenantId, formCode).orElseThrow();
        if (!FormDefinition.BINDING_LOCAL.equals(f.getWorkflowBindingType())
                || f.getWorkflowDefinitionId() == null
                || !f.getWorkflowDefinitionId().equals(definitionId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "表单「" + formCode + "」未关联到本流程，请在表单注册中配置本地工作流");
        }
    }

    /** 供过渡期批量校验：批量取出已注册且启用的 code 集合。 */
    @Transactional(readOnly = true)
    public List<String> listEnabledCodes(Long tenantId, List<String> codes) {
        if (codes == null || codes.isEmpty()) {
            return List.of();
        }
        return formRepository.findAliveByTenantIdAndCodes(tenantId, codes).stream()
                .filter(f -> FormDefinition.STATUS_ENABLED.equals(f.getStatus()))
                .map(FormDefinition::getCode)
                .toList();
    }

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    private record BindingSpec(String type, Long definitionId, String externalSystem, String externalRef) {
    }

    private BindingSpec resolveBinding(Long tenantId, UpsertFormDefinitionRequest req) {
        String raw = StringUtils.hasText(req.workflowBindingType())
                ? req.workflowBindingType().trim().toUpperCase()
                : FormDefinition.BINDING_NONE;
        return switch (raw) {
            case FormDefinition.BINDING_NONE -> new BindingSpec(FormDefinition.BINDING_NONE, null, null, null);
            case FormDefinition.BINDING_LOCAL -> {
                if (req.workflowDefinitionId() == null) {
                    throw new BusinessException(ResultCode.VALIDATION_ERROR, "关联本地流程时必须选择流程定义");
                }
                requireLocalDefinition(tenantId, req.workflowDefinitionId());
                yield new BindingSpec(FormDefinition.BINDING_LOCAL, req.workflowDefinitionId(), null, null);
            }
            case FormDefinition.BINDING_EXTERNAL -> {
                if (!StringUtils.hasText(req.externalWorkflowSystem())
                        || !StringUtils.hasText(req.externalWorkflowRef())) {
                    throw new BusinessException(ResultCode.VALIDATION_ERROR,
                            "关联外部工作流时必须填写外部系统与流程标识");
                }
                yield new BindingSpec(
                        FormDefinition.BINDING_EXTERNAL,
                        null,
                        req.externalWorkflowSystem().trim(),
                        req.externalWorkflowRef().trim());
            }
            default -> throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "workflowBindingType 只能是 NONE / LOCAL / EXTERNAL");
        };
    }

    private void requireLocalDefinition(Long tenantId, Long definitionId) {
        WfDefinition def = definitionRepository.findByIdAndDeleted(definitionId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR,
                        "流程定义不存在: " + definitionId));
        if (!def.getTenantId().equals(tenantId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权关联该流程定义");
        }
    }

    private static void applyBinding(FormDefinition f, BindingSpec binding) {
        f.setWorkflowBindingType(binding.type());
        f.setWorkflowDefinitionId(binding.definitionId());
        f.setExternalWorkflowSystem(binding.externalSystem());
        f.setExternalWorkflowRef(binding.externalRef());
    }

    private void validateCategory(Long tenantId, Long categoryId) {
        if (categoryId == null) {
            return;
        }
        categoryRepository.findByIdAndTenantIdAndDeleted(categoryId, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR,
                        "分类不存在: " + categoryId));
    }

    private FormDefinition require(Long id, Long tenantId) {
        return formRepository.findByIdAndTenantIdAndDeleted(id, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "表单定义不存在"));
    }

    private static String normalizeStatus(String status) {
        if (!StringUtils.hasText(status)) {
            return FormDefinition.STATUS_ENABLED;
        }
        String s = status.trim().toUpperCase();
        if (!FormDefinition.STATUS_ENABLED.equals(s) && !FormDefinition.STATUS_DISABLED.equals(s)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "表单状态只能是 ENABLED 或 DISABLED");
        }
        return s;
    }

    private static FormDefinitionVO toVo(FormDefinition f) {
        return new FormDefinitionVO(
                String.valueOf(f.getId()), String.valueOf(f.getTenantId()), f.getCategoryId(),
                f.getCode(), f.getName(), f.getDescription(), f.getStatus(), f.getSortOrder(),
                f.getConfig(),
                f.getWorkflowBindingType() == null ? FormDefinition.BINDING_NONE : f.getWorkflowBindingType(),
                f.getWorkflowDefinitionId() == null ? null : String.valueOf(f.getWorkflowDefinitionId()),
                f.getExternalWorkflowSystem(),
                f.getExternalWorkflowRef(),
                f.getCreatedAt(), f.getUpdatedAt());
    }
}
