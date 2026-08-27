package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * BFF 部门类型创建请求（对齐 mis-org DeptTypeCreateRequest；tenantId 由 BFF 注入）。
 */
public record DeptTypeCreateRequest(
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        Integer status,
        /** 父级 id；0=根级（默认）。 */
        Long parentId,
        /** 1=末级 / 0=非末级；null 默认由下游按 1 处理。 */
        Integer isLeaf
) {}
