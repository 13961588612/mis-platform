package com.mis.kb.domain.model;

/**
 * 文档上传输入（从 {@code MultipartFile} 规整后传入引擎适配器）。
 *
 * <p>kb_settings_model_chunk（R-P0-06）末位追加 {@code chunkConfig}：文件级切片配置，
 * 可为 {@code null} = 不带文件级参数（行为与旧版完全一致）。
 *
 * <p><b>record 新字段一律末位追加铁律（设计 §8-1）：</b>保留 4 参紧凑构造，
 * 旧调用点（测试/MockAdapter/既有上传）零改动。
 *
 * @param filename    原始文件名
 * @param contentType MIME 类型
 * @param size        文件大小
 * @param content     文件字节
 * @param chunkConfig 文件级切片配置；null = 继承库级
 */
public record DocumentUploadInput(
        String filename,
        String contentType,
        long size,
        byte[] content,
        DocumentChunkConfig chunkConfig) {

    /**
     * 紧凑构造（不带文件级切片配置）。
     *
     * @param filename    原始文件名
     * @param contentType MIME 类型
     * @param size        文件大小
     * @param content     文件字节
     */
    public DocumentUploadInput(String filename, String contentType, long size, byte[] content) {
        this(filename, contentType, size, content, null);
    }
}
