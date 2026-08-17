-- ===========================================================================
-- V52__post_type_hierarchy.sql —— 岗位类型多层化（父级 + 末级标记）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V51 为最新；本文件为 V52，Flyway 只追加不修改已发布版本。
--
-- 背景：岗位类型树 DDL 曾误用版本号 V47，但库中 V47 已是
--       「sys app recon remote fix」，导致 parent_id / is_leaf 从未落地，
--       GET /post-types/tree 查询报列不存在（HTTP 500）。
--
-- 内容：sys_post_type 新增 parent_id / is_leaf 两列。
--   - 历史扁平类型自动成为「根级末级」（parent_id=0、is_leaf=1）。
--   - is_leaf 由后端单一真源维护（PostService.refreshLeaf）。
--
-- 幂等：IF NOT EXISTS；UPDATE 兜底 NULL 归一到 0/1。
-- ===========================================================================

ALTER TABLE sys_post_type
  ADD COLUMN IF NOT EXISTS parent_id BIGINT NOT NULL DEFAULT 0;

ALTER TABLE sys_post_type
  ADD COLUMN IF NOT EXISTS is_leaf SMALLINT NOT NULL DEFAULT 1;

UPDATE sys_post_type SET parent_id = 0 WHERE parent_id IS NULL;
UPDATE sys_post_type SET is_leaf = 1 WHERE is_leaf IS NULL;
