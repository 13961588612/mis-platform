package com.mis.adminbff.client.model;

/**
 * 轻量员工视图（编制统计用，对齐 mis-org EmployeeLiteVO）：仅 id + 姓名。
 */
public record EmployeeLiteVO(
        String id,
        String name,
        Integer isPrimary
) {}
