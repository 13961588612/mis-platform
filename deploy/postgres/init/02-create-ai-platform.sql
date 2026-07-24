-- =============================================================================
-- 融合部署：在共享主 MIS PostgreSQL 实例上幂等创建 ai-platform 专用库与角色
-- =============================================================================
-- 与 mis_platform / nacos 同实例、异库；Flyway 管 mis_platform，Alembic 管
-- ai_platform（库级隔离，工具互不踩踏，见 docs/ai-fusion/ai-fusion-deploy-decision.md §3.1）。
--
-- 该脚本由 docker-entrypoint-initdb.d 在 PG 首次启动时执行一次。
-- 使用 psql \gexec 实现幂等（PostgreSQL 不支持 CREATE DATABASE IF NOT EXISTS，
-- 且 CREATE DATABASE 不能位于事务块内，故用「条件 SELECT + \gexec」绕过）。
-- =============================================================================

-- 1) 角色（最小权限，不复用 postgres 超级用户）
SELECT 'CREATE ROLE aiplatform WITH LOGIN PASSWORD ''aiplatform_dev_password'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aiplatform')
\gexec

-- 2) 数据库（OWNER 指向刚建好的角色）
SELECT 'CREATE DATABASE ai_platform OWNER aiplatform'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_platform')
\gexec

-- 3) 库级授权（连接 + 建表；Alembic 以 aiplatform 身份执行迁移）
GRANT ALL PRIVILEGES ON DATABASE ai_platform TO aiplatform;
