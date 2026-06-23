-- MIS Platform Phase 1 — 初始化表结构
-- PostgreSQL 16 | 库名: mis_platform
-- 参见: docs/database/schema-design.md, ADR-011~014

-- ---------------------------------------------------------------------------
-- 枚举
-- ---------------------------------------------------------------------------
CREATE TYPE sys_perm_type AS ENUM ('menu', 'dept', 'store');

CREATE TYPE sys_api_node_type AS ENUM ('catalog', 'api');

-- ---------------------------------------------------------------------------
-- 租户与应用
-- ---------------------------------------------------------------------------
CREATE TABLE sys_tenant (
    id          BIGINT PRIMARY KEY,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    status      SMALLINT     NOT NULL DEFAULT 1,
    expire_at   TIMESTAMPTZ  NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_tenant_code UNIQUE (code)
);

CREATE TABLE sys_app (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    icon        VARCHAR(64)  NULL,
    base_path   VARCHAR(128) NULL,
    mfe_remote  VARCHAR(256) NULL,
    sort        INT          NOT NULL DEFAULT 0,
    status      SMALLINT     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_app_tenant_code UNIQUE (tenant_id, code)
);

CREATE TABLE sys_module (
    id            BIGINT PRIMARY KEY,
    code          VARCHAR(64)  NOT NULL,
    name          VARCHAR(128) NOT NULL,
    service_name  VARCHAR(64)  NOT NULL,
    sort          INT          NOT NULL DEFAULT 0,
    status        SMALLINT     NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_module_code UNIQUE (code),
    CONSTRAINT uk_module_service UNIQUE (service_name)
);

-- ---------------------------------------------------------------------------
-- 部门
-- ---------------------------------------------------------------------------
CREATE TABLE sys_dept_category (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    sort        INT          NOT NULL DEFAULT 0,
    status      SMALLINT     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_dept_cat_tenant_code UNIQUE (tenant_id, code)
);

