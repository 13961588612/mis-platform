-- =============================================================================
-- 融合部署：在 ai_platform 库补齐 users（及依赖的 departments）表
-- -----------------------------------------------------------------------------
-- 背景：ai-platform 后端（Alembic 管理 ai_platform 库）的 UserModel 期望
--       ai_platform.users 表存在，但现有迁移链（001 建 agent_memory /
--       002 用 op.add_column("users",...) 假设 users 已存在 / 003-004 建
--       session/feedback）从未建过 users 表 —— 导致运行时
--       resolve_mis_user_id_async 报 "relation \"users\" does not exist"。
--
-- 本脚本幂等创建 departments + users，与 src/models/user.py 的 ORM 定义对齐：
--   * 公共列（UUIDPrimaryKeyMixin / TimestampMixin / SoftDeleteMixin）：
--       id (UUID String36 PK)、created_at、updated_at、deleted_at
--   * users 全部业务字段按 UserModel 类型/约束映射
--   * departments 按 DepartmentModel 映射（users.dept_id 外键依赖）
--
-- 执行方式（二选一）：
--   A. 由 DBA 在 ai_platform 库直接跑本 SQL：
--        psql -h <pg-host> -U aiplatform -d ai_platform -f 03-create-ai-platform-users.sql
--   B. 走 Alembic：将本文件内容等价落成一个修订
--        op.create_table("departments", ...) / op.create_table("users", ...)
--        再 `alembic upgrade head`（必须早于 002_add_users_mis_user_id 的执行，
--        或单独先跑本修订再补 002）。
-- =============================================================================

-- 切到 ai_platform 库（若 DBA 已在目标库会话中，此句可删）
\connect ai_platform

-- ---------------------------------------------------------------------------
-- 1) departments（users.dept_id 外键依赖，先建）
--    对齐 agent/ai-platform/backend/src/models/user.py::DepartmentModel
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
    id              VARCHAR(36)  PRIMARY KEY,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ  NULL,

    dept_id         VARCHAR(64)  NOT NULL,
    name            VARCHAR(128) NOT NULL,
    parent_id       VARCHAR(64)  NULL,
    allowed_categories JSONB     NOT NULL DEFAULT '[]'::jsonb,
    denied_categories  JSONB     NOT NULL DEFAULT '[]'::jsonb,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_departments_dept_id UNIQUE (dept_id)
);
CREATE INDEX IF NOT EXISTS ix_departments_dept_id   ON departments (dept_id);
CREATE INDEX IF NOT EXISTS ix_departments_parent_id ON departments (parent_id);

-- ---------------------------------------------------------------------------
-- 2) users（核心补表，对齐 UserModel）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              VARCHAR(36)  PRIMARY KEY,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ  NULL,

    user_id         VARCHAR(64)  NOT NULL,
    username        VARCHAR(128) NOT NULL,
    display_name    VARCHAR(128) NOT NULL DEFAULT '',
    email           VARCHAR(256) NULL,
    phone           VARCHAR(32)  NULL,
    department      VARCHAR(64)  NOT NULL DEFAULT '',
    dept_id         VARCHAR(64)  NULL,
    roles           JSONB        NOT NULL DEFAULT '[]'::jsonb,
    wecom_user_id   VARCHAR(64)  NULL,
    -- MIS 侧 userId（T03 #15-a）：企微渠道身份 → MIS 权限主体绑定列。
    -- nullable + 无回填：未绑定时为 NULL，resolve_mis_user_id 档 2 返回 None → fail-closed。
    mis_user_id     BIGINT       NULL,
    password_hash   VARCHAR(256) NULL,
    channel         VARCHAR(32)  NOT NULL DEFAULT 'wecom_h5',
    skill_allow_list JSONB       NOT NULL DEFAULT '[]'::jsonb,
    skill_deny_list  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    profile         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ  NULL,

    CONSTRAINT uq_users_user_id      UNIQUE (user_id),
    CONSTRAINT uq_users_mis_user_id  UNIQUE (mis_user_id),
    CONSTRAINT fk_users_dept_id      FOREIGN KEY (dept_id)
        REFERENCES departments (dept_id)
);

-- 索引（对齐 ORM 中所有 index=True / unique=True）
CREATE INDEX IF NOT EXISTS ix_users_user_id        ON users (user_id);
CREATE INDEX IF NOT EXISTS ix_users_username       ON users (username);
CREATE INDEX IF NOT EXISTS ix_users_department     ON users (department);
CREATE INDEX IF NOT EXISTS ix_users_dept_id        ON users (dept_id);
CREATE INDEX IF NOT EXISTS ix_users_wecom_user_id  ON users (wecom_user_id);
CREATE INDEX IF NOT EXISTS ix_users_mis_user_id    ON users (mis_user_id);
CREATE INDEX IF NOT EXISTS ix_users_channel        ON users (channel);
CREATE INDEX IF NOT EXISTS ix_users_is_active      ON users (is_active);

-- ---------------------------------------------------------------------------
-- 3) 授权（Alembic 以 aiplatform 身份跑迁移，需持表权限）
-- ---------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON TABLE departments, users TO aiplatform;
