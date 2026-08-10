package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 库级一键重解析结果（BFF 侧镜像，P1-1：换嵌入模型后全量重解析恢复检索）。
 *
 * <p>字段名与 mis-kb {@code KbReparseAllResult} 逐一对齐（本层纯透传，
 * 不加工不翻译）：{@code total} 库内文档总数；{@code success} 新触发数；
 * {@code failed} 失败数；{@code skipped} 解析中幂等跳过数；
 * {@code failedDocuments} 失败明细。
 */
public record KbReparseAllResultVO(
        Long libraryId,
        int total,
        int success,
        int failed,
        int skipped,
        List<FailedDocumentVO> failedDocuments) {

    /** 单文档失败明细（仅含 MIS 业务 id）。 */
    public record FailedDocumentVO(Long documentId, String title, String reason) {
    }
}
