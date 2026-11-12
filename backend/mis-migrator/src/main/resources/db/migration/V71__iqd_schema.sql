-- MIS Platform — 问数（mis-iqd）核心表结构（V71）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/ai-fusion/wrenai/architecture.md §4.2 / §4.2.2 D.8.1（v1.9）
-- 对齐 V12__kb_schema.sql 风格：BIGINT PRIMARY KEY + created_at/updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- 命名：表前缀 iqd_*；对接外部 WrenAI 的适配字段保留 wren 命名（wren_ref_id / wren_status_trail）。
-- 职责边界（R10）：V71 只建业务表；菜单/API 种子统一收敛到 V69。

-- ---------------------------------------------------------------------------
-- 1. 连接配置（iqd_connection）
--    仅存 profile 名/连接标识，不存业务库凭证（凭证由 wren profile server-side 注入）
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_connection (
    id              BIGINT PRIMARY KEY,
    name            VARCHAR(128) NOT NULL,
    base_url        VARCHAR(512) NULL,
    auth_type       VARCHAR(16)  NOT NULL DEFAULT 'none',    -- api_key | bearer | none
    secret_ref      VARCHAR(256) NULL,                       -- 密钥引用（不存明文）
    project_id      VARCHAR(128) NULL,
    default_connector VARCHAR(128) NULL,
    timeout_seconds INT          NOT NULL DEFAULT 60,
    language        VARCHAR(16)  NOT NULL DEFAULT 'zh-CN',
    status          VARCHAR(16)  NOT NULL DEFAULT 'inactive',-- active | inactive | error
    last_health_at  TIMESTAMPTZ  NULL,
    last_health_msg VARCHAR(512) NULL,
    enabled         SMALLINT     NOT NULL DEFAULT 1,          -- 1=enabled 0=disabled
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_iqd_connection_name UNIQUE (name)
);

-- ---------------------------------------------------------------------------
-- 2. 数据源（iqd_datasource）
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_datasource (
    id                 BIGINT PRIMARY KEY,
    connection_id      BIGINT      NOT NULL,
    connector_type     VARCHAR(32) NULL,
    display_name       VARCHAR(128) NOT NULL,
    catalog_name       VARCHAR(128) NULL,
    schema_name        VARCHAR(128) NULL,
    credential_ref     VARCHAR(256) NULL,
    enabled            SMALLINT    NOT NULL DEFAULT 1,
    scope_sync_enabled SMALLINT    NOT NULL DEFAULT 0,        -- v1.9：启用字典同步（一次性接入注册项，非权限配置）
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_iqd_datasource UNIQUE (connection_id, display_name),
    CONSTRAINT fk_iqd_datasource_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);

-- ---------------------------------------------------------------------------
-- 3. MDL 模型快照（iqd_model_snapshot）
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_model_snapshot (
    id              BIGINT PRIMARY KEY,
    connection_id   BIGINT      NOT NULL,
    mdl_hash        VARCHAR(64) NULL,
    mdl_json        JSONB       NULL,
    source          VARCHAR(8)  NOT NULL DEFAULT 'pull',      -- pull | push
    model_count     INT         NULL,
    synced_at       TIMESTAMPTZ NULL,
    synced_by       BIGINT      NULL,
    status          VARCHAR(8)  NOT NULL DEFAULT 'ok',        -- ok | failed
    error_message   TEXT        NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_iqd_model_snapshot_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);
CREATE INDEX idx_iqd_model_snapshot_conn_time ON iqd_model_snapshot(connection_id, synced_at DESC);

