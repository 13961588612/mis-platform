package com.mis.kb.api.dto;

import com.mis.kb.domain.model.RagSettings;

import java.util.List;

/**
 * 知识库详情聚合视图（L-06）。
 *
 * <p>一次返回「基本信息 + 文档数 + 授权摘要 + RAG 设置」，供前端库详情三 Tab 渲染，
 * 避免前端串行发起 4 次请求。
 *
 * @param meta        知识库基本信息
 * @param docCount    文档总数
 * @param aclSummary  授权摘要列表
 * @param ragSettings 生效的 RAG 设置（已用默认值补齐）
 */
public record KbLibraryDetailVO(
        KbLibraryVO meta,
        long docCount,
        List<AclSummaryVO> aclSummary,
        RagSettings ragSettings) {
}
