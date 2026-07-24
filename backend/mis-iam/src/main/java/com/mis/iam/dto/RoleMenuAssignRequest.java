package com.mis.iam.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record RoleMenuAssignRequest(@NotNull List<Long> menuIds) {}
