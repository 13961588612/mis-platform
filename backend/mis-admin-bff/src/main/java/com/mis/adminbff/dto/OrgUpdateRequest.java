package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record OrgUpdateRequest(
        @NotBlank String name,
        Integer sort,
        Integer status,
        String remark
) {}
