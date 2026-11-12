-- V125__taskflow_api_seed_missing.sql
-- 补齐 V123 漏注册的任务流接口（前端实际调用但未映射 → BFF fail-closed 返回 40300）。
-- 段位：sys_api 95045-95049 空闲；sys_menu_api 95045-95049 空闲。
-- 幂等：固定 ID + NOT EXISTS。

-- GET /api/v1/audit-ops/stats（业务审计统计）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95045, 95010, 95010, '00950045', 'api'::sys_api_node_type, '业务审计统计', 'GET', '/api/v1/audit-ops/stats', 45, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = 95045)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = '00950045')
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.type='api' AND a.status=1 AND a.http_method='GET' AND a.path_pattern='/api/v1/audit-ops/stats');

-- POST /api/v1/exec-monitor/{id}/retry（手动重试）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95046, 95010, 95010, '00950046', 'api'::sys_api_node_type, '执行任务手动重试', 'POST', '/api/v1/exec-monitor/{id:[0-9]+}/retry', 46, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = 95046)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = '00950046')
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.type='api' AND a.status=1 AND a.http_method='POST' AND a.path_pattern='/api/v1/exec-monitor/{id:[0-9]+}/retry');

-- POST /api/v1/exec-monitor/scan（运维手动触发扫描）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
  (95047, 95010, 95010, '00950047', 'api'::sys_api_node_type, '执行扫描触发', 'POST', '/api/v1/exec-monitor/scan', 47, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = 95047)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 95010 AND a.code = '00950047')
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.type='api' AND a.status=1 AND a.http_method='POST' AND a.path_pattern='/api/v1/exec-monitor/scan');

-- 菜单绑定：审计统计 → 业务审计(95008)；重试 + 扫描 → 执行监控(95009)
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
  (95045, 95008, 95045, 4, NOW()),
  (95046, 95009, 95046, 2, NOW()),
  (95047, 95009, 95047, 3, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);