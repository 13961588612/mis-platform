package com.mis.iqd.api.controller;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.Result;
import com.mis.common.web.trace.TraceContext;
import com.mis.iqd.api.dto.IqdConnectionSaveRequest;
import com.mis.iqd.api.dto.IqdConnectionVO;
import com.mis.iqd.api.dto.IqdDependents;
import com.mis.iqd.api.dto.IqdModelingCreateResponse;
import com.mis.iqd.api.dto.ValidateExprResult;
import com.mis.iqd.domain.service.IqdAdminService;
import com.mis.iqd.domain.service.IqdCatalogNodeService;
import com.mis.iqd.domain.service.IqdModelLayoutService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 可视化建模台管理面（v1.11 MR-S2 / MR-S1；路径前缀 {@code /api/v1/iqd/**}）。
 *
 * <h2>端点状态总览（15 个）</h2>
 * <table border="1">
 *   <caption>实现状态</caption>
 *   <tr><th>端点</th><th>状态</th><th>服务方法</th></tr>
 *   <tr><td>{@code POST /connections}</td><td>T02a 已实现</td><td>{@link IqdAdminService#createConnection}</td></tr>
 *   <tr><td>{@code GET  /connections}</td><td>T02a 已实现</td><td>{@link IqdAdminService#listConnections}</td></tr>
 *   <tr><td>{@code POST /connections/{id}/test}</td><td>T02a 已实现</td><td>{@link IqdAdminService#testConnection(Long)}</td></tr>
 *   <tr><td>{@code POST /catalog/model/from-table}</td><td>T02a 已实现</td><td>{@link IqdCatalogNodeService#createModelFromTable}</td></tr>
 *   <tr><td>{@code GET  /catalog/validate-expression}</td><td>T02a 已实现</td><td>{@link IqdCatalogNodeService#validateExpression}</td></tr>
 *   <tr><td>{@code GET  /catalog/sync-status}</td><td>T02a 已实现（{@link IqdController}）</td><td>{@link IqdAdminService#getCatalogSyncStatus}</td></tr>
 *   <tr><td>{@code POST /catalog/model}</td><td><b>T03 已实现</b></td><td>{@link IqdCatalogNodeService#createModel}</td></tr>
 *   <tr><td>{@code POST /catalog/relationship}</td><td><b>T03 已实现</b></td><td>{@link IqdCatalogNodeService#createRelationship}</td></tr>
 *   <tr><td>{@code POST /catalog/cube}</td><td><b>T03 已实现</b></td><td>{@link IqdCatalogNodeService#createCube}</td></tr>
 *   <tr><td>{@code PUT  /catalog/cube}</td><td><b>T04a 已实现</b></td><td>{@link IqdCatalogNodeService#upsertCube}</td></tr>
 *   <tr><td>{@code POST /catalog/calculated-column}</td><td><b>T03 已实现</b></td><td>{@link IqdCatalogNodeService#createCalculatedColumn}</td></tr>
 *   <tr><td>{@code GET  /dependencies}</td><td><b>T03 已实现</b></td><td>{@link IqdCatalogNodeService#listDependents}</td></tr>
 *   <tr><td>{@code GET  /modeling/layout/{connectionId}}</td><td><b>T03 已实现</b></td><td>{@link IqdModelLayoutService#get}</td></tr>
 *   <tr><td>{@code PUT  /modeling/layout/{connectionId}}</td><td><b>T03 已实现</b></td><td>{@link IqdModelLayoutService#save}</td></tr>
 *   <tr><td>{@code POST /modeling/layout/{connectionId}/auto-layout}</td><td><b>HTTP 501（A-02 按设计）</b></td><td>{@link IqdModelLayoutService#autoLayout}</td></tr>
 * </table>
 *
 * <h2>错误语义</h2>
 * 业务冲突（40900 乐观并发 / 40901 幂等键重复 / 42200 参数或源对象不存在 /
 * 42201 expression 引用不存在字段 / 40300 写回闸门关闭）
 * 由 {@link IqdCatalogNodeService} / {@link IqdModelLayoutService} / {@link IqdAdminService}
 * 抛 {@link BusinessException}，经 mis-common {@code GlobalExceptionHandler} 落
 * **HTTP 200 + body.code + data**（二/四期既有口径：BFF 侧据此透传 code/data，不降级成 500）。
 * 唯一例外是 {@code auto-layout}：按 A-02 裁决显式返回 **HTTP 501 + code 50101**
 * （「按设计未实现」≠ T01 骨架的 503/50300「尚未实现」）。
 *
 * <p>权限：连接/新建节点/布局写端点声明 {@code hasAuthority('iqd:modeling:edit')}；
 * 读语义端点（{@code GET /connections}、{@code GET /dependencies}、{@code GET /modeling/layout/*}）
 * 声明 {@code hasAuthority('iqd:modeling:view')} —— 与 V87/V88 的 sys_menu_api 绑定逐条一致
 * （system-design §3.3）。BFF 侧另有 {@code sys_api ⋈ sys_menu_api ⋈ sys_menu} 注册表闸门
 * （deny-unmapped → 40300）。
 */
@RestController
@RequestMapping("/api/v1/iqd")
public class IqdModelingController {

    /**
     * 「服务端按设计不实现」专用业务码：镜像 HTTP 501（区别于 T01 骨架的 503/50300）。
     *
     * <p>当前唯一用途：{@code POST /modeling/layout/{id}/auto-layout}
     * （A-02 裁决 —— dagre 在前端跑，前端算完经 PUT 落库）。
     */
    private static final int NOT_IMPLEMENTED_BY_DESIGN = 50101;

    private final IqdAdminService adminService;
    private final IqdCatalogNodeService catalogNodeService;
    private final IqdModelLayoutService layoutService;

    public IqdModelingController(
            IqdAdminService adminService,
            IqdCatalogNodeService catalogNodeService,
            IqdModelLayoutService layoutService) {
        this.adminService = adminService;
        this.catalogNodeService = catalogNodeService;
        this.layoutService = layoutService;
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
     * @return {@code {edit_revision, edit_status, wren_ref_id}}
     */
    @PostMapping("/catalog/model")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<IqdModelingCreateResponse> createModel(@RequestBody Map<String, Object> body) {
        return Result.ok(catalogNodeService.createModel(
                toLong(body.get("connection_id")),
                str(body.get("item_key")),
                asMap(body.get("patch")),
                toLong(body.get("base_revision")),
                str(body.get("idempotency_key"))));
    }

    /**
     * 新建关系（画布连线即关系；T03 实现）。{@code POST /api/v1/iqd/catalog/relationship}。
     *
     * @param body {@code {connection_id, item_key, patch:{join_type,cardinality,condition,source_model,target_model},
     *             base_revision, idempotency_key}}
     * @return {@code {edit_revision, edit_status, wren_ref_id}}
     */
    @PostMapping("/catalog/relationship")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<IqdModelingCreateResponse> createRelationship(@RequestBody Map<String, Object> body) {
        return Result.ok(catalogNodeService.createRelationship(
                toLong(body.get("connection_id")),
                str(body.get("item_key")),
                asMap(body.get("patch")),
                toLong(body.get("base_revision")),
                str(body.get("idempotency_key"))));
    }

    /**
     * 新建 Cube（含 measures/dimensions 子节点；T03 实现）。{@code POST /api/v1/iqd/catalog/cube}。
     *
     * @param body {@code {connection_id, item_key, patch:{display_name,model_ref,measures[],dimensions[]},
     *             base_revision, idempotency_key}}
     * @return {@code {edit_revision, edit_status, wren_ref_id}}
     */
    @PostMapping("/catalog/cube")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<IqdModelingCreateResponse> createCube(@RequestBody Map<String, Object> body) {
        return Result.ok(catalogNodeService.createCube(
                toLong(body.get("connection_id")),
                str(body.get("item_key")),
                asMap(body.get("patch")),
                toLong(body.get("base_revision")),
                str(body.get("idempotency_key"))));
    }

    /**
     * 更新既有 Cube（自身字段 + measures/dimensions 子节点增删改 + 孤儿清理；T04a 实现）。
     * {@code PUT /api/v1/iqd/catalog/cube}。
     *
     * <p>与 {@link #createCube} 并列：POST 是「新建」，PUT 是「更新既有」（补齐 T03c
     * 暴露的「既有 Cube 改不了」缺口）。{@code patch.measures / dimensions} 为<b>全量替换</b>
     * 语义：本次未出现的既有子节点会被清理（物理删除，见服务层
     * {@link IqdCatalogNodeService#upsertCube}）。
     *
     * @param body {@code {connection_id, item_key, patch:{display_name?,model_ref?,measures[],dimensions[]},
     *             base_revision, idempotency_key}}
     * @return {@code {edit_revision, edit_status, wren_ref_id}}
     */
    @PutMapping("/catalog/cube")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<IqdModelingCreateResponse> upsertCube(@RequestBody Map<String, Object> body) {
        return Result.ok(catalogNodeService.upsertCube(
                toLong(body.get("connection_id")),
                str(body.get("item_key")),
                asMap(body.get("patch")),
                toLong(body.get("base_revision")),
                str(body.get("idempotency_key"))));
    }

    /**
     * 新建计算列（T03 实现）。{@code POST /api/v1/iqd/catalog/calculated-column}。
     *
     * @param body {@code {connection_id, model_item_key, column_name, expression, base_revision, idempotency_key}}
     * @return {@code {edit_revision, edit_status, wren_ref_id, item_key, validated, errors}}
     */
    @PostMapping("/catalog/calculated-column")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<Map<String, Object>> createCalculatedColumn(@RequestBody Map<String, Object> body) {
        return Result.ok(catalogNodeService.createCalculatedColumn(
                toLong(body.get("connection_id")),
                str(body.get("model_item_key")),
                str(body.get("column_name")),
                str(body.get("expression")),
                toLong(body.get("base_revision")),
                str(body.get("idempotency_key"))));
    }

    /**
     * 直接引用方清单（右栏「依赖方提示区」+ 删除前阻断证据）。{@code GET /api/v1/iqd/dependencies}。
     *
     * <p>权限码 {@code iqd:modeling:view}（V88 绑定 92644 → 菜单 92631，读语义；§3.3 明示 view）。
     *
     * @param connectionId 连接 id
     * @param itemKey      被查节点稳定键
     * @return {@code {dependents:[{item_key,kind}], total}}
     */
    @GetMapping("/dependencies")
    @PreAuthorize("hasAuthority('iqd:modeling:view')")
    public Result<IqdDependents> listDependencies(
            @RequestParam Long connectionId,
            @RequestParam String itemKey) {
        return Result.ok(catalogNodeService.listDependents(connectionId, itemKey));
    }

    // ================================================================ 画布布局（§4.4 d 点，MR-S4）

    /**
     * 取连接级布局。{@code GET /api/v1/iqd/modeling/layout/{connectionId}}。
     *
     * @param connectionId 连接 id
     * @return {@code {connection_id, nodes, edges, viewport, auto_layout_version, version}}
     */
    @GetMapping("/modeling/layout/{connectionId}")
    @PreAuthorize("hasAuthority('iqd:modeling:view')")
    public Result<Map<String, Object>> getModelLayout(@PathVariable Long connectionId) {
        return Result.ok(layoutService.get(connectionId));
    }

    /**
     * 保存连接级布局（拖拽坐标持久化）。{@code PUT /api/v1/iqd/modeling/layout/{connectionId}}。
     *
     * @param connectionId 连接 id
     * @param body         {@code {nodes, edges, viewport, auto_layout_version?, base_version?}}
     * @return 保存后的布局（{@code version} 已 +1）
     */
    @PutMapping("/modeling/layout/{connectionId}")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Result<Map<String, Object>> saveModelLayout(
            @PathVariable Long connectionId,
            @RequestBody Map<String, Object> body) {
        Integer baseVersion = toInt(body == null ? null : body.get("base_version"));
        return Result.ok(layoutService.save(connectionId, body, baseVersion));
    }

    /**
     * 一键自动布局 —— **服务端按设计不实现（HTTP 501）**。{@code POST /modeling/layout/{connectionId}/auto-layout}。
     *
     * <p>A-02 裁决：{@code @dagrejs/dagre} 是前端依赖，布局计算需与画布节点度量一致，
     * 且前端算完可直接复用 {@code PUT /modeling/layout/{connId}} 落库。故本端点返回
     * <b>HTTP 501 + code 50101</b>（区别于 T01 骨架的 503/50300），把「按设计未实现」
     * 与「尚未实现」在协议层就区分开，避免前端把两者一视同仁地渲染成「建设中」。
     *
     * @param connectionId 连接 id
     * @param body         {@code {algorithm:'dagre', direction:'LR'|'TB'}}
     * @return HTTP 501 + {@code {code:50101, message:说明, traceId}}
     */
    @PostMapping("/modeling/layout/{connectionId}/auto-layout")
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public ResponseEntity<Result<Map<String, Object>>> autoLayout(
            @PathVariable Long connectionId,
            @RequestBody(required = false) Map<String, Object> body) {
        try {
            return ResponseEntity.ok(Result.ok(layoutService.autoLayout(connectionId, body)));
        } catch (UnsupportedOperationException ex) {
            Result<Map<String, Object>> result = Result.fail(
                    NOT_IMPLEMENTED_BY_DESIGN,
                    ex.getMessage() == null ? "服务端不实现自动布局（A-02）" : ex.getMessage());
            result.setTraceId(TraceContext.currentTraceId());
            return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(result);
        }
    }

    // ================================================================ 骨架 / 参数辅助

    /** wire 值 → {@code Map<String,Object>}（非 Map → null，交由 Service 判 42200）。 */
    private static Map<String, Object> asMap(Object value) {
        if (value instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : m.entrySet()) {
                out.put(String.valueOf(e.getKey()), e.getValue());
            }
            return out;
        }
        return null;
    }

    /** wire 值 → Integer（null/布尔/不可解析 → null）。 */
    private static Integer toInt(Object value) {
        Long v = toLong(value);
        return v == null ? null : v.intValue();
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
