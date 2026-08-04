package com.mis.adminbff.dto.kb;

import java.nio.charset.StandardCharsets;

/**
 * 可下载文本文件载荷（BFF 侧镜像，字段与 mis-kb {@code SynonymFileVO} 一一对齐）。
 *
 * <p>Wave D 新增。内部这一跳仍走 JSON 而非字节流：出错时（例如导出超限 40926）
 * 才能沿统一的 {@code Result} 错误通道把 code/message 带回来；
 * 直接吐字节流的话，错误就只剩一个 HTTP 状态码可用。
 * 到 BFF 的对外端点才落成 {@code ResponseEntity<ByteArrayResource>}。
 *
 * @param filename    下载文件名（含扩展名）
 * @param contentType HTTP {@code Content-Type}
 * @param content     文件全文（UTF-8 文本；CSV 场景已含 BOM，BFF 不得再加一次）
 */
public record KbSynonymFileVO(String filename, String contentType, String content) {

    /** 兜底文件名：下游异常地没给文件名时才会用到。 */
    public static final String FALLBACK_FILENAME = "kb-synonyms.csv";

    /** 兜底 MIME 类型。 */
    public static final String FALLBACK_CONTENT_TYPE = "text/csv;charset=UTF-8";

    /**
     * 取 UTF-8 字节。
     *
     * @return 文件字节；{@code content} 为 {@code null} 时返回空数组
     */
    public byte[] bytes() {
        return content == null ? new byte[0] : content.getBytes(StandardCharsets.UTF_8);
    }

    /**
     * 文件名，缺失时回落。
     *
     * @return 非空文件名
     */
    public String filenameOrFallback() {
        return filename == null || filename.isBlank() ? FALLBACK_FILENAME : filename;
    }

    /**
     * MIME 类型，缺失时回落。
     *
     * @return 非空 MIME 类型
     */
    public String contentTypeOrFallback() {
        return contentType == null || contentType.isBlank() ? FALLBACK_CONTENT_TYPE : contentType;
    }
}
