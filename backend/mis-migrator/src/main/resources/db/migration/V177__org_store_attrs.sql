-- V177__org_store_attrs.sql —— 组织增加「是否门店 / 门店编号」
-- 门店编号在租户内、未删除且 is_store=1 时唯一。
-- 版本：master 已占用 V176 给 recon 注册，本脚本从 ext-app 原 V176 顺延。

ALTER TABLE sys_org
    ADD COLUMN IF NOT EXISTS is_store SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS store_code VARCHAR(64) NULL;

COMMENT ON COLUMN sys_org.is_store IS '是否门店：0=否 1=是';
COMMENT ON COLUMN sys_org.store_code IS '门店编号（is_store=1 时填写）';

CREATE UNIQUE INDEX IF NOT EXISTS uk_org_tenant_store_code
    ON sys_org (tenant_id, store_code)
    WHERE deleted = 0 AND is_store = 1 AND store_code IS NOT NULL AND btrim(store_code) <> '';
