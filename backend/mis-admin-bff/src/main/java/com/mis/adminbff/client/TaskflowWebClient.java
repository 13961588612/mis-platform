package com.mis.adminbff.client;

import com.mis.adminbff.client.model.MessageDetailVO;
import com.mis.adminbff.client.model.MessageStatsVO;
import com.mis.adminbff.client.model.MessageVO;
import com.mis.adminbff.client.model.AuditOpDetailVO;
import com.mis.adminbff.client.model.AuditOpVO;
import com.mis.adminbff.client.model.AuditStatsVO;
import com.mis.adminbff.client.model.AuditTimelineItem;
import com.mis.adminbff.client.model.BizCategoryVO;
import com.mis.adminbff.client.model.ExecutionTaskVO;
import com.mis.adminbff.client.model.FormDefinitionVO;
import com.mis.adminbff.client.model.PortalMatterVO;
import com.mis.adminbff.client.model.ProcessDetailVO;
import com.mis.adminbff.client.model.TaskStatsVO;
import com.mis.adminbff.client.model.TaskVO;
import com.mis.adminbff.client.model.WfDefinitionDTO;
import com.mis.adminbff.client.model.WfInstanceVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriBuilder;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;

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
    private static final ParameterizedTypeReference<Result<PageResult<PortalMatterVO>>> MATTER_PAGE =
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
    private static final ParameterizedTypeReference<Result<java.util.List<BizCategoryVO>>> BIZ_CATEGORY_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<BizCategoryVO>> BIZ_CATEGORY_ONE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<ProcessDetailVO>> WF_PROCESS_DETAIL =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<WfInstanceVO>>> WF_INSTANCE_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<java.util.List<FormDefinitionVO>>> FORM_DEF_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<FormDefinitionVO>> FORM_DEF_ONE =
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

    // ------------------------------------------------------------------
    // 出站 URI 构造（编码修复，全客户端统一）
    // ------------------------------------------------------------------

    /**
     * 构造出站 URI 的函数，交给 {@code WebClient.uri(Function<UriBuilder, URI>)} 重载。
     *
     * <p><b>为什么必须走 {@code uri(Function)}（本次 Bug 修复的核心）：</b>
     * <ul>
     *   <li>旧写法先 {@code UriComponentsBuilder...toUriString()}（<b>已做一次百分号编码</b>），
     *       再交给 {@code uri(String)}；后者内部是 {@code DefaultUriBuilderFactory}，默认
     *       {@code EncodingMode.TEMPLATE_AND_VALUES} 会把 {@code %} 又编码一次：
     *       中文 {@code 通过} → {@code q=%E9%80%9A%E8%BF%87} → {@code q=%25E9%2580%259A%25E8%25BF%2587}。
     *       下游 taskflow 只解一次码，拿到字面量 {@code %E9...}，故<b>非 ASCII 关键词/筛选恒匹配 0 条</b>
     *       （ASCII 无字符需编码，二次编码是恒等变换，所以从没被单测暴露）。</li>
     *   <li>若改成把 {@code URI} 对象交给 {@code uri(URI)}：虽可绕过二次编码，但 {@code uri(URI)}
     *       <b>不经过 {@code uriBuilderFactory}</b>，相对 URI 会<b>丢掉 baseUrl</b>（scheme/host/port
     *       与服务发现 host 全丢），比双重编码更难查 —— 实测已证 {@code uri(URI)} 产出相对地址。</li>
     * </ul>
     * 只有 {@code uri(Function<UriBuilder, URI>)} 二者兼顾：经带 baseUrl 的 {@code UriBuilderFactory}
     * 展开，<b>baseUrl 保留且编码只发生一次</b>。
     *
     * <p>查询参数值以 {@code {qN}} 占位 + {@code build(Map)} 展开：值里的 {@code & = { }} 一律被当成
     * 纯数据整体编码，既防查询串注入，也避免被误解析成 URI 模板变量（否则值含 {@code {} 会抛
     * {@code IllegalArgumentException: Not enough variable values}）。
     *
     * @param path        路径（相对 baseUrl，可含 {@code {}} 路径变量，如 {@code /internal/v1/messages/{id}}）
     * @param pathVars    路径变量（{@code null} 表示无）
     * @param queryParams 查询参数（按插入顺序输出；调用方已按原语义决定增删；值为 {@code null} 时输出空值键）
     * @return 供 {@code WebClient.uri(Function)} 消费的 URI 构造函数
     */
    private static Function<UriBuilder, URI> uriOf(String path, Map<String, ?> pathVars, Map<String, ?> queryParams) {
        return ub -> {
            ub.path(path);
            Map<String, Object> vars = new LinkedHashMap<>();
            if (pathVars != null) {
                vars.putAll(pathVars);
            }
            if (queryParams != null) {
                int i = 0;
                for (Map.Entry<String, ?> e : queryParams.entrySet()) {
                    String var = "q" + (i++);
                    ub.queryParam(e.getKey(), "{" + var + "}");
                    vars.put(var, e.getValue());
                }
            }
            return ub.build(vars);
        };
    }

    /** 无路径变量版本的 {@link #uriOf(String, Map, Map)}。 */
    private static Function<UriBuilder, URI> uriOf(String path, Map<String, ?> queryParams) {
        return uriOf(path, null, queryParams);
    }

    /** 路径变量构造：{@code pathVars("id", id, "bt", businessType, ...)}，值允许为 {@code null}。 */
    private static Map<String, Object> pathVars(Object... nameValuePairs) {
        Map<String, Object> vars = new LinkedHashMap<>();
        if (nameValuePairs != null) {
            for (int i = 0; i + 1 < nameValuePairs.length; i += 2) {
                vars.put(String.valueOf(nameValuePairs[i]), nameValuePairs[i + 1]);
            }
        }
        return vars;
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
        return inbox(tenantId, userId, msgType, null, null, page, size);
    }

    /**
     * 收件箱（可选 appCode / scope 归属过滤）。
     *
     * <p>{@code appCode}/{@code scope} 为空/空白时**不透传**该查询参数 ⇒ 下游退化为原查询（零回归）。
     */
    public PageResult<MessageVO> inbox(Long tenantId, Long userId, String msgType,
                                       String appCode, String scope, int page, int size) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("userId", userId);
        if (msgType != null) {
            q.put("msgType", msgType);
        }
        if (appCode != null && !appCode.isBlank()) {
            q.put("appCode", appCode);
        }
        if (scope != null && !scope.isBlank()) {
            q.put("scope", scope);
        }
        q.put("page", page);
        q.put("size", size);
        return block(client().get().uri(uriOf("/internal/v1/messages/inbox", q)).retrieve().bodyToMono(MESSAGE_PAGE));
    }

    /**
     * 关键词检索。{@code msgType} 非空时透传做**类型内独立搜索**（PRD D-5 / Q3），
     * 空白时不带该参数（下游跨类型检索）。
     */
    public PageResult<MessageVO> searchMessages(Long tenantId, Long userId, String msgType, String keyword,
                                                int page, int size) {
        return searchMessages(tenantId, userId, msgType, keyword, null, null, page, size);
    }

    /**
     * 关键词检索（可选类型内 + 可选 appCode / scope 归属过滤）。
     *
     * <p>{@code appCode}/{@code scope} 为空/空白时**不透传**（零回归）。
     */
    public PageResult<MessageVO> searchMessages(Long tenantId, Long userId, String msgType, String keyword,
                                                String appCode, String scope, int page, int size) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("userId", userId);
        if (msgType != null && !msgType.isBlank()) {
            q.put("msgType", msgType);
        }
        q.put("q", keyword);
        if (appCode != null && !appCode.isBlank()) {
            q.put("appCode", appCode);
        }
        if (scope != null && !scope.isBlank()) {
            q.put("scope", scope);
        }
        q.put("page", page);
        q.put("size", size);
        return block(client().get().uri(uriOf("/internal/v1/messages/search", q)).retrieve().bodyToMono(MESSAGE_PAGE));
    }

    public MessageDetailVO messageDetail(Long id, Long userId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("userId", userId);
        return block(client().get()
                .uri(uriOf("/internal/v1/messages/{id}", pathVars("id", id), q))
                .retrieve().bodyToMono(MESSAGE_DETAIL));
    }

    public int markMessagesRead(Long userId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("userId", userId);
        return block(client().post().uri(uriOf("/internal/v1/messages/read", q)).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(INT_RESULT));
    }

    public MessageStatsVO messageStats(Long tenantId, Long userId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("userId", userId);
        return block(client().get().uri(uriOf("/internal/v1/messages/stats", q)).retrieve().bodyToMono(MESSAGE_STATS));
    }

    public Long publishMessage(Long tenantId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().post().uri(uriOf("/internal/v1/messages", q)).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    /**
     * 回复消息（PR-18）—— 透传到 mis-taskflow {@code POST /internal/v1/messages/{id}/reply}。
     *
     * <p>回复语义由 taskflow 侧负责（回写关联流程的 {@code wf_history COMMENT}）；
     * {@code operatorName} 空串不透传。
     */
    public void replyMessage(Long id, Long tenantId, Long operatorId, String operatorName,
                             Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (operatorId != null) {
            q.put("operatorId", operatorId);
        }
        if (operatorName != null && !operatorName.isBlank()) {
            q.put("operatorName", operatorName);
        }
        blockVoid(client().post().uri(uriOf("/internal/v1/messages/{id}/reply", pathVars("id", id), q))
                .contentType(MediaType.APPLICATION_JSON).bodyValue(body).retrieve().bodyToMono(VOID));
    }

    // ------------------------------------------------------------------
    // 代办任务（P3）
    // ------------------------------------------------------------------

    public Long createTask(Long tenantId, Long operatorId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (operatorId != null) {
            q.put("operatorId", operatorId);
        }
        return block(client().post().uri(uriOf("/internal/v1/tasks", q)).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public PageResult<TaskVO> myTasks(Long tenantId, Long assigneeId, String status, String keyword,
                                      int page, int size) {
        return myTasks(tenantId, assigneeId, status, keyword, null, null, page, size);
    }

    /**
     * 我的待办（可选 appCode / scope 归属过滤；空白**不透传** ⇒ 零回归）。
     */
    public PageResult<TaskVO> myTasks(Long tenantId, Long assigneeId, String status, String keyword,
                                      String appCode, String scope, int page, int size) {
        return myTasks(tenantId, assigneeId, status, keyword, appCode, scope, null, null, page, size);
    }

    /**
     * 我的待办（可选发起人/参与人 + 可选 appCode / scope 归属过滤）。
     *
     * <p>{@code initiatorName}/{@code participantName} 为<b>可选</b>尾参：空白**不透传**
     * ⇒ 下游退化原查询（零回归）；非空则按「发起人 = 所属实例 {@code initiator_name}」
     * 「参与人 = 该实例任一 {@code wf_task} 处理人（或关联 {@code sys_task} 处理人）」过滤。
     */
    public PageResult<TaskVO> myTasks(Long tenantId, Long assigneeId, String status, String keyword,
                                      String appCode, String scope,
                                      String initiatorName, String participantName, int page, int size) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("assigneeId", assigneeId);
        if (status != null) {
            q.put("status", status);
        }
        if (keyword != null && !keyword.isBlank()) {
            q.put("keyword", keyword);
        }
        if (initiatorName != null && !initiatorName.isBlank()) {
            q.put("initiatorName", initiatorName);
        }
        if (participantName != null && !participantName.isBlank()) {
            q.put("participantName", participantName);
        }
        if (appCode != null && !appCode.isBlank()) {
            q.put("appCode", appCode);
        }
        if (scope != null && !scope.isBlank()) {
            q.put("scope", scope);
        }
        q.put("page", page);
        q.put("size", size);
        return block(client().get().uri(uriOf("/internal/v1/tasks/my", q)).retrieve().bodyToMono(TASK_PAGE));
    }

    /** 抄送我的：透传 {@code GET /internal/v1/tasks/cc}。 */
    public PageResult<TaskVO> ccTasks(Long tenantId, Long assigneeId, String keyword, int page, int size) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("assigneeId", assigneeId);
        if (keyword != null && !keyword.isBlank()) {
            q.put("keyword", keyword);
        }
        q.put("page", page);
        q.put("size", size);
        return block(client().get().uri(uriOf("/internal/v1/tasks/cc", q)).retrieve().bodyToMono(TASK_PAGE));
    }

    public PageResult<TaskVO> handledTasks(Long tenantId, Long assigneeId, String keyword, int page, int size) {
        return handledTasks(tenantId, assigneeId, keyword, null, null, page, size);
    }

    /**
     * 我处理过的（可选 appCode / scope 归属过滤；空白**不透传** ⇒ 零回归）。
     */
    public PageResult<TaskVO> handledTasks(Long tenantId, Long assigneeId, String keyword,
                                           String appCode, String scope, int page, int size) {
        return handledTasks(tenantId, assigneeId, keyword, appCode, scope, null, null, page, size);
    }

    /**
     * 我处理过的（可选发起人/参与人 + 可选 appCode / scope 归属过滤）。
     *
     * <p>两新增尾参语义同 {@link #myTasks}，空白**不透传** ⇒ 零回归。
     */
    public PageResult<TaskVO> handledTasks(Long tenantId, Long assigneeId, String keyword,
                                           String appCode, String scope,
                                           String initiatorName, String participantName, int page, int size) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("assigneeId", assigneeId);
        if (keyword != null && !keyword.isBlank()) {
            q.put("keyword", keyword);
        }
        if (initiatorName != null && !initiatorName.isBlank()) {
            q.put("initiatorName", initiatorName);
        }
        if (participantName != null && !participantName.isBlank()) {
            q.put("participantName", participantName);
        }
        if (appCode != null && !appCode.isBlank()) {
            q.put("appCode", appCode);
        }
        if (scope != null && !scope.isBlank()) {
            q.put("scope", scope);
        }
        q.put("page", page);
        q.put("size", size);
        return block(client().get().uri(uriOf("/internal/v1/tasks/handled", q)).retrieve().bodyToMono(TASK_PAGE));
    }

    /**
     * 门户「待办事项 · 全部」聚合（三源 UNION + 服务端分页，透传 mis-taskflow
     * {@code GET /internal/v1/tasks/matters}）。
     *
     * <p>所有过滤参数空白**不透传** ⇒ 下游退化「仅我相关的全部事项」（零回归）。
     * 外网路径必须与 {@code sys_api.path_pattern} 的 {@code /api/v1/tasks/matters} 对齐。
     */
    public PageResult<PortalMatterVO> matters(Long tenantId, Long userId, String keyword,
                                              String initiatorName, String participantName,
                                              String appCode, String scope, int page, int size) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("userId", userId);
        if (keyword != null && !keyword.isBlank()) {
            q.put("keyword", keyword);
        }
        if (initiatorName != null && !initiatorName.isBlank()) {
            q.put("initiatorName", initiatorName);
        }
        if (participantName != null && !participantName.isBlank()) {
            q.put("participantName", participantName);
        }
        if (appCode != null && !appCode.isBlank()) {
            q.put("appCode", appCode);
        }
        if (scope != null && !scope.isBlank()) {
            q.put("scope", scope);
        }
        q.put("page", page);
        q.put("size", size);
        return block(client().get().uri(uriOf("/internal/v1/tasks/matters", q)).retrieve().bodyToMono(MATTER_PAGE));
    }

    public TaskStatsVO taskStats(Long tenantId, Long assigneeId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("assigneeId", assigneeId);
        return block(client().get().uri(uriOf("/internal/v1/tasks/stats", q)).retrieve().bodyToMono(TASK_STATS));
    }

    public void handleTask(Long id, Long tenantId, Long operatorId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (operatorId != null) {
            q.put("operatorId", operatorId);
        }
        blockVoid(client().post().uri(uriOf("/internal/v1/tasks/{id}/handle", pathVars("id", id), q))
                .contentType(MediaType.APPLICATION_JSON).bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public void transferTask(Long id, Long tenantId, Long operatorId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (operatorId != null) {
            q.put("operatorId", operatorId);
        }
        blockVoid(client().post().uri(uriOf("/internal/v1/tasks/{id}/transfer", pathVars("id", id), q))
                .contentType(MediaType.APPLICATION_JSON).bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public int batchHandleTasks(Long tenantId, Long operatorId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (operatorId != null) {
            q.put("operatorId", operatorId);
        }
        return block(client().post().uri(uriOf("/internal/v1/tasks/batch-handle", q)).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(INT_RESULT));
    }

    // ------------------------------------------------------------------
    // 业务操作审计（P4）
    // ------------------------------------------------------------------

    public PageResult<AuditOpVO> auditOps(Long tenantId, Long userId, String module, String operationType,
                                          String businessType, String resultStatus, String keyword,
                                          String startTime, String endTime, int page, int size) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("page", page);
        q.put("size", size);
        if (userId != null) q.put("userId", userId);
        if (module != null && !module.isBlank()) q.put("module", module);
        if (operationType != null && !operationType.isBlank()) q.put("operationType", operationType);
        if (businessType != null && !businessType.isBlank()) q.put("businessType", businessType);
        if (resultStatus != null && !resultStatus.isBlank()) q.put("resultStatus", resultStatus);
        if (keyword != null && !keyword.isBlank()) q.put("keyword", keyword);
        if (startTime != null && !startTime.isBlank()) q.put("startTime", startTime);
        if (endTime != null && !endTime.isBlank()) q.put("endTime", endTime);
        return block(client().get().uri(uriOf("/internal/v1/audit-ops", q)).retrieve().bodyToMono(AUDIT_PAGE));
    }

    public AuditOpDetailVO auditOpDetail(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().get()
                .uri(uriOf("/internal/v1/audit-ops/{id}", pathVars("id", id), q))
                .retrieve().bodyToMono(AUDIT_DETAIL));
    }

    public java.util.List<AuditTimelineItem> auditTimeline(Long tenantId, String businessType, String businessId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().get()
                .uri(uriOf("/internal/v1/audit-ops/timeline/{bt}/{bid}",
                        pathVars("bt", businessType, "bid", businessId), q))
                .retrieve().bodyToMono(AUDIT_TIMELINE));
    }

    public AuditStatsVO auditStats(Long tenantId, int days) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("days", days);
        return block(client().get().uri(uriOf("/internal/v1/audit-ops/stats", q)).retrieve().bodyToMono(AUDIT_STATS));
    }

    // ------------------------------------------------------------------
    // 工作流（P5）
    // ------------------------------------------------------------------

    public Long createWorkflowDefinition(Long tenantId, Long operatorId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (operatorId != null) {
            q.put("operatorId", operatorId);
        }
        return block(client().post().uri(uriOf("/internal/v1/workflow/definitions", q)).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public WfDefinitionDTO workflowDefinition(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().get()
                .uri(uriOf("/internal/v1/workflow/definitions/{id}", pathVars("id", id), q))
                .retrieve().bodyToMono(WF_DEFINITION));
    }

    public PageResult<WfDefinitionDTO> workflowDefinitions(Long tenantId, int page, int size) {
        return workflowDefinitions(tenantId, page, size, java.util.List.of(), null);
    }

    /**
     * 流程定义列表（分页，可选 categoryIds 多值分类过滤 / keyword 名称或编码模糊）。
     *
     * <p>{@code categoryIds} 非空时以<b>单值逗号串</b>传参 {@code categoryIds=1,2}，
     * 下游 mis-taskflow 的 {@code @RequestParam List<Long> categoryIds} 自动拆分。
     * {@code keyword} 非空时透传给下游做流程名称或编码包含匹配。
     */
    public PageResult<WfDefinitionDTO> workflowDefinitions(Long tenantId, int page, int size,
                                                           java.util.List<Long> categoryIds) {
        return workflowDefinitions(tenantId, page, size, categoryIds, null);
    }

    public PageResult<WfDefinitionDTO> workflowDefinitions(Long tenantId, int page, int size,
                                                           java.util.List<Long> categoryIds, String keyword) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("page", page);
        q.put("size", size);
        if (categoryIds != null && !categoryIds.isEmpty()) {
            q.put("categoryIds", String.join(",", categoryIds.stream().map(String::valueOf).toList()));
        }
        if (keyword != null && !keyword.isBlank()) {
            q.put("keyword", keyword.trim());
        }
        return block(client().get().uri(uriOf("/internal/v1/workflow/definitions", q)).retrieve().bodyToMono(WF_DEFINITION_PAGE));
    }

    public void activateWorkflowDefinition(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().post().uri(uriOf("/internal/v1/workflow/definitions/{id}/activate", pathVars("id", id), q))
                .retrieve().bodyToMono(VOID));
    }

    public void updateWorkflowDefinition(Long id, Long tenantId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().put().uri(uriOf("/internal/v1/workflow/definitions/{id}", pathVars("id", id), q))
                .contentType(MediaType.APPLICATION_JSON).bodyValue(body).retrieve().bodyToMono(VOID));
    }

    /** 仅更新流程定义表单关联（下游 {@code PUT .../supported-forms}）。 */
    public void updateWorkflowSupportedForms(Long id, Long tenantId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().put()
                .uri(uriOf("/internal/v1/workflow/definitions/{id}/supported-forms", pathVars("id", id), q))
                .contentType(MediaType.APPLICATION_JSON).bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public void deactivateWorkflowDefinition(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().post().uri(uriOf("/internal/v1/workflow/definitions/{id}/deactivate", pathVars("id", id), q))
                .retrieve().bodyToMono(VOID));
    }

    // ------------------------------------------------------------------
    // 业务分类（biz_category，统一邻接树：租户通用、与 APP 无关）
    // ------------------------------------------------------------------

    public java.util.List<BizCategoryVO> bizCategoryTree(Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().get().uri(uriOf("/internal/v1/biz-categories/tree", q)).retrieve().bodyToMono(BIZ_CATEGORY_LIST));
    }

    public java.util.List<BizCategoryVO> bizCategories(Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().get().uri(uriOf("/internal/v1/biz-categories", q)).retrieve().bodyToMono(BIZ_CATEGORY_LIST));
    }

    public BizCategoryVO getBizCategory(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().get()
                .uri(uriOf("/internal/v1/biz-categories/{id}", pathVars("id", id), q))
                .retrieve().bodyToMono(BIZ_CATEGORY_ONE));
    }

    public Long createBizCategory(Long tenantId, Long operatorId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (operatorId != null) {
            q.put("operatorId", operatorId);
        }
        return block(client().post().uri(uriOf("/internal/v1/biz-categories", q)).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public void updateBizCategory(Long id, Long tenantId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().put().uri(uriOf("/internal/v1/biz-categories/{id}", pathVars("id", id), q))
                .contentType(MediaType.APPLICATION_JSON).bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public void deleteBizCategory(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().delete().uri(uriOf("/internal/v1/biz-categories/{id}", pathVars("id", id), q))
                .retrieve().bodyToMono(VOID));
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
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (status != null) {
            q.put("status", status);
        }
        if (categoryIds != null && !categoryIds.isEmpty()) {
            q.put("categoryIds", String.join(",", categoryIds.stream().map(String::valueOf).toList()));
        }
        return block(client().get().uri(uriOf("/internal/v1/form-definitions", q)).retrieve().bodyToMono(FORM_DEF_LIST));
    }

    public FormDefinitionVO formDefinition(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().get()
                .uri(uriOf("/internal/v1/form-definitions/{id}", pathVars("id", id), q))
                .retrieve().bodyToMono(FORM_DEF_ONE));
    }

    public Long createFormDefinition(Long tenantId, Long operatorId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (operatorId != null) {
            q.put("operatorId", operatorId);
        }
        return block(client().post().uri(uriOf("/internal/v1/form-definitions", q)).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public void updateFormDefinition(Long id, Long tenantId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().put().uri(uriOf("/internal/v1/form-definitions/{id}", pathVars("id", id), q))
                .contentType(MediaType.APPLICATION_JSON).bodyValue(body).retrieve().bodyToMono(VOID));
    }

    public void deleteFormDefinition(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().delete().uri(uriOf("/internal/v1/form-definitions/{id}", pathVars("id", id), q))
                .retrieve().bodyToMono(VOID));
    }

    public Long startProcess(Long tenantId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().post().uri(uriOf("/internal/v1/workflow/instances/start", q)).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body).retrieve().bodyToMono(LONG_RESULT));
    }

    public ProcessDetailVO processDetail(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().get()
                .uri(uriOf("/internal/v1/workflow/instances/{id}", pathVars("id", id), q))
                .retrieve().bodyToMono(WF_PROCESS_DETAIL));
    }

    public PageResult<WfInstanceVO> myProcesses(Long tenantId, Long initiatorId, String status, String keyword,
                                                int page, int size) {
        return myProcesses(tenantId, initiatorId, status, keyword, null, null, page, size);
    }

    /**
     * 我发起的流程（可选 appCode / scope 归属过滤；空白**不透传** ⇒ 零回归）。
     */
    public PageResult<WfInstanceVO> myProcesses(Long tenantId, Long initiatorId, String status, String keyword,
                                                String appCode, String scope, int page, int size) {
        return myProcesses(tenantId, initiatorId, status, keyword, appCode, scope, null, null, page, size);
    }

    /**
     * 我发起的流程（可选发起人/参与人 + 可选 appCode / scope 归属过滤）。
     *
     * <p>{@code initiatorName}/{@code participantName} 为<b>可选</b>尾参：空白**不透传**
     * ⇒ 零回归（发起人按实例 {@code initiator_name}；参与人按该实例任一 {@code wf_task} 处理人）。
     */
    public PageResult<WfInstanceVO> myProcesses(Long tenantId, Long initiatorId, String status, String keyword,
                                                String appCode, String scope,
                                                String initiatorName, String participantName, int page, int size) {
        return myProcesses(tenantId, initiatorId, status, keyword, appCode, scope,
                initiatorName, participantName, page, size, false);
    }

    public PageResult<WfInstanceVO> myProcesses(Long tenantId, Long initiatorId, String status, String keyword,
                                                String appCode, String scope,
                                                String initiatorName, String participantName, int page, int size,
                                                boolean includeFormData) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        q.put("initiatorId", initiatorId);
        if (status != null) {
            q.put("status", status);
        }
        if (keyword != null && !keyword.isBlank()) {
            q.put("keyword", keyword);
        }
        if (initiatorName != null && !initiatorName.isBlank()) {
            q.put("initiatorName", initiatorName);
        }
        if (participantName != null && !participantName.isBlank()) {
            q.put("participantName", participantName);
        }
        if (appCode != null && !appCode.isBlank()) {
            q.put("appCode", appCode);
        }
        if (scope != null && !scope.isBlank()) {
            q.put("scope", scope);
        }
        q.put("page", page);
        q.put("size", size);
        if (includeFormData) {
            q.put("includeFormData", true);
        }
        return block(client().get().uri(uriOf("/internal/v1/workflow/instances/my", q)).retrieve().bodyToMono(WF_INSTANCE_PAGE));
    }

    public void completeWfTask(Long id, Long tenantId, Long operatorId, Map<String, Object> body) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (operatorId != null) {
            q.put("operatorId", operatorId);
        }
        blockVoid(client().post().uri(uriOf("/internal/v1/workflow/tasks/{id}/complete", pathVars("id", id), q))
                .contentType(MediaType.APPLICATION_JSON).bodyValue(body).retrieve().bodyToMono(VOID));
    }

    // ------------------------------------------------------------------
    // 后置执行监控（P6）
    // ------------------------------------------------------------------

    public PageResult<ExecutionTaskVO> execMonitor(Long tenantId, String status, int page, int size) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        if (status != null) {
            q.put("status", status);
        }
        q.put("page", page);
        q.put("size", size);
        return block(client().get().uri(uriOf("/internal/v1/exec-monitor", q)).retrieve().bodyToMono(EXEC_PAGE));
    }

    public ExecutionTaskVO execTask(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        return block(client().get()
                .uri(uriOf("/internal/v1/exec-monitor/{id}", pathVars("id", id), q))
                .retrieve().bodyToMono(EXEC_TASK));
    }

    public void execRetry(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().post().uri(uriOf("/internal/v1/exec-monitor/{id}/retry", pathVars("id", id), q))
                .retrieve().bodyToMono(VOID));
    }

    public void execForceArchive(Long id, Long tenantId) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("tenantId", tenantId);
        blockVoid(client().post().uri(uriOf("/internal/v1/exec-monitor/{id}/force-archive", pathVars("id", id), q))
                .retrieve().bodyToMono(VOID));
    }

    public int execScan() {
        return block(client().post().uri("/internal/v1/exec-monitor/scan").retrieve().bodyToMono(INT_RESULT));
    }
}
