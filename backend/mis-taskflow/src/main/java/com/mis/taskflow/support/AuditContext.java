package com.mis.taskflow.support;

import java.util.HashMap;
import java.util.Map;

/**
 * 审计上下文（ThreadLocal）：在业务方法内设置业务标识与 before/after 快照，
 * 由 {@link BusinessOperationAspect} 读取后写入 {@code sys_audit_op}。
 *
 * <p>用法：
 * <pre>{@code
 *   AuditContext.businessId("PO-001");
 *   AuditContext.before(oldJson);
 *   ... do work ...
 *   AuditContext.after(newJson);
 * }</pre>
 * 切面在方法返回/异常后自动清理，避免线程复用串数据。
 */
public final class AuditContext {

    private static final ThreadLocal<Map<String, String>> HOLDER = ThreadLocal.withInitial(HashMap::new);

    private AuditContext() {
    }

    public static void businessId(String id) {
        HOLDER.get().put("businessId", id);
    }

    public static void before(String json) {
        HOLDER.get().put("before", json);
    }

    public static void after(String json) {
        HOLDER.get().put("after", json);
    }

    public static String get(String key) {
        return HOLDER.get().get(key);
    }

    public static void clear() {
        HOLDER.remove();
    }
}