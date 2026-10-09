package com.mis.taskflow.support;

import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.taskflow.domain.entity.SysAuditOp;
import com.mis.taskflow.service.AuditOpService;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * 业务操作审计切面（P4）。
 *
 * <p>拦截 {@link BusinessOperation} 注解方法：成功与异常两条路径都落库 {@code sys_audit_op}，
 * 记录耗时、结果状态与（由 {@link AuditContext} 提供的）before/after 差异。
 *
 * <p>顺序：{@code @Order(Ordered.LOWEST_PRECEDENCE)} —— 尽量贴近业务方法，避免被事务/安全切面干扰。
 */
@Aspect
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class BusinessOperationAspect {

    private final AuditOpService auditOpService;

    public BusinessOperationAspect(AuditOpService auditOpService) {
        this.auditOpService = auditOpService;
    }

    @Around("@annotation(bizOp)")
    public Object around(ProceedingJoinPoint pjp, BusinessOperation bizOp) throws Throwable {
        long start = System.currentTimeMillis();
        Optional<LoginUser> login = SecurityContextHolder.getOptional();

        try {
            Object result = pjp.proceed();
            record(bizOp, login, true, null, System.currentTimeMillis() - start);
            return result;
        } catch (Throwable ex) {
            record(bizOp, login, false, ex.getMessage(), System.currentTimeMillis() - start);
            throw ex;
        } finally {
            AuditContext.clear();
        }
    }

    private void record(BusinessOperation bizOp, Optional<LoginUser> login,
                        boolean success, String errorMsg, long durationMs) {
        try {
            SysAuditOp op = new SysAuditOp();
            login.ifPresent(u -> {
                op.setTenantId(u.getTenantId());
                op.setUserId(u.getUserId());
                op.setUsername(u.getUsername());
            });
            if (op.getTenantId() == null) {
                op.setTenantId(1L); // 单租户阶段兜底
            }
            op.setModule(bizOp.module());
            op.setOperationType(bizOp.type());
            op.setBusinessType(blankToNull(bizOp.businessType()));
            op.setBusinessId(AuditContext.get("businessId"));
            op.setDescription(resolveDescription(bizOp));
            op.setBeforeData(orDefault(AuditContext.get("before"), "{}"));
            op.setAfterData(orDefault(AuditContext.get("after"), "{}"));
            op.setDiffSummary(AuditDiffUtils.diff(AuditContext.get("before"), AuditContext.get("after")));
            op.setResultStatus(success ? SysAuditOp.SUCCESS : SysAuditOp.FAIL);
            op.setErrorMsg(errorMsg);
            op.setDurationMs((int) Math.min(durationMs, Integer.MAX_VALUE));
            op.setOperTime(LocalDateTime.now());
            auditOpService.save(op);
        } catch (Exception ignored) {
            // 审计失败绝不影响主业务
        }
    }

    private String resolveDescription(BusinessOperation bizOp) {
        if (!bizOp.description().isBlank()) {
            return bizOp.description();
        }
        return bizOp.module() + " · " + bizOp.type();
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }

    private static String orDefault(String v, String def) {
        return v == null || v.isBlank() ? def : v;
    }
}