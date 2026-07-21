package com.mis.iam.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record RoleDataScopeRequest(
        @NotNull Integer dataScope,
        List<Long> orgIds,
        List<Long> deptIds
) {
}
