package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * BFF 岗位类型更新请求（对齐 mis-org PostTypeUpdateRequest；code 不可编辑）。V47 新增可选 parentId。
 */
public record PostTypeUpdateRequest(
        @NotBlank String name,
        Integer sort,
        Integer status,
        /** V47 父级 id；null=不修改上级。 */
        Long parentId
) {}
