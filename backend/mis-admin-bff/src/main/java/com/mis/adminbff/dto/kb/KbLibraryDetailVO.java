package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 知识库详情聚合视图（L-06，BFF 侧镜像）。
 *
 * <p>对应详情页三个 Tab：基本信息 / 文档（数量在此，明细单独拉）/ 授权 / RAG 设置。
 *
 * @param meta        基本信息
 * @param docCount    文档数
 * @param aclSummary  授权摘要（{@code subjectName} 由 BFF 回填）
 * @param ragSettings RAG 设置
 */
public record KbLibraryDetailVO(
        KbLibraryVO meta,
        Long docCount,
        List<KbAclSummaryVO> aclSummary,
        KbRagSettings ragSettings) {
}
