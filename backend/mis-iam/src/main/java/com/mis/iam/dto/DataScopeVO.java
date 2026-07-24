package com.mis.iam.dto;

import java.util.List;

/** 用户有效数据范围（多角色取最宽松）及 CUSTOM 自定义组织/部门并集。 */
public record DataScopeVO(
        int dataScope,
        List<Long> customOrgIds,
        List<Long> customDeptIds
) {
    public DataScopeVO(int dataScope) {
        this(dataScope, List.of(), List.of());
    }
}
