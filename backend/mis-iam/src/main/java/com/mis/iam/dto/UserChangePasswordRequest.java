package com.mis.iam.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 内部：更新用户密码并清除 must_change_password。 */
public record UserChangePasswordRequest(
        @NotBlank @Size(min = 8, max = 64) String newPassword
) {
}
