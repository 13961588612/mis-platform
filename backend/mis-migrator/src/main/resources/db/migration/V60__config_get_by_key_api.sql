-- ===========================================================================
-- V60__config_get_by_key_api.sql —— 按 key 读系统参数补登 sys_api
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V59 已登记 by-phone；用户新建表单读 user.force.employee.bind。
--
-- 根因：BFF deny-unmapped=true；GET /api/v1/configs/key/{key} 未登记
--   → 40300「接口未授权映射」→ 前端 catch 当成未开启强制绑定。
--   系统参数页已把该值改为 TRUE，但新建用户读不到。
--
-- 内容：
--   A. sys_api 91204（系统参数 catalog 91189）
--   B. sys_menu_api 91302/91303：挂 系统参数页(293) + 用户管理页(201)
--      并集 system:config:list | system:user:list，用户管理无需参数页权限也能读开关
--
-- 段位（2026-08-18 全仓核实）：
--   sys_api      91204 —— V49 用到 91203；V54/55 用 9201-9205
--   sys_api.code 00900112 —— V55 用到 00900111
--   sys_menu_api 91302-91303 —— V59 用到 91301
--
-- 幂等：固定 ID + WHERE NOT EXISTS；不得修改已发布 V1-V59。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91204, 4, 91189, '00900112', 'api'::sys_api_node_type, '按键读参数', 'GET', '/api/v1/configs/key/{key}', 6, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91189);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91302, 293, 91204, 3, NOW()),
    (91303, 201, 91204, 3, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   SELECT a.id, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m ON ma.menu_id = m.id
--   WHERE a.id = 91204;
--   -- 期望 2 行：system:config:list / system:user:list
-- ---------------------------------------------------------------------------
