package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.KbEngineOrphanVO;
import com.mis.kb.api.dto.KbEngineMissingCleanupVO;
import com.mis.kb.api.dto.KbEngineReconcileVO;
import com.mis.kb.api.dto.KbEngineRenameLogVO;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineConvergenceResult;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.domain.model.KbEngineOrphanResolveReq;
import com.mis.kb.domain.model.KbEngineOrphanResolveResult;
import com.mis.kb.domain.model.KbEngineRenameReq;
import com.mis.kb.domain.model.KbEngineRenameResult;
import com.mis.kb.domain.model.KbEngineRenameRollbackReq;
import com.mis.kb.domain.service.KbEngineConfigService;
import com.mis.kb.domain.service.KbEngineLegacyRenameService;
import com.mis.kb.domain.service.KbEngineOrphanService;
import com.mis.kb.domain.service.KbEngineReconcileService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 引擎配置与连通性端点（S-04，内部端点供 BFF 聚合）。
 *
 * <p>kb_settings_model_chunk 新增 {@code GET /models}（R-P0-01/02/04）：返回模型池 +
 * 全局重排模型 id。<b>绝不返回 RAGFlow apiKey</b>（设计 §7.6 安全），只透传模型元数据。
 */
@RestController
@RequestMapping("/internal/v1/kb/engine")
public class EngineConfigController {

    private final KbEngineConfigService engineConfigService;
    private final KbEngineReconcileService reconcileService;
    private final KbEngineOrphanService orphanService;
    private final KbEngineLegacyRenameService renameService;

    public EngineConfigController(
            KbEngineConfigService engineConfigService,
            KbEngineReconcileService reconcileService,
            KbEngineOrphanService orphanService,
            KbEngineLegacyRenameService renameService) {
        this.engineConfigService = engineConfigService;
        this.reconcileService = reconcileService;
        this.orphanService = orphanService;
        this.renameService = renameService;
    }

    /** 引擎健康检查（连通性）。 */
    @GetMapping("/health")
    public Result<EngineHealth> health() {
        return Result.ok(engineConfigService.health());
    }

    /** 引擎能力声明。 */
    @GetMapping("/capabilities")
    public Result<EngineCapabilities> capabilities() {
        return Result.ok(engineConfigService.capabilities());
    }

    /** 当前生效引擎类型。 */
    @GetMapping("/type")
    public Result<String> engineType() {
        return Result.ok(engineConfigService.engineType());
    }

    /** 模型池（embedding[] / rerank[] / available / degradedReason / globalRerankModelId）。 */
    @GetMapping("/models")
    public Result<EngineModelPool> models() {
        return Result.ok(engineConfigService.modelPool());
    }

    /**
     * 读取最近一次引擎对账报告（T04）。
     *
     * <p>只读内存中的最近报告，进程重启后由 DB 现状重算，<b>不会触发引擎调用</b>——
     * 页面刷新不该把 RAGFlow 的 {@code GET /datasets} 打成 QPS。
     *
     * @return 对账报告
     */
    @GetMapping("/reconcile")
    public Result<KbEngineReconcileVO> reconcileReport() {
        return Result.ok(KbEngineReconcileVO.from(reconcileService.latestReport()));
    }

    /**
     * 手动触发一次引擎对账（T04）。
     *
     * <p>同步执行并返回本次报告。分页拉取受 {@code mis.kb.engine.reconcile.max-pages}
     * 保护，不会因引擎侧 dataset 巨多而无限翻页。
     *
     * <p>判权（{@code kb:engine:reconcile}）与审计在 BFF 侧收口，内部端点不重复判。
     *
     * @return 本次对账报告
     */
    @PostMapping("/reconcile")
    public Result<KbEngineReconcileVO> runReconcile() {
        return Result.ok(KbEngineReconcileVO.from(reconcileService.reconcile()));
    }

    /**
     * 手动收敛「连续 N 次被标记 MISSING_IN_ENGINE」的本地残留（增量 T04）。
     *
     * <p>库走<b>可逆软删</b>（status=0 + archivedAt=now）；孤儿文档直接<b>物理删除</b>行。
     * 收敛阈值由 {@code mis.kb.engine.reconcile.missing-in-engine-threshold}（默认 2）与
     * {@code interval-ms} 共同决定。区别于定时任务的 auto-clean-missing 自动模式，本端点是
     * 显式、人工触发的收敛出口，便于运维在确认引擎侧确实已删后执行。
     *
     * <p>判权（{@code kb:engine:reconcile}）与审计在 BFF 侧收口，内部端点不重复判。
     *
     * @return 收敛结果（软删库数 / 物理删文档数）
     */
    @PostMapping("/cleanup-missing")
    public Result<KbEngineMissingCleanupVO> cleanupMissing() {
        EngineConvergenceResult result = reconcileService.cleanupMissing();
        String note = String.format(
                "已收敛连续多次被标记 MISSING_IN_ENGINE 的本地残留：软删库 %d 个、物理删除孤儿文档 %d 条。",
                result.librariesCleaned(), result.documentsCleaned());
        return Result.ok(new KbEngineMissingCleanupVO(
                result.librariesCleaned(), result.documentsCleaned(), result.at(), note));
    }

