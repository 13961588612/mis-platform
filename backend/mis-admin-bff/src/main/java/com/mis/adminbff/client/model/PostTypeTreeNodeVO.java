package com.mis.adminbff.client.model;

import java.util.List;

/**
 * 岗位类型树节点 VO（BFF 透传 mis-org PostTypeTreeNodeVO）。
 */
public record PostTypeTreeNodeVO(
        String id,
        String code,
        String name,
        Integer sort,
        Integer status,
        Integer isLeaf,
        Integer referenceCount,
        String parentId,
        List<PostTypeTreeNodeVO> children
) {}
