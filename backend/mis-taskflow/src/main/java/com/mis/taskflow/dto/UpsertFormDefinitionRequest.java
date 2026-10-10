package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 新增/更新表单定义请求。
 *
 * <p>code 的格式约束与流程定义 code 保持同一套规则：{@code ^[A-Z][A-Z0-9_]{1,63}$}。
 * code 大小写敏感（前端注册表 key 精确匹配），故只允许大写。
 *
 * <p>V133 起分类是表单的<b>属性</b>：{@code categoryId} 软引用 {@code form_category.id}，
 * 可空（null=未分类）。旧模型里的 {@code parentId} / {@code kind} 已移除。
 */
public record UpsertFormDefinitionRequest(
        Long categoryId,
        @NotBlank(message = "表单编码不能为空")
        @Pattern(regexp = "^[A-Z][A-Z0-9_]{1,63}$", message = "表单编码须为 ^[A-Z][A-Z0-9_]{1,63}$")
        String code,
        @NotBlank(message = "表单名称不能为空")
        @Size(max = 128, message = "表单名称最长 128 字符")
        String name,
        @Size(max = 2000, message = "说明最长 2000 字符")
        String description,
        String status,
        Integer sortOrder,
        String config
) {
}
