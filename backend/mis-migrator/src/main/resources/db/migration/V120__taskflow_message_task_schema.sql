-- V120__taskflow_message_task_schema.sql
-- 消息中心 + 代办任务 核心表（见 docs/architecture/msg-log-workflow/06-*.md 与 07-full-development-plan.md P1/P2/P3）
-- PostgreSQL 16 | 幂等：IF NOT EXISTS，可重复执行。
--
-- 设计要点：
--   * sys_message 主表保留 receiver_ids[] 仅作快速过滤；精确已读/处理状态走 sys_message_receiver 明细表。
--   * 消息与代办可关联（reference_task_id），也可独立存在（纯通知）。
--   * 去掉原设计中的 sys_biz_reference 桥接表，业务引用仅存于 sys_task。

-- ---------------------------------------------------------------------------
-- 消息主表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sys_message (
    id                  BIGINT PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL,
    msg_type            VARCHAR(32)  NOT NULL,          -- APPROVAL / NOTIFY / REMIND / SYSTEM_ALERT
    category            VARCHAR(32)  NOT NULL,          -- TASK / ANNOUNCEMENT / ALERT / FEEDBACK
    title               VARCHAR(256) NOT NULL,
    summary             TEXT         NULL,
    content             JSONB        NULL,
    attachments         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    sender_id           BIGINT       NULL,              -- NULL = 系统自动发送
    sender_name         VARCHAR(64)  NULL,
    receiver_ids        BIGINT[]     NOT NULL DEFAULT '{}',  -- 快速过滤用，唯一事实源见明细表
    receiver_group_type VARCHAR(16)  NOT NULL DEFAULT 'SINGLE', -- SINGLE / GROUP
    reference_task_id   BIGINT       NULL,              -- 关联代办（NULL=纯通知）
    read_count          INTEGER      NOT NULL DEFAULT 0,
    total_count         INTEGER      NOT NULL DEFAULT 0,
    deleted             SMALLINT     NOT NULL DEFAULT 0,
    created_by          BIGINT       NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_tenant_type_time ON sys_message (tenant_id, msg_type, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_receiver_ids ON sys_message USING GIN (receiver_ids);
CREATE INDEX IF NOT EXISTS idx_msg_ref_task ON sys_message (reference_task_id);

-- ---------------------------------------------------------------------------
-- 消息接收者明细（唯一事实源：每个用户的已读/处理状态）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sys_message_receiver (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    message_id  BIGINT       NOT NULL REFERENCES sys_message (id),
    user_id     BIGINT       NOT NULL,
    read_flag   BOOLEAN      NOT NULL DEFAULT FALSE,
    viewed_at   TIMESTAMPTZ  NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE / HANDLED / IGNORED / ARCHIVED
    task_id     BIGINT       NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_msg_receiver UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_msg_recv_user ON sys_message_receiver (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_recv_msg ON sys_message_receiver (message_id, read_flag);

-- ---------------------------------------------------------------------------
-- 代办任务
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sys_task (
    id            BIGINT PRIMARY KEY,
    tenant_id     BIGINT       NOT NULL,
    task_type     VARCHAR(32)  NOT NULL,          -- 业务域：PURCHASE_APPROVAL / LEAVE_APPLICATION ...
    biz_type      VARCHAR(64)  NOT NULL,          -- 业务类型：PURCHASE_ORDER ...
    biz_ref_id    VARCHAR(128) NOT NULL,          -- 业务实例 ID
    biz_title     VARCHAR(256) NOT NULL,
    target_entity VARCHAR(64)  NULL,
    assignee_id   BIGINT       NOT NULL,
    assignee_name VARCHAR(64)  NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    priority      SMALLINT     NOT NULL DEFAULT 1,   -- 1=低 2=普通 3=高 4=紧急
    due_date      TIMESTAMPTZ  NULL,
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    result        JSONB        NULL,
    read_flag     BOOLEAN      NOT NULL DEFAULT FALSE,
    viewed_at     TIMESTAMPTZ  NULL,
    completed_at  TIMESTAMPTZ  NULL,
    deleted       SMALLINT     NOT NULL DEFAULT 0,
    created_by    BIGINT       NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_assignee ON sys_task (assignee_id, tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_biz ON sys_task (biz_type, biz_ref_id);
CREATE INDEX IF NOT EXISTS idx_task_due ON sys_task (due_date) WHERE due_date IS NOT NULL AND status IN ('PENDING', 'APPROVING');