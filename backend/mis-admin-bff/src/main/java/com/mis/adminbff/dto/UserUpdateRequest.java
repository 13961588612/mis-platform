package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record UserUpdateRequest(
        @NotBlank String username,
        String realName,
        String email,
        String phone,
        Integer status
) {}
