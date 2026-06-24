package com.mis.common.jpa.datascope;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 声明 Repository / Service 方法需要附加数据权限条件。
 * 与 {@link DataScopeSpecification} 配合，在领域服务层拼接到 {@link org.springframework.data.jpa.domain.Specification}。
 * <p>
 * 预设 data_scope（2/3/6）按员工全部在任任职并集过滤，见 ADR-014。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface DataScope {

    /** 部门字段名（实体属性，默认 deptId；无部门列时传空串） */
    String deptField() default "deptId";

    /** 组织字段名（实体有 orgId 时填写；无则留空，组织范围通过部门 ID 集合过滤） */
    String orgField() default "";

    /** 创建人字段名（data_scope=SELF 时使用，默认 createdBy） */
    String userField() default "createdBy";
}
