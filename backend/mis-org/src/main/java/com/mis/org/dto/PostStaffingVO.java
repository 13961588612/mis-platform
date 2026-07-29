package com.mis.org.dto;

import java.util.List;

/**
 * 部门岗位编制明细：岗位 + 任职人员（空缺时 holders 为空，vacant=true）。
 */
public record PostStaffingVO(
        String postId,
        String postName,
        String postType,
        List<EmployeeLiteVO> holders,
        boolean vacant
) {}
