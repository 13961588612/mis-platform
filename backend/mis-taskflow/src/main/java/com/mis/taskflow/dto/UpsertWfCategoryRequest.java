package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 新增/更新流程分类请求。
 *
 * <p>code 走与表单定义同一套格式约束（{@code ^[A-Z][A-Z0-9_]{1,63}$}），作为文件夹 key。
 * 租户内唯一（{@code uk_wf_category_tenant_code}）。
 */
public record UpsertWfCategoryRequest(
        Long parentId,
        @NotBlank(message = "分类编码不能为空")
        @Pattern(regexp = "^[A-Z][A-Z0-9_]{1,63}$", message = "分类编码须为 ^[A-Z][A-Z0-9_]{1,63}$")
        String code,
        @NotBlank(message = "分类名称不能为空")
        @Size(max = 128, message = "分类名称最长 128 字符")
        String name,
        @Size(max = 2000, message = "说明最长 2000 字符")
        String description,
        Integer sortOrder,
        String config
) {
}
