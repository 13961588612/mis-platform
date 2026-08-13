package com.mis.org.dto;

/**
 * 岗位类型展示 VO。
 */
public record PostTypeVO(
        String id,
        String tenantId,
        String code,
        String name,
        Integer sort,
        Integer status,
        /** V40 新增：sys_post 引用数（删除拦截依据；前端下拉用 status=1 过滤） */
        Integer referenceCount
) {}
