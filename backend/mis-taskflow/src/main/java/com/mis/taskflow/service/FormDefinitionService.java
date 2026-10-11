package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.FormDefinition;
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
import java.util.List;

/**
 * 业务表单注册表管理。
 *
 * <p>后台只管「哪个 formCode 存在、归哪一类、启用没有」；表单长什么样由前端注册表负责。
 *
 * <p>分类从「父级」改为「属性」：表单不再有父子层级，只以 {@code categoryId}
 * 软引用统一业务分类表 {@code biz_category}（可空=未分类）。旧的树 / 深度 / kind 逻辑已移除。
 *
 * <p>⚠️ code 是身份：{@code uk_form_def_tenant_code} 不带 {@code WHERE deleted = 0}，
 * 软删后 code 也不可复用——否则历史实例（{@code wf_instance.started_form_code} 是字符串软引用）
 * 会渲染出新的同名不同实现表单，审批人看到错数据。
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
     *
     * <p>{@code categoryIds} 非空时按分类集合精确匹配（决策 E：精确匹配，不含子分类），
     * 语义为「勾选 N 个分类 ⇒ 只返回 categoryId ∈ 集合 的项」（集合 IN 的 OR）；
     * 集合为空 / null 则不过滤（返回全部）。
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

    // ------------------------------------------------------------------
    // 写入
    // ------------------------------------------------------------------

    @Transactional
    public Long create(Long tenantId, Long operatorId, UpsertFormDefinitionRequest req) {
        String code = req.code().trim();
        // code 软删后不可复用 ⇒ 冲突判定必须看到软删行
        formRepository.findByTenantIdAndCode(tenantId, code).ifPresent(existing -> {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    existing.getDeleted() == 1
                            ? "表单编码「" + code + "」已被删除，不可复用（历史实例仍按此编码渲染）"
                            : "表单编码「" + code + "」已存在");
        });
        validateCategory(tenantId, req.categoryId());

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

        // code 是身份：改了会让 wf_instance.started_form_code 这种字符串软引用失联
        String code = req.code().trim();
        if (!code.equals(f.getCode())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "表单编码不可修改（它是历史实例的引用标识）");
        }

        validateCategory(tenantId, req.categoryId());

        f.setCategoryId(req.categoryId());
        f.setName(req.name().trim());
        f.setDescription(req.description());
        f.setStatus(normalizeStatus(req.status()));
        f.setSortOrder(req.sortOrder() == null ? 0 : req.sortOrder());
        f.setConfig(StringUtils.hasText(req.config()) ? req.config() : "{}");
        f.setUpdatedAt(LocalDateTime.now());
        formRepository.save(f);
    }

    /**
     * 软删表单定义。
     *
     * <p>⚠️ 有任何引用 ⇒ 拒绝。两类引用：
     * <ol>
     *   <li>{@code wf_definition.supported_form_codes @> ARRAY[code]}：流程白名单</li>
     *   <li>{@code wf_instance.started_form_code = code}：历史实例已用它发起过流程</li>
     * </ol>
     * 这两类是字符串软引用（无外键），库里查不到外键约束，只能在这里挡。
     *
     * <p>分类引用关系是反过来的：表单挂在分类下，删表单不影响分类，无需在此校验。
     */
    @Transactional
    public void delete(Long id, Long tenantId) {
        FormDefinition f = require(id, tenantId);

        long usedByDefs = definitionRepository.countBySupportedFormCode(tenantId, f.getCode());
        if (usedByDefs > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "表单「" + f.getCode() + "」已被 " + usedByDefs + " 个流程定义引用，请先修改流程的表单白名单");
        }
        long usedByInstances = instanceRepository.countByStartedFormCode(tenantId, f.getCode());
        if (usedByInstances > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "表单「" + f.getCode() + "」已被 " + usedByInstances + " 条流程实例使用，不可删除（可改为停用）");
        }

        f.setDeleted(1);
        f.setUpdatedAt(LocalDateTime.now());
        formRepository.save(f);
    }

    /** 校验 formCode 是否已注册且启用——流程定义白名单与启动流程的权威校验入口。 */
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

    /** 供流程定义白名单校验使用：批量取出已注册且启用的 code 集合。 */
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

    /** 分类存在性校验：{@code categoryId} 非空时须存在、同租户、未软删。 */
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
                f.getConfig(), f.getCreatedAt(), f.getUpdatedAt());
    }
}
