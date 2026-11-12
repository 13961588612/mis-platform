-- ===========================================================================
-- V108__iqd_db_profile_and_project_split.sql —— 连接配置分两层：profile（数据库） + project（wren context）
-- PostgreSQL 16 | 库名: mis_platform
--
-- 背景（2026-09-29 用户拍板）
-- ----------------------------------------------------------------
-- 「连接配置」原先把两件事混在 iqd_connection 一行里：
--   ① 业务库在哪（host/port/database/user/password）—— 对应 wren 的 **profile**
--   ② 语义工程是什么（模型/发布/MCP 进程）—— 对应 wren 的 **context / project**
-- 导致菜单与心智混乱，且 profile 与 project 被 1:1 硬绑。
--
-- 本迁移把两者拆开，且显式建模 **profile : project = 1 : N**（同一业务库可挂多个语义工程）：
--   * 新表 iqd_db_profile —— Tab①「数据库连接配置」；
--   * iqd_connection 语义收敛为 **project**（Tab②）—— 新增 profile_id 外键；
--   * 旧 db_* 列**暂不删除**（兼容回滚 + 灰度），但 profile 成为唯一真值源。
--
-- 数据迁移（幂等）
-- ----------------------------------------------------------------
-- 每个「已填过业务库坐标」的既有连接，回填一条同名 profile，并绑定 profile_id。
-- 现有 900001 / 1790686095967 坐标残缺（只填了 port/password），也会各生成一条，
-- 由用户在 Tab① 补全，而不再散落在 project 行上。
--
-- 幂等：CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS；
--       回填用 NOT EXISTS 守卫（可重复执行）。
-- ===========================================================================

-- 1) 数据库连接配置（wren profile 的平台侧登记）
CREATE TABLE IF NOT EXISTS iqd_db_profile (
    id            BIGINT       PRIMARY KEY,
    name          VARCHAR(128) NOT NULL,
    db_type       VARCHAR(32)  NOT NULL DEFAULT 'starrocks',
    db_host       VARCHAR(255) NULL,
    db_port       INTEGER      NULL,
    db_database   VARCHAR(128) NULL,
    db_user       VARCHAR(128) NULL,
    -- 凭证明文只在 ai-platform vault；此处仅存引用（= CredentialVault system_account）
    secret_ref    VARCHAR(256) NULL,
    description   VARCHAR(512) NULL,
    enabled       SMALLINT     NOT NULL DEFAULT 1,
    -- 新建 project 时默认选中的 profile（至多一条为 1，业务层保证）
    is_default    SMALLINT     NOT NULL DEFAULT 0,
    last_test_at  TIMESTAMPTZ  NULL,
    last_test_ok  SMALLINT     NULL,
    last_test_msg VARCHAR(512) NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_iqd_db_profile_name UNIQUE (name)
);

COMMENT ON TABLE  iqd_db_profile IS 'Tab① 数据库连接配置（= wren profile 的平台登记）；密码只在 ai-platform vault';
COMMENT ON COLUMN iqd_db_profile.secret_ref IS 'vault 引用（CredentialVault system_account）；密码绝不落本表';
COMMENT ON COLUMN iqd_db_profile.is_default IS '新建 project 默认选中的 profile（0/1）';

-- 2) project 指向 profile（1 : N）
ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS profile_id BIGINT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_iqd_connection_profile'
    ) THEN
        ALTER TABLE iqd_connection
            ADD CONSTRAINT fk_iqd_connection_profile
            FOREIGN KEY (profile_id) REFERENCES iqd_db_profile(id);
    END IF;
END $$;

COMMENT ON COLUMN iqd_connection.profile_id IS '所属数据库连接配置（iqd_db_profile.id）；项目=wren context，profile=业务库连接';

-- 3) 回填：已填业务库坐标的既有连接各生成一条 profile（确定性 id，避开雪花号段）
INSERT INTO iqd_db_profile (
    id, name, db_type, db_host, db_port, db_database, db_user, secret_ref,
    description, enabled, is_default, created_at, updated_at
)
SELECT
    7000000000000000000 + ROW_NUMBER() OVER (ORDER BY c.id) AS id,
    c.name || ' 数据源' AS name,
    COALESCE(NULLIF(c.db_type, ''), NULLIF(c.default_connector, ''), 'starrocks') AS db_type,
    c.db_host, c.db_port, c.db_database, c.db_user, c.secret_ref,
    '由旧连接自动迁移（请核对坐标）', 1,
    CASE WHEN c.enabled = 1 THEN 1 ELSE 0 END,
    NOW(), NOW()
FROM iqd_connection c
WHERE c.profile_id IS NULL
  AND (c.db_host IS NOT NULL OR c.db_database IS NOT NULL OR c.db_user IS NOT NULL
       OR c.db_type IS NOT NULL)
  AND NOT EXISTS (
      SELECT 1 FROM iqd_db_profile p WHERE p.name = c.name || ' 数据源'
  );

-- 4) 绑定 project → profile
UPDATE iqd_connection c
SET profile_id = p.id
FROM iqd_db_profile p
WHERE c.profile_id IS NULL
  AND p.name = c.name || ' 数据源';
