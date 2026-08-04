package com.mis.kb.domain.service;

import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.engine.KnowledgeEnginePort;
import org.springframework.stereotype.Service;

/**
 * 引擎配置与健康服务（S-04）。
 *
 * <p>从当前生效的 {@link KnowledgeEnginePort} 取健康检查与能力声明，供前端在“知识库 → 引擎”页
 * 展示连通性与能力显隐（如不支持 rerank 则灰化开关）。不落库、不依赖具体引擎实现。
 */
@Service
public class KbEngineConfigService {

    private final KnowledgeEnginePort enginePort;

    public KbEngineConfigService(KnowledgeEnginePort enginePort) {
        this.enginePort = enginePort;
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
}
