package com.mis.kb.domain.service;

import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.engine.KnowledgeEnginePort;
import org.springframework.stereotype.Service;

/**
 * 引擎配置与健康服务（S-04 + kb_settings_model_chunk）。
 *
 * <p>从当前生效的 {@link KnowledgeEnginePort} 取健康检查与能力声明，供前端在“知识库 → 引擎”页
 * 展示连通性与能力显隐（如不支持 rerank 则灰化开关）。不落库、不依赖具体引擎实现。
 *
 * <p>kb_settings_model_chunk 新增模型池读取：委托 {@link EngineModelPoolService}（60s TTL 缓存），
 * 本服务只做装配，不做模型分类/降级决策。
 */
@Service
public class KbEngineConfigService {

    private final KnowledgeEnginePort enginePort;
    private final EngineModelPoolService modelPoolService;

    public KbEngineConfigService(KnowledgeEnginePort enginePort, EngineModelPoolService modelPoolService) {
        this.enginePort = enginePort;
        this.modelPoolService = modelPoolService;
    }

    /** 当前引擎连通性。 */
    public EngineHealth health() {
        return enginePort.health();
    }

    /** 当前引擎能力声明。 */
    public EngineCapabilities capabilities() {
        return enginePort.capabilities();
    }

    /** 当前生效引擎类型（ragflow/noop/mock）。 */
    public String engineType() {
        return enginePort.engineType();
    }

    /**
     * 模型池（UI 用：60s TTL 内命中缓存，过期同步刷新打引擎）。
     *
     * @return 模型池快照，恒非 {@code null}（失败为 unavailable 降级态）
     */
    public EngineModelPool modelPool() {
        return modelPoolService.getPool();
    }
}
