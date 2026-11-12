package com.mis.org.dto;

import java.util.List;

/**
 * 用户数据范围查询响应（供 BFF 调用的内部接口）。
 */
public record UserDataSetScopeVO(
        Long userId,
        int dataScope,
        boolean all,
        List<Long> orgIds,
        List<Long> deptIds,
        List<Long> deptSubtreeIds,
        List<DeptAnchor> deptAnchors,
        List<Long> storeIds
) {
    /** 部门锚点，用于行级注入的 PATH_PREFIX 模式 */
    public record DeptAnchor(
            Long id,
            String path,
            String scope
    ) {}
}
