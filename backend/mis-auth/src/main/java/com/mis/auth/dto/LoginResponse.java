package com.mis.auth.dto;

import java.util.List;

public record LoginResponse(
        String accessToken,
        long expiresIn,
        AppInfo app,
        UserInfo user
) {

    public record AppInfo(String id, String code, String name) {
    }

    public record UserInfo(
            String id,
            String employeeId,
            String username,
            String realName,
            String avatarUrl,
            String deptId,
            String deptName,
            List<String> roles,
            boolean mustChangePassword
    ) {
    }
}
