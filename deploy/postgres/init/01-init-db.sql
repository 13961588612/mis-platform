-- 创建应用用户与数据库（docker-entrypoint-initdb.d 仅首次启动执行）
CREATE USER mis WITH PASSWORD 'mis123';
CREATE DATABASE mis_platform OWNER mis;
GRANT ALL PRIVILEGES ON DATABASE mis_platform TO mis;

\connect mis_platform
GRANT ALL ON SCHEMA public TO mis;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mis;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO mis;
