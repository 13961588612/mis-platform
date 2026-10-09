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
 *
 * <p><b>嵌套安全</b>：切面在方法返回/异常后恢复进入时的快照（而非无条件清空），
 * 这样「带注解的外层方法 → 带注解的内层方法」不会让外层读到空 before/after。
 * 若只 {@code clear()}，内层切面出栈时会把外层已设置的上下文抹掉。
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

    /** 拍一份当前快照，供切面在退出时恢复（嵌套调用时保住外层上下文）。 */
    public static Map<String, String> snapshot() {
        return new HashMap<>(HOLDER.get());
    }

    /** 恢复到先前快照；快照为 null 表示进入时无上下文，整体清空。 */
    public static void restore(Map<String, String> snapshot) {
        if (snapshot == null || snapshot.isEmpty()) {
            HOLDER.remove();
            return;
        }
        HOLDER.get().clear();
        HOLDER.get().putAll(snapshot);
    }

    public static void clear() {
        HOLDER.remove();
    }
}