package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.FormDefinition;
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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 业务表单注册表管理。
 *
 * <p>后台只管「哪个 formCode 存在、归哪一类、启用没有」；表单长什么样由前端注册表负责。
 *
 * <p>⚠️ code 是身份：{@code uk_form_def_tenant_code} 不带 {@code WHERE deleted = 0}，
 * 软删后 code 也不可复用——否则历史实例（{@code wf_instance.started_form_code} 是字符串软引用）
 * 会渲染出新的同名不同实现表单，审批人看到错数据。
 */
@Service
public class FormDefinitionService {

    /** 分类树最大深度：根(0) → 分类(1) → 表单(2)。挂到第 3 层节点下会被拒。 */
    private static final int MAX_DEPTH = 2;

    private final FormDefinitionRepository formRepository;
    private final WfDefinitionRepository definitionRepository;
    private final WfInstanceRepository instanceRepository;

    public FormDefinitionService(FormDefinitionRepository formRepository,
                                 WfDefinitionRepository definitionRepository,
                                 WfInstanceRepository instanceRepository) {
        this.formRepository = formRepository;
        this.definitionRepository = definitionRepository;
        this.instanceRepository = instanceRepository;
    }

    // ------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------

    /** 全量列表（含停用），平铺。 */
    @Transactional(readOnly = true)
    public List<FormDefinitionVO> list(Long tenantId) {
        return formRepository.findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(tenantId, 0)
                .stream().map(f -> toVo(f, null)).toList();
    }

    /** 启用中的表单——编排弹窗的候选项来源。 */
    @Transactional(readOnly = true)
    public List<FormDefinitionVO> listEnabled(Long tenantId) {
        return formRepository.findByTenantIdAndStatusAndDeletedOrderBySortOrderAscIdAsc(
                        tenantId, FormDefinition.STATUS_ENABLED, 0)
                .stream().map(f -> toVo(f, null)).toList();
    }

    /**
     * 分类树（邻接表在内存里组装）。
     *
     * <p>层级在应用层收敛为「根 → 分类 → 表单」三层（见 {@link #validateParent}），
     * 因此这里用递归即可，不需要防环的 visited 集合。
     */
    @Transactional(readOnly = true)
    public List<FormDefinitionVO> tree(Long tenantId) {
        List<FormDefinition> all = formRepository
                .findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(tenantId, 0);
        Map<Long, List<FormDefinition>> byParent = new HashMap<>();
        for (FormDefinition f : all) {
            byParent.computeIfAbsent(f.getParentId(), k -> new ArrayList<>()).add(f);
        }
        return buildLevel(tenantId, FormDefinition.ROOT_PARENT_ID, byParent);
    }

    private List<FormDefinitionVO> buildLevel(Long tenantId, Long parentId,
                                              Map<Long, List<FormDefinition>> byParent) {
        List<FormDefinitionVO> out = new ArrayList<>();
        for (FormDefinition f : byParent.getOrDefault(parentId, List.of())) {
            List<FormDefinitionVO> children = buildLevel(tenantId, f.getId(), byParent);
            out.add(toVo(f, children.isEmpty() ? null : children));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public FormDefinitionVO get(Long id, Long tenantId) {
        return toVo(require(id, tenantId), null);
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
        validateParent(tenantId, req.parentId(), null);

        LocalDateTime now = LocalDateTime.now();
        FormDefinition f = new FormDefinition();
        f.setId(IdGenerator.nextId());
        f.setTenantId(tenantId);
        f.setParentId(req.parentId() == null ? FormDefinition.ROOT_PARENT_ID : req.parentId());
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

        validateParent(tenantId, req.parentId(), id);

        f.setParentId(req.parentId() == null ? FormDefinition.ROOT_PARENT_ID : req.parentId());
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
     * <p>⚠️ 有任何引用 ⇒ 拒绝。三类引用：
     * <ol>
     *   <li>子分类：删了会留下孤儿节点</li>
     *   <li>{@code wf_definition.supported_form_codes @> ARRAY[code]}：流程白名单</li>
     *   <li>{@code wf_instance.started_form_code = code}：历史实例已用它发起过流程</li>
     * </ol>
     * 后两类是字符串软引用（无外键），库里查不到外键约束，只能在这里挡。
     */
    @Transactional
    public void delete(Long id, Long tenantId) {
        FormDefinition f = require(id, tenantId);

        long children = formRepository.countByTenantIdAndParentIdAndDeleted(tenantId, id, 0);
        if (children > 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "表单「" + f.getName() + "」下还有 " + children + " 个子项，请先删除子项");
        }
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

    // ------------------------------------------------------------------
    // 内部
    // ------------------------------------------------------------------

    /**
     * 父节点校验：层级收敛为「根 → 分类 → 表单」三层（{@link #MAX_DEPTH}）。
     *
     * <p>父节点必须存在、未软删，且挂上去之后本节点的深度不超过 {@link #MAX_DEPTH}。
     *
     * <p>为什么用应用层而不是 {@code CHECK}：PG 的 CHECK 不能跨行，深度约束天然做不到。
     *
     * <p>⚠️ 深度上限同时保证了树里不可能出现「A是B的祖先、B是A的祖先」这种环：
     * {@link #tree} 的递归因此不需要 visited 集合。
     */
    private void validateParent(Long tenantId, Long parentId, Long selfId) {
        if (parentId == null || FormDefinition.ROOT_PARENT_ID.equals(parentId)) {
            return;
        }
        if (parentId.equals(selfId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "父分类不能是自己");
        }
        FormDefinition parent = formRepository
                .findByIdAndTenantIdAndDeleted(parentId, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "父分类不存在: " + parentId));
        int parentDepth = depthOf(tenantId, parent);
        if (parentDepth + 1 > MAX_DEPTH) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "分类层级最多三层（根 → 分类 → 表单），父分类「" + parent.getName() + "」已在第三层");
        }
    }

    /** 节点深度：根（{@code parent_id = 0}）为 0，每往下一层 +1。上限 {@link #MAX_DEPTH}，不会死循环。 */
    private int depthOf(Long tenantId, FormDefinition node) {
        int depth = 0;
        Long cursor = node.getParentId();
        while (cursor != null && !FormDefinition.ROOT_PARENT_ID.equals(cursor) && depth <= MAX_DEPTH) {
            depth++;
            cursor = formRepository.findByIdAndTenantIdAndDeleted(cursor, tenantId, 0)
                    .map(FormDefinition::getParentId)
                    .orElse(null);
        }
        return depth;
    }

    private FormDefinition require(Long id, Long tenantId) {
        FormDefinition f = formRepository.findByIdAndTenantIdAndDeleted(id, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "表单定义不存在"));
        return f;
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

    private static FormDefinitionVO toVo(FormDefinition f, List<FormDefinitionVO> children) {
        return new FormDefinitionVO(
                String.valueOf(f.getId()), String.valueOf(f.getTenantId()), f.getParentId(),
                f.getCode(), f.getName(), f.getDescription(), f.getStatus(), f.getSortOrder(),
                f.getConfig(), children, f.getCreatedAt(), f.getUpdatedAt());
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
}