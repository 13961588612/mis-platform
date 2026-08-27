package com.mis.adminbff.controller;

import com.mis.adminbff.dto.iqd.IqdAclSaveRequest;
import com.mis.adminbff.dto.iqd.IqdAclVO;
import com.mis.adminbff.dto.iqd.IqdAskLogVO;
import com.mis.adminbff.dto.iqd.IqdCatalogItemSaveRequest;
import com.mis.adminbff.dto.iqd.IqdCatalogItemVO;
import com.mis.adminbff.dto.iqd.IqdKnowledgeSaveRequest;
import com.mis.adminbff.dto.iqd.IqdKnowledgeVO;
import com.mis.adminbff.dto.iqd.IqdMaskRuleSaveRequest;
import com.mis.adminbff.dto.iqd.IqdMaskRuleVO;
import com.mis.adminbff.dto.iqd.IqdScopeDimensionVO;
import com.mis.adminbff.dto.iqd.IqdScopePolicySaveRequest;
import com.mis.adminbff.dto.iqd.IqdScopePolicyVO;
import com.mis.adminbff.client.AiPlatformClient;
import com.mis.adminbff.dto.iqd.IqdSqlPairSaveRequest;
import com.mis.adminbff.dto.iqd.IqdSqlPairVO;
import com.mis.adminbff.service.iqd.IqdFacadeService;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 问数管理面代理（W2：清单/范围/ACL/脱敏/维度；W3：审计回查；W4：增强物料；
 * BFF → mis-iqd {@code /api/v1/iqd/**}）。
 *
 * <p>权限码（V73/V74 sys_menu_api 绑定 + 兜底判权）：
 * <ul>
 *   <li>catalog 查询/同步 → {@code iqd:catalog:view}</li>
 *   <li>scope 查看 → {@code iqd:scope:view}；scope 保存/勾选 → {@code iqd:scope:save}</li>
 *   <li>acl 查看 → {@code iqd:acl:view}；acl 保存/删除 → {@code iqd:acl:save}</li>
 *   <li>mask 查看 → {@code iqd:mask:view}；mask 保存/删除 → {@code iqd:mask:save}</li>
 *   <li>dimension 查看 → {@code iqd:dimension:view}；保存/删除 → {@code iqd:dimension:save}</li>
 *   <li>scope/sync → {@code iqd:scope:sync}</li>
 *   <li>traces → {@code iqd:trace:view}（W3）</li>
 *   <li>sql-pairs / knowledge → {@code iqd:enhance:view|save}；enhance/push → {@code iqd:enhance:sync}（W4）</li>
 *   <li>sql-pairs/translate / sql-pairs/trial → {@code iqd:enhance:manage}（v1.10，调 Worker）</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/iqd")
public class IqdAclController {

    private final IqdFacadeService iqdFacadeService;
    private final AiPlatformClient aiPlatformClient;

    public IqdAclController(IqdFacadeService iqdFacadeService, AiPlatformClient aiPlatformClient) {
        this.iqdFacadeService = iqdFacadeService;
        this.aiPlatformClient = aiPlatformClient;
    }

    // ================================================================ 清单

    @GetMapping("/catalog")
    public Result<List<IqdCatalogItemVO>> listCatalog(@RequestParam Long connectionId) {
        return Result.ok(iqdFacadeService.listCatalog(connectionId));
    }

    @PostMapping("/catalog/batch")
    public Result<Map<String, Object>> saveCatalogBatch(
            @RequestParam Long connectionId,
            @RequestBody List<IqdCatalogItemSaveRequest> items) {
        return Result.ok(iqdFacadeService.saveCatalogBatch(connectionId, items));
    }

    @PostMapping("/catalog/in-scope")
    public Result<Map<String, Object>> setCatalogInScope(
            @RequestParam Long connectionId,
            @RequestParam boolean inScope,
            @RequestBody List<String> itemKeys) {
        return Result.ok(iqdFacadeService.setCatalogInScope(connectionId, inScope, itemKeys));
    }

    // ================================================================ 范围策略

    @GetMapping("/scope/policies")
    public Result<List<IqdScopePolicyVO>> listScopePolicies(@RequestParam Long connectionId) {
        return Result.ok(iqdFacadeService.listScopePolicies(connectionId));
    }

    @PostMapping("/scope/policies")
    public Result<Map<String, Object>> saveScopePolicies(
            @RequestParam Long connectionId,
            @RequestBody List<IqdScopePolicySaveRequest> items) {
        return Result.ok(iqdFacadeService.saveScopePolicies(connectionId, items));
    }

    // ================================================================ 表级 ACL

    @GetMapping("/acl")
    public Result<List<IqdAclVO>> listAcls(@RequestParam Long connectionId) {
        return Result.ok(iqdFacadeService.listAcls(connectionId));
    }

    @PostMapping("/acl/batch")
    public Result<Map<String, Object>> saveAcls(
            @RequestParam Long connectionId,
            @RequestBody List<IqdAclSaveRequest> items) {
        return Result.ok(iqdFacadeService.saveAcls(connectionId, items));
    }

    @DeleteMapping("/acl/{id}")
    public Result<Void> deleteAcl(@PathVariable Long id) {
        iqdFacadeService.deleteAcl(id);
        return Result.ok();
    }

    // ================================================================ 脱敏规则

    @GetMapping("/mask/rules")
    public Result<List<IqdMaskRuleVO>> listMaskRules() {
        return Result.ok(iqdFacadeService.listMaskRules());
    }

    @PostMapping("/mask/rules")
    public Result<IqdMaskRuleVO> saveMaskRule(@Valid @RequestBody IqdMaskRuleSaveRequest dto) {
        return Result.ok(iqdFacadeService.saveMaskRule(dto));
    }

    @DeleteMapping("/mask/rules/{id}")
    public Result<Void> deleteMaskRule(@PathVariable Long id) {
        iqdFacadeService.deleteMaskRule(id);
        return Result.ok();
    }

    // ================================================================ 维度注册表

    @GetMapping("/dimensions")
    public Result<List<IqdScopeDimensionVO>> listDimensions() {
        return Result.ok(iqdFacadeService.listDimensions());
    }

    @PostMapping("/dimensions")
    public Result<IqdScopeDimensionVO> saveDimension(@RequestBody Map<String, Object> dto) {
        return Result.ok(iqdFacadeService.saveDimension(dto));
    }

    @DeleteMapping("/dimensions/{id}")
    public Result<Void> deleteDimension(@PathVariable Long id) {
        iqdFacadeService.deleteDimension(id);
        return Result.ok();
    }

    // ================================================================ 字典同步

    @PostMapping("/scope/sync/{dimensionCode}")
    public Result<Map<String, Object>> syncDimension(@PathVariable String dimensionCode) {
        return Result.ok(iqdFacadeService.syncDimension(dimensionCode));
    }

    @GetMapping("/scope/dict-sync-status")
    public Result<List<Map<String, Object>>> listDictSyncStatus() {
        return Result.ok(iqdFacadeService.listDictSyncStatus());
    }

    // ================================================================ 审计回查（W3）

    /**
     * 分页回查问数审计日志（需 iqd:trace:view）。
     */
    @GetMapping("/traces")
    public Result<List<IqdAskLogVO>> listTraces(
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Long userId) {
        return Result.ok(iqdFacadeService.listTraces(limit, status, userId));
    }

    /**
     * 取单条审计日志详情（需 iqd:trace:view）。
     */
    @GetMapping("/traces/{id}")
    public Result<IqdAskLogVO> getTrace(@PathVariable Long id) {
        return Result.ok(iqdFacadeService.getTrace(id));
    }

    // ================================================================ 增强物料（W4）

    /**
     * 查询连接下样本对（需 iqd:enhance:view）。
     */
    @GetMapping("/sql-pairs")
    public Result<List<IqdSqlPairVO>> listSqlPairs(@RequestParam Long connectionId) {
        return Result.ok(iqdFacadeService.listSqlPairs(connectionId));
    }

    /**
     * 保存样本对（需 iqd:enhance:save）；保存后自动触发增强同步（best-effort）。
     */
    @PostMapping("/sql-pairs")
    public Result<IqdSqlPairVO> saveSqlPair(@Valid @RequestBody IqdSqlPairSaveRequest dto,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        return Result.ok(iqdFacadeService.saveSqlPair(dto, authorization, traceId));
    }

    /**
     * 删除样本对（需 iqd:enhance:save）。
     */
    @DeleteMapping("/sql-pairs/{id}")
    public Result<Void> deleteSqlPair(@PathVariable Long id) {
        iqdFacadeService.deleteSqlPair(id);
        return Result.ok();
    }

    /**
     * 查询连接下知识/术语/口径（需 iqd:enhance:view）。
     */
    @GetMapping("/knowledge")
    public Result<List<IqdKnowledgeVO>> listKnowledge(
            @RequestParam Long connectionId,
            @RequestParam(required = false) String kind) {
        return Result.ok(iqdFacadeService.listKnowledge(connectionId, kind));
    }

    /**
     * 保存知识/术语/口径（需 iqd:enhance:save）；保存后自动触发增强同步（best-effort）。
     */
    @PostMapping("/knowledge")
    public Result<IqdKnowledgeVO> saveKnowledge(@Valid @RequestBody IqdKnowledgeSaveRequest dto,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        return Result.ok(iqdFacadeService.saveKnowledge(dto, authorization, traceId));
    }

    /**
     * 删除知识/术语/口径（需 iqd:enhance:save）。
     */
    @DeleteMapping("/knowledge/{id}")
    public Result<Void> deleteKnowledge(@PathVariable Long id) {
        iqdFacadeService.deleteKnowledge(id);
        return Result.ok();
    }

    /**
     * 从 S-07 单向拉入知识（需 iqd:enhance:save）。
     */
    @PostMapping("/knowledge/import-s07")
    public Result<Map<String, Object>> importS07Knowledge(@RequestParam Long connectionId) {
        return Result.ok(iqdFacadeService.importS07Knowledge(connectionId));
    }

    /**
     * 取待推送增强物料（需 iqd:enhance:sync）。
     */
    @PostMapping("/enhance/push")
    public Result<Map<String, Object>> pushEnhancements(@RequestParam Long connectionId) {
        return Result.ok(iqdFacadeService.pushEnhancements(connectionId));
    }

    // ================================================================ 闭环补全（P0-2 / P0-4）

    /**
     * 触发增强同步（需 iqd:enhance:sync）：调 ai-platform Worker 经 SyncCoordinator
     * 合并窗口异步执行 context build + memory index + 回填。默认 wait=false（接受即返回）。
     */
    @PostMapping("/enhance/sync")
    public Result<Map<String, Object>> syncEnhancements(
            @RequestParam Long connectionId,
            @RequestParam(required = false, defaultValue = "false") boolean wait,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.syncEnhancements(connectionId, wait, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "增强同步触发失败: " + ex.getMessage());
        }
    }

    /**
     * 回查最近一次增强同步作业（需 iqd:enhance:view；P0-4 状态条）。
     */
    @GetMapping("/enhance/sync-status")
    public Result<Map<String, Object>> getEnhancementSyncStatus(@RequestParam Long connectionId) {
        try {
            return Result.ok(iqdFacadeService.getEnhancementSyncStatus(connectionId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "同步状态查询失败: " + ex.getMessage());
        }
    }

    // ================================================================ 二期：语义模型编辑（P0-1~P0-12）

    /**
     * 编辑 catalog 节点（写回 MDL 前置；需 iqd:catalog:edit）。
     *
     * <p>乐观并发冲突（mis-iqd 40900）原样透传业务码与 {@code current_edit_revision}（data），
     * 前端据此提示「版本已变更，点重读」；引用阻断（42200）同理透传 dependents。不裸透为 500。
     */
    @PutMapping("/catalog/node")
    public Result<Map<String, Object>> updateCatalogNode(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.updateCatalogNode(body, authorization, traceId));
        } catch (BusinessException ex) {
            Result<Map<String, Object>> r = new Result<>();
            r.setCode(ex.getCode());
            r.setMessage(ex.getMessage());
            r.setData(ex.getData() instanceof Map ? (Map<String, Object>) ex.getData() : null);
            return r;
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "catalog 节点编辑失败: " + ex.getMessage());
        }
    }

    /**
     * 取连接级编辑同步状态（需 iqd:catalog:edit；前端 CatalogSyncStatusBar 轮询）。
     */
    @GetMapping("/catalog/sync-status")
    public Result<Map<String, Object>> getCatalogSyncStatus(@RequestParam Long connectionId) {
        try {
            return Result.ok(iqdFacadeService.getCatalogSyncStatus(connectionId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "同步状态查询失败: " + ex.getMessage());
        }
    }

    /**
     * 触发对账（需 iqd:catalog:edit）：清空外部漂移并重按 model 重建。
     */
    @PostMapping("/catalog/reconcile")
    public Result<Map<String, Object>> reconcileCatalog(@RequestParam Long connectionId) {
        try {
            return Result.ok(iqdFacadeService.reconcileCatalog(connectionId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "对账触发失败: " + ex.getMessage());
        }
    }

    // ================================================================ 运维自愈三按钮（需 iqd:selfheal:exec）

    /**
     * 运维自愈-强制重建（action=force-rebuild）：调 ai-platform 经 context build(force) + memory index。
     */
    @PostMapping("/self-heal/force-rebuild")
    public Result<Map<String, Object>> selfHealForceRebuild(
            @RequestParam Long connectionId,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.selfHeal("force-rebuild", connectionId, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "强制重建触发失败: " + ex.getMessage());
        }
    }

    /**
     * 运维自愈-重新索引（action=re-index）：调 ai-platform 经 memory reset + memory index。
     */
    @PostMapping("/self-heal/re-index")
    public Result<Map<String, Object>> selfHealReindex(
            @RequestParam Long connectionId,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.selfHeal("re-index", connectionId, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "重新索引触发失败: " + ex.getMessage());
        }
    }

    /**
     * 运维自愈-模型校验（action=validate）：调 ai-platform 经 context validate。
     */
    @PostMapping("/self-heal/validate")
    public Result<Map<String, Object>> selfHealValidate(
            @RequestParam Long connectionId,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.selfHeal("validate", connectionId, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "模型校验触发失败: " + ex.getMessage());
        }
    }

    // ================================================================ 方案 A 多连接：MCP 进程管理（需 iqd:mcp:manage）

    /**
     * MCP 启动（action=start）：调 ai-platform 经就绪门禁 + 凭证 env 注入拉起本连接进程。
     */
    @PostMapping("/mcp/start")
    public Result<Map<String, Object>> mcpStart(
            @RequestParam Long connectionId,
            @RequestParam(required = false, defaultValue = "true") boolean wait,
            @RequestParam(required = false, defaultValue = "true") boolean retainDir,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.mcpManage("start", connectionId, wait, retainDir, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "MCP 启动失败: " + ex.getMessage());
        }
    }

    /**
     * MCP 停止（action=stop）：调 ai-platform 停止本连接进程并回收端口（默认保留目录）。
     */
    @PostMapping("/mcp/stop")
    public Result<Map<String, Object>> mcpStop(
            @RequestParam Long connectionId,
            @RequestParam(required = false, defaultValue = "true") boolean wait,
            @RequestParam(required = false, defaultValue = "true") boolean retainDir,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.mcpManage("stop", connectionId, wait, retainDir, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "MCP 停止失败: " + ex.getMessage());
        }
    }

    /**
     * MCP 重启（action=restart）：调 ai-platform 复用端口并重新注入凭证 env。
     */
    @PostMapping("/mcp/restart")
    public Result<Map<String, Object>> mcpRestart(
            @RequestParam Long connectionId,
            @RequestParam(required = false, defaultValue = "true") boolean wait,
            @RequestParam(required = false, defaultValue = "true") boolean retainDir,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.mcpManage("restart", connectionId, wait, retainDir, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "MCP 重启失败: " + ex.getMessage());
        }
    }

    /**
     * 取连接级 MCP 进程状态（需 iqd:mcp:manage）。
     */
    @GetMapping("/mcp/status")
    public Result<Map<String, Object>> mcpStatus(
            @RequestParam Long connectionId,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.mcpStatus(connectionId, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "MCP 状态查询失败: " + ex.getMessage());
        }
    }

    /**
     * 列出全部连接 MCP 进程状态（需 iqd:mcp:manage）。
     */
    @GetMapping("/mcp/list")
    public Result<List<Map<String, Object>>> mcpList(
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdFacadeService.mcpList(authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "MCP 列表查询失败: " + ex.getMessage());
        }
    }

    // ================================================================ 方言转化 + 试运行（v1.10）

    /**
     * 样本对方言转化（v1.10 / §4.2.3；需 iqd:enhance:manage）。
     *
     * <p>组装 {@code {db_type, native_sql}} 经 AiPlatformClient 调 Worker
     * {@code /iqd/sql-pairs/translate}，返回 {@code {wren_sql, warnings}}。
     * 前端不直连 WrenAI（对齐 NFR-1 红线）。
     */
    @PostMapping("/sql-pairs/translate")
    public Result<Map<String, Object>> translateSqlPair(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(aiPlatformClient.translateSqlPair(body, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "样本对翻译失败: " + ex.getMessage());
        }
    }

    /**
     * 样本对试运行（v1.10 / §4.2.3；需 iqd:enhance:manage）。
     *
     * <p>组装 {@code {wren_sql}} 经 AiPlatformClient 调 Worker
     * {@code /iqd/sql-pairs/trial}，返回 {@code {columns, rows, error, duration_ms}}
     * （经 MCP run_sql 在 WrenAI 引擎侧执行转化后的 wren_sql）。
     */
    @PostMapping("/sql-pairs/trial")
    public Result<Map<String, Object>> trialSqlPair(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(aiPlatformClient.trialSqlPair(body, authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        } catch (Exception ex) {
            return Result.fail(ResultCode.INTERNAL_ERROR.getCode(), "样本对试运行失败: " + ex.getMessage());
        }
    }
}
