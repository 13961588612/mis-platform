package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.WfDefinition;
import com.mis.taskflow.domain.entity.WfEdge;
import com.mis.taskflow.domain.entity.WfHistory;
import com.mis.taskflow.domain.entity.WfInstance;
import com.mis.taskflow.domain.entity.WfNode;
import com.mis.taskflow.domain.entity.WfTask;
import com.mis.taskflow.domain.repository.WfDefinitionRepository;
import com.mis.taskflow.domain.repository.WfEdgeRepository;
import com.mis.taskflow.domain.repository.WfHistoryRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import com.mis.taskflow.domain.repository.WfNodeRepository;
import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.dto.CompleteWfTaskRequest;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.HandleTaskRequest;
import com.mis.taskflow.dto.ProcessDetailVO;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.WfHistoryVO;
import com.mis.taskflow.dto.WfInstanceVO;
import com.mis.taskflow.dto.WfTaskVO;
import com.mis.taskflow.support.AuditContext;
import com.mis.taskflow.support.BusinessOperation;
import com.mis.taskflow.support.IdGenerator;
import com.mis.taskflow.support.TaskflowStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

/**
 * 流程引擎核心（P5）。
 *
 * <p>流转模型（按 {@code wf_node.sort_order} 顺序推进）：
 * <pre>
 *   startProcess：校验表单白名单 → 建实例 → 记 SUBMIT 历史 → 推进到第一个可执行节点
 *   advance：           找当前节点 → 找下一节点
 *                       ├─ APPROVAL   → 解析审批人 → 建 wf_task + sys_task(+消息)
 *                       ├─ END        → 实例 COMPLETED + 写后处理任务（WAITING）
 *                       └─ 其他/无下个 → 跳过或结束
 *   completeTask：      APPROVE → 记历史 → advance
 *                       REJECT  → 实例 TERMINATED，给发起人发通知
 * </pre>
 *
 * <p>{@code startedFormCode} 记录本次运行实际使用的表单，供前端 {@code ProcessShell} 渲染。
 */
@Service
public class ProcessService {

    private static final Logger log = LoggerFactory.getLogger(ProcessService.class);

    private final WfDefinitionRepository definitionRepository;
    private final WfNodeRepository nodeRepository;
    private final WfEdgeRepository edgeRepository;
    private final WfInstanceRepository instanceRepository;
    private final WfTaskRepository wfTaskRepository;
    private final WfHistoryRepository historyRepository;
    private final AssignmentResolver assignmentResolver;
    private final TaskService taskService;
    private final MessageService messageService;
    private final ExecutionTaskService executionTaskService;

    public ProcessService(WfDefinitionRepository definitionRepository,
                          WfNodeRepository nodeRepository,
                          WfEdgeRepository edgeRepository,
                          WfInstanceRepository instanceRepository,
                          WfTaskRepository wfTaskRepository,
                          WfHistoryRepository historyRepository,
                          AssignmentResolver assignmentResolver,
                          TaskService taskService,
                          MessageService messageService,
                          ExecutionTaskService executionTaskService) {
        this.definitionRepository = definitionRepository;
        this.nodeRepository = nodeRepository;
        this.edgeRepository = edgeRepository;
        this.instanceRepository = instanceRepository;
        this.wfTaskRepository = wfTaskRepository;
        this.historyRepository = historyRepository;
        this.assignmentResolver = assignmentResolver;
        this.taskService = taskService;
        this.messageService = messageService;
        this.executionTaskService = executionTaskService;
    }

    /**
     * 启动流程实例。
     *
     * @return 实例 ID
     */
    @Transactional
    public Long startProcess(Long tenantId, StartProcessRequest req) {
        WfDefinition def = definitionRepository
                .findFirstByTenantIdAndCodeAndStatusAndDeletedOrderByVersionDesc(
                        tenantId, req.definitionCode().trim(), WfDefinition.STATUS_ACTIVE, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "未找到已发布的流程定义: " + req.definitionCode()));

        assertFormAllowed(def, req.startedFormCode());