-- ---------------------------------------------------------------------------
-- 4. 清单项（iqd_catalog_item）
--    item_key 稳定键规范：表={datasource}.{schema}.{table}；字段=表键.{column}；语义=mdl:{kind}:{name}
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_catalog_item (
    id               BIGINT PRIMARY KEY,
    connection_id    BIGINT       NOT NULL,
    kind             VARCHAR(16)  NOT NULL,                   -- table|column|model|relationship|metric|dimension|view
    parent_key       VARCHAR(512) NULL,
    item_key         VARCHAR(512) NOT NULL,
    display_name     VARCHAR(256) NULL,
    data_type        VARCHAR(64)  NULL,
    is_primary_key   SMALLINT     NOT NULL DEFAULT 0,
    is_time_dimension SMALLINT    NOT NULL DEFAULT 0,
    is_email         SMALLINT     NOT NULL DEFAULT 0,
    description      TEXT         NULL,
    expression       TEXT         NULL,
    source           VARCHAR(16)  NOT NULL DEFAULT 'db_meta', -- db_meta | mdl
    in_scope         SMALLINT     NOT NULL DEFAULT 0,         -- 是否纳入问数范围
    sensitive_level  VARCHAR(8)   NOT NULL DEFAULT 'none',    -- none | low | high
    mask_rule        VARCHAR(128) NULL,
    last_seen_at     TIMESTAMPTZ  NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_iqd_catalog_item UNIQUE (connection_id, item_key),
    CONSTRAINT fk_iqd_catalog_item_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);
CREATE INDEX idx_iqd_catalog_item_conn_kind ON iqd_catalog_item(connection_id, kind);
CREATE INDEX idx_iqd_catalog_item_conn_parent ON iqd_catalog_item(connection_id, parent_key);
CREATE INDEX idx_iqd_catalog_item_conn_scope ON iqd_catalog_item(connection_id, in_scope);

-- ---------------------------------------------------------------------------
-- 5. 范围策略（iqd_scope_policy）——治理层「哪些表/语义对象进入问数范围」
--    subject_id 复用角色码/部门 id/用户 id/门店编码（字符串形态）
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_scope_policy (
    id             BIGINT PRIMARY KEY,
    connection_id  BIGINT       NOT NULL,
    subject_type   VARCHAR(16)  NOT NULL,                     -- global|role|dept|user|store
    subject_id     VARCHAR(64)  NOT NULL,
    item_key       VARCHAR(512) NOT NULL,
    allow          SMALLINT     NOT NULL DEFAULT 1,
    effective      SMALLINT     NOT NULL DEFAULT 1,
    remark         VARCHAR(512) NULL,
    created_by     BIGINT       NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_iqd_scope_policy UNIQUE (connection_id, subject_type, subject_id, item_key),
    CONSTRAINT fk_iqd_scope_policy_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);
