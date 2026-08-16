package com.mis.org.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record EmployeeVO(
        String id,
        String tenantId,
        String deptId,
        List<String> deptIds,
        String primaryDeptId,
        List<EmployeePostVO> posts,
        String employeeNo,
        String realName,
        String email,
        String phone,
        Integer gender,
        String title,
        LocalDate hireDate,
        Integer status,
        /** 是否内置账号：1=内置（手机号必填/唯一校验豁免，EMP-03，Q2 推荐方案）；0=普通 */
        Integer isBuiltin,
        Instant createdAt,
        Instant updatedAt
) {}
