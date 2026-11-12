# Step 3b: Create UserDataSetScopeVO in BFF models
path = r"D:\code\mis-platform\backend\mis-admin-bff\src\main\java\com\mis\adminbff\client\model\UserDataSetScopeVO.java"

content = """package com.mis.adminbff.client.model;

import java.util.List;
import java.util.Map;

/**
 * BFF 侧的用户数据范围视图（反序列化 mis-org /internal/v1/orgs/users/{userId}/data-scope）。
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
"""

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Created UserDataSetScopeVO in BFF models")
