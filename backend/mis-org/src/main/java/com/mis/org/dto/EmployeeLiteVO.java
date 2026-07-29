package com.mis.org.dto;

/**
 * 轻量员工视图（编制统计用）：仅 id + 姓名。
 */
public record EmployeeLiteVO(
        String id,
        String name,
        Integer isPrimary
) {}
