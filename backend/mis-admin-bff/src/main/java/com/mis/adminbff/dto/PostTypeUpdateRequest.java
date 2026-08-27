package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * BFF 岗位类型更新请求（对齐 mis-org PostTypeUpdateRequest；code 不可编辑）。
 */
public record PostTypeUpdateRequest(
        @NotBlank String name,
        Integer sort,
        Integer status,
        /** 父级 id；null=不修改上级。 */
        Long parentId,
        /** 1=末级 / 0=非末级；null=不修改。 */
        Integer isLeaf
) {}
