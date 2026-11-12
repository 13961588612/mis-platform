package com.mis.taskflow.support;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 业务操作审计注解（P4）。
 *
 * <p>标注在 Service 的写操作方法上，由 {@link BusinessOperationAspect} 自动记录到
 * {@code sys_audit_op}：模块、操作类型、业务标识、人类可读描述、耗时与结果状态。
 *
 * <p>示例：
 * <pre>{@code
 *   @BusinessOperation(module = "采购管理", type = "UPDATE",
 *       businessType = "PURCHASE_ORDER", description = "更新了采购单")
 *   public void updateOrder(Long id, ...) { ... }
 * }</pre>
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface BusinessOperation {

    /** 业务模块，如「采购管理」。 */
    String module();

    /** 操作类型：CREATE / UPDATE / DELETE / APPROVE / REJECT / ASSIGN / EXPORT。 */
    String type();

    /** 业务类型，如 PURCHASE_ORDER（可空）。 */
    String businessType() default "";

    /** 人类可读描述（可空，缺省由模块+类型生成）。 */
    String description() default "";

    /** 是否记录变更前数据（需调用方通过上下文提供）。 */
    boolean captureBefore() default false;

    /** 是否记录变更后数据。 */
    boolean captureAfter() default false;
}