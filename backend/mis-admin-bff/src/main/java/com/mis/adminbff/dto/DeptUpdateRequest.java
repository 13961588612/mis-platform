package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record DeptUpdateRequest(
        @NotBlank String name,
        Long categoryId,
        Integer sort,
        Integer status,
        Long leaderEmployeeId,
        Long parentId
) {}
