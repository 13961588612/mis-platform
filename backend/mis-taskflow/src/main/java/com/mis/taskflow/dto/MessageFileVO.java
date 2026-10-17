package com.mis.taskflow.dto;

/** 上传完成后的文件元数据。 */
public record MessageFileVO(
        String fileId,
        String name,
        long size,
        String mime
) {
}
