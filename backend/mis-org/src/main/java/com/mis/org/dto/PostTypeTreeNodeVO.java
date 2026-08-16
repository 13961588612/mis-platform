package com.mis.org.dto;

import java.util.List;

/**
 * 岗位类型树节点 VO（V47 多层化）。
 *
 * <p>后端按 parent_id 递归组装：顶层节点 parentId=0；children 递归。isLeaf 标记末级
 * （仅末级可被岗位选作类型）；referenceCount 实时引用计数。
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
