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

    /**
     * 解包下游 {@link Result}：成功取 {@code data}，失败转 {@link BusinessException} 抛出。
     *
     * <p><b>失败分支必须把 {@code data} 一起带走。</b>改造前这里只透传
     * {@code code + message}，结果是下游精心组装的结构化明细在 BFF 这一跳被静默吞掉。
     * 最典型的受害者是同义词词条冲突（40927）——mis-kb 在 {@code data} 里放了
     * {@code {term, ownerGroupId, ownerCanonicalTerm}}，前端要靠这三样拼出
     * 「「OKR」已属于术语组「关键结果法」」并提供跳转；丢了 {@code ownerCanonicalTerm}，
     * 前端只能降级显示 {@code #42} 这种对用户毫无意义的编号。
     *
     * <p>它更阴险的地方在于：链路全程无异常、无日志、无告警，前后端各自的单测也都是绿的，
     * 只有真人点进那个弹窗才会发现文案缺了一半。
     *
     * <p><b>对既有调用方的影响：</b>下游成功时行为一字未变；下游失败且 {@code data} 为
     * {@code null}（当前绝大多数错误码的情形）时，产出的异常与改造前完全等价。
     * 只有下游<b>显式</b>往错误响应里塞了明细时，这份明细才会继续向上传递——
     * 这正是它被塞进去的目的。
     *
     * @param result 下游响应
     * @param <T>    数据类型
     * @return 成功时的 {@code data}
     * @throws BusinessException 下游无响应或返回失败码
     */
    public static <T> T unwrap(Result<T> result) {
        if (result == null) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "下游无响应");
        }
        if (!result.isSuccess()) {
            throw new BusinessException(result.getCode(), result.getMessage(), result.getData());
        }
        return result.getData();
    }
}
