-- V159__ai_template_report_schema.sql
-- 模板报告（mis-ai-template-report）基础表 | PostgreSQL 16 | 幂等
--
-- ## 本迁移（S1）
--   分类 / 参数来源 / 报告定义 / 工作流平台 / ACL / 经营日历（日/周/月）
--   菜单与业务 API 种子放到后续迁移（S2），本文件只建表。
--
-- ## ⚠️ 只追加；绝不修改既有迁移（checksum）。

-- ===========================================================================
-- 1) 报告分类（邻接树；is_group=1 才进入 Copilot 分组栏）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ai_report_category (
    id          BIGINT       PRIMARY KEY,
    parent_id   BIGINT       NOT NULL DEFAULT 0,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    is_group    SMALLINT     NOT NULL DEFAULT 0,
    sort_order  INT          NOT NULL DEFAULT 0,
    enabled     SMALLINT     NOT NULL DEFAULT 1,
    created_by  BIGINT       NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_ai_report_category_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_ai_report_category_tree
    ON ai_report_category (parent_id, sort_order);

-- ===========================================================================
-- 2) 预定义参数来源（设计时注册；运行时按身份 Handler 取数）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ai_param_source (
    id            BIGINT       PRIMARY KEY,
    source_code   VARCHAR(64)  NOT NULL,
    name          VARCHAR(128) NOT NULL,
    value_type    VARCHAR(32)  NOT NULL,
    wire_key      VARCHAR(64)  NOT NULL,
    handler_bean  VARCHAR(128) NOT NULL,
    config_json   JSONB        NULL,
    enabled       SMALLINT     NOT NULL DEFAULT 1,
    sort_order    INT          NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_ai_param_source_code UNIQUE (source_code)
);

-- ===========================================================================
-- 3) 外部 AI 工作流平台主数据
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ai_workflow_platform (
    id             BIGINT       PRIMARY KEY,
    platform_code  VARCHAR(64)  NOT NULL,
    name           VARCHAR(128) NOT NULL,
    -- 连接配置（密钥勿明文；可用 secret_ref）
    config_json    JSONB        NULL,
    enabled        SMALLINT     NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_ai_workflow_platform_code UNIQUE (platform_code)
);

-- ===========================================================================
-- 4) 报告定义（slots JSON 编排参数来源；可选走工作流）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ai_report_def (
    id                      BIGINT       PRIMARY KEY,
    report_code             VARCHAR(64)  NOT NULL,
    title                   VARCHAR(256) NOT NULL,
    description             VARCHAR(1024) NULL,
    category_id             BIGINT       NULL,
    slots_json              JSONB        NOT NULL DEFAULT '[]'::jsonb,
    use_ai_workflow         SMALLINT     NOT NULL DEFAULT 0,
    workflow_platform_code  VARCHAR(64)  NULL,
    workflow_code           VARCHAR(128) NULL,
    enabled                 SMALLINT     NOT NULL DEFAULT 1,
    sort_order              INT          NOT NULL DEFAULT 0,
    created_by              BIGINT       NULL,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_ai_report_def_code UNIQUE (report_code)
);

CREATE INDEX IF NOT EXISTS idx_ai_report_def_category
    ON ai_report_def (category_id, sort_order);

-- ===========================================================================
-- 5) 报告 ACL（角色码或权限码 → report_code；S3 起生效）
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ai_report_acl (
    id           BIGINT       PRIMARY KEY,
    report_code  VARCHAR(64)  NOT NULL,
    subject_type VARCHAR(32)  NOT NULL,
    subject_id   VARCHAR(128) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_ai_report_acl UNIQUE (report_code, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_report_acl_subject
    ON ai_report_acl (subject_type, subject_id);

-- ===========================================================================
-- 6) 经营日历（日 / 周 / 月）— 参数来源 Handler 查库，禁止前端公历臆造
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ai_report_calendar_day (
    biz_date    DATE         PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    enabled     SMALLINT     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ai_report_calendar_week (
    ord_week    VARCHAR(16)  PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    week_start  DATE         NOT NULL,
    week_end    DATE         NOT NULL,
    enabled     SMALLINT     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_ai_report_calendar_week_range
    ON ai_report_calendar_week (week_start, week_end);

CREATE TABLE IF NOT EXISTS ai_report_calendar_month (
    ord_month   VARCHAR(16)  PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    month_start DATE         NOT NULL,
    month_end   DATE         NOT NULL,
    enabled     SMALLINT     NOT NULL DEFAULT 1
);
