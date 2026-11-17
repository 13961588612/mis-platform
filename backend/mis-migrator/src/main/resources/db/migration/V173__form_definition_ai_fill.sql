-- V173：表单注册绑定自动填单 Agent + Skill；示例技能 form-assist 执行码
-- PostgreSQL 16 | 幂等
--
-- 成对可空：ai_agent_id / ai_skill_id 同时为空（关闭辅助录入）或同时有值。
-- 软引用，不建 FK。执行权仍是 ai:skill:{skill_id}:run（与技能池授权同一套）。

ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS ai_agent_id VARCHAR(64) NULL;

ALTER TABLE form_definition
    ADD COLUMN IF NOT EXISTS ai_skill_id VARCHAR(128) NULL;

COMMENT ON COLUMN form_definition.ai_agent_id IS '自动填单 Agent id（与 ai_skill_id 成对）';
COMMENT ON COLUMN form_definition.ai_skill_id IS '自动填单 Skill id（与 ai_agent_id 成对）';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_form_def_ai_fill'
          AND conrelid = 'form_definition'::regclass
    ) THEN
        ALTER TABLE form_definition ADD CONSTRAINT chk_form_def_ai_fill CHECK (
            (ai_agent_id IS NULL AND ai_skill_id IS NULL)
            OR (ai_agent_id IS NOT NULL AND btrim(ai_agent_id) <> ''
                AND ai_skill_id IS NOT NULL AND btrim(ai_skill_id) <> '')
        );
    END IF;
END $$;

-- 示例技能 form-assist 的执行按钮（system App，目录 92200）
INSERT INTO sys_menu (
    id, tenant_id, app_id, parent_id, code, name, type,
    path, component, permission, icon, sort, visible, status,
    created_at, updated_at
)
SELECT v.* FROM (VALUES
    (
        92207::BIGINT, 1, 1, 92200,
        'ai_skill_run_form_assist',
        '执行技能：表单辅助录入',
        3,
        NULL::VARCHAR, NULL::VARCHAR,
        'ai:skill:form-assist:run',
        NULL::VARCHAR,
        7, 1, 1,
        NOW(), NOW()
    )
) AS v(
    id, tenant_id, app_id, parent_id, code, name, type,
    path, component, permission, icon, sort, visible, status,
    created_at, updated_at
)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu m WHERE m.app_id = 1 AND m.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu m
    WHERE m.app_id = 1 AND m.status = 1 AND m.permission = v.permission
  )
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 92200);

INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 92207
  AND m.app_id = 1
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  );
