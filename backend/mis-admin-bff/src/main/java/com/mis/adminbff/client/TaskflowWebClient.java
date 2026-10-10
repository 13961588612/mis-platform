package com.mis.adminbff.client;

import com.mis.adminbff.client.model.MessageDetailVO;
import com.mis.adminbff.client.model.MessageStatsVO;
import com.mis.adminbff.client.model.MessageVO;
import com.mis.adminbff.client.model.AuditOpDetailVO;
import com.mis.adminbff.client.model.AuditOpVO;
import com.mis.adminbff.client.model.AuditStatsVO;
import com.mis.adminbff.client.model.AuditTimelineItem;
import com.mis.adminbff.client.model.ExecutionTaskVO;
import com.mis.adminbff.client.model.FormCategoryVO;
import com.mis.adminbff.client.model.FormDefinitionVO;
import com.mis.adminbff.client.model.ProcessDetailVO;
import com.mis.adminbff.client.model.TaskStatsVO;
import com.mis.adminbff.client.model.TaskVO;
import com.mis.adminbff.client.model.WfDefinitionDTO;
import com.mis.adminbff.client.model.WfCategoryVO;
import com.mis.adminbff.client.model.WfInstanceVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;
import java.util.Optional;

/**
 * mis-taskflow 下游客户端。
 *
 * <p>BFF 只做透传与聚合，不承载任务流业务逻辑；任务/消息/流程的真实状态均由 mis-taskflow 持有。
 */