        List<WfNode> nodes = nodeRepository.findByDefinitionIdOrderBySortOrderAsc(def.getId());
        WfNode startNode = nodes.stream()
                .filter(n -> WfNode.TYPE_START.equals(n.getNodeType()))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "流程缺少开始节点"));

        LocalDateTime now = LocalDateTime.now();
        WfInstance instance = new WfInstance();
        instance.setId(IdGenerator.nextId());
        instance.setTenantId(tenantId);
        instance.setDefinitionId(def.getId());
        instance.setDefinitionCode(def.getCode());
        instance.setStartedFormCode(req.startedFormCode().trim());
        instance.setBusinessType(req.businessType().trim());
        instance.setBusinessId(req.businessId().trim());
        instance.setStatus(TaskflowStatus.Instance.RUNNING);
        instance.setInitiatorId(req.initiatorId());
        instance.setInitiatorName(req.initiatorName());
        instance.setFormData(req.formData());
        instance.setCurrentNodeCode(startNode.getNodeCode());
        instance.setPostProcessStatus(TaskflowStatus.PostProcess.WAITING);
        instance.setCreatedAt(now);
        instance.setUpdatedAt(now);
        instanceRepository.save(instance);

        recordHistory(instance.getId(), startNode.getNodeCode(), req.initiatorId(), req.initiatorName(),
                WfHistory.OP_SUBMIT, null, startNode.getNodeCode(), null, now);

        advanceToNext(instance, nodes, startNode, now);
        return instance.getId();
    }

    /**
     * 处理流程任务。
     *
     * <p>APPROVE → 记录历史并推进下一节点；REJECT → 终止实例并通知发起人。
     *
     * <p><b>为什么挂 {@code @BusinessOperation}</b>：本方法是用户在流程详情页点「同意/驳回」
     * 的唯一入口，不审计等于审批动作无痕。{@code handleTask} 也有同名注解，
     * 二者嵌套由 {@code AuditContext} 的快照-恢复机制保证互不污染。
     */
    @Transactional
    @BusinessOperation(module = "流程审批", type = "APPROVE",
            businessType = "WF_INSTANCE", description = "处理流程任务",
            captureBefore = true, captureAfter = true)
    public void completeTask(Long tenantId, Long wfTaskId, CompleteWfTaskRequest req, Long operatorId) {
        WfTask wfTask = wfTaskRepository.findByIdAndTenantId(wfTaskId, tenantId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "流程任务不存在"));
        if (!WfTask.STATUS_PENDING.equals(wfTask.getStatus())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "该流程任务已处理");
        }
        // 处理人校验：仅当前任务的 assignee 可处理
        if (operatorId != null && !operatorId.equals(wfTask.getAssigneeId())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权处理该流程任务");
        }

        WfInstance instance = instanceRepository.findByIdAndTenantId(wfTask.getInstanceId(), tenantId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "流程实例不存在"));

        LocalDateTime now = LocalDateTime.now();
        String action = req.action().trim().toUpperCase();

        AuditContext.businessId(instance.getBusinessType() + "/" + instance.getBusinessId());
        AuditContext.before(auditSnapshot(instance));

        if ("REJECT".equals(action)) {
            wfTask.setStatus(WfTask.STATUS_COMPLETED);
            wfTask.setCompletedAt(now);
            wfTaskRepository.save(wfTask);

            instance.setStatus(TaskflowStatus.Instance.TERMINATED);
            instance.setCompletedAt(now);
            instance.setUpdatedAt(now);
            instanceRepository.save(instance);

            recordHistory(instance.getId(), wfTask.getNodeCode(), operatorId, wfTask.getAssigneeName(),
                    WfHistory.OP_REJECT, wfTask.getNodeCode(), null, req.comment(), now);

            notify(instance, "REJECT", "申请被驳回", trimDefault(req.comment(), "您的申请已被驳回"));

            syncLinkedSysTask(tenantId, wfTask, action, req.comment(), operatorId);
            AuditContext.after(auditSnapshot(instance));
            return;
        }

        if (!"APPROVE".equals(action)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "不支持的操作: " + action);
        }

        wfTask.setStatus(WfTask.STATUS_COMPLETED);
        wfTask.setCompletedAt(now);
        wfTaskRepository.save(wfTask);

        // 同步关闭关联的用户视角代办
        syncLinkedSysTask(tenantId, wfTask, action, req.comment(), operatorId);

        WfNode currentNode = nodeRepository.findByDefinitionIdOrderBySortOrderAsc(instance.getDefinitionId()).stream()
                .filter(n -> n.getNodeCode().equals(wfTask.getNodeCode()))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "当前节点不存在"));

        recordHistory(instance.getId(), currentNode.getNodeCode(), operatorId, wfTask.getAssigneeName(),
                WfHistory.OP_APPROVE, currentNode.getNodeCode(), null, req.comment(), now);

        // 会签/路由节点：等待聚合条件满足再推进
        if (WfNode.TYPE_ROUTING.equals(currentNode.getNodeType())) {
            if (!aggregationSatisfied(instance, currentNode)) {
                AuditContext.after(auditSnapshot(instance));
                return; // 还有待处理任务，等其余会签人
            }
        }

        advanceToNext(instance, nodeRepository.findByDefinitionIdOrderBySortOrderAsc(instance.getDefinitionId()),
                currentNode, now);
        AuditContext.after(auditSnapshot(instance));
    }

    /** 审计快照：实例状态 + 当前节点，用于生成可读的 before/after diff。 */
    private String auditSnapshot(WfInstance instance) {
        return "{\"status\":\"" + instance.getStatus() + "\",\"currentNodeCode\":\""
                + (instance.getCurrentNodeCode() == null ? "" : instance.getCurrentNodeCode()) + "\"}";
    }

    /**
     * 把流程任务的动作同步到关联的用户视角代办（{@code sys_task}）。
     *
     * <p>APPROVE 与 REJECT 都必须走这里：驳回时若不同步，待办会永远停在 PENDING，
     * 用户在「我的待办」里反复看到一条已终止流程的审批。
     *
     * <p>失败不阻断流程：代办可能已由用户在待办中心直接处理过。但必须留日志，
     * 否则「流程已完成、待办不同步」这类线上问题无从追溯。
     *
     * <p><b>为什么要回填 operatorId</b>：{@code completeTask} 的处理人校验（见本类上方）
     * 是 {@code operatorId != null && ...}，即「未携带操作人」视为系统调用而放行；
     * 而 {@code TaskService.requireTask} 是 B-1 越权防护，语义为
     * {@code operatorId == null || ...} 即缺操作人一律拒绝。两者对 null 的态度相反，
     * 若直接透传 null，内部调用必被拒并被下方 catch 静默吞掉 →
     * 流程已终止但 sys_task 仍是 PENDING（B-2「处理完了但待办还在」被重新引入）。
     * 因此这里用 wf_task 自身的 assignee 回填：wf_task 与其关联的 sys_task 由
     * {@code assignNode} 用同一个 assignee 创建，两者处理人本就一致，回填是补全
     * 缺失信息而非绕过校验——B-1 的 assignee 比对依然真实生效。
     */
    private void syncLinkedSysTask(Long tenantId, WfTask wfTask, String action,
                                   String comment, Long operatorId) {
        if (wfTask.getSysTaskId() == null) {
            return;
        }
        Long handlerId = operatorId != null ? operatorId : wfTask.getAssigneeId();
        try {
            taskService.handleTask(tenantId, wfTask.getSysTaskId(),
                    new HandleTaskRequest(action, comment, null), handlerId);
        } catch (BusinessException e) {
            log.warn("同步 sys_task 失败: wfTaskId={}, sysTaskId={}, action={}, reason={}",
                    wfTask.getId(), wfTask.getSysTaskId(), action, e.getMessage());
        }
    }

    /**
     * 判断会签/路由节点是否已满足聚合条件。
     *
     * <p>{@code routingStrategy}（节点 config 里可配，缺省 ALL_PASS）：
     * <ul>
     *   <li>{@code ALL_PASS}（会签）：所有任务完成才放行。</li>
     *   <li>{@code ANY_PASS}（或签）：任一通过即可，剩余待处理任务自动作废。</li>
     * </ul>
     * 任一任务被驳回时实例已在外层终止，不会走到这里。
     */
    private boolean aggregationSatisfied(WfInstance instance, WfNode routingNode) {
        String strategy = readStrategy(routingNode.getConfig());
        long pending = wfTaskRepository.countPendingByNode(instance.getId(), routingNode.getNodeCode());
        if (pending == 0) {
            return true; // 会签全部完成
        }
        if ("ANY_PASS".equals(strategy)) {
            // 或签：任一通过即可——作废其余待处理任务
            long completed = wfTaskRepository.countCompletedByNode(instance.getId(), routingNode.getNodeCode());
            if (completed > 0) {
                wfTaskRepository.findByInstanceIdAndNodeCodeOrderByCreatedAtAsc(instance.getId(), routingNode.getNodeCode())
                        .stream()
                        .filter(t -> WfTask.STATUS_PENDING.equals(t.getStatus()))
                        .forEach(t -> {
                            t.setStatus("CANCELLED");
                            t.setCompletedAt(LocalDateTime.now());
                            wfTaskRepository.save(t);
                        });
                return true;
            }
        }
        return false;
    }

    private String readStrategy(String configJson) {
        if (configJson == null || configJson.isBlank()) {
            return "ALL_PASS";
        }
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"routingStrategy\"\\s*:\\s*\"([A-Z_]+)\"").matcher(configJson);
        return m.find() ? m.group(1) : "ALL_PASS";
    }

    /**
     * 推进到下一个节点（图式流转）。
     *
     * <p>优先按 {@code wf_edge} 有向边推进（支持条件分支：一个源多个出口，按 conditionExpr 求值）；
     * 若该流程未定义任何边（历史/线性定义），回退到按 {@code sortOrder} 线性推进。多条匹配边为并行出口时，
     * 当前实现取第一条匹配边顺序推进（会签并行任务模型留待后续）。
     */
    private void advanceToNext(WfInstance instance, List<WfNode> nodes, WfNode currentNode, LocalDateTime now) {
        List<WfEdge> outEdges = edgeRepository
                .findByDefinitionIdAndSourceNodeOrderBySortOrderAsc(instance.getDefinitionId(), currentNode.getNodeCode());

        List<WfNode> nextNodes;
        if (!outEdges.isEmpty()) {
            nextNodes = resolveNextByEdges(nodes, outEdges, instance);
        } else {
            // 回退：线性 sortOrder 推进
            WfNode linear = linearNext(nodes, currentNode);
            nextNodes = linear == null ? List.of() : List.of(linear);
        }

        if (nextNodes.isEmpty()) {
            // 无后继 → 流程结束
            completeInstance(instance, currentNode, null, now);
            return;
        }

        // 当前模型按顺序处理第一个后继；END 直接结束
        WfNode next = nextNodes.get(0);
        if (WfNode.TYPE_END.equals(next.getNodeType())) {
            completeInstance(instance, currentNode, next, now);
            return;
        }

        instance.setCurrentNodeCode(next.getNodeCode());
        instance.setUpdatedAt(now);
        instanceRepository.save(instance);

        if (WfNode.TYPE_APPROVAL.equals(next.getNodeType()) || WfNode.TYPE_ROUTING.equals(next.getNodeType())) {
            assignNode(instance, next, now);
        } else {
            // 非审批节点（CONDITIONAL / AUTOMATION）自动跳过并继续推进
            recordHistory(instance.getId(), next.getNodeCode(), null, null,
                    WfHistory.OP_SKIP, currentNode.getNodeCode(), next.getNodeCode(), null, now);
            advanceToNext(instance, nodes, next, now);
        }
    }

    /** 结束实例：置 COMPLETED、写历史、投递后处理任务并通知。 */
    private void completeInstance(WfInstance instance, WfNode currentNode, WfNode endNode, LocalDateTime now) {
        instance.setStatus(TaskflowStatus.Instance.COMPLETED);
        instance.setCurrentNodeCode(endNode == null ? currentNode.getNodeCode() : endNode.getNodeCode());
        instance.setCompletedAt(now);
        instance.setUpdatedAt(now);
        instance.setProgress("100%");
        instanceRepository.save(instance);

        if (endNode != null) {
            recordHistory(instance.getId(), endNode.getNodeCode(), null, null,
                    WfHistory.OP_SKIP, currentNode.getNodeCode(), endNode.getNodeCode(), null, now);
        }

        executionTaskService.enqueue(instance.getTenantId(), instance.getId(),
                "FINALIZE_BIZ", instance.getBusinessType(), instance.getBusinessId(),
                "{\"instanceId\":" + instance.getId() + "}");
        notify(instance, "APPROVED", "流程已通过", "您的申请已审批通过");
    }

    /** 依据边（含条件求值）解析后继节点。 */
    private List<WfNode> resolveNextByEdges(List<WfNode> nodes, List<WfEdge> outEdges, WfInstance instance) {
        for (WfEdge edge : outEdges) {
            if (ConditionEvaluator.matches(edge.getConditionExpr(), instance.getFormData())) {
                return nodes.stream()
                        .filter(n -> n.getNodeCode().equals(edge.getTargetNode()))
                        .findFirst()
                        .map(List::of)
                        .orElse(List.of());
            }
        }
        return List.of();
    }

    /** 线性回退：按 sortOrder 取下一个。 */
    /**
     * 为审批节点分配处理人，创建 wf_task + sys_task(+通知)。
     */
    private void assignNode(WfInstance instance, WfNode node, LocalDateTime now) {
        List<Long> assignees = assignmentResolver.resolve(node.getAssigneeRule(),
                new AssignmentResolver.AssignmentContext(
                        instance.getTenantId(), instance.getInitiatorId(),
                        instance.getBusinessType(), instance.getBusinessId()));

        for (Long assignee : assignees) {
            Long sysTaskId = taskService.createTask(instance.getTenantId(), instance.getInitiatorId(),
                    new CreateTaskRequest(
                            instance.getDefinitionCode(),
                            instance.getBusinessType(),
                            instance.getBusinessId(),
                            node.getNodeName() + " · " + instance.getBusinessId(),
                            node.getNodeCode(),
                            assignee,
                            null,
                            (short) 2,
                            node.getTimeoutHours() == null ? null : now.plusHours(node.getTimeoutHours()),
                            "{\"wfInstanceId\":" + instance.getId() + ",\"wfNode\":\"" + node.getNodeCode() + "\"}",
                            "待处理：" + node.getNodeName(),
                            "请及时处理 " + instance.getBusinessId()));

            WfTask wfTask = new WfTask();
            wfTask.setId(IdGenerator.nextId());
            wfTask.setTenantId(instance.getTenantId());
            wfTask.setInstanceId(instance.getId());
            wfTask.setNodeCode(node.getNodeCode());
            wfTask.setNodeName(node.getNodeName());
            wfTask.setTaskType("APPROVE");
            wfTask.setSysTaskId(sysTaskId);
            wfTask.setAssigneeId(assignee);
            wfTask.setAssigneeName(null);
            wfTask.setStatus(WfTask.STATUS_PENDING);
            wfTask.setDueDate(node.getTimeoutHours() == null ? null : now.plusHours(node.getTimeoutHours()));
            wfTask.setCreatedAt(now);
            wfTaskRepository.save(wfTask);
        }
    }

    private WfNode linearNext(List<WfNode> nodes, WfNode current) {
        int idx = nodes.indexOf(current);
        if (idx < 0 || idx + 1 >= nodes.size()) {
            return null;
        }
        return nodes.get(idx + 1);
    }

    private void assertFormAllowed(WfDefinition def, String formCode) {
        if (!StringUtils.hasText(formCode)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "startedFormCode 不能为空");
        }
        String[] allowed = def.getSupportedFormCodes();
        if (allowed == null || allowed.length == 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "流程「" + def.getCode() + "」未配置表单白名单，无法启动");
        }
        boolean ok = Arrays.stream(allowed).anyMatch(f -> f.equalsIgnoreCase(formCode.trim()));
        if (!ok) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "表单 " + formCode + " 不在流程「" + def.getCode() + "」的白名单内");
        }
    }

    private void notify(WfInstance instance, String result, String title, String summary) {
        if (instance.getInitiatorId() == null) {
            return;
        }
        try {
            messageService.publish(instance.getTenantId(), new com.mis.taskflow.dto.PublishMessageRequest(
                    "NOTIFY", "TASK", title, summary, null, null,
                    null, "系统", List.of(instance.getInitiatorId()), null));
        } catch (Exception ignored) {
            // 通知失败不影响流程
        }
    }

    private void recordHistory(Long instanceId, String nodeCode, Long operatorId, String operatorName,
                               String operation, String fromNode, String toNode, String comment, LocalDateTime now) {
        WfHistory h = new WfHistory();
        h.setId(IdGenerator.nextId());
        h.setInstanceId(instanceId);
        h.setNodeCode(nodeCode);
        h.setOperatorId(operatorId);
        h.setOperatorName(operatorName);
        h.setOperation(operation);
        h.setFromNode(fromNode);
        h.setToNode(toNode);
        h.setComment(comment);
        h.setCreatedAt(now);
        historyRepository.save(h);
    }

    // ------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public ProcessDetailVO detail(Long instanceId, Long tenantId) {
        WfInstance instance = instanceRepository.findByIdAndTenantId(instanceId, tenantId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "流程实例不存在"));
        List<WfTaskVO> tasks = wfTaskRepository.findByInstanceIdOrderByCreatedAtAsc(instanceId).stream()
                .map(this::toTaskVo).toList();
        List<WfHistoryVO> history = historyRepository.findByInstanceIdOrderByCreatedAtAsc(instanceId).stream()
                .map(h -> new WfHistoryVO(String.valueOf(h.getId()), h.getNodeCode(), nullableId(h.getOperatorId()),
                        h.getOperatorName(), h.getOperation(), h.getFromNode(), h.getToNode(),
                        h.getComment(), h.getCreatedAt()))
                .toList();
        return new ProcessDetailVO(toInstanceVo(instance), tasks, history);
    }

    @Transactional(readOnly = true)
    public PageResult<WfInstanceVO> myInitiated(Long tenantId, Long initiatorId, String status, int page, int size) {
        var pageable = PageRequest.of(Math.max(page - 1, 0), Math.min(Math.max(size, 1), 200));
        var p = instanceRepository.findByInitiator(tenantId, initiatorId, blankToNull(status), pageable);
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(),
                p.getContent().stream().map(this::toInstanceVo).toList());
    }

    private WfInstanceVO toInstanceVo(WfInstance i) {
        return new WfInstanceVO(
                String.valueOf(i.getId()), i.getDefinitionCode(), i.getStartedFormCode(),
                i.getBusinessType(), i.getBusinessId(), i.getStatus(),
                nullableId(i.getInitiatorId()), i.getInitiatorName(), i.getCurrentNodeCode(),
                null, i.getProgress(), i.getPostProcessStatus(), i.getPostRetryCount(),
                i.getCreatedAt(), i.getCompletedAt());
    }

    private WfTaskVO toTaskVo(WfTask t) {
        return new WfTaskVO(
                String.valueOf(t.getId()), String.valueOf(t.getInstanceId()), t.getNodeCode(), t.getNodeName(),
                t.getTaskType(), nullableId(t.getSysTaskId()), String.valueOf(t.getAssigneeId()),
                t.getAssigneeName(), t.getStatus(), t.getDueDate(), t.getCreatedAt(), t.getCompletedAt());
    }

    private static String nullableId(Long id) {
        return id == null ? null : String.valueOf(id);
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }

    private static String trimDefault(String v, String def) {
        return v == null || v.isBlank() ? def : v;
    }
}
