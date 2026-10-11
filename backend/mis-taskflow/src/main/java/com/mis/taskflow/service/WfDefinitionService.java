package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.WfDefinition;
import com.mis.taskflow.domain.entity.WfEdge;
import com.mis.taskflow.domain.entity.WfNode;
import com.mis.taskflow.domain.repository.BizCategoryRepository;
import com.mis.taskflow.domain.repository.WfDefinitionRepository;
import com.mis.taskflow.domain.repository.WfEdgeRepository;
import com.mis.taskflow.domain.repository.WfNodeRepository;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.WfDefinitionDTO;
import com.mis.taskflow.dto.WfEdgeDTO;
import com.mis.taskflow.dto.WfNodeDTO;
import com.mis.taskflow.support.IdGenerator;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

/**
 * 流程定义管理（P5）：创建 / 更新（草稿）/ 发布 / 查询。
 */
@Service
public class WfDefinitionService {

    private final WfDefinitionRepository definitionRepository;
    private final WfNodeRepository nodeRepository;
    private final WfEdgeRepository edgeRepository;
    private final FormDefinitionService formDefinitionService;
    private final BizCategoryRepository bizCategoryRepository;

    public WfDefinitionService(WfDefinitionRepository definitionRepository, WfNodeRepository nodeRepository,
                               WfEdgeRepository edgeRepository, FormDefinitionService formDefinitionService,
                               BizCategoryRepository bizCategoryRepository) {
        this.definitionRepository = definitionRepository;
        this.nodeRepository = nodeRepository;
        this.edgeRepository = edgeRepository;
        this.formDefinitionService = formDefinitionService;
        this.bizCategoryRepository = bizCategoryRepository;
    }

    @Transactional
    public Long create(Long tenantId, Long operatorId, CreateDefinitionRequest req) {
        validateNodes(req.nodes());
        validateSupportedForms(tenantId, req.supportedFormCodes());
        validateCategory(tenantId, req.categoryId());
        LocalDateTime now = LocalDateTime.now();
        Long defId = IdGenerator.nextId();

        WfDefinition def = new WfDefinition();
        def.setId(defId);
        def.setTenantId(tenantId);
        def.setCode(req.code().trim());
        def.setName(req.name().trim());
        def.setCategory(StringUtils.hasText(req.category()) ? req.category().trim() : "APPROVAL");
        def.setCategoryId(req.categoryId());
        def.setDescription(req.description());
        def.setVersion(1);
        def.setStatus(WfDefinition.STATUS_DRAFT);
        def.setSupportedFormCodes(toArray(req.supportedFormCodes()));
        def.setConfig(StringUtils.hasText(req.config()) ? req.config() : "{}");
        def.setCreatedBy(operatorId);
        def.setCreatedAt(now);
        def.setUpdatedAt(now);
        definitionRepository.save(def);

        saveNodes(defId, req.nodes(), now);
        saveEdges(defId, req.edges(), now);
        return defId;
    }

    @Transactional
    public void update(Long id, Long tenantId, CreateDefinitionRequest req) {
        WfDefinition def = requireDef(id, tenantId);
        if (!WfDefinition.STATUS_DRAFT.equals(def.getStatus())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "仅草稿状态可修改，已发布流程请先取消发布或创建新版本");
        }
        validateNodes(req.nodes());
        validateSupportedForms(tenantId, req.supportedFormCodes());
        validateCategory(tenantId, req.categoryId());
        LocalDateTime now = LocalDateTime.now();
        def.setName(req.name().trim());
        def.setCategory(StringUtils.hasText(req.category()) ? req.category().trim() : "APPROVAL");
        def.setCategoryId(req.categoryId());
        def.setDescription(req.description());
        def.setSupportedFormCodes(toArray(req.supportedFormCodes()));
        def.setConfig(StringUtils.hasText(req.config()) ? req.config() : "{}");
        def.setUpdatedAt(now);
        definitionRepository.save(def);

