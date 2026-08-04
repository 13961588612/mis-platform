package com.mis.kb.api.dto;

import java.nio.charset.StandardCharsets;

/**
 * 可下载的文本文件载荷（Wave D，导出词表 / 下载未导入行共用）。
 *
 * <p>刻意<b>不</b>直接返回 {@code byte[]}：内容始终是 UTF-8 文本，
 * 在服务层保持 {@code String} 让单测能逐字断言（「表头是不是这四列」「BOM 在不在」），
 * 到 Controller 才落成字节流。若一路传字节数组，测试就得先解码再断言，
 * 编码问题会被自己的测试代码掩盖掉。
 *
 * @param filename    下载文件名（含扩展名）
 * @param contentType HTTP {@code Content-Type}
 * @param content     文件全文（UTF-8 文本；CSV 场景已含 BOM）
 */
public record SynonymFileVO(String filename, String contentType, String content) {

    /** CSV 下载的 MIME 类型。 */
    public static final String CONTENT_TYPE_CSV = "text/csv;charset=UTF-8";

    /** JSON 下载的 MIME 类型。 */
    public static final String CONTENT_TYPE_JSON = "application/json;charset=UTF-8";

    /**
     * 取 UTF-8 字节（Controller 写响应体用）。
     *
     * @return 文件字节；{@code content} 为 {@code null} 时返回空数组
     */
    public byte[] bytes() {
        return content == null ? new byte[0] : content.getBytes(StandardCharsets.UTF_8);
    }
}
