-- PostgreSQL 16 | 库名: mis_platform
-- 员工内置账号标识：用于手机号必填/唯一校验豁免（EMP-03，Q2 推荐方案）
ALTER TABLE sys_employee ADD COLUMN IF NOT EXISTS is_builtin SMALLINT NOT NULL DEFAULT 0;
