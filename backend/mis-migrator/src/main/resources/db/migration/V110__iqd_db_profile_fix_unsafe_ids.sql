-- ===========================================================================
-- V110__iqd_db_profile_fix_unsafe_ids.sql —— 修复超出 JS 安全整数的 profile id
-- PostgreSQL 16 | 库名: mis_platform
--
-- 背景（2026-09-30 真机 bug）
-- ----------------------------------------------------------------
-- V108 回填 profile 时用了 `7000000000000000000 + ROW_NUMBER()`，得到
-- `7000000000000000001`。该值 **超出 JavaScript 的 Number.MAX_SAFE_INTEGER
-- (9007199254740991)** —— 前端 JSON.parse 会把 id 舍入成 `7000000000000000000`
-- （最后一位丢失），于是 DELETE/PUT /db-profiles/7000000000000000000 报
-- `40400 数据库连接配置不存在`，而库里真正存在的是 ...001。
--
-- 本迁移把 > MAX_SAFE_INTEGER 的 profile id 重新编号到**安全区间**
-- （9000000000000000 + ROW_NUMBER()，仍远小于 2^53），并同步更新引用它的
-- project（iqd_connection.profile_id）。
--
-- 幂等：WHERE id > MAX_SAFE_INTEGER 守卫；无超大 id 时为 no-op。
-- ===========================================================================

-- 1) 先记录映射（临表，事务内可见）
CREATE TEMP TABLE IF NOT EXISTS _iqd_profile_remap ON COMMIT DROP AS
SELECT id AS old_id,
       (9000000000000000 + ROW_NUMBER() OVER (ORDER BY id)) AS new_id
FROM iqd_db_profile
WHERE id > 9007199254740991;

-- 2) 拆外键 → 改子表 → 改主表 → 恢复外键（避免改父键时违反 FK）
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM _iqd_profile_remap) THEN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_iqd_connection_profile') THEN
            ALTER TABLE iqd_connection DROP CONSTRAINT fk_iqd_connection_profile;
        END IF;

        UPDATE iqd_connection c
        SET profile_id = r.new_id
        FROM _iqd_profile_remap r
        WHERE c.profile_id = r.old_id;

        UPDATE iqd_db_profile p
        SET id = r.new_id
        FROM _iqd_profile_remap r
        WHERE p.id = r.old_id;

        ALTER TABLE iqd_connection
            ADD CONSTRAINT fk_iqd_connection_profile
            FOREIGN KEY (profile_id) REFERENCES iqd_db_profile(id);
    END IF;
END $$;

-- 3) 兜底：任何仍超出安全范围的 id（含手工插入）也一并规整
DO $$
DECLARE
    rec RECORD;
    next_id BIGINT := 9000000000000000;
BEGIN
    IF EXISTS (SELECT 1 FROM iqd_db_profile WHERE id > 9007199254740991) THEN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_iqd_connection_profile') THEN
            ALTER TABLE iqd_connection DROP CONSTRAINT fk_iqd_connection_profile;
        END IF;
        FOR rec IN SELECT id FROM iqd_db_profile WHERE id > 9007199254740991 ORDER BY id LOOP
            next_id := next_id + 1;
            UPDATE iqd_connection SET profile_id = next_id WHERE profile_id = rec.id;
            UPDATE iqd_db_profile SET id = next_id WHERE id = rec.id;
        END LOOP;
        ALTER TABLE iqd_connection
            ADD CONSTRAINT fk_iqd_connection_profile
            FOREIGN KEY (profile_id) REFERENCES iqd_db_profile(id);
    END IF;
END $$;

COMMENT ON COLUMN iqd_db_profile.id IS '主键（必须 ≤ 2^53-1，否则前端 JS 会舍入丢精度）';
