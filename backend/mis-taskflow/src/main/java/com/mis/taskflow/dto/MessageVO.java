package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 收件箱消息视图。
 *
 * @param read      当前用户的已读状态（来自明细表，而非主表聚合）
 * @param instanceId 关联流程实例 ID（无关联时为 {@code null}）
 * @param canReply  是否可回复（{@code msgType=='NOTIFY' && instanceId!=null}）
 * @param appCode   应用归属（{@code sys_app.code}）；{@code null} = 平台级
 * @param bizType   业务类型（软引用 {@code biz_category.code}）；{@code null} = 未标注（末尾追加）
 */
public record MessageVO(
        String id,
        String tenantId,
        String msgType,
        String category,
        String title,
        String summary,
        String senderId,
        String senderName,
        String referenceTaskId,
        String receiverGroupType,
        boolean read,
        Integer readCount,
        Integer totalCount,
        LocalDateTime createdAt,
        String instanceId,
        boolean canReply,
        String appCode,
        String bizType
) {
}