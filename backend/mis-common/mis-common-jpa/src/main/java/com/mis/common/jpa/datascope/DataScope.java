package com.mis.common.jpa.datascope;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 声明 Repository / Service 方法需要附加数据权限条件。
 * 与 {@link DataScopeSpecification} 配合，在领域服务层拼接到 {@link org.springframework.data.jpa.domain.Specification}。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface DataScope {

    /** 部门字段名（实体属性，默认 deptId） */
    String deptField() default "deptId";

    /** 创建人字段名（data_scope=SELF 时使用，默认 createdBy） */
    String userField() default "createdBy";
}
