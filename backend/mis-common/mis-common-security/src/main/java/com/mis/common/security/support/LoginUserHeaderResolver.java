package com.mis.common.security.support;

import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.security.context.LoginUser;
import jakarta.servlet.http.HttpServletRequest;

/**
 * 从 Gateway 透传请求头解析 {@link LoginUser}。
 */
public final class LoginUserHeaderResolver {

    private LoginUserHeaderResolver() {
    }

    /**
     * @return 无 {@link SecurityConstants#HEADER_USER_ID} 时返回 null（白名单或未认证内部调用）
     */
    public static LoginUser resolve(HttpServletRequest request) {
        String userIdHeader = request.getHeader(SecurityConstants.HEADER_USER_ID);
        if (userIdHeader == null || userIdHeader.isBlank()) {
            return null;
        }

        LoginUser loginUser = new LoginUser();
        loginUser.setUserId(parseLong(userIdHeader));
        loginUser.setTenantId(parseLongHeader(request, SecurityConstants.HEADER_TENANT_ID));
        loginUser.setAppId(parseLongHeader(request, SecurityConstants.HEADER_APP_ID));
        loginUser.setEmployeeId(parseLongHeader(request, SecurityConstants.HEADER_EMPLOYEE_ID));

        String username = request.getHeader(SecurityConstants.HEADER_USERNAME);
        if (username != null && !username.isBlank()) {
            loginUser.setUsername(username.trim());
        }

        return loginUser;
    }

    private static Long parseLongHeader(HttpServletRequest request, String headerName) {
        String value = request.getHeader(headerName);
        if (value == null || value.isBlank()) {
            return null;
        }
        return parseLong(value.trim());
    }

    private static Long parseLong(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("Invalid numeric header value: " + value, ex);
        }
    }
}
