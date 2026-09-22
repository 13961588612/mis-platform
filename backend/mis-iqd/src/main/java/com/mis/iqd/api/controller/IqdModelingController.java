package com.mis.iqd.api.controller;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.Result;
import com.mis.common.web.trace.TraceContext;
import com.mis.iqd.api.dto.IqdConnectionSaveRequest;
import com.mis.iqd.api.dto.IqdConnectionVO;
import com.mis.iqd.api.dto.ValidateExprResult;
import com.mis.iqd.domain.service.IqdAdminService;
import com.mis.iqd.domain.service.IqdCatalogNodeService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 可视化建模台管理面（v1.11 MR-S2 / MR-S1；路径前缀 {@code /api/v1/iqd/**}）。
 *
 * <h2>端点状态总览（10 个）</h2>
 * <table border="1">
 *   <caption>实现状态</caption>
 *   <tr><th>端点</th><th>状态</th><th>服务方法</th></tr>
 *   <tr><td>{@code POST /connections}</td><td><b>T02a 已实现</b></td><td>{@link IqdAdminService#createConnection}</td></tr>
 *   <tr><td>{@code GET  /connections}</td><td><b>T02a 已实现</b></td><td>{@link IqdAdminService#listConnections}</td></tr>
 *   <tr><td>{@code POST /connections/{id}/test}</td><td><b>T02a 已实现</b></td><td>{@link IqdAdminService#testConnection(Long)}</td></tr>
 *   <tr><td>{@code POST /catalog/model/from-table}</td><td><b>T02a 已实现</b></td><td>{@link IqdCatalogNodeService#createModelFromTable}</td></tr>
 *   <tr><td>{@code GET  /catalog/validate-expression}</td><td><b>T02a 已实现</b></td><td>{@link IqdCatalogNodeService#validateExpression}</td></tr>
 *   <tr><td>{@code GET  /catalog/sync-status}</td><td><b>T02a 已实现</b></td><td>{@link IqdAdminService#getCatalogSyncStatus}</td></tr>
 *   <tr><td>{@code POST /catalog/model}</td><td>T03 stub（503）</td><td>—</td></tr>
 *   <tr><td>{@code POST /catalog/relationship}</td><td>T03 stub（503）</td><td>—</td></tr>
 *   <tr><td>{@code POST /catalog/cube}</td><td>T03 stub（503）</td><td>—</td></tr>
 *   <tr><td>{@code POST /catalog/calculated-column}</td><td>T03 stub（503）</td><td>—</td></tr>
 * </table>
 *
 * <h2>错误语义</h2>
 * 业务冲突（40900 乐观并发 / 42200 参数或源表不存在 / 40901 幂等键重复 / 40300 写回闸门关闭）
 * 由 {@link IqdCatalogNodeService} / {@link IqdAdminService} 抛 {@link BusinessException}，
 * 经 mis-common {@code GlobalExceptionHandler} 落 **HTTP 200 + body.code + data**
 * （二/四期既有口径：BFF 侧据此透传 code/data，不降级成 500）。
 * 未实现的 T03 端点仍走 HTTP 503（T01 骨架口径，便于与真故障区分）。
 *
 * <p>权限：全部建模台端点声明 {@code @PreAuthorize("hasAuthority('iqd:modeling:edit')")}
 * （system-design §3.3；与 V87 的 sys_menu_api 绑定一致）。BFF 侧另有
 * {@code sys_api ⋈ sys_menu_api ⋈ sys_menu} 注册表闸门（deny-unmapped → 40300）。
 */
@RestController
@RequestMapping("/api/v1/iqd")
public class IqdModelingController {

    /** T03 骨架专用业务码：镜像 HTTP 503「未实现」（同 T01 口径，T03 接管后删除）。 */
    private static final int NOT_IMPLEMENTED = 50300;

    private final IqdAdminService adminService;
    private final IqdCatalogNodeService catalogNodeService;

    public IqdModelingController(IqdAdminService adminService, IqdCatalogNodeService catalogNodeService) {
        this.adminService = adminService;
        this.catalogNodeService = catalogNodeService;
    }

    // ================================================================ 连接向导（T02a 已实现）

    /**
     * 新建连接（追加一条）。{@code POST /api/v1/iqd/connections}。
     *
     * <p>入参 wire 用 {@code Map} 而非绑定 DTO：{@code IqdConnectionSaveRequest} 同时存在
     * {@code getBaseUrl()}（camel）与 {@code baseUrlWire()}（{@code @JsonProperty("base_url")}，
     * 只读别名）两条 Jackson 路径，直接绑定会让 `base_url` 的**入参**归属含糊；
     * 显式取键（snake 优先、camel 兜底）与既有 {@code updateCatalogNode(Map)} 同口径。
     *
     * @param body {@code {name, base_url, auth_type, secret_ref, project_id, default_connector,
     *             timeout_seconds, language, enabled, mdl_writeback_enabled}}
     * @return 新建后的连接视图（凭证恒 {@code ******}）
     */
    @PostMapping("/connections")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<IqdConnectionVO> createConnection(@RequestBody Map<String, Object> body) {
        return Result.ok(adminService.createConnection(toConnectionDto(body)));
    }

    /**
     * 连接清单（多连接 + MCP 运行态字段）。{@code GET /api/v1/iqd/connections}。
     *
     * <p><b>权限码用 {@code iqd:modeling:view} 而非 {@code edit}</b>（V88 绑定 92631）：
     * 建模台主页的准入码就是 {@code view}（§3.2「无 view → 不可进页面」），而页面一进就要
     * 拉连接列表才能渲染（连接选择器 / MCP 状态卡）。若此处要 {@code edit}，只有 view 的用户
     * **进得去页面却拿不到列表** → 页面半残。读语义接口用 view 与 §3.3 的
     * {@code GET /dependencies → view} 同口径；凭证不回显（{@code secret_ref} 恒 ******）。
     *
     * @return 全量连接视图（按 id 升序；空列表=尚未配置）
     */
    @GetMapping("/connections")
    @PreAuthorize("hasAuthority('iqd:modeling:view')")
    public Result<List<IqdConnectionVO>> listConnections() {
        return Result.ok(adminService.listConnections());
    }

    /**
     * 连通性自检。{@code POST /api/v1/iqd/connections/{connectionId}/test}。
     *
     * @param connectionId 连接 id
     * @return {@code {ok, latency_ms, version, status, message, last_health_at}}
     */
    @PostMapping("/connections/{connectionId}/test")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<Map<String, Object>> testConnection(@PathVariable Long connectionId) {
        return Result.ok(adminService.testConnection(connectionId));
    }

    // ================================================================ 新建节点族（§4.3 c 点）

    /**
     * 由物理表生成模型（M1 黄金路径 M-G1 核心）。{@code POST /api/v1/iqd/catalog/model/from-table}。
     *
     * @param body {@code {connectionId, source_table:{schema,name,columns?}, model_item_key,
     *             base_revision, idempotency_key, ref_sql?, in_scope?}}
     * @return {@code {edit_revision, edit_status, item_key, column_mapping, table_key, wren_ref_id}}
     */
    @PostMapping("/catalog/model/from-table")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<Map<String, Object>> createModelFromTable(@RequestBody Map<String, Object> body) {
        Long connectionId = toLong(body.get("connection_id"));
        @SuppressWarnings("unchecked")
        Map<String, Object> sourceTable = body.get("source_table") instanceof Map<?, ?> m
                ? (Map<String, Object>) m
                : null;
        String modelItemKey = str(body.get("model_item_key"));
        Long baseRevision = toLong(body.get("base_revision"));
        String idempotencyKey = str(body.get("idempotency_key"));
        Map<String, Object> options = new java.util.LinkedHashMap<>();
        options.put("in_scope", body.get("in_scope"));
        // ref_sql 支持放在 source_table 内或顶层（设计 §3.3 放在顶层）
        if (sourceTable != null && sourceTable.get("ref_sql") == null && body.get("ref_sql") != null) {
            sourceTable.put("ref_sql", body.get("ref_sql"));
        }
        return Result.ok(catalogNodeService.createModelFromTable(
                connectionId, sourceTable, modelItemKey, baseRevision, idempotencyKey, options));
    }

    /**
     * 表达式静态校验（A-10 提交前同步校验）。{@code GET /api/v1/iqd/catalog/validate-expression}。
     *
     * @param connectionId 连接 id
     * @param modelItemKey 模型稳定键（引用字段存在性范围）
     * @param expression   待校验表达式
     * @return {@code {valid, errors}}
     */
    @GetMapping("/catalog/validate-expression")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<ValidateExprResult> validateExpression(
            @RequestParam Long connectionId,
            @RequestParam String modelItemKey,
            @RequestParam String expression) {
        return Result.ok(catalogNodeService.validateExpression(connectionId, modelItemKey, expression));
    }

    /**
     * 连接级编辑同步状态 —— **不在此重复映射**。
     *
     * <p>{@code GET /api/v1/iqd/catalog/sync-status} 已由既有 {@link IqdController} 提供
     * （二/四期落地，V81 已登记 sys_api 92591）；同一路径若在本类再映射一次，Spring 启动会因
     * <b>Ambiguous mapping</b> 直接失败。BFF 侧同理由既有 {@code IqdAclController} 提供。
     * 建模台前端轮询复用该既有端点即可（前端 {@code getIqdCatalogSyncStatus} 已指向它）。
     */

    /**
     * 空白模型创建（T03 实现）。{@code POST /api/v1/iqd/catalog/model}。
     *
     * @param body {@code {connection_id, item_key, patch, base_revision, idempotency_key}}
     * @return T02a 恒为 503 + traceId
     */
    @PostMapping("/catalog/model")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public ResponseEntity<Result<Map<String, Object>>> createModel(
            @RequestBody Map<String, Object> body) {
        return notImplemented("T03 实现");
    }

    /**
     * 新建关系（画布连线即关系；T03 实现）。{@code POST /api/v1/iqd/catalog/relationship}。
     *
     * @param body {@code {connection_id, item_key, patch, base_revision, idempotency_key}}
     * @return T02a 恒为 503 + traceId
     */
    @PostMapping("/catalog/relationship")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public ResponseEntity<Result<Map<String, Object>>> createRelationship(
            @RequestBody Map<String, Object> body) {
        return notImplemented("T03 实现");
    }

    /**
     * 新建 Cube（T03 实现）。{@code POST /api/v1/iqd/catalog/cube}。
     *
     * @param body {@code {connection_id, item_key, patch, base_revision, idempotency_key}}
     * @return T02a 恒为 503 + traceId
     */
    @PostMapping("/catalog/cube")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public ResponseEntity<Result<Map<String, Object>>> createCube(
            @RequestBody Map<String, Object> body) {
        return notImplemented("T03 实现");
    }

    /**
     * 新建计算列（T03 实现）。{@code POST /api/v1/iqd/catalog/calculated-column}。
     *
     * @param body {@code {connection_id, model_item_key, column_name, expression, base_revision, idempotency_key}}
     * @return T02a 恒为 503 + traceId
     */
    @PostMapping("/catalog/calculated-column")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public ResponseEntity<Result<Map<String, Object>>> createCalculatedColumn(
            @RequestBody Map<String, Object> body) {
        return notImplemented("T03 实现");
    }

    // ================================================================ 骨架辅助

    /**
     * 统一构造「未实现」响应：HTTP 503 + {@code {code:50300, message:"T0X 实现", traceId}}。
     *
     * @param message 归属任务的实现文案
     * @return 503 响应
     */
    private ResponseEntity<Result<Map<String, Object>>> notImplemented(String message) {
        Result<Map<String, Object>> body = Result.fail(NOT_IMPLEMENTED, message);
        body.setTraceId(TraceContext.currentTraceId());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }

    /** wire Map → {@link IqdConnectionSaveRequest}（snake_case 优先，camelCase 兜底）。 */
    private static IqdConnectionSaveRequest toConnectionDto(Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        IqdConnectionSaveRequest dto = new IqdConnectionSaveRequest();
        dto.setName(str(first(b, "name")));
        dto.setBaseUrl(str(first(b, "base_url", "baseUrl")));
        String authType = str(first(b, "auth_type", "authType"));
        if (authType != null && !authType.isBlank()) {
            dto.setAuthType(authType);
        }
        dto.setSecretRef(str(first(b, "secret_ref", "secretRef")));
        dto.setProjectId(str(first(b, "project_id", "projectId")));
        dto.setDefaultConnector(str(first(b, "default_connector", "defaultConnector")));
        Long timeout = toLong(first(b, "timeout_seconds", "timeoutSeconds"));
        if (timeout != null) {
            dto.setTimeoutSeconds(timeout.intValue());
        }
        String language = str(first(b, "language"));
        if (language != null && !language.isBlank()) {
            dto.setLanguage(language);
        }
        Object enabled = first(b, "enabled");
        if (enabled != null) {
            dto.setEnabled(Boolean.TRUE.equals(toBoolean(enabled)));
        }
        Object writeback = first(b, "mdl_writeback_enabled", "mdlWritebackEnabled");
        if (writeback != null) {
            dto.setMdlWritebackEnabled(toBoolean(writeback));
        }
        return dto;
    }

    /** 取第一个非 null 键值（支持 snake/camel 双写法）。 */
    private static Object first(Map<String, Object> body, String... keys) {
        for (String k : keys) {
            if (body.containsKey(k)) {
                return body.get(k);
            }
        }
        return null;
    }

    /** wire 值 → String（null 安全）。 */
    private static String str(Object value) {
        if (value == null) {
            return null;
        }
        return value instanceof String s ? s : String.valueOf(value);
    }

    /** wire 值 → Long（null/布尔 → null）。 */
    private static Long toLong(Object value) {
        if (value == null || value instanceof Boolean) {
            return null;
        }
        try {
            if (value instanceof Number n) {
                return n.longValue();
            }
            return Long.parseLong(String.valueOf(value).trim());
        } catch (NumberFormatException exc) {
            return null;
        }
    }

    /** wire 值 → Boolean（字符串 "true"/"1" 也认）。 */
    private static Boolean toBoolean(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Boolean b) {
            return b;
        }
        String s = String.valueOf(value).trim();
        return "true".equalsIgnoreCase(s) || "1".equals(s);
    }
}
