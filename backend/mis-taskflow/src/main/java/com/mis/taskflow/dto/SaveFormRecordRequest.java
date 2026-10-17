package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.Map;

/**
 * 保存/更新表单单据。
 *
 * @param formCode     表单编码
 * @param values       字段值（camelCase，与前端一致）
 * @param title        可选展示标题
 * @param createdBy    创建人（新建必填）
 * @param createdByName 创建人姓名
 */
public record SaveFormRecordRequest(
        @NotBlank String formCode,
        @NotNull Map<String, Object> values,
        String title,
        Long createdBy,
        String createdByName
) {
}
