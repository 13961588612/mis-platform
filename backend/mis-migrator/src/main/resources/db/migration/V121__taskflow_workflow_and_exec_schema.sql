-- V121__taskflow_workflow_and_exec_schema.sql
-- 工作流引擎 + 高可用闭环（Outbox 本地消息表 + 分布式锁表）—— 见 07-full-development-plan.md P5/P6
-- PostgreSQL 16 | 幂等：IF NOT EXISTS。

-- ---------------------------------------------------------------------------
-- 流程定义
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wf_definition (
    id                   BIGINT PRIMARY KEY,
    tenant_id            BIGINT       NOT NULL,
    code                 VARCHAR(64)  NOT NULL,
    name                 VARCHAR(128) NOT NULL,
    category             VARCHAR(32)  NOT NULL DEFAULT 'APPROVAL',
    description          TEXT         NULL,
    version              INT          NOT NULL DEFAULT 1,
    status               VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',  -- DRAFT / ACTIVE / ARCHIVED
    supported_form_codes TEXT[]       NOT NULL DEFAULT '{}',     -- 表单白名单（一个流程可对多表单）
    form_schema          JSONB        NULL,
    config               JSONB        NOT NULL DEFAULT '{}'::jsonb,
    deleted              SMALLINT     NOT NULL DEFAULT 0,
    created_by           BIGINT       NULL,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_wf_def_tenant_code_ver ON wf_definition (tenant_id, code, version) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_wf_def_status ON wf_definition (tenant_id, status);

-- ---------------------------------------------------------------------------
-- 流程节点
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wf_node (
    id                  BIGINT PRIMARY KEY,
    definition_id       BIGINT       NOT NULL REFERENCES wf_definition (id),
    node_code           VARCHAR(64)  NOT NULL,
    node_name           VARCHAR(128) NOT NULL,
    node_type           VARCHAR(32)  NOT NULL,   -- START/APPROVAL/ROUTING/CONDITIONAL/AUTOMATION/END
    sort_order          INT          NOT NULL DEFAULT 0,
    canvas_x            DOUBLE PRECISION NULL,
    canvas_y            DOUBLE PRECISION NULL,
    condition_expr      TEXT         NULL,
    assignee_rule       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    timeout_hours       INT          NULL,
    notify_template_id  BIGINT       NULL,
    config              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_wf_node_code UNIQUE (definition_id, node_code)
);

CREATE INDEX IF NOT EXISTS idx_wf_node_def ON wf_node (definition_id, sort_order);

-- ---------------------------------------------------------------------------
-- 流程实例
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wf_instance (
    id                  BIGINT PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL,
    definition_id       BIGINT       NOT NULL REFERENCES wf_definition (id),
    definition_code     VARCHAR(64)  NOT NULL,
    started_form_code   VARCHAR(64)  NULL,        -- 本次运行实际使用的表单（来自白名单）
    business_type       VARCHAR(64)  NOT NULL,
    business_id         VARCHAR(128) NOT NULL,
    status              VARCHAR(16)  NOT NULL DEFAULT 'RUNNING',
    initiator_id        BIGINT       NOT NULL,
    initiator_name      VARCHAR(64)  NULL,
    current_node_code   VARCHAR(64)  NULL,
    form_data           JSONB        NULL,
    progress            VARCHAR(32)  NULL,
    extra_context       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- 审批后执行情况（后置业务闭环）
    post_process_status  VARCHAR(16) NOT NULL DEFAULT 'WAITING', -- WAITING/SUCCESS/FAILED/RETRYING/MANUAL_FIX
    post_process_time    TIMESTAMPTZ NULL,
    post_process_msg     VARCHAR(512) NULL,
    post_retry_count     INTEGER     NOT NULL DEFAULT 0,
    completed_at        TIMESTAMPTZ  NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wf_inst_biz ON wf_instance (business_type, business_id);
CREATE INDEX IF NOT EXISTS idx_wf_inst_initiator ON wf_instance (initiator_id, status);
CREATE INDEX IF NOT EXISTS idx_wf_inst_post ON wf_instance (post_process_status) WHERE post_process_status <> 'SUCCESS';

-- ---------------------------------------------------------------------------
-- 流程任务（每个节点产生的执行单元，与 sys_task 通过 biz/task 双向绑定）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wf_task (
    id             BIGINT PRIMARY KEY,
    tenant_id      BIGINT       NOT NULL,
    instance_id    BIGINT       NOT NULL REFERENCES wf_instance (id),
    node_code      VARCHAR(64)  NOT NULL,
    node_name      VARCHAR(128) NOT NULL,
    task_type      VARCHAR(32)  NOT NULL,     -- APPROVE / REVIEW / SIGN / NOTICE
    sys_task_id    BIGINT       NULL,         -- 关联用户视角的 sys_task（纯流程任务可为空）
    assignee_id    BIGINT       NOT NULL,
    assignee_name  VARCHAR(64)  NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    due_date       TIMESTAMPTZ  NULL,
    action_result  JSONB        NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at   TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_wf_task_assignee ON wf_task (assignee_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_task_instance ON wf_task (instance_id, node_code);
CREATE INDEX IF NOT EXISTS idx_wf_task_sys_task ON wf_task (sys_task_id);

-- ---------------------------------------------------------------------------
-- 流程历史（审计追溯）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wf_history (
    id                BIGINT PRIMARY KEY,
    instance_id       BIGINT       NOT NULL REFERENCES wf_instance (id),
    node_code         VARCHAR(64)  NOT NULL,
    operator_id       BIGINT       NULL,
    operator_name     VARCHAR(64)  NULL,
    operation         VARCHAR(32)  NOT NULL,   -- SUBMIT/APPROVE/REJECT/FORWARD/SKIP
    from_node         VARCHAR(64)  NULL,
    to_node           VARCHAR(64)  NULL,
    comment           TEXT         NULL,
    duration_seconds  DOUBLE PRECISION NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wf_history_instance ON wf_history (instance_id, created_at);

-- ---------------------------------------------------------------------------
-- 本地任务消息表（Outbox Pattern）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biz_execution_task (
    id               BIGINT PRIMARY KEY,
    tenant_id        BIGINT       NOT NULL,
    source_instance_id BIGINT     NULL,         -- 关联 wf_instance（可空）
    action_type      VARCHAR(64)  NOT NULL,     -- START_WORKFLOW / ASSIGN_NODE / FINALIZE_BIZ ...
    biz_type         VARCHAR(64)  NULL,
    biz_ref_id       VARCHAR(128) NULL,
    payload          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    tx_status        VARCHAR(16)  NOT NULL DEFAULT 'WAITING',  -- WAITING/SUCCESS/FAILED
    retry_count      INTEGER      NOT NULL DEFAULT 0,
    next_retry_at    TIMESTAMPTZ  NULL,
    error_msg        TEXT         NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biz_exec_status ON biz_execution_task (tx_status, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_biz_exec_biz ON biz_execution_task (biz_type, biz_ref_id);

-- ---------------------------------------------------------------------------
-- 分布式锁表（替代 synchronized，集群安全）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biz_exec_lock (
    biz_type          VARCHAR(64)  NOT NULL,
    biz_id            VARCHAR(128) NOT NULL,
    status            VARCHAR(16)  NOT NULL,      -- RUNNING/SUCCESS/FAILED
    operator_service  VARCHAR(128) NULL,          -- 持有锁的实例标识（hostname:port）
    locked_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_biz_exec_lock PRIMARY KEY (biz_type, biz_id)
);

CREATE INDEX IF NOT EXISTS idx_biz_lock_status ON biz_exec_lock (status, updated_at);