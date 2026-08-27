-- ===========================================================================
-- V59__user_employee_lookup_api.sql —— 用户管理员工查找端点补登 sys_api
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V58 已加 sys_user.email；用户管理新增 by-phone / check-employee-binding。
--
-- 根因：BFF deny-unmapped=true；ApiService.registry() = sys_api ⋈ sys_menu_api ⋈ sys_menu。
--   GET /api/v1/users/employees/by-phone 未登记 → 40300「接口未授权映射」。
--   GET /api/v1/users/check-employee-binding 同属新建端点，一并补登，避免 {id} 误匹配。
--
-- 内容：
--   A. sys_api 1012-1013（用户查询 catalog 1001）
--   B. sys_menu_api 91298-91301：挂新增(211) + 编辑(212)，并集 system:user:add|edit
--
-- 段位（2026-08-18 全仓核实）：
--   sys_api      1012-1013 —— V4 用到 1011；1000 段此后空闲
--   sys_menu_api 91298-91301 —— V55 用到 91297
--   code         000100010004-000100010005
--
-- 幂等：固定 ID + WHERE NOT EXISTS；不得修改已发布 V1-V58。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (1012, 1, 1001, '000100010004', 'api'::sys_api_node_type, '按手机查员工',   'GET', '/api/v1/users/employees/by-phone', 4, 1, NOW(), NOW()),
    (1013, 1, 1001, '000100010005', 'api'::sys_api_node_type, '员工绑定预检',   'GET', '/api/v1/users/check-employee-binding', 5, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 1001);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91298, 211, 1012, 2, NOW()),
    (91299, 212, 1012, 4, NOW()),
    (91300, 211, 1013, 3, NOW()),
    (91301, 212, 1013, 5, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m ON ma.menu_id = m.id
--   WHERE a.id IN (1012, 1013)
--   ORDER BY a.id, m.id;
--   -- 期望 4 行；permission = system:user:add|edit 各 ×2
-- ---------------------------------------------------------------------------
