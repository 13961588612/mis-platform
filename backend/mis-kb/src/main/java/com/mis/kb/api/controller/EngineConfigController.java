package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.kb.api.dto.KbEngineReconcileVO;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.domain.service.KbEngineConfigService;
import com.mis.kb.domain.service.KbEngineReconcileService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

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

    public EngineConfigController(
            KbEngineConfigService engineConfigService,
            KbEngineReconcileService reconcileService) {
        this.engineConfigService = engineConfigService;
        this.reconcileService = reconcileService;
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
}
