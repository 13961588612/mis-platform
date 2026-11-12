package com.mis.iqd.domain.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 只读部门子树查询（行级范围 dept 映射解析用）。
 *
 * <p>⚠️ 边界说明：{@code sys_dept} 归 mis-org 模块所有。此处只做**只读**子树展开，
 * 原因是 dept 的「锚点无直接映射 → 向下找有映射的后代（且只取最上级）」规则需要
 * MIS 部门树；mis-iqd 与 mis-org 共用 mis_platform 库。后续如需严格模块隔离，可改为
 * 调用 mis-org 内部接口。
 *
 * <p>查询用 {@code dept_path} 前缀匹配（V70 物化），deleted=0 且 dept_path 非空；
 * 结果按 {@code dept_path} 升序 —— 前缀序天然是「父先于子」的 DFS 前序，裁剪可边走边判。
 */
@Component
public class IqdDeptSubtreeLookup {

    /** 部门树节点：id + 物化路径。 */
    public record DeptNode(String id, String path) {
    }

    private final JdbcTemplate jdbcTemplate;

    public IqdDeptSubtreeLookup(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 返回锚点部门（含自身）及其全部后代的 (id, dept_path)，deleted=0，按 path 升序。
     *
     * @param deptId 锚点部门 id（sys_dept.id，字符串形态）
     * @return 子树节点（含锚点）；锚点不存在或无 dept_path 时退化为仅自身（path 为 null）
     */
    public List<DeptNode> subtreeNodes(String deptId) {
        if (deptId == null || deptId.isBlank()) {
            return List.of();
        }
        String id = deptId.trim();
        List<String> paths = jdbcTemplate.query(
                "SELECT dept_path FROM sys_dept WHERE id = ? AND deleted = 0",
                (rs, i) -> rs.getString(1),
                Long.valueOf(id));
        if (paths.isEmpty() || paths.get(0) == null || paths.get(0).isBlank()) {
            // 锚点不存在 / 无 path：退化为仅自身（无法判断子树）
            return List.of(new DeptNode(id, null));
        }
        String path = paths.get(0);
        return jdbcTemplate.query(
                "SELECT CAST(id AS VARCHAR), dept_path FROM sys_dept "
                        + "WHERE deleted = 0 AND dept_path LIKE ? ORDER BY dept_path",
                (rs, i) -> new DeptNode(rs.getString(1), rs.getString(2)),
                path + "%");
    }
}
