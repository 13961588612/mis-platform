package com.mis.auth.dto;

import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
        @NotBlank String appCode,
        @NotBlank String username,
        @NotBlank String password,
        String captchaId,
        String captchaCode
) {
}
