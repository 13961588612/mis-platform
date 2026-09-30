-- ===========================================================================
-- V109__iqd_db_profile_api_seed.sql —— 数据库连接配置（Tab①）端点登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V72（iqd:config:* 权限码按钮 92501/92502/92503 → 菜单 92500）
--
-- 内容：把新增的 /api/v1/iqd/db-profiles/** 端点挂到既有 iqd:config:* 权限码：
--   GET    /api/v1/iqd/db-profiles            -> iqd:config:view
--   GET    /api/v1/iqd/db-profiles/{id}       -> iqd:config:view
--   POST   /api/v1/iqd/db-profiles            -> iqd:config:save
--   PUT    /api/v1/iqd/db-profiles/{id}       -> iqd:config:save
--   DELETE /api/v1/iqd/db-profiles/{id}       -> iqd:config:save
--   POST   /api/v1/iqd/db-profiles/{id}/test  -> iqd:config:test
--
-- 段位：sys_api 92940.. / sys_menu_api 92960..（避开 V100/V105/V106 已用段）
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (VALUES
    (92940, 92020, 92550, '00960100', 'api'::sys_api_node_type, '数据库连接配置-清单',   'GET',    '/api/v1/iqd/db-profiles',            10, 1, NOW(), NOW()),
    (92941, 92020, 92550, '00960101', 'api'::sys_api_node_type, '数据库连接配置-详情',   'GET',    '/api/v1/iqd/db-profiles/{id}',       11, 1, NOW(), NOW()),
    (92942, 92020, 92550, '00960102', 'api'::sys_api_node_type, '数据库连接配置-新建',   'POST',   '/api/v1/iqd/db-profiles',            12, 1, NOW(), NOW()),
    (92943, 92020, 92550, '00960103', 'api'::sys_api_node_type, '数据库连接配置-更新',   'PUT',    '/api/v1/iqd/db-profiles/{id}',       13, 1, NOW(), NOW()),
    (92944, 92020, 92550, '00960104', 'api'::sys_api_node_type, '数据库连接配置-删除',   'DELETE', '/api/v1/iqd/db-profiles/{id}',       14, 1, NOW(), NOW()),
    (92945, 92020, 92550, '00960105', 'api'::sys_api_node_type, '数据库连接配置-连通测试', 'POST', '/api/v1/iqd/db-profiles/{id}/test',  15, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  );

-- 绑定：view → 92501；save → 92502；test → 92503
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92960, 92501, 92940, 1, NOW()),
    (92961, 92501, 92941, 2, NOW()),
    (92962, 92502, 92942, 3, NOW()),
    (92963, 92502, 92943, 4, NOW()),
    (92964, 92502, 92944, 5, NOW()),
    (92965, 92503, 92945, 6, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);
