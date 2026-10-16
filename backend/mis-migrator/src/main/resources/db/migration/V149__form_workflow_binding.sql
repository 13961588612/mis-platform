-- V149__form_workflow_binding.sql
-- 表单 ↔ 工作流关联迁到 form_definition（真相源）；wf_definition.supported_form_codes 软废弃 | PostgreSQL 16 | 幂等
--
-- ## 决策
--   * 一个表单三种形态：纯表单(NONE) / 关联本地流程(LOCAL) / 关联外部工作流(EXTERNAL)
--   * LOCAL：workflow_definition_id 软引用 wf_definition.id
--   * EXTERNAL：external_workflow_system + external_workflow_ref（本轮仅落库，运行时对接后续）
--   * 关联一律在表单注册侧维护；流程定义侧仅反查
--   * wf_definition.supported_form_codes 保留列、停止作为写入口（回填后可清空）
--
-- ⚠️ 只追加；绝不修改已发布迁移。

-- ===========================================================================
-- 1) form_definition 关联列
-- ===========================================================================
ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS workflow_binding_type VARCHAR(16) NOT NULL DEFAULT 'NONE';

ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS workflow_definition_id BIGINT NULL;

ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS external_workflow_system VARCHAR(64) NULL;

ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS external_workflow_ref VARCHAR(256) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_form_def_workflow_binding'
          AND conrelid = 'form_definition'::regclass
    ) THEN
        ALTER TABLE form_definition ADD CONSTRAINT chk_form_def_workflow_binding CHECK (
            (workflow_binding_type = 'NONE'
                AND workflow_definition_id IS NULL
                AND external_workflow_system IS NULL
                AND external_workflow_ref IS NULL)
            OR (workflow_binding_type = 'LOCAL'
                AND workflow_definition_id IS NOT NULL
                AND external_workflow_system IS NULL
                AND external_workflow_ref IS NULL)
            OR (workflow_binding_type = 'EXTERNAL'
                AND workflow_definition_id IS NULL
                AND external_workflow_system IS NOT NULL
                AND external_workflow_ref IS NOT NULL)
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_form_def_wf_binding
    ON form_definition (tenant_id, workflow_binding_type, workflow_definition_id)
    WHERE deleted = 0;

-- ===========================================================================
-- 2) 从旧白名单回填（同一 formCode 多流程时取 id 最小的定义）
-- ===========================================================================
WITH owners AS (
    SELECT DISTINCT ON (d.tenant_id, c.code)
           d.tenant_id,
           c.code AS form_code,
           d.id AS definition_id
    FROM wf_definition d
    CROSS JOIN LATERAL unnest(COALESCE(d.supported_form_codes, '{}')) AS c(code)
    WHERE d.deleted = 0
      AND c.code IS NOT NULL
      AND btrim(c.code) <> ''
    ORDER BY d.tenant_id, c.code, d.id
)
UPDATE form_definition f
SET workflow_binding_type = 'LOCAL',
    workflow_definition_id = o.definition_id,
    external_workflow_system = NULL,
    external_workflow_ref = NULL,
    updated_at = NOW()
FROM owners o
WHERE f.tenant_id = o.tenant_id
  AND f.code = o.form_code
  AND f.deleted = 0
  AND f.workflow_binding_type = 'NONE';

-- 旧列清空（保留物理列；读路径改为反查 form_definition）
UPDATE wf_definition
SET supported_form_codes = '{}',
    updated_at = NOW()
WHERE deleted = 0
  AND supported_form_codes IS DISTINCT FROM '{}';

-- SELECT workflow_binding_type, count(*) FROM form_definition WHERE deleted = 0 GROUP BY 1;
-- SELECT id, code, supported_form_codes FROM wf_definition WHERE deleted = 0 LIMIT 5;
