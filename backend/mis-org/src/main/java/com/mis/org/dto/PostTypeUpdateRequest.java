package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 岗位类型更新请求（code 不可编辑，与 org/dict 更新语义一致）。
 */
public record PostTypeUpdateRequest(
        @NotBlank String name,
        Integer sort,
        Integer status
) {}
