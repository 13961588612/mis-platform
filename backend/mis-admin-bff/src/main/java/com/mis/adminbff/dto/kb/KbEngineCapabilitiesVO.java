package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 引擎能力视图（S-04），字段与 mis-kb {@code EngineCapabilities} + 引擎类型对齐。
 *
 * <p>前端按能力显隐/灰化 UI（如 {@code rerankSupported=false} 时置灰 rerank 开关）。
 *
 * <p><b>Wave A（WA-03/WA-06）：</b>新增 {@code hybridSupported}；同时
 * {@code rerankSupported} 语义改为「<b>当前配置下实际可用</b>」——它会随全局
 * {@code mis.kb.engine.rerank-model-id} 是否配置而变化，不再是引擎的静态能力宣告。
 *
 * <p><b>引擎删除策略 P0（T04）：</b>新增 {@code deleteSupported}。它<b>不是</b>引擎的静态
 * 能力宣告，而是 {@code mis.kb.engine.delete-supported} 配置项的直读值（Q5 裁定不做启动
 * 探测）。当前部署的 RAGFLOW 版本删除接口不可用，该值为 {@code false}，前端据此把
 * 「物理删除」置灰并只提供归档。
 *
 * <p><b>企业级增强一期（KE-06/KE-07）：</b>新增 {@code parserOcrSupported} /
 * {@code parserOverlapSupported}，直读 mis-kb {@code EngineCapabilities} 的对应布尔位。
 * 当前引擎不支持时前端据此置灰 OCR/overlap 控件并提示「暂不生效」。
 *
 * <p><b>Wave C RAPTOR（T01）：</b>末位追加 {@code raptorSupported}，直读 mis-kb
 * {@code EngineCapabilities.raptorSupported}（受平台总开关 {@code mis.kb.engine.raptor-enabled}
 * 控制，默认 true）。当前引擎不支持时前端据此置灰 RAPTOR 开关并提示「暂不生效」。
 *
 * <p><b>切片参数对齐（T3）：</b>末位追加 {@code parserTocSupported} /
 * {@code parserImageTableContextSupported}（配置闸门，默认 false）。本实例 T0 实测
 * dataset PUT 拒 toc/image 键；前端据此置灰页码索引/图像表格上下文控件。
 *
 * @param engineType                         引擎类型 ragflow/noop/mock
 * @param capabilities                       能力码值列表
 * @param rerankSupported                    当前配置下重排是否可用
 * @param metadataFilterSupported            是否支持元数据过滤
 * @param replaceSupported                   是否支持同名文档替换
 * @param hybridSupported                    是否支持混合检索（关键字 + 语义）
 * @param deleteSupported                    是否支持在线删除知识库（false 时只能归档）
 * @param parserOcrSupported                 当前引擎是否支持 parser_config OCR 键
 * @param parserOverlapSupported             当前引擎是否支持 parser_config overlap 键
 * @param graphSupported                     当前引擎是否支持知识图谱构建/增强
 * @param raptorSupported                    当前引擎是否支持 RAPTOR 摘要构建/融合
 * @param parserTocSupported                 当前引擎是否接受 toc_extraction
 * @param parserImageTableContextSupported   当前引擎是否接受 image_table_context_window
 */
public record KbEngineCapabilitiesVO(
        String engineType,
        List<String> capabilities,
        Boolean rerankSupported,
        Boolean metadataFilterSupported,
        Boolean replaceSupported,
        Boolean hybridSupported,
        Boolean deleteSupported,
        Boolean parserOcrSupported,
        Boolean parserOverlapSupported,
        Boolean graphSupported,
        Boolean raptorSupported,
        Boolean parserTocSupported,
        Boolean parserImageTableContextSupported) {
}
