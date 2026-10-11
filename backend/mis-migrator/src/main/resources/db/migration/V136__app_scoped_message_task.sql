-- V136__app_scoped_message_task.sql
-- 平台级 vs 应用级：消息 / 待办归属模型（P0） | PostgreSQL 16 | 幂等：可重复执行
--
-- ## 为什么需要它
-- 门户「消息 / 待办」需要按「归属哪个 APP」过滤；APP 归属用可空 app_code 表达：
--   app_code IS NULL  = 平台级（系统公告 / 跨应用通知 / 平台运维待办）
--   app_code = 'code' = 应用级（某 APP 的业务消息 / 待办）
-- 存量数据天然 NULL = 平台级，**不回填**（设计 §3.2-c 建议）。
--
-- ## 为什么用 code 而非数字 id
-- sys_app 主键是分段数字 ID（跨环境不稳定，设计 F11）；全链路一等标识是 code（F10）。
--
-- ## 幂等
--   * ALTER TABLE ... ADD COLUMN IF NOT EXISTS  —— 天然幂等
--   * CREATE INDEX IF NOT EXISTS                 —— 天然幂等
--
-- ⚠️ 只追加；绝不修改 V1~V135（checksum 变更会阻塞整条迁移链）。

-- 1) 加列
ALTER TABLE sys_message ADD COLUMN IF NOT EXISTS app_code VARCHAR(64) NULL;
ALTER TABLE sys_task    ADD COLUMN IF NOT EXISTS app_code VARCHAR(64) NULL;

-- 2) 索引（设计 §1.3）
--    应用级过滤：单列等值 + 时间/受理人
CREATE INDEX IF NOT EXISTS idx_msg_app_time  ON sys_message (tenant_id, app_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_app_stat ON sys_task    (tenant_id, app_code, assignee_id, status);
--    平台级过滤：app_code IS NULL 数据量通常小 → 部分索引
CREATE INDEX IF NOT EXISTS idx_msg_platform  ON sys_message (tenant_id, created_at DESC) WHERE app_code IS NULL;

-- 自检（取消注释手动执行）：
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name IN ('sys_message','sys_task') AND column_name='app_code';
-- SELECT indexname FROM pg_indexes WHERE indexname IN
--   ('idx_msg_app_time','idx_task_app_stat','idx_msg_platform');
