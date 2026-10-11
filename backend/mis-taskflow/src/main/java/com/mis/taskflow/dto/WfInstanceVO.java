package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 流程实例视图。
 *
 * @param appCode 应用归属（{@code sys_app.code}，启动时显式写入 {@code wf_instance.app_code}）；
 *                {@code null} = 平台级。末尾追加。
 */
public record WfInstanceVO(
        String id,
        String definitionCode,
        String startedFormCode,
        String businessType,
        String businessId,
        String status,
        String initiatorId,
        String initiatorName,
        String currentNodeCode,
        String currentNodeName,
        String progress,
        String postProcessStatus,
        Integer postRetryCount,
        LocalDateTime createdAt,
        LocalDateTime completedAt,
        String appCode
) {
}
