package com.mis.org.dto;

import java.util.List;

/**
 * 部门类型树节点 VO（多层化）。
 *
 * <p>后端按 parent_id 递归组装：顶层节点 parentId=0；children 递归。isLeaf 标记末级
 * （仅末级可被部门选作类型）；referenceCount 实时引用计数。
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
