package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotNull;

public record StatusUpdateRequest(@NotNull Integer status) {}