CREATE INDEX idx_iqd_scope_policy_subject ON iqd_scope_policy(connection_id, subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- 6. 表级 ACL（iqd_table_acl）——双闸门第二闸的数据面
--    row_scope JSONB NULL=全行可见；v1.9 语义=维度注册表实例（单维度或 dimensions 数组 AND 叠加）
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_table_acl (
    id             BIGINT PRIMARY KEY,
    connection_id  BIGINT       NOT NULL,
    subject_type   VARCHAR(16)  NOT NULL,                     -- role|dept|user|store
    subject_id     VARCHAR(64)  NOT NULL,
    item_key       VARCHAR(512) NOT NULL,
    action         VARCHAR(16)  NOT NULL,                     -- ask | manage
    row_scope      JSONB        NULL,
    created_by     BIGINT       NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_iqd_table_acl UNIQUE (connection_id, subject_type, subject_id, item_key, action),
    CONSTRAINT chk_iqd_table_acl_action CHECK (action IN ('ask','manage')),
    CONSTRAINT fk_iqd_table_acl_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);
CREATE INDEX idx_iqd_table_acl_subject ON iqd_table_acl(connection_id, subject_type, subject_id, action);

-- ---------------------------------------------------------------------------
-- 7. 行级范围维度注册表（iqd_row_scope_dimension）——v1.9 一期必做
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_row_scope_dimension (
    id              BIGINT PRIMARY KEY,
    dimension_code  VARCHAR(32)  NOT NULL,                    -- dept | store | ...
    dimension_name  VARCHAR(64)  NOT NULL,
    predicate_type  VARCHAR(16)  NOT NULL,                    -- PATH_PREFIX | ENUM
    column_name     VARCHAR(64)  NOT NULL,                    -- 业务表条件列：dept_id / store_id
    header_name     VARCHAR(64)  NOT NULL,                    -- X-Mis-Dept-Scope / X-Mis-Stores
    param_whitelist JSONB        NULL,                        -- 模板参数来源白名单（header:* / user.* / ctx.*）
    dict_table      VARCHAR(64)  NULL,                        -- 业务库字典表：mis_dept_scope / mis_store_scope；NULL=复用主数据
    auto_mode       SMALLINT     NOT NULL DEFAULT 1,          -- 自动模式（BFF 按数据权限自动展开注入）
    enabled         SMALLINT     NOT NULL DEFAULT 1,
    sort            INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_iqd_row_scope_dim_code UNIQUE (dimension_code),
    CONSTRAINT uk_iqd_row_scope_dim_header UNIQUE (header_name),
    CONSTRAINT chk_iqd_row_scope_predicate CHECK (predicate_type IN ('PATH_PREFIX','ENUM'))
);
CREATE INDEX idx_iqd_row_scope_dim_enabled ON iqd_row_scope_dimension(enabled, sort);

-- 维度注册表种子（architecture §4.2.2 D.8.1）——dept + store 两条，幂等
INSERT INTO iqd_row_scope_dimension
    (id, dimension_code, dimension_name, predicate_type, column_name, header_name,
     param_whitelist, dict_table, auto_mode, enabled, sort, created_at, updated_at)
VALUES
    (1, 'dept',  '部门', 'PATH_PREFIX', 'dept_id', 'X-Mis-Dept-Scope',
     '["header:X-Mis-Dept-Scope","header:X-Mis-Depts","header:X-Mis-Orgs","user.*","ctx.*"]'::jsonb,
     'mis_dept_scope', 1, 1, 1, NOW(), NOW()),
    (2, 'store', '门店', 'ENUM',         'store_id', 'X-Mis-Stores',
     '["header:X-Mis-Stores","user.store_ids","ctx.*"]'::jsonb,
     'mis_store_scope', 1, 1, 2, NOW(), NOW())
ON CONFLICT (dimension_code) DO UPDATE SET
    dimension_name = EXCLUDED.dimension_name,
    predicate_type = EXCLUDED.predicate_type,
    column_name    = EXCLUDED.column_name,
    header_name    = EXCLUDED.header_name,
    param_whitelist = EXCLUDED.param_whitelist,
    dict_table     = EXCLUDED.dict_table,
    auto_mode      = EXCLUDED.auto_mode,
    enabled        = EXCLUDED.enabled,
    sort           = EXCLUDED.sort,
    updated_at     = NOW();

-- ---------------------------------------------------------------------------
-- 8. 样本对（iqd_sql_pair）
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_sql_pair (
    id             BIGINT PRIMARY KEY,
    connection_id  BIGINT       NOT NULL,
    question       TEXT         NOT NULL,
    sql_text       TEXT         NOT NULL,
    remark         VARCHAR(512) NULL,
    enabled        SMALLINT     NOT NULL DEFAULT 1,
    wren_ref_id    VARCHAR(128) NULL,                         -- WrenAI 侧引用 id 回填
    sync_status    VARCHAR(16)  NOT NULL DEFAULT 'pending',   -- pending|synced|failed
    synced_at      TIMESTAMPTZ  NULL,
    created_by     BIGINT       NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_iqd_sql_pair_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);
CREATE INDEX idx_iqd_sql_pair_conn_status ON iqd_sql_pair(connection_id, sync_status);

-- ---------------------------------------------------------------------------
-- 9. 知识/术语/口径（iqd_knowledge）
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_knowledge (
    id                BIGINT PRIMARY KEY,
    connection_id     BIGINT       NOT NULL,
    kind              VARCHAR(24)  NOT NULL,                  -- term|metric_definition|synonym|instruction
    title             VARCHAR(256) NOT NULL,
    content           TEXT         NULL,
    related_item_keys JSONB        NULL,
    source            VARCHAR(16)  NOT NULL DEFAULT 'local',  -- local | kb_s07
    kb_term_id        VARCHAR(128) NULL,                      -- S-07 术语表 id（A6 未就绪保留不启用）
    enabled           SMALLINT     NOT NULL DEFAULT 1,
    wren_ref_id       VARCHAR(128) NULL,
    sync_status       VARCHAR(16)  NOT NULL DEFAULT 'pending',
    synced_at         TIMESTAMPTZ  NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_iqd_knowledge_conn FOREIGN KEY (connection_id) REFERENCES iqd_connection(id)
);
CREATE INDEX idx_iqd_knowledge_conn_kind ON iqd_knowledge(connection_id, kind);
CREATE INDEX idx_iqd_knowledge_kb_term ON iqd_knowledge(kb_term_id);

-- ---------------------------------------------------------------------------
-- 10. 脱敏规则（iqd_mask_rule）——全平台 WrenAI 结果脱敏的唯一规则源
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_mask_rule (
    id          BIGINT PRIMARY KEY,
    name        VARCHAR(128)  NOT NULL,
    match_type  VARCHAR(24)   NOT NULL,                       -- column_name|regex|semantic_tag
    pattern     VARCHAR(512)  NOT NULL,
    rule        VARCHAR(24)   NOT NULL,                       -- phone|idcard|email|amount|full|custom
    replacement VARCHAR(128)  NULL,
    priority    INT           NOT NULL DEFAULT 0,
    enabled     SMALLINT      NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_iqd_mask_rule_name UNIQUE (name),
    CONSTRAINT chk_iqd_mask_rule_type CHECK (match_type IN ('column_name','regex','semantic_tag')),
    CONSTRAINT chk_iqd_mask_rule_rule CHECK (rule IN ('phone','idcard','email','amount','full','custom'))
);
CREATE INDEX idx_iqd_mask_rule_enabled ON iqd_mask_rule(enabled, priority);

-- ---------------------------------------------------------------------------
-- 11. 审计日志（iqd_ask_log）——「谁问了什么、见了什么、结果如何」全链路留痕
-- ---------------------------------------------------------------------------
CREATE TABLE iqd_ask_log (
    id               BIGINT PRIMARY KEY,
    trace_id         VARCHAR(64)  NULL,
    session_id       VARCHAR(64)  NULL,
    thread_id        VARCHAR(64)  NULL,
    query_id         VARCHAR(64)  NULL,
    user_id          BIGINT       NOT NULL,
    employee_id      VARCHAR(64)  NULL,
    role_codes       JSONB        NULL,
    question         TEXT         NULL,
    resolved_scope   JSONB        NULL,                       -- row_scope verdict/strategy/dimensions/original_sql
    status           VARCHAR(16)  NULL,
    wren_status_trail JSONB       NULL,                       -- WrenAI 状态轨迹
    sql_text         TEXT         NULL,                       -- 注入行级范围后的最终 SQL
    sql_dialect      VARCHAR(32)  NULL,
    summary          TEXT         NULL,
    citations        JSONB        NULL,
    plan_steps       JSONB        NULL,
    row_count        INT          NULL,
    masked_columns   JSONB        NULL,
    latency_ms       BIGINT       NULL,
    error_code       VARCHAR(32)  NULL,
    error_message    TEXT         NULL,
    view_mode        VARCHAR(16)  NOT NULL DEFAULT 'user',    -- user | admin
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_iqd_ask_log_user_time ON iqd_ask_log(user_id, created_at DESC);
CREATE INDEX idx_iqd_ask_log_trace ON iqd_ask_log(trace_id);
CREATE INDEX idx_iqd_ask_log_status_time ON iqd_ask_log(status, created_at DESC);
