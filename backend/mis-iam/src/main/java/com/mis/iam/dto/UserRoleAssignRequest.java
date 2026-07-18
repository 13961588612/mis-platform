package com.mis.iam.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record UserRoleAssignRequest(
        @NotNull List<Long> roleIds
) {}
