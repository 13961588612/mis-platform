package com.mis.org.dto;

/**
 * 部门类型展示 VO。
 */
public record DeptTypeVO(
        String id,
        String tenantId,
        String code,
        String name,
        Integer sort,
        Integer status,
        /** sys_dept 引用数（删除拦截依据） */
        Integer referenceCount,
        /** 父级 id；0=根级 */
        String parentId,
        /** 1=末级 / 0=非末级（显式字段） */
        Integer isLeaf
) {}
