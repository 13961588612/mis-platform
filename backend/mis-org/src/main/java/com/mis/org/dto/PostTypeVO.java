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
        Integer status
) {}
