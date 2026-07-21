package com.mis.adminbff.client.model;

import java.util.List;

public record RoleDataScopeVO(
        Integer dataScope,
        List<Long> orgIds,
        List<Long> deptIds
) {
}
