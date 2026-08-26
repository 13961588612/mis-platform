package com.mis.iqd.api.controller;

import com.mis.common.core.result.Result;
import com.mis.iqd.api.dto.IqdAclSaveRequest;
import com.mis.iqd.api.dto.IqdAclVO;
import com.mis.iqd.api.dto.IqdAskLogVO;
import com.mis.iqd.api.dto.IqdCatalogItemSaveRequest;
import com.mis.iqd.api.dto.IqdCatalogItemVO;
import com.mis.iqd.api.dto.IqdConnectionSaveRequest;
import com.mis.iqd.api.dto.IqdConnectionVO;
import com.mis.iqd.api.dto.IqdKnowledgeSaveRequest;
import com.mis.iqd.api.dto.IqdKnowledgeVO;
import com.mis.iqd.api.dto.IqdMaskRuleSaveRequest;
import com.mis.iqd.api.dto.IqdMaskRuleVO;
import com.mis.iqd.api.dto.IqdScopeDimensionVO;
import com.mis.iqd.api.dto.IqdScopePolicySaveRequest;
import com.mis.iqd.api.dto.IqdScopePolicyVO;
import com.mis.iqd.api.dto.IqdSqlPairSaveRequest;
import com.mis.iqd.api.dto.IqdSqlPairVO;
import com.mis.iqd.api.dto.IqdSyncJobVO;
import com.mis.iqd.domain.service.IqdAdminService;
import com.mis.iqd.domain.service.IqdScopeSyncJobService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 问数管理面（B2：连接配置 CRUD + 连通自检；B3：清单/范围/ACL/脱敏规则 CRUD）。
 *
 * <p>路径前缀 {@code /api/v1/iqd/**}，对外由 BFF 代理调用（权限码 {@code iqd:*}）。
 */
@RestController
@RequestMapping("/api/v1/iqd")
public class IqdController {

    private final IqdAdminService adminService;
    private final IqdScopeSyncJobService scopeSyncJobService;

    public IqdController(IqdAdminService adminService, IqdScopeSyncJobService scopeSyncJobService) {
        this.adminService = adminService;
        this.scopeSyncJobService = scopeSyncJobService;
    }

    /**
     * 管理面健康探测。
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
     * 取连接配置（密钥恒回 ******）。
     */
    @GetMapping("/config")
    public Result<IqdConnectionVO> getConfig() {
        return Result.ok(adminService.getConnection());
    }

    /**
     * 保存连接配置（upsert；密钥提交非空才更新）。
     */
    @PutMapping("/config")
    public Result<IqdConnectionVO> saveConfig(@Valid @RequestBody IqdConnectionSaveRequest dto) {
        return Result.ok(adminService.saveConnection(dto));
    }

    /**
     * 连通性自检：GET {baseUrl}/health 探活并更新 status。
     */
    @PostMapping("/config/test")
    public Result<Map<String, Object>> testConfig() {
        return Result.ok(adminService.testConnection());
    }

    // ================================================================ 清单（catalog）

    /**
     * 查询连接下的全部清单项（左树 + 右栏分 model/relationship/metric/dimension 展示）。
     */
    @GetMapping("/catalog")
    public Result<List<IqdCatalogItemVO>> listCatalog(@RequestParam Long connectionId) {
        return Result.ok(adminService.listCatalog(connectionId));
    }

    /**
     * 批量 upsert 清单项（MDL 同步快照落库）。
     */
    @PostMapping("/catalog/batch")
    public Result<Map<String, Object>> saveCatalogBatch(
            @RequestParam Long connectionId,
            @RequestBody List<IqdCatalogItemSaveRequest> items) {
        int count = adminService.saveCatalogBatch(connectionId, items);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("count", count);
        return Result.ok(body);
    }

    /**
     * 从 WrenAI MDL 快照同步清单（get_mdl/list_models/describe_model 产物）。
     */
    @PostMapping("/catalog/sync-mdl")
    public Result<Map<String, Object>> syncCatalogFromMdl(
            @RequestParam Long connectionId,
            @RequestParam(required = false, defaultValue = "pg_main") String datasource,
            @RequestParam(required = false, defaultValue = "public") String schema,
            @RequestBody Map<String, Object> body) {
        Object mdl = body == null ? null : body.get("mdl");
        String mdlJson = mdl == null ? "" : String.valueOf(mdl);
        int count = adminService.syncCatalogFromMdl(connectionId, mdlJson, datasource, schema);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("count", count);
        return Result.ok(result);
    }

    /**
     * 勾选「纳入问数范围」（与 iqd_scope_policy global 行一致更新）。
     */
    @PostMapping("/catalog/in-scope")
    public Result<Map<String, Object>> setCatalogInScope(
            @RequestParam Long connectionId,
            @RequestParam boolean inScope,
            @RequestBody List<String> itemKeys) {
        int count = adminService.setCatalogInScope(connectionId, itemKeys, inScope);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("count", count);
        return Result.ok(body);
    }

    // ================================================================ 范围策略

    /**
     * 查询连接下的范围策略。
     */
    @GetMapping("/scope/policies")
    public Result<List<IqdScopePolicyVO>> listScopePolicies(@RequestParam Long connectionId) {
        return Result.ok(adminService.listScopePolicies(connectionId));
    }

    /**
     * 批量提交范围策略（按 UK 幂等 upsert）。
     */
    @PostMapping("/scope/policies")
    public Result<Map<String, Object>> saveScopePolicies(
            @RequestParam Long connectionId,
            @RequestBody List<IqdScopePolicySaveRequest> items) {
        int count = adminService.saveScopePolicies(connectionId, items);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("count", count);
        return Result.ok(body);
    }

    // ================================================================ 表级 ACL

    /**
     * 查询连接下的全部表级 ACL。
     */
    @GetMapping("/acl")
    public Result<List<IqdAclVO>> listAcls(@RequestParam Long connectionId) {
        return Result.ok(adminService.listAcls(connectionId));
    }

    /**
     * 批量提交表级 ACL（action=ask/manage）。
     */
    @PostMapping("/acl/batch")
    public Result<Map<String, Object>> saveAcls(
            @RequestParam Long connectionId,
            @RequestBody List<IqdAclSaveRequest> items) {
        int count = adminService.saveAcls(connectionId, items);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("count", count);
        return Result.ok(body);
    }

    /**
     * 删除单条 ACL。
     */
    @DeleteMapping("/acl/{id}")
    public Result<Void> deleteAcl(@PathVariable Long id) {
        adminService.deleteAcl(id);
        return Result.ok();
    }

    // ================================================================ 脱敏规则

    /**
     * 查询全部脱敏规则。
     */
    @GetMapping("/mask/rules")
    public Result<List<IqdMaskRuleVO>> listMaskRules() {
        return Result.ok(adminService.listMaskRules());
    }

    /**
     * 保存脱敏规则（按 name 幂等 upsert）。
     */
    @PostMapping("/mask/rules")
    public Result<IqdMaskRuleVO> saveMaskRule(@Valid @RequestBody IqdMaskRuleSaveRequest dto) {
        return Result.ok(adminService.saveMaskRule(dto));
    }

    /**
     * 删除脱敏规则。
     */
    @DeleteMapping("/mask/rules/{id}")
    public Result<Void> deleteMaskRule(@PathVariable Long id) {
        adminService.deleteMaskRule(id);
        return Result.ok();
    }

    // ================================================================ 维度注册表

    /**
     * 查询维度注册表（W2：维度下拉数据源）。
     */
    @GetMapping("/dimensions")
    public Result<List<IqdScopeDimensionVO>> listDimensions() {
        return Result.ok(adminService.listDimensions());
    }

    /**
     * 保存维度注册表条目（W2：crud_dimension）。
     */
    @PostMapping("/dimensions")
    public Result<IqdScopeDimensionVO> saveDimension(@RequestBody Map<String, Object> dto) {
        return Result.ok(adminService.saveDimension(dto));
    }

    /**
     * 删除维度注册表条目（W2：enabled 开关替代硬删；硬删仅限未引用场景）。
     */
    @DeleteMapping("/dimensions/{id}")
    public Result<Void> deleteDimension(@PathVariable Long id) {
        adminService.deleteDimension(id);
        return Result.ok();
    }

    // ================================================================ 字典同步

    /**
     * 触发单维度字典同步（W2：手动触发，重跑幂等）。
     */
    @PostMapping("/scope/sync/{dimensionCode}")
    public Result<Map<String, Object>> syncDimension(@PathVariable String dimensionCode) {
        return Result.ok(scopeSyncJobService.syncForDimension(dimensionCode));
    }

    /**
     * 拉取字典同步状态（W2：每维度一行）。
     */
    @GetMapping("/scope/dict-sync-status")
    public Result<List<Map<String, Object>>> listDictSyncStatus() {
        return Result.ok(scopeSyncJobService.listSyncStatus());
    }

    /**
     * 拉取变更事件（BFF 诊断用；Worker 走内部面）。
     */
    @GetMapping("/change-events")
    public Result<List<Map<String, Object>>> listChangeEvents(
            @RequestParam(defaultValue = "0") long sinceSeq) {
        return Result.ok(adminService.drainChangeEvents(sinceSeq));
    }

    // ================================================================ 审计回查（W3）

    /**
     * 分页回查问数审计日志（W3：运营联调审计；需 iqd:trace:view）。
     */
    @GetMapping("/traces")
    public Result<List<IqdAskLogVO>> listTraces(
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Long userId) {
        return Result.ok(adminService.listAskLogs(limit, status, userId));
    }

    /**
     * 取单条审计日志详情（W3：完整计划时间线 + SQL 代码块回查）。
     */
    @GetMapping("/traces/{id}")
    public Result<IqdAskLogVO> getTrace(@PathVariable Long id) {
        return Result.ok(adminService.getAskLog(id));
    }

    // ================================================================ 样本对（W4）

    /**
     * 查询连接下的样本对（W4：few-shot 增强物料）。
     */
    @GetMapping("/sql-pairs")
    public Result<List<IqdSqlPairVO>> listSqlPairs(@RequestParam Long connectionId) {
        return Result.ok(adminService.listSqlPairs(connectionId));
    }

    /**
     * 保存样本对（W4：幂等 upsert）。
     */
    @PostMapping("/sql-pairs")
    public Result<IqdSqlPairVO> saveSqlPair(@Valid @RequestBody IqdSqlPairSaveRequest dto) {
        return Result.ok(adminService.saveSqlPair(dto));
    }

    /**
     * 删除样本对（W4）。
     */
    @DeleteMapping("/sql-pairs/{id}")
    public Result<Void> deleteSqlPair(@PathVariable Long id) {
        adminService.deleteSqlPair(id);
        return Result.ok();
    }

    // ================================================================ 知识/术语（W4）

    /**
     * 查询连接下的知识/术语/口径（W4）。
     */
    @GetMapping("/knowledge")
    public Result<List<IqdKnowledgeVO>> listKnowledge(
            @RequestParam Long connectionId,
            @RequestParam(required = false) String kind) {
        return Result.ok(adminService.listKnowledge(connectionId, kind));
    }

    /**
     * 保存知识/术语/口径（W4：按连接+kind+title 幂等 upsert）。
     */
    @PostMapping("/knowledge")
    public Result<IqdKnowledgeVO> saveKnowledge(@Valid @RequestBody IqdKnowledgeSaveRequest dto) {
        return Result.ok(adminService.saveKnowledge(dto));
    }

    /**
     * 删除知识/术语/口径（W4）。
     */
    @DeleteMapping("/knowledge/{id}")
    public Result<Void> deleteKnowledge(@PathVariable Long id) {
        adminService.deleteKnowledge(id);
        return Result.ok();
    }

    /**
     * 从 S-07 平台术语表单向拉入（W4：source=kb_s07；A6 未就绪空导入）。
     */
    @PostMapping("/knowledge/import-s07")
    public Result<Map<String, Object>> importS07Knowledge(@RequestParam Long connectionId) {
        return Result.ok(adminService.importS07Knowledge(connectionId));
    }

    // ================================================================ 增强推送（W4）

    /**
     * 取待推送增强物料（W4：sql_pairs + knowledge pending 清单；真实 push 由
     * Worker 经 CLI context build 执行并回填 wren_ref_id）。
     */
    @PostMapping("/enhance/push")
    public Result<Map<String, Object>> pushEnhancements(@RequestParam Long connectionId) {
        return Result.ok(adminService.pushEnhancements(connectionId));
    }

    // ================================================================ 闭环补全（P0-4 / 二期前向）

    /**
     * 回查最近一次增强同步作业（P0-4：前端 SyncStatusBar 渲染 build/index 进度与回填计数）。
     *
     * <p>无作业记录时返回 data=null（前端展示「尚未同步」）。
     */
    @GetMapping("/enhance/sync-status")
    public Result<IqdSyncJobVO> getEnhanceSyncStatus(@RequestParam Long connectionId) {
        return Result.ok(adminService.getLatestSyncJob(connectionId));
    }

    /**
     * 二期前向占位：平台内建/修改 catalog 节点（write-back 到 MDL）。
     *
     * <p>一期 iqd_catalog_item.editable 恒 false，未实现写回，返回 501。预留路由与开关位，
     * 待二期 mdlWritebackEnabled=true 时再落地。
     */
    @PutMapping("/catalog/node")
    public Result<Void> updateCatalogNode() {
        return Result.fail(501, "catalog 节点写回尚未实现（二期前向占位）");
    }
}
