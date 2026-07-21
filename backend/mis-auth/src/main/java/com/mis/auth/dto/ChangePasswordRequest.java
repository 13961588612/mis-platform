package com.mis.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 用户自助修改密码。 */
public record ChangePasswordRequest(
        @NotBlank @Size(min = 6, max = 64) String oldPassword,
        @NotBlank @Size(min = 8, max = 64) String newPassword
) {
}
