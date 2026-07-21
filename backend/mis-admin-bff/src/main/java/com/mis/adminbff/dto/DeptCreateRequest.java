package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record DeptCreateRequest(
        @NotNull Long orgId,
        @NotNull Long parentId,
        @NotBlank String name,
        @NotNull Long categoryId,
        Integer sort,
        Long leaderEmployeeId
) {}
