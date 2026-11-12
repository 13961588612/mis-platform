-- V150__form_record_and_pur_form_store.sql
-- 表单单据 form_record + PUR_FORM 专用宽表 + wf_instance.form_record_id + API 登记 | PostgreSQL 16 | 幂等
--
-- 产品：结构化宽表为数据真相源；form_record 管状态/挂流程；撤回后回 SAVED 再发新实例。
-- ID：sys_api 95120~95125；sys_menu_api 95120~95125（绑测试表单菜单 95110）
--
-- ⚠️ 只追加；绝不修改 V1~V149（V149 为 form_workflow_binding，已在测试库执行）。

-- ===========================================================================
-- 1) form_record
-- ===========================================================================
CREATE TABLE IF NOT EXISTS form_record (
    id                   BIGINT PRIMARY KEY,
    tenant_id            BIGINT       NOT NULL,
    form_code            VARCHAR(64)  NOT NULL,
    status               VARCHAR(16)  NOT NULL DEFAULT 'SAVED',
    storage_table        VARCHAR(128) NOT NULL,
    data_id              BIGINT       NOT NULL,
    current_instance_id  BIGINT       NULL,
    last_instance_id     BIGINT       NULL,
    title                VARCHAR(256) NULL,
    payload_snapshot     JSONB        NULL,
    created_by           BIGINT       NOT NULL,
    created_by_name      VARCHAR(64)  NULL,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted              SMALLINT     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_form_record_creator
    ON form_record (tenant_id, created_by, status)
    WHERE deleted = 0;

CREATE INDEX IF NOT EXISTS idx_form_record_form_code
    ON form_record (tenant_id, form_code, status)
    WHERE deleted = 0;

CREATE INDEX IF NOT EXISTS idx_form_record_current_inst
    ON form_record (current_instance_id)
    WHERE current_instance_id IS NOT NULL AND deleted = 0;

-- ===========================================================================
-- 2) PUR_FORM 专用宽表
-- ===========================================================================
CREATE TABLE IF NOT EXISTS biz_form_pur_form (
    id              BIGINT PRIMARY KEY,
    tenant_id       BIGINT         NOT NULL,
    form_record_id  BIGINT         NULL,
    order_no        VARCHAR(64)    NULL,
    supplier        VARCHAR(256)   NULL,
    amount          NUMERIC(18, 2) NULL,
    apply_date      DATE           NULL,
    priority        VARCHAR(32)    NULL,
    categories      JSONB          NULL,
    urgent          BOOLEAN        NULL,
    reason          TEXT           NULL,
    created_by      BIGINT         NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted         SMALLINT       NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_biz_form_pur_form_tenant
    ON biz_form_pur_form (tenant_id)
    WHERE deleted = 0;

COMMENT ON TABLE biz_form_pur_form IS 'PUR_FORM 采购申请专用宽表（SQL 汇总真相源）';

-- ===========================================================================
-- 3) wf_instance.form_record_id
-- ===========================================================================
ALTER TABLE wf_instance
    ADD COLUMN IF NOT EXISTS form_record_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_wf_inst_form_record
    ON wf_instance (form_record_id)
    WHERE form_record_id IS NOT NULL;

-- form_definition 可选记录物理表名（运维核对；无列则跳过）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = 'form_definition'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'form_definition'
           AND column_name = 'storage_table'
    ) THEN
        ALTER TABLE form_definition ADD COLUMN storage_table VARCHAR(128) NULL;
    END IF;
END $$;

UPDATE form_definition
   SET storage_table = 'biz_form_pur_form',
       updated_at = NOW()
 WHERE code = 'PUR_FORM'
   AND deleted = 0
   AND (storage_table IS NULL OR storage_table <> 'biz_form_pur_form');

-- ===========================================================================
-- 4) sys_api 登记
-- ===========================================================================
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95120, 95010, 95010, 'form_record_list', 'api'::sys_api_node_type, '表单单据列表',
   'GET', '/api/v1/form-records', 120, 1, NOW(), NOW()),
  (95121, 95010, 95010, 'form_record_get', 'api'::sys_api_node_type, '表单单据详情',
   'GET', '/api/v1/form-records/{id:[0-9]+}', 121, 1, NOW(), NOW()),
  (95122, 95010, 95010, 'form_record_create', 'api'::sys_api_node_type, '保存表单单据',
   'POST', '/api/v1/form-records', 122, 1, NOW(), NOW()),
  (95123, 95010, 95010, 'form_record_update', 'api'::sys_api_node_type, '更新表单单据',
   'PUT', '/api/v1/form-records/{id:[0-9]+}', 123, 1, NOW(), NOW()),
  (95124, 95010, 95010, 'form_record_start', 'api'::sys_api_node_type, '单据发起流程',
   'POST', '/api/v1/form-records/{id:[0-9]+}/start-process', 124, 1, NOW(), NOW()),
  (95125, 95010, 95010, 'wf_instance_withdraw', 'api'::sys_api_node_type, '发起人撤回流程',
   'POST', '/api/v1/workflow/instances/{id:[0-9]+}/withdraw', 125, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );

-- 绑定「测试表单」菜单 95110
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95120, 95110, 95120, 10, NOW()),
  (95121, 95110, 95121, 11, NOW()),
  (95122, 95110, 95122, 12, NOW()),
  (95123, 95110, 95123, 13, NOW()),
  (95124, 95110, 95124, 14, NOW()),
  (95125, 95110, 95125, 15, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);
