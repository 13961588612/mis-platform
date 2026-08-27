-- 用户级邮箱（独立于员工邮箱）。绑员工时由员工邮箱同步回填；非员工用户自行填写。
-- PostgreSQL 幂等：列已存在则跳过。
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS email VARCHAR(255);
