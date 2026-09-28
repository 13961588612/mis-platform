package com.mis.adminbff.service.iqd;

import com.mis.adminbff.client.AiPlatformClient;
import com.mis.adminbff.client.IqdClient;
import com.mis.adminbff.config.IqdProperties;
import com.mis.adminbff.dto.iqd.IqdAclSaveRequest;
import com.mis.adminbff.dto.iqd.IqdAclVO;
import com.mis.adminbff.dto.iqd.IqdAskLogVO;
import com.mis.adminbff.dto.iqd.IqdCatalogItemSaveRequest;
import com.mis.adminbff.dto.iqd.IqdCatalogItemVO;
import com.mis.adminbff.dto.iqd.IqdConnectionConfigVO;
import com.mis.adminbff.dto.iqd.IqdConnectionSaveRequest;
import com.mis.adminbff.dto.iqd.IqdConnectionTestVO;
import com.mis.adminbff.dto.iqd.IqdKnowledgeSaveRequest;
import com.mis.adminbff.dto.iqd.IqdKnowledgeVO;
import com.mis.adminbff.dto.iqd.IqdMaskRuleSaveRequest;
import com.mis.adminbff.dto.iqd.IqdMaskRuleVO;
import com.mis.adminbff.dto.iqd.IqdScopeDimensionVO;
import com.mis.adminbff.dto.iqd.IqdScopePolicySaveRequest;
import com.mis.adminbff.dto.iqd.IqdScopePolicyVO;
import com.mis.adminbff.dto.iqd.IqdSqlPairSaveRequest;
import com.mis.adminbff.dto.iqd.IqdSqlPairVO;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 问数管理面门面（BFF 代理 mis-iqd 连接配置 + W2 清单/范围/ACL/脱敏/维度 CRUD）。
 *
 * <p>权限双闸门：
 * <ol>
 *   <li>主路径：{@code ApiPermissionInterceptor} + sys_api 注册表（V72/V73 绑定权限码）</li>
 *   <li>兜底：注册表未生效空窗期读 {@link UserPermissionLoader#load}（与 KB 同款口径）</li>
 * </ol>
 */
@Service
public class IqdFacadeService {

    private static final Logger log = LoggerFactory.getLogger(IqdFacadeService.class);

    private final IqdClient iqdClient;
    private final IqdProperties properties;
    private final UserPermissionLoader userPermissionLoader;
    private final AiPlatformClient aiPlatformClient;

    public IqdFacadeService(
            IqdClient iqdClient,
            IqdProperties properties,
            UserPermissionLoader userPermissionLoader,
            AiPlatformClient aiPlatformClient) {
        this.iqdClient = iqdClient;
        this.properties = properties;
        this.userPermissionLoader = userPermissionLoader;
        this.aiPlatformClient = aiPlatformClient;
    }

    // ================================================================ 连接配置

    /**
     * 取连接配置（需 iqd:config:view）。
     */
    public IqdConnectionConfigVO getConfig() {
        requirePermission(properties.getConfigViewPermission());
        return iqdClient.getConfig();
    }

    /**
     * 保存连接配置（需 iqd:config:save）。
     */
    public IqdConnectionConfigVO saveConfig(IqdConnectionSaveRequest dto) {
        requirePermission(properties.getConfigSavePermission());
        return iqdClient.saveConfig(dto);
    }

    /**
     * 连通性自检（需 iqd:config:test）。
     */
    public IqdConnectionTestVO testConfig() {
        requirePermission(properties.getConfigTestPermission());
        return iqdClient.testConfig();
    }

    // ================================================================ W2 管理面

    /**
     * 查询清单（需 iqd:catalog:view）。
     */
    public List<IqdCatalogItemVO> listCatalog(Long connectionId) {
        requirePermission(properties.getCatalogPermission());
        return iqdClient.listCatalog(connectionId);
    }

    /**
     * 批量 upsert 清单（需 iqd:catalog:view）。
     */
    public Map<String, Object> saveCatalogBatch(Long connectionId, List<IqdCatalogItemSaveRequest> items) {
        requirePermission(properties.getCatalogPermission());
        return iqdClient.saveCatalogBatch(connectionId, items);
    }

    /**
     * 勾选纳入问数范围（需 iqd:scope:save）。
     */
    public Map<String, Object> setCatalogInScope(Long connectionId, boolean inScope, List<String> itemKeys) {
        requirePermission(properties.getScopeSavePermission());
        return iqdClient.setCatalogInScope(connectionId, inScope, itemKeys);
    }

    /**
     * 查询范围策略（需 iqd:scope:view）。
     */
    public List<IqdScopePolicyVO> listScopePolicies(Long connectionId) {
        requirePermission(properties.getScopeViewPermission());
        return iqdClient.listScopePolicies(connectionId);
    }

    /**
     * 批量保存范围策略（需 iqd:scope:save）。
     */
    public Map<String, Object> saveScopePolicies(Long connectionId, List<IqdScopePolicySaveRequest> items) {
        requirePermission(properties.getScopeSavePermission());
        return iqdClient.saveScopePolicies(connectionId, items);
    }

    /**
     * 查询表级 ACL（需 iqd:acl:view）。
     */
    public List<IqdAclVO> listAcls(Long connectionId) {
        requirePermission(properties.getAclViewPermission());
        return iqdClient.listAcls(connectionId);
    }

    /**
     * 批量保存表级 ACL（需 iqd:acl:save）。
     */
    public Map<String, Object> saveAcls(Long connectionId, List<IqdAclSaveRequest> items) {
        requirePermission(properties.getAclSavePermission());
        return iqdClient.saveAcls(connectionId, items);
    }

    /**
     * 删除单条 ACL（需 iqd:acl:save）。
     */
    public void deleteAcl(Long id) {
        requirePermission(properties.getAclSavePermission());
        iqdClient.deleteAcl(id);
    }

    /**
     * 查询脱敏规则（需 iqd:mask:view）。
     */
    public List<IqdMaskRuleVO> listMaskRules() {
        requirePermission(properties.getMaskViewPermission());
        return iqdClient.listMaskRules();
    }

    /**
     * 保存脱敏规则（需 iqd:mask:save）。
     */
    public IqdMaskRuleVO saveMaskRule(IqdMaskRuleSaveRequest dto) {
        requirePermission(properties.getMaskSavePermission());
        return iqdClient.saveMaskRule(dto);
    }

    /**
     * 删除脱敏规则（需 iqd:mask:save）。
     */
    public void deleteMaskRule(Long id) {
        requirePermission(properties.getMaskSavePermission());
        iqdClient.deleteMaskRule(id);
    }

    /**
     * 查询维度注册表（需 iqd:dimension:view）。
     */
    public List<IqdScopeDimensionVO> listDimensions() {
        requirePermission(properties.getDimensionViewPermission());
        return iqdClient.listDimensions();
    }

    /**
     * 保存维度注册表条目（需 iqd:dimension:save）。
     */
    public IqdScopeDimensionVO saveDimension(Map<String, Object> dto) {
        requirePermission(properties.getDimensionSavePermission());
        return iqdClient.saveDimension(dto);
    }

    /**
     * 删除维度注册表条目（需 iqd:dimension:save）。
     */
    public void deleteDimension(Long id) {
        requirePermission(properties.getDimensionSavePermission());
        iqdClient.deleteDimension(id);
    }

    /**
     * 触发单维度字典同步（需 iqd:scope:sync）。
     */
    public Map<String, Object> syncDimension(String dimensionCode) {
        requirePermission(properties.getSyncPermission());
        return iqdClient.syncDimension(dimensionCode);
    }

    /**
     * 拉取字典同步状态（需 iqd:scope:view）。
     */
    public List<Map<String, Object>> listDictSyncStatus() {
        requirePermission(properties.getScopeViewPermission());
        return iqdClient.listDictSyncStatus();
    }

    // ================================================================ W3 审计回查

    /**
     * 分页回查问数审计日志（需 iqd:trace:view）。
     */
    public List<IqdAskLogVO> listTraces(Integer limit, String status, Long userId) {
        requirePermission(properties.getTraceViewPermission());
        return iqdClient.listTraces(limit, status, userId);
    }

    /**
     * 取单条审计日志详情（需 iqd:trace:view）。
     */
    public IqdAskLogVO getTrace(Long id) {
        requirePermission(properties.getTraceViewPermission());
        return iqdClient.getTrace(id);
    }

    // ================================================================ W4 增强物料

    /**
     * 查询连接下样本对（需 iqd:enhance:view）。
     */
    public List<IqdSqlPairVO> listSqlPairs(Long connectionId) {
        requirePermission(properties.getEnhanceViewPermission());
        return iqdClient.listSqlPairs(connectionId);
    }

    /**
     * 保存样本对（需 iqd:enhance:save）；保存后自动触发增强同步（best-effort）。
     */
    public IqdSqlPairVO saveSqlPair(IqdSqlPairSaveRequest dto, String authorization, String traceId) {
        requirePermission(properties.getEnhanceSavePermission());
        IqdSqlPairVO saved = iqdClient.saveSqlPair(dto);
        triggerSyncBestEffort(dto.connectionId(), authorization, traceId);
        return saved;
    }

    /**
     * 删除样本对（需 iqd:enhance:save）。
     */
    public void deleteSqlPair(Long id) {
        requirePermission(properties.getEnhanceSavePermission());
        iqdClient.deleteSqlPair(id);
    }

    /**
     * 查询连接下知识/术语/口径（需 iqd:enhance:view）。
     */
    public List<IqdKnowledgeVO> listKnowledge(Long connectionId, String kind) {
        requirePermission(properties.getEnhanceViewPermission());
        return iqdClient.listKnowledge(connectionId, kind);
    }

    /**
     * 保存知识/术语/口径（需 iqd:enhance:save）；保存后自动触发增强同步（best-effort）。
     */
    public IqdKnowledgeVO saveKnowledge(IqdKnowledgeSaveRequest dto, String authorization, String traceId) {
        requirePermission(properties.getEnhanceSavePermission());
        IqdKnowledgeVO saved = iqdClient.saveKnowledge(dto);
        triggerSyncBestEffort(dto.connectionId(), authorization, traceId);
        return saved;
    }

    /**
     * 按 id 更新知识/术语/口径（需 iqd:enhance:save）；更新后自动触发增强同步（best-effort）。
     */
    public IqdKnowledgeVO updateKnowledge(
            Long id, IqdKnowledgeSaveRequest dto, String authorization, String traceId) {
        requirePermission(properties.getEnhanceSavePermission());
        IqdKnowledgeVO saved = iqdClient.updateKnowledge(id, dto);
        if (dto.connectionId() != null) {
            triggerSyncBestEffort(dto.connectionId(), authorization, traceId);
        }
        return saved;
    }

    /**
     * 删除知识/术语/口径（需 iqd:enhance:save）。
     */
    public void deleteKnowledge(Long id) {
        requirePermission(properties.getEnhanceSavePermission());
        iqdClient.deleteKnowledge(id);
    }

    /**
     * 从 S-07 单向拉入知识（需 iqd:enhance:save）。
     */
    public Map<String, Object> importS07Knowledge(Long connectionId) {
        requirePermission(properties.getEnhanceSavePermission());
        return iqdClient.importS07Knowledge(connectionId);
    }

    /**
     * 取待推送增强物料（需 iqd:enhance:sync）。
     */
    public Map<String, Object> pushEnhancements(Long connectionId) {
        requirePermission(properties.getEnhanceSyncPermission());
        return iqdClient.pushEnhancements(connectionId);
    }

    /**
     * 触发增强同步（需 {@code iqd:enhance:sync}）：调平台 Worker
     * {@code /api/v1/iqd/enhance/sync}。
     *
     * @param connectionId 问数连接 id
     * @param wait         是否阻塞至完成（手动/重试=true；自动=false）
     * @param scope        {@code materials}（一期物料）| {@code model}（二期模型写回）；
     *                     非法值回落 materials
     * @param authorization BFF 收到的原始 MIS JWT（透传平台 RS256）
     * @param traceId      全链路追踪 ID
     * @return 平台响应 data（SyncResult：build/index 状态 + mdl_hash + 回填计数）
     */
    public Map<String, Object> syncEnhancements(
            Long connectionId, Boolean wait, String scope, String authorization, String traceId) {
        requirePermission(properties.getEnhanceSyncPermission());
        String effectiveScope =
                "model".equalsIgnoreCase(scope == null ? "" : scope.trim()) ? "model" : "materials";
        return aiPlatformClient.syncEnhancements(
                connectionId, wait, effectiveScope, authorization, traceId);
    }

    /**
     * 兼容旧调用：缺省 scope=materials（增强页「立即同步」）。
     */
    public Map<String, Object> syncEnhancements(
            Long connectionId, Boolean wait, String authorization, String traceId) {
        return syncEnhancements(connectionId, wait, "materials", authorization, traceId);
    }

    /**
     * 触发运维自愈动作（需 iqd:selfheal:exec）：按 action 分发到 ai-platform 对应端点。
     *
     * <p>action ∈ {force-rebuild, re-index, validate}；wait 固定 true（阻塞至完整
     * SyncResult 返回，与编辑写回 best-effort 区分）。权限闸门与兜底判权同其它 IQD 端点。
     *
     * @param action       自愈动作（force-rebuild / re-index / validate）
     * @param connectionId 问数连接 id
     * @param authorization BFF 收到的原始 MIS JWT（透传平台 RS256）
     * @param traceId      全链路追踪 ID
     * @return 平台响应 data（SyncResult：build/index 状态 + mdl_hash + 回填计数）
     */
    public Map<String, Object> selfHeal(
            String action, Long connectionId, String authorization, String traceId) {
        requirePermission(properties.getSelfHealPermission());
        return switch (action) {
            case "force-rebuild" -> aiPlatformClient.selfHealForceRebuild(connectionId, authorization, traceId);
            case "re-index" -> aiPlatformClient.selfHealReindex(connectionId, authorization, traceId);
            case "validate" -> aiPlatformClient.selfHealValidate(connectionId, authorization, traceId);
            default -> throw new BusinessException(ResultCode.VALIDATION_ERROR, "未知自愈动作: " + action);
        };
    }

    /**
     * 方案 A 多连接：MCP 进程管理（需 iqd:mcp:manage）：按 action 分发到 ai-platform。
     *
     * <p>action ∈ {start, stop, restart}；平台执行就绪门禁 + 凭证 env 注入 + 进程
     * 启停/重启，并回写 mis-iqd {@code mcp_status} / {@code mcp_port}（可观测 REQ-P1-2）。
     *
     * @param action       管理动作（start / stop / restart）
     * @param connectionId 问数连接 id
     * @param wait         是否阻塞至完成（保留参数，启动异步）
     * @param retainDir    stop 时是否保留 project 目录
     * @param authorization BFF 收到的原始 MIS JWT（透传平台 RS256）
     * @param traceId      全链路追踪 ID
     * @return 平台响应 data（{connection_id, mcp_status, host, port}）
     */
    public Map<String, Object> mcpManage(
            String action, Long connectionId, Boolean wait, Boolean retainDir,
            String authorization, String traceId) {
        requirePermission(properties.getMcpManagerPermission());
        return switch (action) {
            case "start" -> aiPlatformClient.mcpStart(connectionId, wait, retainDir, authorization, traceId);
            case "stop" -> aiPlatformClient.mcpStop(connectionId, wait, retainDir, authorization, traceId);
            case "restart" -> aiPlatformClient.mcpRestart(connectionId, wait, retainDir, authorization, traceId);
            default -> throw new BusinessException(ResultCode.VALIDATION_ERROR, "未知 MCP 管理动作: " + action);
        };
    }

    /**
     * 取连接级 MCP 进程状态（需 iqd:mcp:manage）。
     *
     * @param connectionId 问数连接 id
     * @return 平台响应 data（单连接状态 dict）
     */
    public Map<String, Object> mcpStatus(Long connectionId, String authorization, String traceId) {
        requirePermission(properties.getMcpManagerPermission());
        return aiPlatformClient.mcpStatus(connectionId, authorization, traceId);
    }

    /**
     * 列出全部连接 MCP 进程状态（需 iqd:mcp:manage）。
     *
     * @return 平台响应 data（list[dict]）
     */
    public List<Map<String, Object>> mcpList(String authorization, String traceId) {
        requirePermission(properties.getMcpManagerPermission());
        return aiPlatformClient.mcpList(authorization, traceId);
    }

    /**
     * 启用/创建连接项目（用户自助「启用/创建项目」按钮；需 iqd:mcp:manage）。
     *
     * <p>业务主路径：admin 保存连接（含凭证）后点击「启用/创建项目」→ 调 ai-platform
     * {@code /api/v1/iqd/mcp/ensure}。平台据 {@code WREN_AGENT_ENDPOINT} 是否配置分流：
     * 远程模式经 WrenMcpAgentClient.ensure 推凭证 + 拉起 wren 机进程（v0.2 跨机器落地，
     * 决策 ①⑧），本地模式退回既有 Plan A 子进程模型。无论哪条路径，平台均回写
     * mis-iqd {@code mcp_host} / {@code agent_handle} / {@code mcp_status}（可观测 + 前端定位）。
     *
     * @param connectionId 问数连接 id
     * @param authorization BFF 收到的原始 MIS JWT（透传平台 RS256 校验）
     * @param traceId      全链路追踪 ID
     * @return 平台响应 data（{connection_id, mcp_status, mcp_host, agent_handle, remote}）
     */
    public Map<String, Object> enableProject(Long connectionId, String authorization, String traceId) {
        requirePermission(properties.getMcpManagerPermission());
        return aiPlatformClient.mcpEnsure(connectionId, authorization, traceId);
    }

    /**
     * 回查最近一次增强同步作业（需 iqd:enhance:view；P0-4 状态条）。
     */
    public Map<String, Object> getEnhancementSyncStatus(Long connectionId) {
        requirePermission(properties.getEnhanceViewPermission());
        return iqdClient.getEnhancementSyncStatus(connectionId);
    }

    // ================================================================ 二期：语义模型编辑（P0-1~P0-12）

    /**
     * 编辑 catalog 节点（写回 MDL 前置；需 iqd:catalog:edit）。
     *
     * <p>① 权限闸门；② 调 mis-iqd {@code updateCatalogNode}（乐观并发 409 / 幂等 /
     * 引用校验 422 由平台返回，BFF 原样透传业务码与 data）；③ 成功后 best-effort 触发
     * model 范围同步（重新派生完整 MDL 并写回 WrenAI）。
     *
     * <p><b>连接 id 取哪个</b>：以 **query 参数 `connectionId`** 为准（与同控制器的
     * {@code /catalog/sync-status}、{@code /catalog/reconcile} 同口径，也是前端
     * {@code updateIqdCatalogNode} 实际发的位置）；仅当 query 缺省时回退读 body 的
     * {@code connection_id}（兼容旧调用方）。两者都没有 → 明确 40001，**不再把 null
     * 当查询参数转发下去**（否则下游收到 {@code ?connectionId=}，空串转 Long 得 null，
     * 最终以 {@code MissingServletRequestParameterException → 50000「系统错误」} 暴露，
     * 排查成本极高）。
     *
     * @param connectionId query 参数 connectionId（可空：空则回退 body）
     * @param dto     请求体 {item_key, kind, patch, base_revision, idempotency_key}（可选 connection_id）
     * @param authorization BFF 收到的原始 MIS JWT（透传给平台 RS256）
     * @param traceId 全链路追踪 ID
     * @return mis-iqd 返回 {edit_revision, edit_status, wren_ref_id}
     */
    public Map<String, Object> updateCatalogNode(
            Long connectionId, Map<String, Object> dto, String authorization, String traceId) {
        requirePermission(properties.getCatalogEditPermission());
        Long cid = connectionId != null ? connectionId : toLong(dto.get("connection_id"));
        if (cid == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "connectionId 不能为空");
        }
        Map<String, Object> result = iqdClient.updateCatalogNode(cid, dto);
        // 编辑成功后自动触发 model 范围同步（best-effort，接受即返回，不阻断写回主流程）
        triggerSyncBestEffort(cid, authorization, traceId, "model");
        return result;
    }

    /**
     * 取连接级编辑同步状态（需 iqd:catalog:edit；前端 CatalogSyncStatusBar 轮询）。
     */
    public Map<String, Object> getCatalogSyncStatus(Long connectionId) {
        requirePermission(properties.getCatalogEditPermission());
        return iqdClient.getCatalogSyncStatus(connectionId);
    }

    /**
     * 触发对账（需 iqd:catalog:edit）：清空外部漂移标记并 best-effort 触发 model 重建。
     */
    public Map<String, Object> reconcileCatalog(Long connectionId) {
        requirePermission(properties.getCatalogEditPermission());
        Map<String, Object> result = iqdClient.reconcileCatalog(connectionId);
        // 重新按 model 范围派发构建（best-effort，无用户上下文也可触发）
        triggerSyncBestEffort(connectionId, null, null, "model");
        return result;
    }

    /** wire 数值 → Long（null/布尔 → null）。 */
    private static Long toLong(Object value) {
        if (value == null || value instanceof Boolean) {
            return null;
        }
        if (value instanceof Number n) {
            return n.longValue();
        }
        try {
            return Long.parseLong(String.valueOf(value).trim());
        } catch (NumberFormatException exc) {
            return null;
        }
    }

    /**
     * 保存后自动触发增强同步（best-effort，wait=false 接受即返回）。
     *
     * <p>失败仅告警，绝不阻断保存主流程（运维可手动重试 /enhance/sync）。无授权头或连接
     * 缺失时不触发（避免无意义调用）。
     */
    private void triggerSyncBestEffort(Long connectionId, String authorization, String traceId) {
        triggerSyncBestEffort(connectionId, authorization, traceId, "materials");
    }

    /**
     * 保存后自动触发增强同步（best-effort，wait=false 接受即返回）。
     *
     * @param scope 构建范围：materials(一期物料) | model(二期模型写回)
     */
    private void triggerSyncBestEffort(
            Long connectionId, String authorization, String traceId, String scope) {
        if (connectionId == null || authorization == null || authorization.isBlank()) {
            return;
        }
        try {
            aiPlatformClient.syncEnhancements(connectionId, Boolean.FALSE, scope, authorization, traceId);
        } catch (Exception exc) {
            log.warn("IQD auto sync after save skipped connectionId={} scope={} error={}",
                    connectionId, scope, exc.getMessage());
        }
    }

    /** 兜底判权：注册表未生效空窗期（与 KB {@code requirePermission} 同款口径）。 */
    private void requirePermission(String permissionCode) {
        LoginUser user = RequestContext.requireLoginUser();
        if (user.getUserId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        Set<String> permissions = userPermissionLoader.load(user);
        if (permissions == null || !permissions.contains(permissionCode)) {
            throw new BusinessException(ResultCode.FORBIDDEN);
        }
    }
}
