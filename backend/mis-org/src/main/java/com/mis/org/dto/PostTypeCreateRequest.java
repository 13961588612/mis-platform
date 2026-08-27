package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 岗位类型创建请求（多层化：parentId + 显式 isLeaf）。
 *
 * <p>isLeaf 为表字段，由调用方指定（默认 1=末级），不再根据是否有子节点推导。
 * 挂到非根父级时，父必须已是非末级（分类）。
 */
public record PostTypeCreateRequest(
        @NotNull Long tenantId,
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        Integer status,
        /** 父级 id；0=根级（默认）。父非 0 时须为非末级。 */
        Long parentId,
        /** 1=末级 / 0=非末级（分类）；null 默认 1。 */
        Integer isLeaf
) {}
