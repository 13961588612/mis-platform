package com.mis.kb.domain.model;

import java.util.ArrayList;
import java.util.List;

/**
 * 引擎能力声明（由 {@code KnowledgeEnginePort.capabilities()} 返回）。
 *
 * <p>前端按能力显隐 UI（如不支持 rerank 则置灰开关）。未知能力返回 {@code UNSUPPORTED}。
 *
 * <p><b>Wave A（WA-03/WA-06）变更两点：</b>
 * <ol>
 *   <li>新增 {@code hybridSupported}，码值 {@value #CAP_HYBRID} 纳入 {@code capabilities} 列表；</li>
 *   <li>{@code rerankSupported} 语义由「理论支持」改为「<b>当前配置下实际可用</b>」——
 *       RAGFlow 适配器需按全局 {@code mis.kb.engine.rerank-model-id} 是否配置动态判定。
 *       这是「前端置灰 + 后端强制关闭 + 检索期降级」三道防线口径一致的基础。</li>
 * </ol>
 *
 * <p>码值字符串常量集中定义在本类，禁止在各适配器/服务中硬编码字面量。
 *
 * @param capabilities            能力码值列表
 * @param rerankSupported         当前配置下重排是否可用
 * @param metadataFilterSupported 是否支持元数据过滤
 * @param replaceSupported        是否支持同名文档替换
 * @param hybridSupported         是否支持混合检索（关键字 + 语义）与权重调节
 */
public record EngineCapabilities(
        List<String> capabilities,
        boolean rerankSupported,
        boolean metadataFilterSupported,
        boolean replaceSupported,
        boolean hybridSupported) {

    /** 无任何能力的占位码值。 */
    public static final String UNSUPPORTED = "UNSUPPORTED";

    /** 能力码值：混合检索（关键字 + 语义）。 */
    public static final String CAP_HYBRID = "hybrid";
    /** 能力码值：重排（当前配置下可用）。 */
    public static final String CAP_RERANK = "rerank";
    /** 能力码值：元数据过滤。 */
    public static final String CAP_METADATA_FILTER = "metadata_filter";
    /** 能力码值：同名文档替换。 */
    public static final String CAP_REPLACE = "replace";

    /**
     * 全不支持的能力声明（noop 引擎、能力探测失败时使用）。
     *
     * @return 四个布尔位全 false 的声明
     */
    public static EngineCapabilities unsupported() {
        return new EngineCapabilities(List.of(UNSUPPORTED), false, false, false, false);
    }

    /**
     * 由四个布尔位反推 {@code capabilities} 列表，避免各适配器手工维护两份信息导致漂移。
     *
     * @param rerank         重排是否可用
     * @param metadataFilter 元数据过滤是否可用
     * @param replace        同名替换是否可用
     * @param hybrid         混合检索是否可用
     * @return 列表与布尔位严格一致的能力声明；全 false 时等价 {@link #unsupported()}
     */
    public static EngineCapabilities of(
            boolean rerank, boolean metadataFilter, boolean replace, boolean hybrid) {
        List<String> caps = new ArrayList<>(4);
        if (hybrid) {
            caps.add(CAP_HYBRID);
        }
        if (rerank) {
            caps.add(CAP_RERANK);
        }
        if (metadataFilter) {
            caps.add(CAP_METADATA_FILTER);
        }
        if (replace) {
            caps.add(CAP_REPLACE);
        }
        if (caps.isEmpty()) {
            caps.add(UNSUPPORTED);
        }
        return new EngineCapabilities(List.copyOf(caps), rerank, metadataFilter, replace, hybrid);
    }

    /**
     * 是否声明了某项能力。
     *
     * @param capability 能力码值
     * @return 列表包含该码值返回 {@code true}
     */
    public boolean supports(String capability) {
        return capabilities != null && capabilities.contains(capability);
    }
}
