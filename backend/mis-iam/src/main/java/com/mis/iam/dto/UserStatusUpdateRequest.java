package com.mis.iam.dto;

import jakarta.validation.constraints.NotNull;

public record UserStatusUpdateRequest(@NotNull Integer status) {}
