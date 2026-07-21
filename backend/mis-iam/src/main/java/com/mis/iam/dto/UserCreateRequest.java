package com.mis.iam.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record UserCreateRequest(
        @NotNull Long tenantId,
        @NotNull Long appId,
        @NotNull Long employeeId,
        @NotBlank String username,
        @NotBlank String password,
        List<Long> roleIds
) {}
