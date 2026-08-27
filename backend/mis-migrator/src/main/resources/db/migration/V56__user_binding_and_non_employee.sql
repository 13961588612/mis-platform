-- MIS Platform — 用户↔员工绑定 + 非员工用户支持
-- PostgreSQL 16 | 库名: mis_platform
-- 关联需求：用户管理重构（按手机绑员工 / 支持非员工用户 / 员工改同步用户 / 用户权限部门树修复）

-- 1. 解除"一个员工只能有一个用户"的唯一约束（允许一个员工绑定多个用户，D3 手动选择）
DROP INDEX IF EXISTS uk_user_app_employee;

-- 2. 用户可脱离员工独立存在（非员工用户：组织/部门非必选）
ALTER TABLE sys_user ALTER COLUMN employee_id DROP NOT NULL;

-- 3. 用户名/手机落用户自身列（绑定用户由员工同步写入；非员工用户自有）
--    历史数据 employee_id 保持原值；real_name/phone 由上线后员工同步或新建时填充（可留 NULL）
ALTER TABLE sys_user ADD COLUMN real_name VARCHAR(64);
ALTER TABLE sys_user ADD COLUMN phone     VARCHAR(32);

-- 4. 索引（原 idx_user_employee 仅在 employee_id 非 NULL 时有意义，保留即可；补充检索列索引）
CREATE INDEX IF NOT EXISTS idx_sys_user_real_name ON sys_user(real_name);
CREATE INDEX IF NOT EXISTS idx_sys_user_phone     ON sys_user(phone);
