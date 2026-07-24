package com.mis.iam.dto;

import java.util.List;

public record RoleDataScopeVO(
        Integer dataScope,
        List<Long> orgIds,
        List<Long> deptIds
) {
}
