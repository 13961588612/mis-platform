package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;

public record DeptUpdateRequest(
        @NotBlank String name,
        Long categoryId,
        Long parentId,
        Integer sort,
        Integer status,
        Long leaderEmployeeId
) {}