CREATE TABLE sys_dept (
    id                  BIGINT PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL,
    parent_id           BIGINT       NOT NULL DEFAULT 0,
    code                VARCHAR(64)  NOT NULL,
    name                VARCHAR(128) NOT NULL,
    category_id         BIGINT       NOT NULL,
    ancestors           VARCHAR(512) NOT NULL,
    sort                INT          NOT NULL DEFAULT 0,
    status              SMALLINT     NOT NULL DEFAULT 1,
    is_root             SMALLINT     NOT NULL DEFAULT 0,
    leader_employee_id  BIGINT       NULL,
    deleted             SMALLINT     NOT NULL DEFAULT 0,
    created_by          BIGINT       NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by          BIGINT       NULL,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uk_dept_tenant_code ON sys_dept (tenant_id, code) WHERE deleted = 0;
CREATE UNIQUE INDEX uk_dept_tenant_root ON sys_dept (tenant_id) WHERE is_root = 1 AND deleted = 0;
CREATE INDEX idx_dept_tenant_parent ON sys_dept (tenant_id, parent_id);

-- ---------------------------------------------------------------------------
-- 岗位
-- ---------------------------------------------------------------------------
CREATE TABLE sys_post_type (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    sort        INT          NOT NULL DEFAULT 0,
    status      SMALLINT     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_post_type_tenant_code UNIQUE (tenant_id, code)
);

CREATE TABLE sys_post (
    id            BIGINT PRIMARY KEY,
    tenant_id     BIGINT       NOT NULL,
    dept_id       BIGINT       NOT NULL,
    post_type_id  BIGINT       NOT NULL,
    code          VARCHAR(64)  NOT NULL,
    name          VARCHAR(128) NOT NULL,
    sort          INT          NOT NULL DEFAULT 0,
    status        SMALLINT     NOT NULL DEFAULT 1,
    deleted       SMALLINT     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uk_post_tenant_code ON sys_post (tenant_id, code) WHERE deleted = 0;
CREATE INDEX idx_post_dept ON sys_post (dept_id);

CREATE TABLE sys_employee_post (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT   NOT NULL,
    employee_id BIGINT   NOT NULL,
    post_id     BIGINT   NOT NULL,
    is_primary  SMALLINT NOT NULL DEFAULT 0,
    start_date  DATE     NULL,
    end_date    DATE     NULL,
    status      SMALLINT NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uk_emp_post ON sys_employee_post (employee_id, post_id) WHERE status = 1;
CREATE INDEX idx_emp_post_employee ON sys_employee_post (employee_id);

-- ---------------------------------------------------------------------------
-- 员工与用户
-- ---------------------------------------------------------------------------
CREATE TABLE sys_employee (
    id           BIGINT PRIMARY KEY,
    tenant_id    BIGINT       NOT NULL,
    dept_id      BIGINT       NOT NULL,
    employee_no  VARCHAR(64)  NOT NULL,
    real_name    VARCHAR(64)  NOT NULL,
    email        VARCHAR(128) NULL,
    phone        VARCHAR(32)  NULL,
    gender       SMALLINT     NULL,
    title        VARCHAR(64)  NULL,
    hire_date    DATE         NULL,
    status       SMALLINT     NOT NULL DEFAULT 1,
    deleted      SMALLINT     NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uk_employee_tenant_no ON sys_employee (tenant_id, employee_no) WHERE deleted = 0;

CREATE TABLE sys_platform_user (
    id                    BIGINT PRIMARY KEY,
    username              VARCHAR(64)  NOT NULL,
    password_hash         VARCHAR(128) NOT NULL,
    real_name             VARCHAR(64)  NULL,
    status                SMALLINT     NOT NULL DEFAULT 1,
    is_protected          SMALLINT     NOT NULL DEFAULT 0,
    must_change_password  SMALLINT     NOT NULL DEFAULT 0,
    last_login_at         TIMESTAMPTZ  NULL,
    login_fail_count      INT          NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_platform_username UNIQUE (username)
);

CREATE TABLE sys_user (
    id                    BIGINT PRIMARY KEY,
    tenant_id             BIGINT       NOT NULL,
    app_id                BIGINT       NOT NULL,
    employee_id           BIGINT       NOT NULL,
    dept_id               BIGINT       NOT NULL,
    username              VARCHAR(64)  NOT NULL,
    password_hash         VARCHAR(128) NOT NULL,
    avatar_url            VARCHAR(512) NULL,
    status                SMALLINT     NOT NULL DEFAULT 1,
    last_login_at         TIMESTAMPTZ  NULL,
    login_fail_count      INT          NOT NULL DEFAULT 0,
    is_tenant_admin       SMALLINT     NOT NULL DEFAULT 0,
    must_change_password  SMALLINT     NOT NULL DEFAULT 0,
    deleted               SMALLINT     NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uk_user_tenant_app_username ON sys_user (tenant_id, app_id, username) WHERE deleted = 0;
CREATE UNIQUE INDEX uk_user_app_employee ON sys_user (app_id, employee_id);
CREATE INDEX idx_user_employee ON sys_user (employee_id);

-- ---------------------------------------------------------------------------
-- RBAC
-- ---------------------------------------------------------------------------
CREATE TABLE sys_role (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    app_id      BIGINT       NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    type        SMALLINT     NOT NULL DEFAULT 2,
    data_scope  SMALLINT     NOT NULL DEFAULT 1,
    status      SMALLINT     NOT NULL DEFAULT 1,
    remark      VARCHAR(512) NULL,
    deleted     SMALLINT     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uk_role_app_code ON sys_role (app_id, code) WHERE deleted = 0;

CREATE TABLE sys_user_role (
    id         BIGINT PRIMARY KEY,
    user_id    BIGINT NOT NULL,
    role_id    BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_user_role UNIQUE (user_id, role_id)
);

CREATE INDEX idx_user_role_role ON sys_user_role (role_id);

CREATE TABLE sys_menu (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL DEFAULT 1,
    app_id      BIGINT       NOT NULL,
    parent_id   BIGINT       NOT NULL DEFAULT 0,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(64)  NOT NULL,
    type        SMALLINT     NOT NULL,
    path        VARCHAR(128) NULL,
    component   VARCHAR(128) NULL,
    permission  VARCHAR(128) NULL,
    icon        VARCHAR(64)  NULL,
    sort        INT          NOT NULL DEFAULT 0,
    visible     SMALLINT     NOT NULL DEFAULT 1,
    status      SMALLINT     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_menu_app_code UNIQUE (app_id, code)
);

CREATE INDEX idx_menu_parent ON sys_menu (parent_id);
CREATE UNIQUE INDEX uk_menu_app_permission ON sys_menu (app_id, permission)
    WHERE status = 1 AND permission IS NOT NULL;

CREATE TABLE sys_api (
    id            BIGINT PRIMARY KEY,
    tenant_id     BIGINT            NOT NULL DEFAULT 1,
    app_id        BIGINT            NOT NULL,
    module_id     BIGINT            NOT NULL,
    parent_id     BIGINT            NOT NULL DEFAULT 0,
    code          VARCHAR(64)       NOT NULL,
    type          sys_api_node_type NOT NULL,
    name          VARCHAR(64)       NOT NULL,
    http_method   VARCHAR(16)       NULL,
    path_pattern  VARCHAR(256)      NULL,
    sort          INT               NOT NULL DEFAULT 0,
    status        SMALLINT          NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_api_app_code UNIQUE (app_id, code)
);

CREATE UNIQUE INDEX uk_api_method_path ON sys_api (http_method, path_pattern)
    WHERE type = 'api' AND status = 1;
CREATE INDEX idx_api_parent ON sys_api (parent_id);

CREATE TABLE sys_menu_api (
    id         BIGINT PRIMARY KEY,
    menu_id    BIGINT NOT NULL,
    api_id     BIGINT NOT NULL,
    sort       INT    NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_menu_api_pair UNIQUE (menu_id, api_id),
    CONSTRAINT uk_menu_api_api UNIQUE (api_id)
);

CREATE TABLE sys_role_permission (
    id         BIGINT PRIMARY KEY,
    role_id    BIGINT        NOT NULL,
    perm_type  sys_perm_type NOT NULL,
    target_id  BIGINT        NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_role_perm UNIQUE (role_id, perm_type, target_id)
);

CREATE INDEX idx_role_perm_type ON sys_role_permission (role_id, perm_type);
CREATE INDEX idx_perm_target ON sys_role_permission (perm_type, target_id);

-- ---------------------------------------------------------------------------
-- 字典与配置
-- ---------------------------------------------------------------------------
CREATE TABLE sys_dict_type (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL DEFAULT 0,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    status      SMALLINT     NOT NULL DEFAULT 1,
    remark      VARCHAR(512) NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_dict_type_code UNIQUE (tenant_id, code)
);

CREATE TABLE sys_dict_item (
    id          BIGINT PRIMARY KEY,
    type_id     BIGINT       NOT NULL,
    label       VARCHAR(128) NOT NULL,
    value       VARCHAR(128) NOT NULL,
    sort        INT          NOT NULL DEFAULT 0,
    status      SMALLINT     NOT NULL DEFAULT 1,
    css_class   VARCHAR(64)  NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dict_item_type ON sys_dict_item (type_id);

CREATE TABLE sys_config (
    id           BIGINT PRIMARY KEY,
    config_key   VARCHAR(128) NOT NULL,
    config_value TEXT         NOT NULL,
    remark       VARCHAR(512) NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_config_key UNIQUE (config_key)
);

-- ---------------------------------------------------------------------------
-- 认证与审计
-- ---------------------------------------------------------------------------
CREATE TABLE sys_refresh_token (
    id          BIGINT PRIMARY KEY,
    user_id     BIGINT       NOT NULL,
    app_id      BIGINT       NOT NULL,
    token_hash  VARCHAR(128) NOT NULL,
    client_id   VARCHAR(64)  NOT NULL DEFAULT 'web',
    expire_at   TIMESTAMPTZ  NOT NULL,
    revoked     SMALLINT     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_token_user ON sys_refresh_token (user_id);
CREATE INDEX idx_refresh_token_hash ON sys_refresh_token (token_hash);

CREATE TABLE sys_login_log (
    id          BIGINT PRIMARY KEY,
    tenant_id   BIGINT       NOT NULL,
    app_id      BIGINT       NOT NULL,
    user_id     BIGINT       NULL,
    username    VARCHAR(64)  NOT NULL,
    ip          VARCHAR(64)  NULL,
    user_agent  VARCHAR(512) NULL,
    status      SMALLINT     NOT NULL,
    msg         VARCHAR(256) NULL,
    login_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_log_user ON sys_login_log (user_id);
CREATE INDEX idx_login_log_time ON sys_login_log (login_at DESC);

CREATE TABLE sys_oper_log (
    id              BIGINT PRIMARY KEY,
    tenant_id       BIGINT       NOT NULL,
    user_id         BIGINT       NULL,
    username        VARCHAR(64)  NULL,
    module          VARCHAR(64)  NULL,
    operation       VARCHAR(64)  NULL,
    method          VARCHAR(256) NULL,
    request_uri     VARCHAR(256) NULL,
    request_method  VARCHAR(16)  NULL,
    request_params  TEXT         NULL,
    response_code   INT          NULL,
    duration_ms     INT          NULL,
    ip              VARCHAR(64)  NULL,
    oper_time       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oper_log_user ON sys_oper_log (user_id);
CREATE INDEX idx_oper_log_time ON sys_oper_log (oper_time DESC);
