-- ===========================================================================
-- V47__post_type_hierarchy.sql —— 岗位类型多层化（父级 + 末级标记）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V46 为最新；本文件为 V47，Flyway 只追加不修改已发布版本。
--
-- 内容：sys_post_type 新增 parent_id / is_leaf 两列。
--   - 历史 5 条扁平类型（id 1-5）自动成为「根级末级」（parent_id=0、is_leaf=1），
--     无需重分类（E.2 决策：否）。
--   - is_leaf 由后端单一真源维护（PostService.refreshLeaf），前端不选/不传/不推断。
--
-- 幂等：IF NOT EXISTS 保证重复执行安全；UPDATE 兜底 NULL 归一到 0/1（兼容部分库 ALTER 不回填）。
-- ===========================================================================

-- 父级 id：0=根级（无父）
ALTER TABLE sys_post_type
  ADD COLUMN IF NOT EXISTS parent_id BIGINT NOT NULL DEFAULT 0;

-- 末级标记：1=末级（可被选作岗位类型）/ 0=非末级（仅作分类）
ALTER TABLE sys_post_type
  ADD COLUMN IF NOT EXISTS is_leaf SMALLINT NOT NULL DEFAULT 1;

-- 兜底：部分 PostgreSQL 版本 ALTER ADD COLUMN ... NOT NULL DEFAULT 不会回填历史 NULL，统一归一到 0/1
UPDATE sys_post_type SET parent_id = 0 WHERE parent_id IS NULL;
UPDATE sys_post_type SET is_leaf = 1 WHERE is_leaf IS NULL;
