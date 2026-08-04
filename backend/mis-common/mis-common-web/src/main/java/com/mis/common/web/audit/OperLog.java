package com.mis.common.web.audit;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** 操作审计注解：由 AOP 写入 sys_oper_log（失败不影响业务）。 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface OperLog {

    String module();

    String operation();

    /**
     * 是否把入参与结果条数写入 {@code sys_oper_log.request_params}（T19）。
     *
     * <p><b>默认 {@code false} 是二进制兼容的充要条件</b>：本注解是 {@code RUNTIME} 保留的，
     * 已编译的 6 个存量使用方字节码里没有 {@code recordParams} 这一项，若不给默认值，
     * 运行期读取注解会抛 {@code IncompleteAnnotationException}。所以这个 {@code default}
     * 不是「顺手加的可选项」，删了就是线上事故。
     *
     * <p><b>默认关闭还有第二重意义</b>：审计表保留期长、查询权限比业务表宽、还常导出给合规。
     * 入参默认不落库，等于把「记什么」变成一次显式决定，而不是无声的默认行为。
     *
     * <p>置为 {@code true} 时，切面会采集<b>脱敏后</b>的入参（见 {@code OperLogAspect}
     * 的字段名黑名单，C5-2）与返回结果条数。开启前请确认该端点入参不含凭据类字段。
     *
     * @return {@code true} 表示采集入参；缺省 {@code false} 保持历史行为（写 null）
     */
    boolean recordParams() default false;
}
