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
 * @param engineType              引擎类型 ragflow/noop/mock
 * @param capabilities            能力码值列表
 * @param rerankSupported         当前配置下重排是否可用
 * @param metadataFilterSupported 是否支持元数据过滤
 * @param replaceSupported        是否支持同名文档替换
 * @param hybridSupported         是否支持混合检索（关键字 + 语义）
 */
public record KbEngineCapabilitiesVO(
        String engineType,
        List<String> capabilities,
        Boolean rerankSupported,
        Boolean metadataFilterSupported,
        Boolean replaceSupported,
        Boolean hybridSupported) {
}
