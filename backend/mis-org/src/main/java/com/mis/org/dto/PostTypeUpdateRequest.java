package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 岗位类型更新请求（code 不可编辑，与 org/dict 更新语义一致）。
 * V47 多层化：新增可选 parentId（变更上级时校验不能挂到自身子孙）。
 */
public record PostTypeUpdateRequest(
        @NotBlank String name,
        Integer sort,
        Integer status,
        /** V47 父级 id；null=不修改上级，0=挂到根级，其他=指定父级。 */
        Long parentId
) {}