        nodeRepository.deleteByDefinitionId(id);
        edgeRepository.deleteByDefinitionId(id);
        // ⚠️ 必须显式 flush：Hibernate 的动作队列里 INSERT 排在 DELETE 之前，
        // 不 flush 的话新节点会先撞上 uk_wf_node_code (definition_id, node_code)。
        nodeRepository.flush();
        edgeRepository.flush();
        saveNodes(id, req.nodes(), now);
        saveEdges(id, req.edges(), now);
    }

    /** 发布：DRAFT -> ACTIVE。 */
    @Transactional
    public void activate(Long id, Long tenantId) {
        WfDefinition def = requireDef(id, tenantId);
        if (WfDefinition.STATUS_ACTIVE.equals(def.getStatus())) {
            return;
        }
        validateNodes(toNodeDtos(nodeRepository.findByDefinitionIdOrderBySortOrderAsc(id)));
        def.setStatus(WfDefinition.STATUS_ACTIVE);
        def.setUpdatedAt(LocalDateTime.now());
        definitionRepository.save(def);
    }

    /**
     * 取消发布：ACTIVE -> DRAFT。
     *
     * <p>非 ACTIVE（含已是 DRAFT / ARCHIVED）时幂等返回，不抛错。
     *
     * <p>⚠️ 只能改 {@code status}，<b>不能删定义</b>：唯一索引是
     * {@code uk_wf_def_tenant_code_ver (tenant_id, code, version) WHERE deleted = 0}（V121:26），
     * 同 code 可多版本并存，且 {@code wf_instance.definition_id} 是外键指向具体定义行。
     * 删除会让历史实例的 definition 失联。
     *
     * <p>取消发布后 {@code status = DRAFT} ⇒ {@link #update} 的「仅草稿可改」守卫自然放行，
     * 编辑路径无需额外改动。
     */
    @Transactional
    public void deactivate(Long id, Long tenantId) {
        WfDefinition def = requireDef(id, tenantId);
        if (!WfDefinition.STATUS_ACTIVE.equals(def.getStatus())) {
            return;
        }
        def.setStatus(WfDefinition.STATUS_DRAFT);
        def.setUpdatedAt(LocalDateTime.now());
        definitionRepository.save(def);
    }

    @Transactional(readOnly = true)
    public WfDefinitionDTO get(Long id, Long tenantId) {
        return toDto(requireDef(id, tenantId));
    }

    @Transactional(readOnly = true)
    public WfDefinitionDTO getByCode(Long tenantId, String code) {
        WfDefinition def = definitionRepository
                .findFirstByTenantIdAndCodeAndStatusAndDeletedOrderByVersionDesc(
                        tenantId, code, WfDefinition.STATUS_ACTIVE, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "未找到已发布的流程定义: " + code));
        return toDto(def);
    }

    @Transactional(readOnly = true)
    public PageResult<WfDefinitionDTO> list(Long tenantId, int page, int size) {
        return list(tenantId, page, size, List.of());
    }

    /**
     * 分页列表（可选 categoryIds / keyword 过滤）。
     *
     * <p>{@code categoryIds} 为空 / null 时不按分类筛；非空时按软引用分类集合筛选
     * （{@code category_id IN (...)}，集合 IN 的 OR）。调用方若需「选父含子集」应先展开子孙 id。
     * {@code keyword} 非空时按流程名称或编码做大小写不敏感的包含匹配（模糊搜索）。
     * 无分类且无关键词时走仓储 Page；否则取候选全量后内存过滤再分页（数据量可控）。
     */
    @Transactional(readOnly = true)
    public PageResult<WfDefinitionDTO> list(Long tenantId, int page, int size, List<Long> categoryIds) {
        return list(tenantId, page, size, categoryIds, null);
    }

    @Transactional(readOnly = true)
    public PageResult<WfDefinitionDTO> list(Long tenantId, int page, int size,
                                            List<Long> categoryIds, String keyword) {
        boolean hasCategory = categoryIds != null && !categoryIds.isEmpty();
        String kw = StringUtils.hasText(keyword) ? keyword.trim().toLowerCase(Locale.ROOT) : null;
        if (!hasCategory && kw == null) {
            var pageable = PageRequest.of(Math.max(page - 1, 0), Math.min(Math.max(size, 1), 200));
            var p = definitionRepository.findByTenantIdAndDeleted(tenantId, 0, pageable);
            return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(),
                    p.getContent().stream().map(this::toDto).toList());
        }
        Stream<WfDefinition> stream = hasCategory
                ? definitionRepository.findByTenantIdAndCategoryIdInAndDeleted(tenantId, categoryIds, 0).stream()
                : definitionRepository.findByTenantIdAndDeletedOrderByUpdatedAtDesc(tenantId, 0).stream();
        if (kw != null) {
            final String needle = kw;
            stream = stream.filter(d -> matchesNameOrCode(d, needle));
        }
        List<WfDefinitionDTO> all = stream.map(this::toDto).toList();
        int safeSize = Math.min(Math.max(size, 1), 200);
        int from = Math.max((page - 1) * safeSize, 0);
        int to = Math.min(from + safeSize, all.size());
        List<WfDefinitionDTO> content = from >= all.size() ? List.of() : all.subList(from, to);
        return PageResult.of(page, safeSize, (long) all.size(), content);
    }

    /** 名称或编码包含关键词（已小写）。 */
    private static boolean matchesNameOrCode(WfDefinition d, String needle) {
        if (d.getName() != null && d.getName().toLowerCase(Locale.ROOT).contains(needle)) {
            return true;
        }
        return d.getCode() != null && d.getCode().toLowerCase(Locale.ROOT).contains(needle);
    }

    // ------------------------------------------------------------------

    private void saveNodes(Long defId, List<WfNodeDTO> nodes, LocalDateTime now) {
        for (WfNodeDTO dto : nodes) {
            WfNode node = new WfNode();
            node.setId(IdGenerator.nextId());
            node.setDefinitionId(defId);
            node.setNodeCode(dto.nodeCode().trim());
            node.setNodeName(dto.nodeName().trim());
            node.setNodeType(dto.nodeType().trim().toUpperCase());
            node.setSortOrder(dto.sortOrder() == null ? 0 : dto.sortOrder());
            node.setCanvasX(dto.canvasX());
            node.setCanvasY(dto.canvasY());
            node.setConditionExpr(dto.conditionExpr());
            node.setAssigneeRule(StringUtils.hasText(dto.assigneeRule()) ? dto.assigneeRule() : "{}");
            node.setTimeoutHours(dto.timeoutHours());
            node.setConfig(StringUtils.hasText(dto.config()) ? dto.config() : "{}");
            node.setCreatedAt(now);
            nodeRepository.save(node);
        }
    }

    private void saveEdges(Long defId, List<WfEdgeDTO> edges, LocalDateTime now) {
        if (edges == null) {
            return;
        }
        int sort = 0;
        for (WfEdgeDTO dto : edges) {
            if (!StringUtils.hasText(dto.source()) || !StringUtils.hasText(dto.target())) {
                continue;
            }
            WfEdge edge = new WfEdge();
            edge.setId(IdGenerator.nextId());
            edge.setDefinitionId(defId);
            edge.setSourceNode(dto.source().trim());
            edge.setTargetNode(dto.target().trim());
            edge.setEdgeType(StringUtils.hasText(dto.edgeType()) ? dto.edgeType().trim().toUpperCase() : WfEdge.TYPE_DEFAULT);
            edge.setLabel(dto.label());
            edge.setConditionExpr(dto.conditionExpr());
            edge.setSortOrder(dto.sortOrder() == null ? sort : dto.sortOrder());
            edge.setCreatedAt(now);
            sort++;
            edgeRepository.save(edge);
        }
    }

    /**
     * 白名单强校验：每个 formCode 必须已在 {@code form_definition} 注册、未软删且 {@code status=ENABLED}。
     *
     * <p>这是「后台定义了 formCode 但前端没注册」双保险里的<b>权威层</b>（前端拦截只是提效）。
     * 绕过前端直调API 也能挡住脏数据。
     */
    private void validateSupportedForms(Long tenantId, List<String> codes) {
        if (codes == null || codes.isEmpty()) {
            return;
        }
        List<String> wanted = codes.stream().filter(StringUtils::hasText).map(String::trim).distinct().toList();
        if (wanted.isEmpty()) {
            return;
        }
        List<String> enabled = formDefinitionService.listEnabledCodes(tenantId, wanted);
        for (String code : wanted) {
            if (!enabled.contains(code)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR,
                        "表单「" + code + "」未注册或已停用，请先在表单管理中登记并启用");
            }
        }
    }

    /** 校验：恰一个 START、至少一个 END、审批节点需有审批人规则。 */
    private void validateNodes(List<WfNodeDTO> nodes) {
        if (nodes == null || nodes.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "流程至少需要一个节点");
        }
        long start = nodes.stream().filter(n -> WfNode.TYPE_START.equalsIgnoreCase(n.nodeType())).count();
        long end = nodes.stream().filter(n -> WfNode.TYPE_END.equalsIgnoreCase(n.nodeType())).count();
        if (start != 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "流程必须且仅能有一个开始节点（当前 " + start + " 个）");
        }
        if (end < 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "流程至少需要一个结束节点");
        }
        for (WfNodeDTO n : nodes) {
            if (WfNode.TYPE_APPROVAL.equalsIgnoreCase(n.nodeType())
                    && (!StringUtils.hasText(n.assigneeRule()) || "{}".equals(n.assigneeRule().trim()))) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR,
                        "审批节点「" + n.nodeName() + "」未配置审批人规则");
            }
        }
    }

    /**
     * 分类存在性校验（软引用 {@code biz_category.id}）：{@code categoryId} 非空时须存在、同租户、未软删。
     */
    private void validateCategory(Long tenantId, Long categoryId) {
        if (categoryId == null) {
            return;
        }
        bizCategoryRepository.findByIdAndTenantIdAndDeleted(categoryId, tenantId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR,
                        "业务分类不存在: " + categoryId));
    }

    private WfDefinition requireDef(Long id, Long tenantId) {
        WfDefinition def = definitionRepository.findByIdAndDeleted(id, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "流程定义不存在"));
        if (!def.getTenantId().equals(tenantId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权访问该流程定义");
        }
        return def;
    }

    private WfDefinitionDTO toDto(WfDefinition def) {
        List<WfNodeDTO> nodes = toNodeDtos(nodeRepository.findByDefinitionIdOrderBySortOrderAsc(def.getId()));
        List<WfEdgeDTO> edges = edgeRepository.findByDefinitionIdOrderBySortOrderAsc(def.getId()).stream()
                .map(e -> new WfEdgeDTO(e.getSourceNode(), e.getTargetNode(), e.getEdgeType(),
                        e.getLabel(), e.getConditionExpr(), e.getSortOrder()))
                .toList();
        return new WfDefinitionDTO(
                String.valueOf(def.getId()), String.valueOf(def.getTenantId()), def.getCode(), def.getName(),
                def.getCategory(), def.getDescription(), def.getVersion(), def.getStatus(),
                def.getSupportedFormCodes() == null ? List.of() : Arrays.asList(def.getSupportedFormCodes()),
                def.getFormSchema(), def.getConfig(), nodes, edges, def.getCreatedAt(), def.getUpdatedAt(),
                def.getCategoryId());
    }

    private List<WfNodeDTO> toNodeDtos(List<WfNode> nodes) {
        return nodes.stream().map(n -> new WfNodeDTO(
                n.getNodeCode(), n.getNodeName(), n.getNodeType(), n.getSortOrder(),
                n.getCanvasX(), n.getCanvasY(), n.getConditionExpr(), n.getAssigneeRule(),
                n.getTimeoutHours(), n.getConfig())).toList();
    }

    private static String[] toArray(List<String> list) {
        return list == null ? new String[0] : list.stream().filter(StringUtils::hasText).toArray(String[]::new);
    }
}
