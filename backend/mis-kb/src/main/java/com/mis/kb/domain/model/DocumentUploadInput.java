package com.mis.kb.domain.model;

/**
 * 文档上传输入（从 {@code MultipartFile} 规整后传入引擎适配器）。
 */
public record DocumentUploadInput(
        String filename,
        String contentType,
        long size,
        byte[] content) {
}
