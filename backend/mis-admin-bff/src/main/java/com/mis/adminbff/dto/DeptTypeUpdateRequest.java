package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * BFF 部门类型更新请求（对齐 mis-org DeptTypeUpdateRequest；code 不可编辑）。
 */
public record DeptTypeUpdateRequest(
        @NotBlank String name,
        Integer sort,
        Integer status,
        /** 父级 id；null=不修改上级。 */
        Long parentId,
        /** 1=末级 / 0=非末级；null=不修改。 */
        Integer isLeaf
) {}
