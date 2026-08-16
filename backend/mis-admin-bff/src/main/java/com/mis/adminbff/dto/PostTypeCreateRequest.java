package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * BFF 岗位类型创建请求（对齐 mis-org PostTypeCreateRequest）。V47 新增 parentId。
 */
public record PostTypeCreateRequest(
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        Integer status,
        /** V47 父级 id；0=根级（默认）。 */
        Long parentId
) {}
