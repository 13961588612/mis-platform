package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 启动流程实例。
 *
 * @param startedFormCode 本次使用的表单代码，必须在定义白名单内
 * @param appCode         可选应用归属（{@code sys_app.code}）；{@code null}/空白 = 平台级。
 *                        启动时**由发起方显式写入** {@code wf_instance.app_code}；其分派待办、
 *                        结果通知**继承**该值。不再由业务类型推导（P0 绑定表已作废）。
 *                        末尾追加，兼容既有 {@code new StartProcessRequest(...)} 调用点。
 */
public record StartProcessRequest(
        @NotBlank String definitionCode,
        @NotBlank String businessType,
        @NotBlank String businessId,
        @NotBlank String startedFormCode,
        String formData,
        Long initiatorId,
        String initiatorName,
        String appCode
) {
}
