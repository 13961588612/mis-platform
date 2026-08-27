package com.mis.org.dto;

import java.util.List;

/**
 * 组织穿透树节点 VO（只读 forest，每层懒加载）。
 *
 * <p>节点携带来源组织标识（orgId/orgName，子树根徽标）与锚点信息
 * （linkedOrgId/linkedOrgName，供「下钻」按钮）。children 为完整子树，递归同构。
 * V54 新增 deptTypeId / deptTypeName（部门类型，穿透只读行同样展示，与 tree 对齐）。
 */
public record DeptPierceVO(
        String id,
        String orgId,
        String orgName,
        String parentId,
        String code,
        String name,
        /** V54 部门类型 id（String 对齐前端 DeptNode.deptTypeId） */
        String deptTypeId,
        /** V54 部门类型名（按 deptTypeId 经 buildDeptTypeNameMap 解析） */
        String deptTypeName,
        Integer sort,
        Integer status,
        Integer isRoot,
        String linkedOrgId,
        String linkedOrgName,
        List<DeptPierceVO> children
) {}
