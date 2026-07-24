package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record OrgCreateRequest(
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        String remark,
        Long categoryId
) {}
