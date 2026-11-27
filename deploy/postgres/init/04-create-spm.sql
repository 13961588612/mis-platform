-- 超市运营业务库（S4 10.254.26.36）。首次执行一次。
-- docker exec -i mis-postgres psql -U postgres < 04-create-spm.sql

CREATE USER spm WITH PASSWORD 'spm#1014';
CREATE DATABASE spm OWNER spm;
GRANT ALL PRIVILEGES ON DATABASE spm TO spm;

\connect spm
GRANT ALL ON SCHEMA public TO spm;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO spm;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO spm;
