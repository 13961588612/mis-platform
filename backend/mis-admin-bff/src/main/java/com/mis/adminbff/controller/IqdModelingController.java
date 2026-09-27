package com.mis.adminbff.controller;

import com.mis.adminbff.client.AiPlatformDiscoveryClient;
import com.mis.adminbff.client.IqdModelingClient;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.Result;
import com.mis.common.web.trace.TraceContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 可视化建模台代理（BFF，v1.11 MR-S1~S4）。路径前缀 {@code /api/v1/iqd/**}。
 *
 * <h2>端点组成（20 = 16 建模台 + 4 表发现）</h2>
 * <ul>
 *   <li><b>16 建模台端点</b>（转发 mis-iqd {@code /api/v1/iqd/**}，经 {@link IqdModelingClient}）：
 *       {@code POST /connections}、{@code GET /connections}、{@code POST /connections/{id}/test}、
 *       {@code PUT  /connections/{id}}（T06 按 id 局部更新连接）、
 *       {@code POST /catalog/model}、{@code POST /catalog/model/from-table}、
 *       {@code POST /catalog/relationship}、{@code POST /catalog/cube}、
 *       {@code PUT  /catalog/cube}（T04a 更新既有 Cube）、
 *       {@code POST /catalog/calculated-column}、{@code GET /catalog/validate-expression}、
 *       {@code GET /catalog/sync-status}（{@link IqdAclController} 提供，本类不重复映射）、
 *       {@code GET /dependencies}、{@code GET /modeling/layout/{connectionId}}、
 *       {@code PUT /modeling/layout/{connectionId}}、
 *       {@code POST /modeling/layout/{connectionId}/auto-layout}</li>
 *   <li><b>4 表发现端点</b>（转发 ai-platform Worker {@code /api/v1/iqd/discovery/**}，
 *       经 {@link AiPlatformDiscoveryClient}）：{@code GET /discovery/schemas}、
 *       {@code GET /discovery/tables}、{@code GET /discovery/columns}、{@code POST /discovery/import}</li>
 * </ul>
 * <p><b>T03 状态</b>：建模台端点全部真实转发（含 blank model / relationship / cube /
 * calculated-column / dependencies / layout GET·PUT）；唯 {@code auto-layout} 按 A-02
 * **显式返回 HTTP 501 + code 50101**（服务端不做 dagre，前端算完经 PUT 落库）。
 * 4 个表发现端点转发到 Worker（T02a 已实现）。
 *
 * <p><b>注册表</b>：这 14 + 4 条与 {@code V87}（92601-92612）、{@code V88}（92640-92644）、
 * {@code V89}（MCP）的 sys_api / sys_menu_api 一一对应 —— 注册表里登记的路径必须真的有
 * 控制器接住，否则 deny-unmapped 放行后落到 404（注册了却没人接 = 比未注册更难查）。
 *
 * <h2>权限</h2>
 * 本控制器**不写 {@code @PreAuthorize}**：与既有 {@code IqdAclController} 同口径，
 * BFF 侧判权由 {@code ApiPermissionInterceptor} 依
 * {@code sys_api ⋈ sys_menu_api ⋈ sys_menu}（V87 绑定，权限码 {@code iqd:modeling:edit}）
 * 统一裁定的，避免在同一请求上叠两套判权规则导致行为不一致。
 * 下游 mis-iqd 再按功能码兜底（{@code @PreAuthorize}，双闸）。
 *
 * <h2>T01 透传语义</h2>
 * 下游（mis-iqd / ai-platform）在 T01 尚未实现，客户端方法抛
 * {@code UnsupportedOperationException("T0X 实现")}；本控制器把该异常翻译成
 * **HTTP 503 + traceId**（透传「未实现」而非降级为 500、也不伪装成 200），
 * 与下游 mis-iqd {@code IqdModelingController} 的 503 口径一致。
 * T02/T03 落地后客户端方法返回正常数据，本控制器无需改动。
 */
@RestController
@RequestMapping("/api/v1/iqd")
public class IqdModelingController {

    /** T01 骨架专用业务码：镜像 HTTP 503「未实现」（同 mis-iqd 侧口径，生命周期 = T01 骨架）。 */
    private static final int NOT_IMPLEMENTED = 50300;

    /**
     * 「服务端按设计不实现」专用业务码：镜像 HTTP 501。
     *
     * <p>唯一用途：{@code POST /modeling/layout/{id}/auto-layout}（A-02 —— dagre 在前端跑）。
     * 与 50300 分开，使前端能把「按设计不做」与「还没做」区别对待。
     */
    private static final int NOT_IMPLEMENTED_BY_DESIGN = 50101;

    private final IqdModelingClient modelingClient;
    private final AiPlatformDiscoveryClient discoveryClient;

    public IqdModelingController(
            IqdModelingClient modelingClient,
            AiPlatformDiscoveryClient discoveryClient) {
        this.modelingClient = modelingClient;
        this.discoveryClient = discoveryClient;
    }

    // ================================================================ 连接向导（T02）

    /** 新建连接。{@code POST /connections}。 */
    @PostMapping("/connections")
    public ResponseEntity<Result<Map<String, Object>>> createConnection(
            @RequestBody Map<String, Object> body) {
        return forward(() -> modelingClient.createConnection(body));
    }

    /**
     * 连接清单（多连接 + MCP 运行态字段）。{@code GET /connections}。
     *
     * <p>⚠️ 该路径**尚未在 sys_api/sys_menu_api 登记**（V87 只登记了 POST /connections）：
     * 在 {@code deny-unmapped=true} 下会先被 BFF 注册表拦成 40300，需补一条种子
     * （见 T02a 报告「待补种子」一节）。
     */
    @GetMapping("/connections")
    public ResponseEntity<Result<List<Map<String, Object>>>> listConnections() {
        return ResponseEntity.ok(Result.ok(modelingClient.listConnections()));
    }

    /** 连接连通性自检。{@code POST /connections/{connectionId}/test}。 */
    @PostMapping("/connections/{connectionId}/test")
    public ResponseEntity<Result<Map<String, Object>>> testConnection(
            @PathVariable Long connectionId) {
        return forward(() -> modelingClient.testConnection(connectionId));
    }

    /**
     * 按 id 精确更新一条既有连接（**局部更新**；T06）。{@code PUT /connections/{connectionId}}。
     *
     * <p>复用 {@link #forward(DownstreamCall)}：成功 → HTTP 200 + data；下游业务失败
     * （<b>40900</b> 改名撞唯一约束 / <b>42200</b> 连接不存在或参数非法）→ **HTTP 200 +
     * {@code body.code} + {@code data}** 原样透传前端（不降级 50000）。
     *
     * <p>权限：BFF 侧由注册表（V92 登记 sys_api 92800 → menu 92632，权限码
     * {@code iqd:modeling:edit}）裁定，本控制器**不写** {@code @PreAuthorize}（与
     * {@link #createConnection} 同口径）；下游 mis-iqd 再按 {@code iqd:modeling:edit} 兜底（双闸）。
     * 注意与同卡片的 {@code iqd:mcp:manage} 是**两个码**，勿混淆。
     */
    @PutMapping("/connections/{connectionId}")
    public ResponseEntity<Result<Map<String, Object>>> updateConnection(
            @PathVariable Long connectionId,
            @RequestBody Map<String, Object> body) {
        return forward(() -> modelingClient.updateConnection(connectionId, body));
    }

    /**
     * 物理删除问数连接。{@code DELETE /connections/{connectionId}}。
     *
     * <p>权限：注册表 V100 → {@code iqd:modeling:edit}（与创建/更新同码）。
     * 建议前端先 {@code POST /mcp/stop?retainDir=false} 再删库。
     */
    @DeleteMapping("/connections/{connectionId}")
    public ResponseEntity<Result<Map<String, Object>>> deleteConnection(
            @PathVariable Long connectionId) {
        return forward(() -> modelingClient.deleteConnection(connectionId));
    }

    /**
     * 连接级编辑同步状态 —— **不在此重复映射**。
     *
     * <p>{@code GET /api/v1/iqd/catalog/sync-status} 已由既有 {@link IqdAclController} 提供
     * （V81 登记 92591，绑定 {@code iqd:catalog:edit}）。同一路径在本类再映射一次会导致 Spring
     * 启动 <b>Ambiguous mapping</b>；建模台发布流水线复用该既有端点即可。
     */

    // ================================================================ 新建节点族（§4.3 c 点）

    /** 空白模型创建。{@code POST /catalog/model}。 */
    @PostMapping("/catalog/model")
    public ResponseEntity<Result<Map<String, Object>>> createModel(
            @RequestBody Map<String, Object> body) {
        return forward(() -> modelingClient.createModel(body));
    }

    /** 由物理表生成模型（M1 黄金路径）。{@code POST /catalog/model/from-table}。 */
    @PostMapping("/catalog/model/from-table")
    public ResponseEntity<Result<Map<String, Object>>> createModelFromTable(
            @RequestBody Map<String, Object> body) {
        return forward(() -> modelingClient.createModelFromTable(body));
    }

    /** 新建关系。{@code POST /catalog/relationship}。 */
    @PostMapping("/catalog/relationship")
    public ResponseEntity<Result<Map<String, Object>>> createRelationship(
            @RequestBody Map<String, Object> body) {
        return forward(() -> modelingClient.createRelationship(body));
    }

    /** 新建 Cube。{@code POST /catalog/cube}。 */
    @PostMapping("/catalog/cube")
    public ResponseEntity<Result<Map<String, Object>>> createCube(
            @RequestBody Map<String, Object> body) {
        return forward(() -> modelingClient.createCube(body));
    }

    /**
     * 更新既有 Cube（自身字段 + measures/dimensions 子节点增删改 + 孤儿清理）。
     * {@code PUT /catalog/cube}（T04a）。
     *
     * <p>与 {@code POST /catalog/cube} 并列：POST 新建、PUT 更新既有。
     * {@code patch.measures / dimensions} 为全量替换语义（本次未出现的既有子节点被清理）。
     */
    @PutMapping("/catalog/cube")
    public ResponseEntity<Result<Map<String, Object>>> upsertCube(
            @RequestBody Map<String, Object> body) {
        return forward(() -> modelingClient.upsertCube(body));
    }

    /** 新建计算列。{@code POST /catalog/calculated-column}。 */
    @PostMapping("/catalog/calculated-column")
    public ResponseEntity<Result<Map<String, Object>>> createCalculatedColumn(
            @RequestBody Map<String, Object> body) {
        return forward(() -> modelingClient.createCalculatedColumn(body));
    }

    /** 表达式静态校验（A-10 提交前同步校验）。{@code GET /catalog/validate-expression}。 */
    @GetMapping("/catalog/validate-expression")
    public ResponseEntity<Result<Map<String, Object>>> validateExpression(
            @RequestParam Long connectionId,
            @RequestParam String modelItemKey,
            @RequestParam String expression) {
        return forward(() -> modelingClient.validateExpression(connectionId, modelItemKey, expression));
    }

    /** 直接引用方清单（依赖提示区 + 删除前阻断证据）。{@code GET /dependencies}。 */
    @GetMapping("/dependencies")
    public ResponseEntity<Result<Map<String, Object>>> listDependencies(
            @RequestParam Long connectionId,
            @RequestParam String itemKey) {
        return forward(() -> modelingClient.listDependencies(connectionId, itemKey));
    }

    // ================================================================ 画布布局（§4.4 d 点，MR-S4）

    /** 取连接级布局。{@code GET /modeling/layout/{connectionId}}。 */
    @GetMapping("/modeling/layout/{connectionId}")
    public ResponseEntity<Result<Map<String, Object>>> getModelLayout(@PathVariable Long connectionId) {
        return forward(() -> modelingClient.getModelLayout(connectionId));
    }

    /** 保存连接级布局（拖拽坐标持久化）。{@code PUT /modeling/layout/{connectionId}}。 */
    @PutMapping("/modeling/layout/{connectionId}")
    public ResponseEntity<Result<Map<String, Object>>> saveModelLayout(
            @PathVariable Long connectionId,
            @RequestBody Map<String, Object> body) {
        Integer baseVersion = toInt(body == null ? null : body.get("base_version"));
        return forward(() -> modelingClient.saveModelLayout(connectionId, body, baseVersion));
    }

    /**
     * 一键自动布局 —— <b>按设计返回 HTTP 501</b>。{@code POST /modeling/layout/{connectionId}/auto-layout}。
     *
     * <p>A-02 裁决：dagre 在前端跑（{@code @dagrejs/dagre} 是前端依赖，且布局需与画布节点度量一致），
     * 前端算完经 {@code PUT /modeling/layout/{connId}} 落库。故本端点显式返回
     * <b>HTTP 501 + code 50101</b>（「按设计未实现」），**区别于** T01 骨架的 503/50300
     * （「尚未实现」）—— 前端据此不必把它渲染成「功能建设中」。
     */
    @PostMapping("/modeling/layout/{connectionId}/auto-layout")
    public ResponseEntity<Result<Map<String, Object>>> autoLayout(
            @PathVariable Long connectionId,
            @RequestBody(required = false) Map<String, Object> body) {
        return forwardByDesign(() -> modelingClient.autoLayout(connectionId, body));
    }

    // ================================================================ 表发现（§4.1 a 点）

    /** schema 列表。{@code GET /discovery/schemas}。 */
    @GetMapping("/discovery/schemas")
    public ResponseEntity<Result<Map<String, Object>>> listSchemas(@RequestParam Long connectionId) {
        return forward(() -> discoveryClient.listSchemas(connectionId));
    }

    /** 表清单（分页/搜索）。{@code GET /discovery/tables}。 */
    @GetMapping("/discovery/tables")
    public ResponseEntity<Result<Map<String, Object>>> listTables(
            @RequestParam Long connectionId,
            @RequestParam String schema,
            @RequestParam(required = false, defaultValue = "1") Integer page,
            @RequestParam(required = false) String keyword) {
        return forward(() -> discoveryClient.listTables(connectionId, schema, page, keyword));
    }

    /** 列清单（PK 推断高亮）。{@code GET /discovery/columns}。 */
    @GetMapping("/discovery/columns")
    public ResponseEntity<Result<Map<String, Object>>> listColumns(
            @RequestParam Long connectionId,
            @RequestParam String schema,
            @RequestParam String table) {
        return forward(() -> discoveryClient.listColumns(connectionId, schema, table));
    }

    /** 批量导入表。{@code POST /discovery/import}。 */
    @PostMapping("/discovery/import")
    public ResponseEntity<Result<Map<String, Object>>> importTables(
            @RequestBody Map<String, Object> body) {
        return forward(() -> discoveryClient.importTables(body));
    }

    // ================================================================ 骨架辅助

    /** 下游调用可抛出的「未实现」异常类型（T0X 实现 / 按设计不实现）。 */
    @FunctionalInterface
    private interface DownstreamCall {
        Map<String, Object> invoke();
    }

    /**
     * 统一转发（T01 骨架口径）：成功 → HTTP 200 + data；下游未实现
     * （{@code UnsupportedOperationException}）→ HTTP 503 + {@code {code:50300, ..., traceId}}；
     * 下游业务失败（{@code BusinessException}）→ **HTTP 200 + body.code + data**
     * （二/四期口径：40900 带 {@code current_edit_revision} / 40901 带 {@code idempotency_key} /
     * 42200 带 {@code dependents} / 42201 带 {@code errors}）；均带 traceId。
     *
     * @param call 下游调用
     * @return 响应（200 / 200+业务码 / 503）
     */
    private ResponseEntity<Result<Map<String, Object>>> forward(DownstreamCall call) {
        return forward(call, NOT_IMPLEMENTED, HttpStatus.SERVICE_UNAVAILABLE);
    }

    /**
     * 「按设计不实现」转发：{@code UnsupportedOperationException} → <b>HTTP 501 + code 50101</b>。
     *
     * <p>与 {@link #forward(DownstreamCall)}（503/50300）的区别仅在「未实现」的语义：
     * 501 表达「服务端断言这活儿不该由它干」（A-02 的 auto-layout），
     * 503 表达「尚未实现，稍后再来」。前端可据此分别处理。
     */
    private ResponseEntity<Result<Map<String, Object>>> forwardByDesign(DownstreamCall call) {
        return forward(call, NOT_IMPLEMENTED_BY_DESIGN, HttpStatus.NOT_IMPLEMENTED);
    }

    /**
     * 统一转发实现。
     *
     * @param call              下游调用
     * @param notImplCode       未实现时的业务码（50300 骨架 / 50101 按设计）
     * @param notImplStatus     未实现时的 HTTP 状态（503 / 501）
     * @return 响应
     */
    private ResponseEntity<Result<Map<String, Object>>> forward(
            DownstreamCall call, int notImplCode, HttpStatus notImplStatus) {
        try {
            return ResponseEntity.ok(Result.ok(call.invoke()));
        } catch (UnsupportedOperationException ex) {
            String message = ex.getMessage() == null ? "T0X 实现" : ex.getMessage();
            Result<Map<String, Object>> body = Result.fail(notImplCode, message);
            body.setTraceId(TraceContext.currentTraceId());
            return ResponseEntity.status(notImplStatus).body(body);
        } catch (BusinessException ex) {
            // 与 IqdAclController.updateCatalogNode 同口径：保留 code 与 data 明细，不裸奔成 50000
            Result<Map<String, Object>> body = new Result<>();
            body.setCode(ex.getCode());
            body.setMessage(ex.getMessage());
            @SuppressWarnings("unchecked")
            Map<String, Object> data = ex.getData() instanceof Map
                    ? (Map<String, Object>) ex.getData() : null;
            body.setData(data);
            body.setTraceId(TraceContext.currentTraceId());
            return ResponseEntity.ok(body);
        }
    }

    /** wire 值 → Integer（null / 布尔 / 不可解析 → null）。 */
    private static Integer toInt(Object value) {
        if (value == null || value instanceof Boolean) {
            return null;
        }
        try {
            if (value instanceof Number n) {
                return n.intValue();
            }
            return Integer.parseInt(String.valueOf(value).trim());
        } catch (NumberFormatException exc) {
            return null;
        }
    }
}
