-- V53__add_post_quota.sql
-- 岗位编制：计划编制人数（业务可选，默认 0）
ALTER TABLE sys_post ADD COLUMN quota INT NULL DEFAULT 0;
