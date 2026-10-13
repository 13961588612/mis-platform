-- V144__wf_instance_initiator_org_name.sql
-- 流程实例补充发起人所属公司（组织）名称快照 | PostgreSQL 16 | 幂等
--
-- ## 背景
--   门户「流程类」列表需展示「发起人（公司）」；发起时把用户主组织名写入实例，
--   列表/聚合查询直接读列，避免跨服务实时反查。
--
-- ⚠️ 只追加；绝不修改 V1~V143。

ALTER TABLE wf_instance
  ADD COLUMN IF NOT EXISTS initiator_org_name VARCHAR(128) NULL;

COMMENT ON COLUMN wf_instance.initiator_org_name IS '发起人所属组织/公司名称快照（启动时写入）';
