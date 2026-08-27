package com.mis.org.dto;

import java.util.List;

/**
 * 按手机查员工时的轻量返回：仅含建用户绑定所需字段 + 任职岗位（岗位情况）。
 * 字段名与 BFF 端 EmployeePhoneMatchVO 对齐，便于 JSON 直序列化。
 */
public record EmployeePhoneMatchVO(
        String id,
        String realName,
        String deptId,
        String deptName,
        String orgName,
        List<EmployeePhoneMatchPostVO> posts
) {}
