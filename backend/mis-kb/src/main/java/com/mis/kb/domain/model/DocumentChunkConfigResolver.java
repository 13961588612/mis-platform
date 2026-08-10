package com.mis.kb.domain.model;

import org.springframework.stereotype.Component;

/**
 * 两级切片合并收口（设计 §3.2.2 / §7.2 Resolver 铁律）。
 *
 * <p><b>唯一收口：</b>任何「文件级 ?? 库级 ?? 全局默认」的切片合并判断必须走本类，
 * 服务层（{@code KbDocumentService} / {@code RagSettingsService}）<b>禁止</b>内联
 * {@code file ?? lib} 判断——否则同一套语义会出现多份实现、逐步漂移。
 *
 * <p>合并算法：
 * <ol>
 *   <li>基准 = 库级设置（{@code null} 时用 {@link RagSettings#defaults()}，再补默认值）；</li>
 *   <li>文件级字段非空才覆盖对应字段（{@code chunkMethod} 空白视为未指定）；</li>
 *   <li>来源标记：文件级任一字段非空 → {@code FILE_OVERRIDE}，否则 {@code LIBRARY}。</li>
 * </ol>
 */
@Component
public class DocumentChunkConfigResolver {

    /**
     * 合并文件级与库级切片配置。
     *
     * @param file    文件级配置；可为 {@code null}（等价全空）
     * @param library 库级设置；可为 {@code null}（用全局默认）
     * @return 生效值 + 来源标记，恒非 {@code null}
     */
    public EffectiveChunkConfig resolve(DocumentChunkConfig file, RagSettings library) {
        RagSettings def = library == null ? RagSettings.defaults() : library.withDefaults();
        String method = (file != null && file.chunkMethod() != null && !file.chunkMethod().isBlank())
                ? file.chunkMethod() : def.chunkMethod();
        Integer token = (file != null && file.chunkTokenNum() != null)
                ? file.chunkTokenNum() : def.chunkTokenNum();
        String sep = (file != null && file.separator() != null)
                ? file.separator() : def.separator();
        String source = (file != null && file.hasAnyOverride())
                ? EffectiveChunkConfig.SOURCE_FILE_OVERRIDE
                : EffectiveChunkConfig.SOURCE_LIBRARY;
        return new EffectiveChunkConfig(method, token, sep, source);
    }
}
