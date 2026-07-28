package com.mis.adminbff.audit;

import com.mis.adminbff.client.AuditWebClient;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.security.context.LoginUser;
import com.mis.common.web.audit.OperLog;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.HashMap;
import java.util.Map;

@Aspect
@Component
public class OperLogAspect {

    private static final Logger log = LoggerFactory.getLogger(OperLogAspect.class);

    private final AuditWebClient auditWebClient;

    public OperLogAspect(AuditWebClient auditWebClient) {
        this.auditWebClient = auditWebClient;
    }

    @Around("@annotation(operLog)")
    public Object around(ProceedingJoinPoint pjp, OperLog operLog) throws Throwable {
        long start = System.currentTimeMillis();
        Integer responseCode = 0;
        Throwable error = null;
        try {
            Object result = pjp.proceed();
            return result;
        } catch (Throwable ex) {
            error = ex;
            responseCode = 1;
            throw ex;
        } finally {
            try {
                writeLog(pjp, operLog, System.currentTimeMillis() - start, responseCode, error);
            } catch (Exception ex) {
                log.debug("写操作日志失败: {}", ex.getMessage());
            }
        }
    }

    private void writeLog(
            ProceedingJoinPoint pjp, OperLog operLog, long durationMs, Integer responseCode, Throwable error) {
        LoginUser user = null;
        try {
            user = RequestContext.requireLoginUser();
        } catch (Exception ignored) {
            // 无登录上下文时仍尝试记录
        }
        HttpServletRequest request = currentRequest();
        MethodSignature signature = (MethodSignature) pjp.getSignature();
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", user != null && user.getTenantId() != null ? user.getTenantId() : 0L);
        body.put("userId", user != null ? user.getUserId() : null);
        body.put("username", user != null ? user.getUsername() : null);
        body.put("module", operLog.module());
        body.put("operation", operLog.operation());
        body.put("method", signature.getDeclaringTypeName() + "." + signature.getName());
        body.put("requestUri", request != null ? request.getRequestURI() : null);
        body.put("requestMethod", request != null ? request.getMethod() : null);
        body.put("requestParams", null);
        body.put("responseCode", responseCode);
        body.put("durationMs", (int) Math.min(durationMs, Integer.MAX_VALUE));
        body.put("ip", request != null ? request.getRemoteAddr() : null);
        auditWebClient.createOperLog(body);
    }

    private static HttpServletRequest currentRequest() {
        ServletRequestAttributes attrs =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return attrs != null ? attrs.getRequest() : null;
    }
}
