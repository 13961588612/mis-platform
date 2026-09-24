package com.mis.iqd.api.controller;

import com.mis.common.core.result.Result;
import com.mis.iqd.api.dto.IqdAclVO;
import com.mis.iqd.api.dto.IqdAskLogVO;
import com.mis.iqd.api.dto.IqdCatalogItemVO;
import com.mis.iqd.api.dto.IqdKnowledgeVO;
import com.mis.iqd.api.dto.IqdMaskRuleVO;
import com.mis.iqd.api.dto.IqdScopeDimensionVO;
import com.mis.iqd.api.dto.IqdScopePolicyVO;
import com.mis.iqd.api.dto.IqdSqlPairVO;
import com.mis.iqd.api.dto.IqdSyncJobVO;
import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.service.IqdAdminService;
import com.mis.iqd.domain.service.IqdScopeSyncJobService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 问数配置读取 API（内部端点，W2 完整实现）。
 *
 * <p>路径前缀 {@code /internal/v1/iqd/**}，仅供 Worker {@code IqdConfigClient}
 * 内网调用（对齐 {@code /internal/v1/kb/**} 范式）。
 *
 * <p>W2（B3）端点全部落地：
 * get-acls / get-scope-policies / get-catalog-in-scope / get-catalog-meta /
 * get-dimensions / get-mask-rules / get-dict-sync-status / get-change-events。
 *
 * <p>W4 新增：get-sql-pairs / get-knowledge（增强物料） / get-ask-logs（审计复核）。
 */
@RestController
@RequestMapping("/internal/v1/iqd")
public class IqdInternalController {

    private final IqdConnectionRepository connectionRepository;
    private final IqdAdminService adminService;
    private final IqdScopeSyncJobService scopeSyncJobService;
    private final com.mis.iqd.domain.service.IqdCatalogNodeService catalogNodeService;

    public IqdInternalController(
            IqdConnectionRepository connectionRepository,
            IqdAdminService adminService,
            IqdScopeSyncJobService scopeSyncJobService,
            com.mis.iqd.domain.service.IqdCatalogNodeService catalogNodeService) {
        this.connectionRepository = connectionRepository;
        this.adminService = adminService;
        this.scopeSyncJobService = scopeSyncJobService;
        this.catalogNodeService = catalogNodeService;
    }

    /**
     * 健康检查：Worker 连通性自检。
     */
    @GetMapping("/health")
    public Result<Map<String, Object>> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "ok");
        body.put("service", "mis-iqd");
        body.put("time", Instant.now().toString());
        return Result.ok(body);
    }

    /**
     * 拉取连接配置清单（启用连接最小视图，不含敏感字段）。
     *
     * <p>每行**追加**计算字段 {@code is_primary}（布尔）：标识该连接是否为主连接。
     * 判定**复用** {@link IqdAdminService#findPrimaryConnection()}（**权威单一选主口径**
     * —— {@code name='default'} 优先 → 最小 id {@code enabled} → 首行，见 §14.5.1 A/B/D），
     * 即「本行 {@code id} == {@code findPrimaryConnection().id}」。
     * {@code is_primary} **不落库、不新增迁移、不改既有键**（追加在末尾，向后兼容）。
     *
     * <p>用途：① 让隐式选主**可观测**；② 作为 ai-platform Python 侧
     * {@code IqdConfigClient.resolve_primary_connection_id} 的**单一真值源** —— 消除历史
     * 3 份「只取 {@code connections[0]}、无视 {@code name='default'}」的漂移拷贝（§14.5.1 C）。
     */
    @GetMapping("/get-connections")
    public Result<List<Map<String, Object>>> getConnections() {
        List<IqdConnection> connections = connectionRepository.findByEnabledOrderByIdAsc(1);
        // 主连接 id 由权威选主方法派生（与 GET /config 同源）——避免第 4 份判定拷贝。
        Long primaryConnectionId = adminService.findPrimaryConnection()
                .map(IqdConnection::getId)
                .orElse(null);
        List<Map<String, Object>> items = connections.stream().map(c -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", c.getId());
            m.put("name", c.getName());
            m.put("baseUrl", c.getBaseUrl());
            m.put("authType", c.getAuthType());
            m.put("projectId", c.getProjectId());
            m.put("defaultConnector", c.getDefaultConnector());
            m.put("timeoutSeconds", c.getTimeoutSeconds());
            m.put("language", c.getLanguage());
            m.put("status", c.getStatus());
            m.put("enabled", c.getEnabled());
            m.put("mcp_status", c.getMcpStatus());
            m.put("mcp_port", c.getMcpPort());
            // 追加计算字段（末尾，不改既有键，向后兼容）：本行是否为主连接
            m.put("is_primary", c.getId() != null && c.getId().equals(primaryConnectionId));
            return m;
        }).toList();
        return Result.ok(items);
    }

    /**
     * 写问数审计日志（Worker 投影前全量调用）。
     *
     * @param payload 审计载荷（snake_case）
     * @return 落库后的日志行 id
     */
    @PostMapping("/write-ask-log")
    public Result<Map<String, Object>> writeAskLog(@RequestBody Map<String, Object> payload) {
        Long id = adminService.writeAskLog(payload);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", id);
        return Result.ok(body);
    }

    /**
     * 拉取表级 ACL（W2：全量，含 row_scope）。
     */
    @GetMapping("/get-acls")
    public Result<List<IqdAclVO>> getAcls() {
        // 取主连接（Worker 单连接场景）；无连接返回空数组
        Long connectionId = resolvePrimaryConnectionId();
        if (connectionId == null) {
            return Result.ok(List.of());
        }
        return Result.ok(adminService.listAcls(connectionId));
    }

    /**
     * 拉取范围策略（W2：全量，含 global/主体模板）。
     */
    @GetMapping("/get-scope-policies")
    public Result<List<IqdScopePolicyVO>> getScopePolicies() {
        Long connectionId = resolvePrimaryConnectionId();
        if (connectionId == null) {
            return Result.ok(List.of());
        }
        return Result.ok(adminService.listScopePolicies(connectionId));
    }

    /**
     * 拉取纳入问数范围的清单项（W2：in_scope=1；范围裁定消费）。
     */
    @GetMapping("/get-catalog-in-scope")
    public Result<List<IqdCatalogItemVO>> getCatalogInScope() {
        Long connectionId = resolvePrimaryConnectionId();
        if (connectionId == null) {
            return Result.ok(List.of());
        }
        return Result.ok(adminService.listCatalogInScope(connectionId));
    }

    /**
     * 拉取清单元数据（W2：item_key/kind/mask_rule/sensitive_level/data_type；脱敏消费）。
     */
    @GetMapping("/get-catalog-meta")
    public Result<List<IqdCatalogItemVO>> getCatalogMeta() {
        Long connectionId = resolvePrimaryConnectionId();
        if (connectionId == null) {
            return Result.ok(List.of());
        }
        return Result.ok(adminService.listCatalog(connectionId));
    }

    /**
     * 拉取行级范围维度注册表（W2：全量种子 dept/store + 自定义）。
     */
    @GetMapping("/get-dimensions")
    public Result<List<IqdScopeDimensionVO>> getDimensions() {
        return Result.ok(adminService.listDimensions());
    }

    /**
     * 拉取脱敏规则（W2：启用规则，priority 降序）。
     */
    @GetMapping("/get-mask-rules")
    public Result<List<IqdMaskRuleVO>> getMaskRules() {
        return Result.ok(adminService.listMaskRules());
    }

    /**
     * 拉取字典同步状态（W2：mis_dept_scope / mis_store_scope 每维度一行）。
     */
    @GetMapping("/get-dict-sync-status")
    public Result<List<Map<String, Object>>> getDictSyncStatus() {
        return Result.ok(scopeSyncJobService.listSyncStatus());
    }

    /**
     * 拉取变更事件（Worker 增量拉取；since 游标推进）。
     *
     * @param sinceSeq 上次消费游标；缺省 0 = 全量。
     */
    @GetMapping("/get-change-events")
    public Result<List<Map<String, Object>>> getChangeEvents(
            @RequestParam(defaultValue = "0") long sinceSeq) {
        return Result.ok(adminService.drainChangeEvents(sinceSeq));
    }

    /**
     * 拉取样本对（W4：增强物料 few-shot；Worker 经 IqdConfigClient 缓存消费）。
     */
    @GetMapping("/get-sql-pairs")
    public Result<List<IqdSqlPairVO>> getSqlPairs() {
        Long connectionId = resolvePrimaryConnectionId();
        if (connectionId == null) {
            return Result.ok(List.of());
        }
        return Result.ok(adminService.listSqlPairs(connectionId));
    }

    /**
     * 拉取知识/术语/口径（W4：增强物料 instructions；Worker 经 IqdConfigClient 缓存消费）。
     */
    @GetMapping("/get-knowledge")
    public Result<List<IqdKnowledgeVO>> getKnowledge() {
        Long connectionId = resolvePrimaryConnectionId();
        if (connectionId == null) {
            return Result.ok(List.of());
        }
        return Result.ok(adminService.listKnowledge(connectionId, null));
    }

    /**
     * 拉取审计日志（W4 复核；Worker 诊断用）。
     */
    @GetMapping("/get-ask-logs")
    public Result<List<IqdAskLogVO>> getAskLogs(
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Long userId) {
        return Result.ok(adminService.listAskLogs(limit, status, userId));
    }

    /**
     * 回填增强物料（ai-platform 经 IqdConfigClient 回调；覆盖本批 pending 物料的
     * wren_ref_id / sync_status='synced' / synced_at）。
     */
    @PostMapping("/enhance/backfill")
    public Result<Map<String, Object>> backfillEnhancementSync(
            @RequestBody Map<String, Object> payload) {
        Long connectionId = toLong(payload.get("connection_id"));
        List<Long> sqlPairIds = toLongList(payload.get("sql_pair_ids"));
        List<Long> knowledgeIds = toLongList(payload.get("knowledge_ids"));
        Instant syncedAt = parseInstant(payload.get("synced_at"));
        int count = adminService.backfillEnhancementSync(
                connectionId, str(payload.get("wren_ref_id")), sqlPairIds, knowledgeIds, syncedAt);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("synced_count", count);
        return Result.ok(body);
    }

    /**
     * 上报意见见 reportSyncJob；此处为路径占位避免歧义。
     */

    /**
     * 上报同步作业（ai-platform 经 IqdConfigClient 回调；每连接覆盖写）。
     */
    @PostMapping("/enhance/sync-job")
    public Result<IqdSyncJobVO> reportSyncJob(@RequestBody Map<String, Object> payload) {
        return Result.ok(adminService.reportSyncJob(payload));
    }

    /**
     * 取连接完整 MDL 快照 + 已编辑节点（ai-platform {@code get_catalog_full}，
     * 供 G7 以 mdl_raw 为基线派生完整 MDL）。
     */
    @GetMapping("/get-catalog-full")
    public Result<Map<String, Object>> getCatalogFull(
            @RequestParam("connection_id") Long connectionId) {
        Map<String, Object> body = adminService.getCatalogFull(connectionId);
        return Result.ok(body);
    }

    /**
     * 批量回填 catalog 编辑盖章（ai-platform build 成功后回调，P0-8 断点续盖）。
     */
    @PostMapping("/enhance/catalog-backfill")
    public Result<Map<String, Object>> catalogBackfill(@RequestBody Map<String, Object> payload) {
        Long connectionId = toLong(payload.get("connection_id"));
        String mdlHash = str(payload.get("mdl_hash"));
        Long editRevision = toLong(payload.get("edit_revision"));
        int stamped = adminService.backfillCatalogSync(connectionId, mdlHash, editRevision);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("stamped_count", stamped);
        return Result.ok(body);
    }

    /**
     * 外部漂移标记（ai-platform 漂移检测命中回调；drift=true 阻断后续 build，false 收敛）。
     */
    @PostMapping("/enhance/drift")
    public Result<Map<String, Object>> setDrift(@RequestBody Map<String, Object> payload) {
        Long connectionId = toLong(payload.get("connection_id"));
        boolean drift = Boolean.TRUE.equals(payload.get("drift"));
        adminService.setStaleDrift(connectionId, drift);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        return Result.ok(body);
    }

    /**
     * 取连接凭证引用（方案 A 多连接 D6 凭证解析前置）。
     *
     * <p>仅回 {@code secret_ref}（opaque vault 引用），绝不回明文/密码；ai-platform 经此
     * 引用调本地 CredentialVault 解密并注入 wren serve mcp 进程 env（不落盘）。注意与
     * {@code /get-connections} 区分：后者为安全视图，secret 恒回 {@code ******}，本端点为
     * 内部进程管理器专用，仅回引用。
     *
     * @param connectionId 问数连接 id
     * @return {@code {connection_id, secret_ref}}
     */
    @GetMapping("/connection-credentials")
    public Result<Map<String, Object>> getConnectionCredentials(
            @RequestParam("connection_id") Long connectionId) {
        return Result.ok(adminService.getConnectionSecretRef(connectionId));
    }

    /**
     * 回写连接级 WrenAI MCP 进程状态（方案 A 多连接可观测，REQ-P1-2）。
     *
     * <p>由 ai-platform Worker 进程管理器在启停/健康自检后回调。仅回写
     * {@code mcp_status} / {@code mcp_port}，不影响其它连接字段。
     */
    @PostMapping("/mcp-status")
    public Result<Map<String, Object>> reportMcpStatus(@RequestBody Map<String, Object> payload) {
        Long connectionId = toLong(payload.get("connection_id"));
        String mcpStatus = str(payload.get("mcp_status"));
        Integer mcpPort = toLong(payload.get("mcp_port")) == null ? null : toLong(payload.get("mcp_port")).intValue();
        adminService.reportMcpStatus(connectionId, mcpStatus, mcpPort);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        return Result.ok(body);
    }

    /**
     * 回写连接级 WrenAI MCP 跨机器部署句柄（方案 A 跨机器落地 v0.2）。
     *
     * <p>由 ai-platform Worker 经 {@code WrenMcpAgentClient.ensure} 拉起部署后回调。仅回写
     * {@code mcp_host} / {@code agent_handle} / {@code mcp_status}，不影响其它连接字段。
     */
    @PostMapping("/mcp-deploy")
    public Result<Map<String, Object>> reportMcpDeployment(@RequestBody Map<String, Object> payload) {
        Long connectionId = toLong(payload.get("connection_id"));
        String mcpHost = str(payload.get("mcp_host"));
        String agentHandle = str(payload.get("agent_handle"));
        String mcpStatus = str(payload.get("mcp_status"));
        adminService.reportMcpDeployment(connectionId, mcpHost, agentHandle, mcpStatus);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        return Result.ok(body);
    }

    /**
     * 由物理表生成模型（**内部面**：ai-platform Worker 表发现导入回调；v1.11 MR-02 / §4.1 a 点）。
     *
     * <p>为什么走内部面而非管理面：Worker 在 {@code importTables} 里对每张勾选的表调用本端点
     * （设计 §6.1 时序「AIP->>MIS: POST …/catalog/model/from-table × N」），调用方是**服务**
     * 而非浏览器 —— 无 MIS JWT，故与既有 {@code /internal/v1/iqd/**} 同口径（Worker 直调，
     * 不登记 sys_api，见 V72 说明）。业务逻辑完全复用
     * {@link com.mis.iqd.domain.service.IqdCatalogNodeService#createModelFromTable}，
     * 本端点只做 wire 取值与转发（**不重复实现**幂等/并发/落库）。
     *
     * <p>注意：内部面**不写 sys_api**，故此处不加 {@code @PreAuthorize}（无 JWT 上下文）；
     * 权限边界由 BFF 侧 {@code iqd:modeling:edit} + 网络隔离（仅内网可达）共同保证。
     *
     * @param body {@code {connection_id, source_table:{schema,name,columns?}, model_item_key,
     *             base_revision, idempotency_key, ref_sql?, in_scope?}}
     * @return {@code {edit_revision, edit_status, item_key, column_mapping, table_key, wren_ref_id}}
     */
    @PostMapping("/catalog/model/from-table")
    public Result<Map<String, Object>> createModelFromTable(@RequestBody Map<String, Object> body) {
        Long connectionId = toLong(body.get("connection_id"));
        @SuppressWarnings("unchecked")
        Map<String, Object> sourceTable = body.get("source_table") instanceof Map<?, ?> m
                ? (Map<String, Object>) m
                : null;
        if (sourceTable != null && sourceTable.get("ref_sql") == null && body.get("ref_sql") != null) {
            sourceTable.put("ref_sql", body.get("ref_sql"));
        }
        Map<String, Object> options = new LinkedHashMap<>();
        options.put("in_scope", body.get("in_scope"));
        options.put("refresh_columns", body.get("refresh_columns"));
        return Result.ok(catalogNodeService.createModelFromTable(
                connectionId,
                sourceTable,
                str(body.get("model_item_key")),
                toLong(body.get("base_revision")),
                str(body.get("idempotency_key")),
                options));
    }

    /**
     * 取主连接 id（W2 全量拉取面 / 无连接上下文的**服务间兜底**）。
     *
     * <p><b>契约（§14.5.1 B，行为一字不改）</b>：三级**确定**回退，与
     * {@link IqdAdminService#findPrimaryConnection()} **同构** ——
     * <ol>
     *   <li>① {@code name='default'}（**主连接显式标识**；**不筛 {@code enabled}**）；</li>
     *   <li>② 否则 **id 最小**的 {@code enabled=1}（{@code OrderByIdAsc}，确定性回退）；</li>
     *   <li>③ 否则任意首行（{@code findAll().findFirst()}）；表空 ⇒ {@code null}。</li>
     * </ol>
     *
     * <p>调用方（6 处内部读面，grep 核实）：{@code get-acls} / {@code get-scope-policies} /
     * {@code get-catalog-in-scope} / {@code get-catalog-meta} / {@code get-sql-pairs} /
     * {@code get-knowledge}。**本次仅补契约注释，行为不变**（放开多条 {@code enabled} 后仍
     * 确定：① 优先 ⇒ 不受 {@code enabled} 条数影响）。
     */
    private Long resolvePrimaryConnectionId() {
        return connectionRepository.findByName("default")
                .map(IqdConnection::getId)
                .orElseGet(() -> {
                    List<IqdConnection> enabled = connectionRepository.findByEnabledOrderByIdAsc(1);
                    if (!enabled.isEmpty()) {
                        return enabled.get(0).getId();
                    }
                    return connectionRepository.findAll().stream().findFirst()
                            .map(IqdConnection::getId)
                            .orElse(null);
                });
    }

    /** wire 数值 → Long（null/布尔 → null）。 */
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

    /** wire 数组 → Long 列表（跳过非数值）。 */
    private static List<Long> toLongList(Object value) {
        if (value instanceof List<?> list) {
            List<Long> out = new ArrayList<>();
            for (Object o : list) {
                Long l = toLong(o);
                if (l != null) {
                    out.add(l);
                }
            }
            return out;
        }
        return List.of();
    }

    /** wire 字符串 → snake_case 原值（null → null）。 */
    private static String str(Object value) {
        if (value == null) {
            return null;
        }
        return value instanceof String s ? s : String.valueOf(value);
    }

    /** wire 时间 → Instant（ISO-8601 / instant / local；解析失败回退 now）。 */
    private static Instant parseInstant(Object value) {
        if (value == null) {
            return Instant.now();
        }
        String s = value instanceof String str ? str : String.valueOf(value);
        if (s.isBlank()) {
            return Instant.now();
        }
        try {
            return OffsetDateTime.parse(s).toInstant();
        } catch (Exception ignore) {
            // fall through
        }
        try {
            return Instant.parse(s);
        } catch (Exception ignore) {
            // fall through
        }
        try {
            return LocalDateTime.parse(s).atOffset(ZoneOffset.UTC).toInstant();
        } catch (Exception ignore) {
            return Instant.now();
        }
    }
}
