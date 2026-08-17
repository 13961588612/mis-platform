package com.mis.adminbff.client.model;

import java.util.List;

/**
 * 部门类型树节点 VO（BFF 透传 mis-org DeptTypeTreeNodeVO）。
 */
public record DeptTypeTreeNodeVO(
        String id,
        String code,
        String name,
        Integer sort,
        Integer status,
        Integer isLeaf,
        Integer referenceCount,
        String parentId,
        List<DeptTypeTreeNodeVO> children
) {}
