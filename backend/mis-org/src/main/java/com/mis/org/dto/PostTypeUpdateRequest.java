package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 岗位类型更新请求（code 不可编辑）。
 * 多层化：可选 parentId（防环）+ 可选 isLeaf（显式字段，非按子节点推导）。
 */
public record PostTypeUpdateRequest(
        @NotBlank String name,
        Integer sort,
        Integer status,
        /** 父级 id；null=不修改上级，0=挂到根级；非 0 时父须为非末级。 */
        Long parentId,
        /** 1=末级 / 0=非末级；null=不修改。有子不可改末级；有岗位引用不可改分类。 */
        Integer isLeaf
) {}
