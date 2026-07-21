package com.mis.adminbff.support;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;

/**
 * 从 Gateway 透传上下文取租户 / APP / 操作人。
 */
public final class RequestContext {

    private RequestContext() {
    }

    public static LoginUser requireLoginUser() {
        return SecurityContextHolder.requireLoginUser();
    }

    public static Long requireTenantId() {
        Long tenantId = requireLoginUser().getTenantId();
        if (tenantId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少 X-Tenant-Id");
        }
        return tenantId;
    }

    public static Long requireAppId() {
        Long appId = requireLoginUser().getAppId();
        if (appId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少 X-App-Id");
        }
        return appId;
    }

    public static Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }

    public static <T> T unwrap(Result<T> result) {
        if (result == null) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "下游无响应");
        }
        if (!result.isSuccess()) {
            throw new BusinessException(result.getCode(), result.getMessage());
        }
        return result.getData();
    }
}
