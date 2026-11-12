-- ===========================================================================
-- V105__iqd_relationship_delete_api_seed.sql —— 关系删除端点登记（T03c 删除路径）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V87（建模台主页 92600 + 权限码 92632 iqd:modeling:edit；sys_api 段 92601-92612）。
--
-- 内容（1 条 sys_api + 1 条 sys_menu_api）：
--   DELETE /api/v1/iqd/catalog/relationship/{itemKey} → iqd:modeling:edit（菜单 92632）
--
-- 背景（2026-09-29）：建模台此前**只能建关系、不能删** —— 画布 onEdgesChange 主动过滤
--   remove（避免「画布删了、刷新又回来」的假删除），后端亦无删除端点。
--   本迁移登记真删除端点：物理删除 + bump current_edit_revision，
--   与 T04a cube 子节点孤儿清理同口径（关系是叶子节点，删除风险最低，故先只开这一条）。
--
-- 段位：sys_api 92934 / sys_menu_api 92935 / code 00960082 → 菜单 92632
--   （92932/92933 被 V104 占用；code 段 00960081 已用 → 00960082）
--
-- 路径变量说明：item_key 形如 `mdl:relationship:<name>`（含冒号，**不含斜杠**），
--   注册表按整段匹配写 `{itemKey}`（不加 `:[0-9]+` 约束 —— 那是数字 id 的约定）。
--
-- 列口径对齐 V92/V100/V101/V104：sys_menu_api 为 (id, menu_id, api_id, sort, created_at)，无 status 列。
--
-- ⚠️ 新 method+path 未登记时，BFF 在 deny-unmapped=true 下直接 40300「接口未授权映射」。
--    BFF 内存注册表启动加载 + 每 300s 定时重载；迁移后最多等 300s，或重启 mis-admin-bff。
-- ===========================================================================

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (
    VALUES
    (92934, 92020, 92550, '00960082', 'api'::sys_api_node_type, '建模台-删除关系', 'DELETE', '/api/v1/iqd/catalog/relationship/{itemKey}', 38, 1, NOW(), NOW())
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
    (92935, 92632, 92934, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 验证（期望 1 行；permission = iqd:modeling:edit）：
--   SELECT a.http_method, a.path_pattern, m.permission
--     FROM sys_api a
--     JOIN sys_menu_api ma ON ma.api_id = a.id
--     JOIN sys_menu m ON m.id = ma.menu_id
--    WHERE a.id = 92934;
-- ---------------------------------------------------------------------------