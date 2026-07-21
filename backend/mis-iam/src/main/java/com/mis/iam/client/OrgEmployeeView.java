package com.mis.iam.client;

/** mis-org 员工详情（仅取校验/展示所需字段）。 */
public record OrgEmployeeView(String id, String tenantId, String deptId, String realName, Integer status) {}
