package com.mis.common.security.context;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;

import java.util.Optional;

/**
 * 当前线程登录用户（ThreadLocal）。
 * <p>
 * 由 {@link com.mis.common.security.filter.GatewayContextFilter} 在请求入口写入，请求结束清除。
 */
public final class SecurityContextHolder {

    private static final ThreadLocal<LoginUser> CONTEXT = new ThreadLocal<>();

    private SecurityContextHolder() {
    }

    public static void setLoginUser(LoginUser loginUser) {
        CONTEXT.set(loginUser);
    }

    public static Optional<LoginUser> getOptional() {
        return Optional.ofNullable(CONTEXT.get());
    }

    public static LoginUser getLoginUser() {
        return requireLoginUser();
    }

    public static LoginUser requireLoginUser() {
        LoginUser loginUser = CONTEXT.get();
        if (loginUser == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        return loginUser;
    }

    public static Optional<Long> getUserId() {
        return getOptional().map(LoginUser::getUserId);
    }

    public static Long requireUserId() {
        return requireLoginUser().getUserId();
    }

    public static void clear() {
        CONTEXT.remove();
    }
}
