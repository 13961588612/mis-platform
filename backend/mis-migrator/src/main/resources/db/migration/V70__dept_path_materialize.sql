-- ===========================================================================
-- V70__dept_path_materialize.sql —— 部门路径物化（W2 行级范围前置）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V1（sys_dept 表）；本文件在 V71（iqd_schema，维度注册表 seed 引用
--       mis_dept_scope）之前执行。
--
-- 内容（W2 = T-W2-02a）：
--   A. sys_dept 加列 dept_path VARCHAR(512)（如 /0/1/100/）。
--   B. 存量部门全量回填（递归 CTE：根 = /<rootId>/；子孙 = 父路径 + id + /）。
--   C. 兜底：未达节点（孤儿/异常数据）按 /<id>/ 置根路径，保证非 NULL。
--
-- 维护级联（DeptService）：
--   - create：dept.setDeptPath(buildDeptPath(parent, id))
--   - update/relocate：本部门 + 全部子孙 rebuildDeptPath(parentId, id)
--   - 本迁移只做一次性物化；后续变更由 DeptService 维护（见 DeptService.java）。
--
-- 行级注入语义（scope_resolver PATH_PREFIX）：
--   EXISTS (SELECT 1 FROM mis_dept_scope d
--           WHERE d.dept_id = t.dept_id
--             AND (d.dept_path = '/0/1/100/' OR d.dept_path LIKE '/0/1/100/%'))
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. 加列
-- ---------------------------------------------------------------------------
ALTER TABLE sys_dept
    ADD COLUMN IF NOT EXISTS dept_path VARCHAR(512) NULL;

-- ---------------------------------------------------------------------------
-- B. 存量回填（递归 CTE；deleted=0 才参与，已删除不重算）
-- ---------------------------------------------------------------------------
WITH RECURSIVE dept_paths AS (
    SELECT id, parent_id, '/' || id || '/' AS path
    FROM sys_dept
    WHERE is_root = 1 AND deleted = 0
    UNION ALL
    SELECT d.id, d.parent_id, p.path || d.id || '/'
    FROM sys_dept d
    JOIN dept_paths p ON d.parent_id = p.id
    WHERE d.deleted = 0
)
UPDATE sys_dept s
SET dept_path = dp.path,
    updated_at = NOW()
FROM dept_paths dp
WHERE s.id = dp.id
  AND (s.dept_path IS NULL OR s.dept_path <> dp.path);

-- ---------------------------------------------------------------------------
-- C. 兜底：递归未达（根缺失/孤儿/软删根）按自身根路径补齐，保证非 NULL
-- ---------------------------------------------------------------------------
UPDATE sys_dept
SET dept_path = '/' || id || '/',
    updated_at = NOW()
WHERE dept_path IS NULL;

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   -- 1) 无 NULL
--   SELECT count(*) FROM sys_dept WHERE dept_path IS NULL;
--   -- 期望：0
--
--   -- 2) 抽查路径形态（应以 / 开头结尾，且包含祖先链）
--   SELECT id, parent_id, is_root, dept_path FROM sys_dept
--   WHERE deleted = 0 ORDER BY dept_path LIMIT 10;
--   -- 期望：根为 /<rootId>/；非根为父路径 + id + /
--
--   -- 3) 移动后路径级联（DeptService.relocate 单测覆盖）
--   --    移 A 到 B 下后：A 与其全部子孙 dept_path 前缀都变为 B 的路径。
-- ---------------------------------------------------------------------------