@Component
public class TaskflowWebClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<Map<String, Object>>> MAP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<MessageVO>>> MESSAGE_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<MessageDetailVO>> MESSAGE_DETAIL =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<MessageStatsVO>> MESSAGE_STATS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Integer>> INT_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Long>> LONG_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<TaskVO>>> TASK_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<TaskStatsVO>> TASK_STATS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Void>> VOID =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<AuditOpVO>>> AUDIT_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<AuditOpDetailVO>> AUDIT_DETAIL =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<java.util.List<AuditTimelineItem>>> AUDIT_TIMELINE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<AuditStatsVO>> AUDIT_STATS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<WfDefinitionDTO>> WF_DEFINITION =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<WfDefinitionDTO>>> WF_DEFINITION_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<java.util.List<WfCategoryVO>>> WF_CATEGORY_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<WfCategoryVO>> WF_CATEGORY_ONE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<ProcessDetailVO>> WF_PROCESS_DETAIL =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<WfInstanceVO>>> WF_INSTANCE_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<java.util.List<FormDefinitionVO>>> FORM_DEF_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<FormDefinitionVO>> FORM_DEF_ONE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<java.util.List<FormCategoryVO>>> FORM_CATEGORY_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<FormCategoryVO>> FORM_CATEGORY_ONE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<ExecutionTaskVO>>> EXEC_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<ExecutionTaskVO>> EXEC_TASK =
            new ParameterizedTypeReference<>() {};

    public TaskflowWebClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            @Qualifier("loadBalancedWebClientBuilder") WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        super(buildClient(plainBuilder, loadBalancedBuilder, properties), properties.getAggregateTimeoutMs());
    }

    private static WebClient buildClient(
            WebClient.Builder plainBuilder,
            WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        WebClient.Builder builder = properties.isTaskflowDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        return builder.baseUrl(resolveBaseUrl(
                properties.isTaskflowDiscoveryEnabled(),
                properties.getTaskflowServiceId(),
                properties.getTaskflowBaseUrl())).build();
    }

    /** 探针：验证 BFF -> mis-taskflow 链路。 */
    public Map<String, Object> health() {
        return block(client().get()
                .uri("/internal/v1/taskflow/health")
                .retrieve()
                .bodyToMono(MAP));
    }

    // ------------------------------------------------------------------
    // 消息中心（P2）
    // ------------------------------------------------------------------

    public PageResult<MessageVO> inbox(Long tenantId, Long userId, String msgType, int page, int size) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/messages/inbox")
                .queryParam("tenantId", tenantId)
                .queryParam("userId", userId)
                .queryParamIfPresent("msgType", Optional.ofNullable(msgType))
                .queryParam("page", page)
                .queryParam("size", size)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(MESSAGE_PAGE));
    }

    public PageResult<MessageVO> searchMessages(Long tenantId, Long userId, String keyword, int page, int size) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/messages/search")
                .queryParam("tenantId", tenantId)
                .queryParam("userId", userId)
                .queryParam("q", keyword)
                .queryParam("page", page)
                .queryParam("size", size)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(MESSAGE_PAGE));
    }

    public MessageDetailVO messageDetail(Long id, Long userId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/messages/{id}")
                .queryParam("userId", userId)
                .buildAndExpand(id).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(MESSAGE_DETAIL));
    }

    public int markMessagesRead(Long userId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/messages/read")
                .queryParam("userId", userId)
                .toUriString();
        return block(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(INT_RESULT));
    }

    public MessageStatsVO messageStats(Long tenantId, Long userId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/messages/stats")
                .queryParam("tenantId", tenantId)
                .queryParam("userId", userId)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(MESSAGE_STATS));
    }

    public Long publishMessage(Long tenantId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/messages")
                .queryParam("tenantId", tenantId)
                .toUriString();
        return block(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    // ------------------------------------------------------------------
    // 代办任务（P3）
    // ------------------------------------------------------------------

    public Long createTask(Long tenantId, Long operatorId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/tasks")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("operatorId", Optional.ofNullable(operatorId))
                .toUriString();
        return block(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public PageResult<TaskVO> myTasks(Long tenantId, Long assigneeId, String status, int page, int size) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/tasks/my")
                .queryParam("tenantId", tenantId)
                .queryParam("assigneeId", assigneeId)
                .queryParamIfPresent("status", Optional.ofNullable(status))
                .queryParam("page", page)
                .queryParam("size", size)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(TASK_PAGE));
    }

    public PageResult<TaskVO> handledTasks(Long tenantId, Long assigneeId, int page, int size) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/tasks/handled")
                .queryParam("tenantId", tenantId)
                .queryParam("assigneeId", assigneeId)
                .queryParam("page", page)
                .queryParam("size", size)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(TASK_PAGE));
    }

    public TaskStatsVO taskStats(Long tenantId, Long assigneeId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/tasks/stats")
                .queryParam("tenantId", tenantId)
                .queryParam("assigneeId", assigneeId)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(TASK_STATS));
    }

    public void handleTask(Long id, Long tenantId, Long operatorId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/tasks/{id}/handle")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("operatorId", Optional.ofNullable(operatorId))
                .buildAndExpand(id).toUriString();
        blockVoid(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public void transferTask(Long id, Long tenantId, Long operatorId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/tasks/{id}/transfer")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("operatorId", Optional.ofNullable(operatorId))
                .buildAndExpand(id).toUriString();
        blockVoid(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public int batchHandleTasks(Long tenantId, Long operatorId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/tasks/batch-handle")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("operatorId", Optional.ofNullable(operatorId))
                .toUriString();
        return block(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(INT_RESULT));
    }

    // ------------------------------------------------------------------
    // 业务操作审计（P4）
    // ------------------------------------------------------------------

    public PageResult<AuditOpVO> auditOps(Long tenantId, Long userId, String module, String operationType,
                                          String businessType, String resultStatus, String keyword,
                                          String startTime, String endTime, int page, int size) {
        UriComponentsBuilder b = UriComponentsBuilder.fromPath("/internal/v1/audit-ops")
                .queryParam("tenantId", tenantId)
                .queryParam("page", page)
                .queryParam("size", size);
        if (userId != null) b.queryParam("userId", userId);
        if (module != null && !module.isBlank()) b.queryParam("module", module);
        if (operationType != null && !operationType.isBlank()) b.queryParam("operationType", operationType);
        if (businessType != null && !businessType.isBlank()) b.queryParam("businessType", businessType);
        if (resultStatus != null && !resultStatus.isBlank()) b.queryParam("resultStatus", resultStatus);
        if (keyword != null && !keyword.isBlank()) b.queryParam("keyword", keyword);
        if (startTime != null && !startTime.isBlank()) b.queryParam("startTime", startTime);
        if (endTime != null && !endTime.isBlank()) b.queryParam("endTime", endTime);
        return block(client().get().uri(b.toUriString()).retrieve().bodyToMono(AUDIT_PAGE));
    }

    public AuditOpDetailVO auditOpDetail(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/audit-ops/{id}")
                .queryParam("tenantId", tenantId)
                .buildAndExpand(id).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(AUDIT_DETAIL));
    }

    public java.util.List<AuditTimelineItem> auditTimeline(Long tenantId, String businessType, String businessId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/audit-ops/timeline/{bt}/{bid}")
                .queryParam("tenantId", tenantId)
                .buildAndExpand(businessType, businessId).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(AUDIT_TIMELINE));
    }

    public AuditStatsVO auditStats(Long tenantId, int days) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/audit-ops/stats")
                .queryParam("tenantId", tenantId)
                .queryParam("days", days)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(AUDIT_STATS));
    }

    // ------------------------------------------------------------------
    // 工作流（P5）
    // ------------------------------------------------------------------

    public Long createWorkflowDefinition(Long tenantId, Long operatorId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/definitions")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("operatorId", Optional.ofNullable(operatorId))
                .toUriString();
        return block(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public WfDefinitionDTO workflowDefinition(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/definitions/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(WF_DEFINITION));
    }

    public PageResult<WfDefinitionDTO> workflowDefinitions(Long tenantId, int page, int size) {
        return workflowDefinitions(tenantId, page, size, java.util.List.of());
    }

    /**
     * 流程定义列表（分页，可选 categoryIds 多值分类过滤）。
     *
     * <p>{@code categoryIds} 非空时以<b>单值逗号串</b>传参 {@code categoryIds=1,2}，
     * 下游 mis-taskflow 的 {@code @RequestParam List<Long> categoryIds} 自动拆分。
     */
    public PageResult<WfDefinitionDTO> workflowDefinitions(Long tenantId, int page, int size,
                                                           java.util.List<Long> categoryIds) {
        UriComponentsBuilder b = UriComponentsBuilder.fromPath("/internal/v1/workflow/definitions")
                .queryParam("tenantId", tenantId)
                .queryParam("page", page)
                .queryParam("size", size);
        if (categoryIds != null && !categoryIds.isEmpty()) {
            b.queryParam("categoryIds", String.join(",", categoryIds.stream().map(String::valueOf).toList()));
        }
        return block(client().get().uri(b.toUriString()).retrieve().bodyToMono(WF_DEFINITION_PAGE));
    }

    public void activateWorkflowDefinition(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/definitions/{id}/activate")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().post().uri(uri).retrieve().bodyToMono(VOID));
    }

    public void updateWorkflowDefinition(Long id, Long tenantId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/definitions/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().put().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public void deactivateWorkflowDefinition(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/definitions/{id}/deactivate")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().post().uri(uri).retrieve().bodyToMono(VOID));
    }

    // ------------------------------------------------------------------
    // 流程分类（wf_category，决策 B：独立邻接树）
    // ------------------------------------------------------------------

    public java.util.List<WfCategoryVO> wfCategoryTree(Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/categories/tree")
                .queryParam("tenantId", tenantId).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(WF_CATEGORY_LIST));
    }

    public java.util.List<WfCategoryVO> wfCategories(Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/categories")
                .queryParam("tenantId", tenantId).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(WF_CATEGORY_LIST));
    }

    public WfCategoryVO getWfCategory(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/categories/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(WF_CATEGORY_ONE));
    }

    public Long createWfCategory(Long tenantId, Long operatorId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/categories")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("operatorId", Optional.ofNullable(operatorId))
                .toUriString();
        return block(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public void updateWfCategory(Long id, Long tenantId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/categories/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().put().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public void deleteWfCategory(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/categories/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().delete().uri(uri).retrieve().bodyToMono(VOID));
    }

    // ------------------------------------------------------------------
    // 表单分类（form_category，决策 B：独立邻接树）
    // ------------------------------------------------------------------

    public java.util.List<FormCategoryVO> formCategoryTree(Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-categories/tree")
                .queryParam("tenantId", tenantId).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(FORM_CATEGORY_LIST));
    }

    public java.util.List<FormCategoryVO> formCategories(Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-categories")
                .queryParam("tenantId", tenantId).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(FORM_CATEGORY_LIST));
    }

    public FormCategoryVO getFormCategory(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-categories/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(FORM_CATEGORY_ONE));
    }

    public Long createFormCategory(Long tenantId, Long operatorId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-categories")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("operatorId", Optional.ofNullable(operatorId))
                .toUriString();
        return block(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public void updateFormCategory(Long id, Long tenantId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-categories/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().put().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public void deleteFormCategory(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-categories/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().delete().uri(uri).retrieve().bodyToMono(VOID));
    }

    // ------------------------------------------------------------------
    // 业务表单注册（form_definition）
    // ------------------------------------------------------------------

    public java.util.List<FormDefinitionVO> formDefinitions(Long tenantId, String status) {
        return formDefinitions(tenantId, status, java.util.List.of());
    }

    /**
     * 表单定义列表（可选 status / categoryIds 过滤）。
     *
     * <p>{@code categoryIds} 非空时以<b>单值逗号串</b>传参 {@code categoryIds=1,2}
     * （避免各层对重复参数绑定不一致的问题）；下游 mis-taskflow 的
     * {@code @RequestParam List<Long> categoryIds} 会自动按逗号拆分。
     */
    public java.util.List<FormDefinitionVO> formDefinitions(Long tenantId, String status,
                                                            java.util.List<Long> categoryIds) {
        UriComponentsBuilder b = UriComponentsBuilder.fromPath("/internal/v1/form-definitions")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("status", Optional.ofNullable(status));
        if (categoryIds != null && !categoryIds.isEmpty()) {
            b.queryParam("categoryIds", String.join(",", categoryIds.stream().map(String::valueOf).toList()));
        }
        return block(client().get().uri(b.toUriString()).retrieve().bodyToMono(FORM_DEF_LIST));
    }

    public FormDefinitionVO formDefinition(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-definitions/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(FORM_DEF_ONE));
    }

    public Long createFormDefinition(Long tenantId, Long operatorId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-definitions")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("operatorId", Optional.ofNullable(operatorId))
                .toUriString();
        return block(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public void updateFormDefinition(Long id, Long tenantId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-definitions/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().put().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public void deleteFormDefinition(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/form-definitions/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().delete().uri(uri).retrieve().bodyToMono(VOID));
    }

    public Long startProcess(Long tenantId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/instances/start")
                .queryParam("tenantId", tenantId).toUriString();
        return block(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public ProcessDetailVO processDetail(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/instances/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(WF_PROCESS_DETAIL));
    }

    public PageResult<WfInstanceVO> myProcesses(Long tenantId, Long initiatorId, String status, int page, int size) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/instances/my")
                .queryParam("tenantId", tenantId)
                .queryParam("initiatorId", initiatorId)
                .queryParamIfPresent("status", Optional.ofNullable(status))
                .queryParam("page", page)
                .queryParam("size", size)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(WF_INSTANCE_PAGE));
    }

    public void completeWfTask(Long id, Long tenantId, Long operatorId, Map<String, Object> body) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/workflow/tasks/{id}/complete")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("operatorId", Optional.ofNullable(operatorId))
                .buildAndExpand(id).toUriString();
        blockVoid(client().post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(VOID));
    }

    // ------------------------------------------------------------------
    // 后置执行监控（P6）
    // ------------------------------------------------------------------

    public PageResult<ExecutionTaskVO> execMonitor(Long tenantId, String status, int page, int size) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/exec-monitor")
                .queryParam("tenantId", tenantId)
                .queryParamIfPresent("status", Optional.ofNullable(status))
                .queryParam("page", page)
                .queryParam("size", size)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(EXEC_PAGE));
    }

    public ExecutionTaskVO execTask(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/exec-monitor/{id}")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(EXEC_TASK));
    }

    public void execRetry(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/exec-monitor/{id}/retry")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().post().uri(uri).retrieve().bodyToMono(VOID));
    }

    public void execForceArchive(Long id, Long tenantId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/exec-monitor/{id}/force-archive")
                .queryParam("tenantId", tenantId).buildAndExpand(id).toUriString();
        blockVoid(client().post().uri(uri).retrieve().bodyToMono(VOID));
    }

    public int execScan() {
        return block(client().post().uri("/internal/v1/exec-monitor/scan").retrieve().bodyToMono(INT_RESULT));
    }
}
