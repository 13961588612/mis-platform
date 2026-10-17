package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDateTime;

/**
 * 启动流程实例。
 *
 * @param startedFormCode 本次使用的表单代码，必须在定义白名单内
 * @param appCode            可选应用归属（{@code sys_app.code}）；{@code null}/空白 = 平台级。
 *                           启动时**由发起方显式写入** {@code wf_instance.app_code}；其分派待办、
 *                           结果通知**继承**该值。不再由业务类型推导（P0 绑定表已作废）。
 * @param initiatorOrgName   可选发起人所属组织/公司名快照；写入 {@code wf_instance.initiator_org_name}，
 *                           供门户「发起人（公司）」展示。末尾追加，兼容既有调用点。
 * @param title              可选流程标题；非空优先写入 {@code wf_instance.title}。为空时按表单
 *                           {@code config.titleField} 从 {@code formData} 取值；仍取不到则校验失败。
 * @param priority           可选紧急程度（1 低 / 2 普通 / 3 高 / 4 紧急）；写入实例快照并用于分派待办。
 * @param dueDate            可选过期时间；写入实例快照并用于分派待办；缺省则回退节点 timeoutHours。
 * @param formRecordId       可选关联表单单据；由单据发起时写入 {@code wf_instance.form_record_id}。
 */
public record StartProcessRequest(
        @NotBlank String definitionCode,
        @NotBlank String businessType,
        @NotBlank String businessId,
        @NotBlank String startedFormCode,
        String formData,
        Long initiatorId,
        String initiatorName,
        String appCode,
        String initiatorOrgName,
        String title,
        Short priority,
        LocalDateTime dueDate,
        Long formRecordId
) {
    /** 兼容旧调用：无 formRecordId。 */
    public StartProcessRequest(
            String definitionCode,
            String businessType,
            String businessId,
            String startedFormCode,
            String formData,
            Long initiatorId,
            String initiatorName,
            String appCode,
            String initiatorOrgName,
            String title,
            Short priority,
            LocalDateTime dueDate) {
        this(definitionCode, businessType, businessId, startedFormCode, formData,
                initiatorId, initiatorName, appCode, initiatorOrgName, title, priority, dueDate, null);
    }
}
