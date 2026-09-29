-- ===========================================================================
-- V107__iqd_connection_db_profile.sql —— 路线 A：连接展示用数据库连接字段
-- PostgreSQL 16 | 库名: mis_platform
--
-- 背景：路线 A 把业务库凭证（host/port/user/password/database）由「wren 机手工
-- profile」改为「平台侧管理」。明文密文统一存 ai_platform.credential_mappings
-- （AES-256-GCM vault，键 = secret_ref）；**本表绝不落密码**。
--
-- 本迁移只加**非敏感展示列**，用途有二：
--   1) 连接列表 / 编辑弹窗可直接回显 db_type/host/port/database/user，
--      无需为每行回调 ai-platform vault（避免列表 N+1）；
--   2) 表发现直连（list_tables/list_schemas）需要 host/port/database 才能建连接。
--
-- 安全边界（红线）：
--   * db_password **不在此表**，只在 vault；
--   * 用户在连接向导里填的密码经 BFF 直接送 ai-platform vault，经 mis-iqd 时只留 secret_ref。
--
-- 幂等：ADD COLUMN IF NOT EXISTS；可重复执行（Flyway 仅首次应用）。
-- ===========================================================================

ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS db_type     VARCHAR(32)  NULL;

ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS db_host     VARCHAR(255) NULL;

ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS db_port     INTEGER      NULL;

ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS db_database VARCHAR(128) NULL;

ALTER TABLE iqd_connection
    ADD COLUMN IF NOT EXISTS db_user     VARCHAR(128) NULL;

COMMENT ON COLUMN iqd_connection.db_type     IS '业务库类型（starrocks/mysql/postgres/...）；路线 A 平台管理连接';
COMMENT ON COLUMN iqd_connection.db_host     IS '业务库 host（非敏感，展示+表发现直连用）';
COMMENT ON COLUMN iqd_connection.db_port     IS '业务库 port（非敏感）';
COMMENT ON COLUMN iqd_connection.db_database IS '业务库 database / schema（非敏感）';
COMMENT ON COLUMN iqd_connection.db_user     IS '业务库账号名（非敏感；密码只在 ai-platform vault）';
