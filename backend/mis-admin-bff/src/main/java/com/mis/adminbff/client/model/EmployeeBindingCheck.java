package com.mis.adminbff.client.model;

/**
 * 员工绑定预检结果：该员工是否已在指定「租户 + APP」内被其他账号绑定（D1 守卫）。
 */
public record EmployeeBindingCheck(boolean exists) {}
