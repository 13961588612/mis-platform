package com.mis.adminbff.client.model;

import java.util.List;
import java.util.Map;

/**
 * BFF side user data scope view for deserializing mis-org response.
 */
public record UserDataSetScopeVO(
        Long userId,
        Integer dataScope,
        Boolean all,
        List<Long> orgIds,
        List<Long> deptIds,
        List<Long> deptSubtreeIds,
        List<DeptAnchor> deptAnchors,
        List<Long> storeIds
) {
    public record DeptAnchor(
            Long id,
            String path,
            String scope
    ) {}
}
