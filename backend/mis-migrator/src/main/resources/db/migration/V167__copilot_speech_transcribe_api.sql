-- V167：Copilot 语音转写 BFF 薄转发 | PostgreSQL 16 | 幂等
-- POST /api/v1/agent-ops/speech/transcribe → ai-platform /api/v1/speech/transcribe
-- 绑 agent:chat:use（92032）；deny-unmapped=true 必须登记

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (VALUES
    (93233, 92020, 92090, '00920079', 'api'::sys_api_node_type, 'Copilot语音转写', 'POST', '/api/v1/agent-ops/speech/transcribe', 66, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  );

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (93274, 92032, 93233, 11, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);
