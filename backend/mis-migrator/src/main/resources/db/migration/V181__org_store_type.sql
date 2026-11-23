-- V181__org_store_type.sql —— 组织门店增加「门店类型」
-- BGMD=百购门店 / CSMD=超市门店 / WLZS=物流中心；仅 is_store=1 时填写。

ALTER TABLE sys_org
    ADD COLUMN IF NOT EXISTS store_type VARCHAR(16) NULL;

COMMENT ON COLUMN sys_org.store_type IS '门店类型：BGMD=百购门店 CSMD=超市门店 WLZS=物流中心（is_store=1 时填写）';
