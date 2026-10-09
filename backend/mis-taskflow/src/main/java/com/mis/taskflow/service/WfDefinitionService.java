package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.WfDefinition;
import com.mis.taskflow.domain.entity.WfEdge;
import com.mis.taskflow.domain.entity.WfNode;
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

/**
 * 流程定义管理（P5）：创建 / 更新（草稿）/ 发布 / 查询。
 */
@Service
public class WfDefinitionService {

    private final WfDefinitionRepository definitionRepository;
    private final WfNodeRepository nodeRepository;
    private final WfEdgeRepository edgeRepository;

    public WfDefinitionService(WfDefinitionRepository definitionRepository, WfNodeRepository nodeRepository,
                               WfEdgeRepository edgeRepository) {
        this.definitionRepository = definitionRepository;
        this.nodeRepository = nodeRepository;
        this.edgeRepository = edgeRepository;
    }

    @Transactional
    public Long create(Long tenantId, Long operatorId, CreateDefinitionRequest req) {
        validateNodes(req.nodes());
        LocalDateTime now = LocalDateTime.now();
        Long defId = IdGenerator.nextId();

        WfDefinition def = new WfDefinition();
        def.setId(defId);
        def.setTenantId(tenantId);
        def.setCode(req.code().trim());
        def.setName(req.name().trim());
        def.setCategory(StringUtils.hasText(req.category()) ? req.category().trim() : "APPROVAL");
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
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "仅草稿状态可修改，已发布流程请创建新版本");
        }
        validateNodes(req.nodes());
        LocalDateTime now = LocalDateTime.now();
        def.setName(req.name().trim());
        def.setCategory(StringUtils.hasText(req.category()) ? req.category().trim() : "APPROVAL");
        def.setDescription(req.description());
        def.setSupportedFormCodes(toArray(req.supportedFormCodes()));
        def.setConfig(StringUtils.hasText(req.config()) ? req.config() : "{}");
        def.setUpdatedAt(now);
        definitionRepository.save(def);

        nodeRepository.deleteByDefinitionId(id);
        edgeRepository.deleteByDefinitionId(id);
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
        var pageable = PageRequest.of(Math.max(page - 1, 0), Math.min(Math.max(size, 1), 200));
        var p = definitionRepository.findByTenantIdAndDeleted(tenantId, 0, pageable);
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(),
                p.getContent().stream().map(this::toDto).toList());
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
                def.getFormSchema(), def.getConfig(), nodes, edges, def.getCreatedAt(), def.getUpdatedAt());
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
