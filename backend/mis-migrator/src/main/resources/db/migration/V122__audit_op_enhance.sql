-- V122__audit_op_enhance.sql
-- 业务语义化操作审计（见 02-operational-logging-design.md 与 07-full-development-plan.md P4）
-- 与既有 sys_oper_log（HTTP 轨迹）互补：一张管技术视角，一张管业务视角。
-- PostgreSQL 16 | 幂等。

CREATE TABLE IF NOT EXISTS sys_audit_op (
    id             BIGINT PRIMARY KEY,
    tenant_id      BIGINT       NOT NULL,
    user_id        BIGINT       NULL,
    username       VARCHAR(64)  NULL,
    module         VARCHAR(64)  NULL,
    operation_type VARCHAR(32)  NOT NULL,          -- CREATE/UPDATE/DELETE/APPROVE/REJECT/ASSIGN/EXPORT
    business_type  VARCHAR(64)  NULL,
    business_id    VARCHAR(128) NULL,
    description    VARCHAR(512) NULL,
    before_data    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    after_data     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    diff_summary   JSONB        NOT NULL DEFAULT '[]'::jsonb,
    trace_id       VARCHAR(64)  NULL,
    http_log_id    BIGINT       NULL,
    result_status  VARCHAR(16)  NOT NULL DEFAULT 'SUCCESS',  -- SUCCESS/FAIL/PARTIAL
    error_msg      TEXT         NULL,
    duration_ms    INTEGER      NULL,
    extra_context  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    oper_time      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_time ON sys_audit_op (tenant_id, user_id, oper_time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_module_type ON sys_audit_op (tenant_id, module, operation_type, oper_time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_business ON sys_audit_op (business_type, business_id, oper_time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_result ON sys_audit_op (result_status, oper_time DESC);

-- 增强既有 HTTP 审计表：补齐业务语义列（可空，向后兼容）
ALTER TABLE sys_oper_log ADD COLUMN IF NOT EXISTS description   VARCHAR(512);
ALTER TABLE sys_oper_log ADD COLUMN IF NOT EXISTS business_type VARCHAR(64);
ALTER TABLE sys_oper_log ADD COLUMN IF NOT EXISTS business_id   VARCHAR(128);
ALTER TABLE sys_oper_log ADD COLUMN IF NOT EXISTS before_data   JSONB DEFAULT '{}'::jsonb;
ALTER TABLE sys_oper_log ADD COLUMN IF NOT EXISTS after_data    JSONB DEFAULT '{}'::jsonb;
ALTER TABLE sys_oper_log ADD COLUMN IF NOT EXISTS diff_summary  JSONB DEFAULT '[]'::jsonb;
ALTER TABLE sys_oper_log ADD COLUMN IF NOT EXISTS result_status VARCHAR(16) DEFAULT 'SUCCESS';

CREATE INDEX IF NOT EXISTS idx_operlog_business ON sys_oper_log (business_type, business_id, oper_time DESC);
CREATE INDEX IF NOT EXISTS idx_operlog_result ON sys_oper_log (result_status, oper_time DESC);