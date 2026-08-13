package com.mis.org.dto;

import java.time.LocalDate;

/**
 * 创建/更新员工时提交的单个岗位任职项。
 */
public record EmployeePostItem(
        Long postId,
        Integer isPrimary,
        LocalDate startDate
) {}
