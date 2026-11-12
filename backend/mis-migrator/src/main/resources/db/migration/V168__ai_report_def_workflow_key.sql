-- V168：报告定义增加百炼工作流 key（APP_ID）| PostgreSQL 16 | 幂等
-- API Key 不入库，仅环境变量 / Nacos

ALTER TABLE ai_report_def
    ADD COLUMN IF NOT EXISTS workflow_key VARCHAR(128) NULL;

COMMENT ON COLUMN ai_report_def.workflow_key IS '工作流 key：阿里百炼为应用 APP_ID；平台密钥不写本列';
