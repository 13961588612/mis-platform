package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 授权主体（I-03 主体选择器统一视图）。
 *
 * <p>用户/角色/部门三种主体在前端共用一个选择器组件，因此在 BFF 侧归一成同一结构，
 * 由 {@code type} 区分。部门是树形，用 {@code children} 承载；用户/角色为空列表。
 *
 * @param type     主体类型 user/role/dept
 * @param id       主体 id
 * @param name     显示名
 * @param extra    附加说明（用户显示部门名、角色显示编码、部门显示层级路径）
 * @param children 子节点（仅部门树使用）
 */
public record KbSubjectVO(
        String type,
        Long id,
        String name,
        String extra,
        List<KbSubjectVO> children) {

    /** 叶子节点便捷构造。 */
    public static KbSubjectVO leaf(String type, Long id, String name, String extra) {
        return new KbSubjectVO(type, id, name, extra, List.of());
    }
}
