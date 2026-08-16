package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 岗位类型创建请求（V47 多层化：新增 parentId，默认根级 0）。
 */
public record PostTypeCreateRequest(
        @NotNull Long tenantId,
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        Integer status,
        /** V47 父级 id；0=根级（默认）。创建后刷新父节点 isLeaf=0。 */
        Long parentId
) {}
