package com.mis.adminbff.client.model;

/** mis-org 按手机查员工返回的「任职岗位」轻量项（BFF 端镜像，Req2：展示岗位情况）。 */
public record EmployeePhoneMatchPostVO(
        String deptId,
        String deptName,
        String orgName,
        String postId,
        String postName,
        Integer isPrimary
) {}
