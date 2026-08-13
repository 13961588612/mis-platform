package com.mis.org.dto;

import java.util.List;

/**
 * 组织穿透树节点 VO（只读 forest，每层懒加载）。
 *
 * <p>节点携带来源组织标识（orgId/orgName，子树根徽标）与锚点信息
 * （linkedOrgId/linkedOrgName，供「下钻」按钮）。children 为完整子树，递归同构。
 */
public record DeptPierceVO(
        String id,
        String orgId,
        String orgName,
        String parentId,
        String code,
        String name,
        Integer sort,
        Integer status,
        Integer isRoot,
        String linkedOrgId,
        String linkedOrgName,
        List<DeptPierceVO> children
) {}
