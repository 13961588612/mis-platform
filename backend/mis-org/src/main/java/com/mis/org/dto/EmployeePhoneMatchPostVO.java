package com.mis.org.dto;

/**
 * 按手机查员工时返回的「任职岗位」轻量项（部门/组织/岗位名已解析）。
 * 字段与 BFF 端 EmployeePhoneMatchPostVO 对齐，便于 JSON 直序列化。
 */
public record EmployeePhoneMatchPostVO(
        String deptId,
        String deptName,
        String orgName,
        String postId,
        String postName,
        Integer isPrimary
) {}
