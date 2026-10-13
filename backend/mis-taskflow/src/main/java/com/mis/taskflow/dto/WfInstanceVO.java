package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 流程实例视图。
 *
 * @param title   流程实例展示标题；{@code null} 仅兼容旧缓存（库列 NOT NULL）。
 * @param appCode 应用归属（{@code sys_app.code}，启动时显式写入 {@code wf_instance.app_code}）；
 *                {@code null} = 平台级。末尾追加。
 * @param formData 发起时提交的表单 JSON；仅 {@code includeFormData=true} 时填充，
 *                 默认列表为 {@code null}，避免门户分页多传表单体。
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
        /** 发起人所属组织/公司名；{@code null} 表示未快照。 */
        String initiatorOrgName,
        String currentNodeCode,
        String currentNodeName,
        String progress,
        String postProcessStatus,
        Integer postRetryCount,
        LocalDateTime createdAt,
        LocalDateTime completedAt,
        String appCode,
        String title,
        String formData
) {
}
