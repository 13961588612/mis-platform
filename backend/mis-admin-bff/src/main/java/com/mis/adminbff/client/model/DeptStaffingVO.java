package com.mis.adminbff.client.model;

import java.util.List;

/**
 * 部门岗位编制统计（对齐 mis-org DeptStaffingVO）：岗位数 / 已任职 / 空缺 + 各岗位明细 + 部门任职人员。
 */
public record DeptStaffingVO(
        String deptId,
        String deptName,
        Integer postCount,
        Integer filledCount,
        Integer vacantCount,
        List<PostStaffingVO> posts,
        List<EmployeeLiteVO> employees
) {}
