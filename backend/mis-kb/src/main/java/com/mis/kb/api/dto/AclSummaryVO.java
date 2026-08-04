package com.mis.kb.api.dto;

/**
 * ACL 摘要（用于库详情与会话详情的可见范围展示）。
 *
 * <p>{@code subjectName} 由 BFF 侧回填（mis-kb 不直连 IAM/Org 做批量名称解析，
 * 避免在领域服务里引入 N+1 远程调用）；mis-kb 返回时该字段为 {@code null}。
 */
public record AclSummaryVO(
        String subjectType,
        Long subjectId,
        String subjectName,
        String action) {

    /** 无名称版本的便捷构造（mis-kb 内部使用）。 */
    public AclSummaryVO(String subjectType, Long subjectId, String action) {
        this(subjectType, subjectId, null, action);
    }
}