    /**
     * 列出引擎侧游离 dataset（P1-T3）。
     *
     * <p>只读列表，复用 P0 的 {@code kb:engine:reconcile} 权限码（与对账同源、风险同级），
     * 内部端点不重复判权。<b>非 ragflow 引擎直接返回空列表</b>。
     *
     * @param engineType 引擎类型；缺省取当前引擎类型
     * @param resolved   0=待处理（默认）1=已处置
     * @return 游离项视图列表
     */
    @GetMapping("/orphans")
    public Result<List<KbEngineOrphanVO>> listOrphans(
            @RequestParam(required = false) String engineType,
            @RequestParam(defaultValue = "0") int resolved) {
        return Result.ok(orphanService.list(engineType, resolved));
    }

    /**
     * 处置一个游离 dataset（P1-T3）。
     *
     * <p>写操作，权限码 {@code kb:engine:orphan:handle} 与审计在 BFF 侧收口，内部端点不判。
     * 服务端按动作做护栏（目标库必须为空、ignore 备注必填等），见 {@link KbEngineOrphanService}。
     *
     * @param engineType 引擎类型；缺省取当前引擎类型
     * @param nativeId   引擎原生 dataset id
     * @param req        处置请求
     * @return 处置结果（含引擎侧改名是否失败）
     */
    @PostMapping("/orphans/{nativeId}/resolve")
    public Result<KbEngineOrphanResolveResult> resolveOrphan(
            @RequestParam(required = false) String engineType,
            @PathVariable("nativeId") String nativeId,
            @RequestBody KbEngineOrphanResolveReq req) {
        Long operatorId = SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
        return Result.ok(orphanService.resolve(engineType, nativeId, req, operatorId));
    }

    /**
     * 存量 dataset 批量重命名（P1-T4，方案 X：受控端点）。
     *
     * <p>默认 {@code dryRun=true} 只出计划；执行需 {@code confirmToken="RENAME-LEGACY"}。
     * 权限码 {@code kb:engine:dataset:rename} 与审计在 BFF 侧收口，内部端点不判。
     *
     * @param req 请求（dryRun / confirmToken / limit）
     * @return 本次结果（含 batchId，供回滚定位）
     */
    @PostMapping("/datasets/rename")
    public Result<KbEngineRenameResult> renameDatasets(@RequestBody KbEngineRenameReq req) {
        Long operatorId = SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
        return Result.ok(renameService.rename(req, operatorId));
    }

    /**
     * 回滚某批次的重命名（P1-T4）。
     *
     * @param body 请求体，含 {@code batchId}
     * @return 回滚结果
     */
    @PostMapping("/datasets/rename/rollback")
    public Result<KbEngineRenameResult> rollbackRename(@RequestBody KbEngineRenameRollbackReq body) {
        Long operatorId = SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
        return Result.ok(renameService.rollback(body.batchId(), operatorId));
    }

    /**
     * 最近的重命名日志列表（P1-T4）。
     *
     * @param limit 返回条数（默认 100）
     * @return 日志视图列表（按时间倒序）
     */
    @GetMapping("/datasets/rename/logs")
    public Result<List<KbEngineRenameLogVO>> listRenameLogs(@RequestParam(defaultValue = "100") int limit) {
        return Result.ok(renameService.recentLogs(limit).stream().map(KbEngineRenameLogVO::from).toList());
    }

    /**
     * 某批次的全部重命名日志（P1-T4）。
     *
     * @param batchId 批次号
     * @return 该批次日志视图列表（按时间倒序）
     */
    @GetMapping("/datasets/rename/logs/{batchId}")
    public Result<List<KbEngineRenameLogVO>> getRenameLogsByBatch(@PathVariable("batchId") String batchId) {
        return Result.ok(renameService.logsByBatch(batchId).stream().map(KbEngineRenameLogVO::from).toList());
    }
}
