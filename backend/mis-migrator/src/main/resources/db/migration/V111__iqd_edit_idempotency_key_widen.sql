-- V111__iqd_edit_idempotency_key_widen.sql
-- 幂等键列加宽：V80 建表为 VARCHAR(64)，但前端幂等键模板
-- `{connId}:{kind}:{action}:{uuid}` 在雪花连接 id（最长约 19 位）下可达 ~76 字符，
-- 超过 64 会触发 `value too long for type character varying(64)`（POST /catalog/relationship 500）。
-- 加宽到 128，覆盖 BIGINT 连接 id + 36 位 uuid 的最坏情况；不改语义、不重建索引。
ALTER TABLE iqd_edit_idempotency
    ALTER COLUMN idempotency_key TYPE VARCHAR(128);
