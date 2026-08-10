package com.mis.kb.api.dto;

import java.util.List;

/**
 * 库级一键重解析结果（P1-1：换嵌入模型后全量重解析恢复检索）。
 *
 * <p>批量语义：遍历库内全部文档逐个触发重解析；单文档失败不中断其余。
 * <ul>
 *   <li>{@code total} = 库内文档总数；</li>
 *   <li>{@code success} = 本次新触发解析的文档数；</li>
 *   <li>{@code failed} = 触发失败、或尚无引擎映射无法解析的文档数；</li>
 *   <li>{@code skipped} = 已处于解析中、按幂等语义跳过的文档数；</li>
 *   <li>{@code failedDocuments} = 失败明细（id + 标题 + 原因，供前端失败列表展示）。</li>
 * </ul>
 */
public record KbReparseAllResult(
        Long libraryId,
        int total,
        int success,
        int failed,
        int skipped,
        List<FailedDocument> failedDocuments) {

    /** 单文档失败明细；仅含 MIS 业务 id，不暴露引擎原生 id。 */
    public record FailedDocument(Long documentId, String title, String reason) {
    }
}
