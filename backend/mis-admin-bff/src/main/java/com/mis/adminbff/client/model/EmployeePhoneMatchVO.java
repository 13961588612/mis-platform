package com.mis.adminbff.client.model;

import java.util.List;

/** mis-org 按手机查员工的轻量返回（建用户时提示绑定/手动选择，Req2）。 */
public record EmployeePhoneMatchVO(
        String id,
        String realName,
        String deptId,
        String deptName,
        String orgName,
        List<EmployeePhoneMatchPostVO> posts
) {}
