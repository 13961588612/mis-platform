-- V145__wf_instance_title.sql
-- 流程实例补充展示标题 title | PostgreSQL 16 | 幂等
--
-- ## 背景
--   门户/待办需展示流程实例 TITLE；发起时可由表单 config.titleField 从 formData
--   取值，或由调用方显式传入；存量无标题实例回填为「业务类型+编号+的标题」。
--
-- ⚠️ 只追加；绝不修改 V1~V144。

ALTER TABLE wf_instance
  ADD COLUMN IF NOT EXISTS title VARCHAR(256) NULL;

COMMENT ON COLUMN wf_instance.title IS '流程实例展示标题（发起时写入；列表/待办展示）';

UPDATE wf_instance
   SET title = business_type || business_id || '的标题'
 WHERE title IS NULL OR btrim(title) = '';

ALTER TABLE wf_instance
  ALTER COLUMN title SET NOT NULL;
