-- ===========================================================================
-- V104__iqd_scope_preview_api_seed.sql —— 行级谓词预览端点登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V73（范围策略 GET/POST 92563/92564 → iqd:scope:view/save；菜单 92511 iqd:scope:view）。
--
-- 内容（1 条 sys_api + 1 条 sys_menu_api）：
--   POST /api/v1/iqd/scope/preview → iqd:scope:view（与范围策略查看同权限码）
--
-- 背景（2026-09-28，偏差 6）：范围页「模拟角色 WHERE 片段预览」原无后端端点，
--   前端只能按 row_scope 模板推导示意串（恒标 degraded）。谓词真实形态由
--   ScopeResolver._build_authorized_predicate 决定（PATH_PREFIX → 字典表 EXISTS、
--   ENUM → IN），前端推导必然与真实注入不一致。本端点复用同一构造逻辑，
--   前端改为调它（含草稿规则 + 示意实参），预览与注入逐字一致。
--
-- 段位：sys_api 92932 / sys_menu_api 92933 / code 00960081 → 菜单 92511
--   （92930/92931 被 V101 占用 → 取 92932/92933；code 段 00960080 已用 → 00960081）
-- 列口径对齐 V92/V100/V101：sys_menu_api 为 (id, menu_id, api_id, sort, created_at)，无 status 列。
--
-- ⚠️ 新 method+path 未登记时，BFF 在 deny-unmapped=true 下直接 40300「接口未授权映射」。
--    BFF 内存注册表启动加载 + 每 300s 定时重载；迁移后最多等 300s，或重启 mis-admin-bff。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (
    VALUES
    (92932, 92020, 92550, '00960081', 'api'::sys_api_node_type, '行级谓词预览', 'POST', '/api/v1/iqd/scope/preview', 17, 1, NOW(), NOW())
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
    (92933, 92511, 92932, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 验证（期望 1 行；permission = iqd:scope:view）：
--   SELECT a.http_method, a.path_pattern, m.permission
--     FROM sys_api a
--     JOIN sys_menu_api ma ON ma.api_id = a.id
--     JOIN sys_menu m ON m.id = ma.menu_id
--    WHERE a.id = 92932;
-- ---------------------------------------------------------------------------