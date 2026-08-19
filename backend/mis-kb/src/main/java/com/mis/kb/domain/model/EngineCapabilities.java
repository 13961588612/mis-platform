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
 * <p><b>引擎删除策略 P0（T01）新增 {@code deleteSupported}：</b>
 * 语义是「当前引擎版本是否支持在线删除知识库（dataset）」。取值来自配置项
 * {@code mis.kb.engine.delete-supported}（<b>写死配置，不做启动探测</b>，Q5 裁定），
 * 默认 {@code false}。为 false 时 {@code DELETE ?mode=physical} 一律被拒
 * （{@code KB_ENGINE_DELETE_UNSUPPORTED}），业务侧只能走归档；等 RAGFLOW 升级后
 * 翻配置即可放开，代码分支不用动。
 *
 * <p><b>企业级增强一期（KE-06/KE-07）新增 {@code parserOcrSupported} / {@code parserOverlapSupported}：</b>
 * 语义是「当前引擎版本是否支持 parser_config 的 OCR / overlap 键」。当前 RAGFlow 实例
 * <b>实测不支持</b>（硬下发即 code:101/102 拒整单），默认 {@code false}；为 false 时
 * {@code RagflowAdapter}/{@code RagflowClient} 一律<b>不下发</b>这三个键（只落库 + 回显 + 提示），
 * 前端据此置灰 + 提示「当前引擎版本暂不支持」。引擎升级后翻转能力声明即可放行下发，
 * 代码分支不动（与 {@code deleteSupported} 同款配置化口径）。
 *
 * <p><b>Wave B GraphRAG PoC（T01）新增 {@code graphSupported}（record 末位追加）：</b>
 * 语义是「当前引擎版本是否支持知识图谱构建 + 图谱增强检索」。RAGFlow 适配器按
 * <b>T00 实测</b>（{@code ragflow-graphrag-probe-2026-08-11.md}）声明 {@code true}；
 * noop/mock 走 {@link #unsupported()} 或 {@code of(...)} 默认 {@code false}。
 *
 * <p><b>Wave C RAPTOR（T01）新增 {@code raptorSupported}：</b>
 * 语义是「当前引擎版本是否支持 RAPTOR 摘要构建 + 检索自动融合」。
 *
 * <p><b>切片参数对齐（T3）新增 {@code parserTocSupported} / {@code parserImageTableContextSupported}：</b>
 * 对应 {@code toc_extraction} / {@code image_table_context_window}。T0 实测本实例
 * dataset PUT 拒这两键（code:101）；默认 false。若误开硬下发，整单被拒会连带阻断
 * {@code auto_keywords}/{@code auto_questions} 同步。
 *
 * <p>码值字符串常量集中定义在本类，禁止在各适配器/服务中硬编码字面量。
 *
 * @param capabilities                       能力码值列表
 * @param rerankSupported                    当前配置下重排是否可用
 * @param metadataFilterSupported            是否支持元数据过滤
 * @param replaceSupported                   是否支持同名文档替换
 * @param hybridSupported                    是否支持混合检索（关键字 + 语义）与权重调节
 * @param deleteSupported                    是否支持在线删除知识库（配置项决定，默认 false）
 * @param parserOcrSupported                 当前引擎是否支持 parser_config OCR 键（默认 false）
 * @param parserOverlapSupported             当前引擎是否支持 parser_config overlap 键（默认 false）
 * @param graphSupported                     当前引擎是否支持知识图谱构建/增强（默认 false）
 * @param raptorSupported                    当前引擎是否支持 RAPTOR 摘要构建/融合（默认 false）
 * @param parserTocSupported                 当前引擎是否接受 toc_extraction（默认 false）
 * @param parserImageTableContextSupported   当前引擎是否接受 image_table_context_window（默认 false）
 */
public record EngineCapabilities(
        List<String> capabilities,
        boolean rerankSupported,
        boolean metadataFilterSupported,
        boolean replaceSupported,
        boolean hybridSupported,
        boolean deleteSupported,
        boolean parserOcrSupported,
        boolean parserOverlapSupported,
        boolean graphSupported,
        boolean raptorSupported,
        boolean parserTocSupported,
        boolean parserImageTableContextSupported) {

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
    /** 能力码值：在线删除知识库（dataset）。 */
    public static final String CAP_DELETE = "delete";
    /** 能力码值：parser_config OCR 键（企业级增强一期新增；默认不支持）。 */
    public static final String CAP_PARSER_OCR = "parser_ocr";
    /** 能力码值：parser_config overlap 键（企业级增强一期新增；默认不支持）。 */
    public static final String CAP_PARSER_OVERLAP = "parser_overlap";
    /**
     * 能力码值：知识图谱（Wave B GraphRAG PoC 新增）。
     *
     * <p><b>注意</b>：码值固定为 {@code graphrag}（引擎内部任务类型），
     * 与「构图触发 type 参数值 = {@code graph}」（{@code RagflowClient.INDEX_TYPE_GRAPH}）
     * 是<b>两个不同概念</b>——前者是能力码，后者是 HTTP query 参数，禁止混用
     * （共享知识 §10-2）。
     */
    public static final String CAP_GRAPH = "graphrag";

    /**
     * 能力码值：RAPTOR 摘要（Wave C RAPTOR 新增）。
     *
     * <p><b>注意</b>：码值固定为 {@code raptor}（引擎内部任务类型），
     * 与「构建触发 type 参数值 = {@code raptor}」（{@code RagflowClient.INDEX_TYPE_RAPTOR}）
     * 一致——RAPTOR 没有 Wave B 那种「能力码 ≠ 触发 type」的歧义，但常量仍集中定义，
     * 禁止在适配器/服务中硬编码字面量（共享知识 §10-1）。
     */
    public static final String CAP_RAPTOR = "raptor";

    /** 能力码值：parser_config.toc_extraction（切片参数对齐 T3；默认不支持）。 */
    public static final String CAP_PARSER_TOC = "parser_toc";
    /** 能力码值：parser_config.image_table_context_window（切片参数对齐 T3；默认不支持）。 */
    public static final String CAP_PARSER_IMAGE_TABLE_CONTEXT = "parser_image_table_context";

    /**
     * 兼容构造：6 参数旧签名，OCR/overlap/graph/raptor/toc/imageTable 六位恒 {@code false}。
     */
    public EngineCapabilities(
            List<String> capabilities,
            boolean rerankSupported,
            boolean metadataFilterSupported,
            boolean replaceSupported,
            boolean hybridSupported,
            boolean deleteSupported) {
        this(capabilities, rerankSupported, metadataFilterSupported, replaceSupported,
                hybridSupported, deleteSupported, false, false, false, false, false, false);
    }

    /**
     * 兼容构造：10 参数旧签名（Wave C canonical），toc/imageTable 两位恒 {@code false}。
     */
    public EngineCapabilities(
            List<String> capabilities,
            boolean rerankSupported,
            boolean metadataFilterSupported,
            boolean replaceSupported,
            boolean hybridSupported,
            boolean deleteSupported,
            boolean parserOcrSupported,
            boolean parserOverlapSupported,
            boolean graphSupported,
            boolean raptorSupported) {
        this(capabilities, rerankSupported, metadataFilterSupported, replaceSupported,
                hybridSupported, deleteSupported, parserOcrSupported, parserOverlapSupported,
                graphSupported, raptorSupported, false, false);
    }

    /**
     * 全不支持的能力声明（noop 引擎、能力探测失败时使用）。
     *
     * @return 十一位布尔全 false 的声明
     */
    public static EngineCapabilities unsupported() {
        return new EngineCapabilities(
                List.of(UNSUPPORTED), false, false, false, false, false, false, false, false, false,
                false, false);
    }

    /**
     * 由五个布尔位反推 {@code capabilities} 列表（其余默认不支持）。
     */
    public static EngineCapabilities of(
            boolean rerank, boolean metadataFilter, boolean replace, boolean hybrid, boolean delete) {
        return of(rerank, metadataFilter, replace, hybrid, delete, false, false, false, false, false, false);
    }

    /**
     * 由七个布尔位反推（graph/raptor/toc/imageTable 默认不支持）。
     */
    public static EngineCapabilities of(
            boolean rerank, boolean metadataFilter, boolean replace, boolean hybrid, boolean delete,
            boolean parserOcr, boolean parserOverlap) {
        return of(rerank, metadataFilter, replace, hybrid, delete, parserOcr, parserOverlap,
                false, false, false, false);
    }

    /**
     * 由八个布尔位反推（raptor/toc/imageTable 默认不支持）。
     */
    public static EngineCapabilities of(
            boolean rerank, boolean metadataFilter, boolean replace, boolean hybrid, boolean delete,
            boolean parserOcr, boolean parserOverlap, boolean graph) {
        return of(rerank, metadataFilter, replace, hybrid, delete, parserOcr, parserOverlap,
                graph, false, false, false);
    }

    /**
     * 由九个布尔位反推（toc/imageTable 默认不支持；Wave C 存量调用点）。
     */
    public static EngineCapabilities of(
            boolean rerank, boolean metadataFilter, boolean replace, boolean hybrid, boolean delete,
            boolean parserOcr, boolean parserOverlap, boolean graph, boolean raptor) {
        return of(rerank, metadataFilter, replace, hybrid, delete, parserOcr, parserOverlap,
                graph, raptor, false, false);
    }

    /**
     * 由十一个布尔位反推 {@code capabilities} 列表。
     *
     * @param rerank         重排是否可用
     * @param metadataFilter 元数据过滤是否可用
     * @param replace        同名替换是否可用
     * @param hybrid         混合检索是否可用
     * @param delete         在线删除知识库是否可用
     * @param parserOcr      parser_config OCR 键是否可用
     * @param parserOverlap  parser_config overlap 键是否可用
     * @param graph          知识图谱构建/增强是否可用
     * @param raptor         RAPTOR 摘要构建/融合是否可用
     * @param parserToc      toc_extraction 键是否可用
     * @param parserImageTable image_table_context_window 键是否可用
     * @return 列表与布尔位严格一致的能力声明；全 false 时等价 {@link #unsupported()}
     */
    public static EngineCapabilities of(
            boolean rerank, boolean metadataFilter, boolean replace, boolean hybrid, boolean delete,
            boolean parserOcr, boolean parserOverlap, boolean graph, boolean raptor,
            boolean parserToc, boolean parserImageTable) {
        List<String> caps = new ArrayList<>(11);
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
        if (delete) {
            caps.add(CAP_DELETE);
        }
        if (parserOcr) {
            caps.add(CAP_PARSER_OCR);
        }
        if (parserOverlap) {
            caps.add(CAP_PARSER_OVERLAP);
        }
        if (graph) {
            caps.add(CAP_GRAPH);
        }
        if (raptor) {
            caps.add(CAP_RAPTOR);
        }
        if (parserToc) {
            caps.add(CAP_PARSER_TOC);
        }
        if (parserImageTable) {
            caps.add(CAP_PARSER_IMAGE_TABLE_CONTEXT);
        }
        if (caps.isEmpty()) {
            caps.add(UNSUPPORTED);
        }
        return new EngineCapabilities(
                List.copyOf(caps), rerank, metadataFilter, replace, hybrid, delete,
                parserOcr, parserOverlap, graph, raptor, parserToc, parserImageTable);
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
