-- MIS Platform — 企微用户身份绑定 运营台（wecom-user-binding-design.md §11）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V19__agent_ops_seed.sql（menu 92040 /api/... /agent/channels/wecom）
--       V20__agent_ops_api_perms.sql（catalog 92090 / 模块 92020 / #48–#54）
--
-- 背景：V20 已登记企微 Bot 管理 #48–#54。设计文档 §11 要求补一组「企微用户绑定」
-- 运营台能力：绑定列表 / 人工绑定 / 解绑 / 校验。本文件补 2 个按钮码 + 4 条 API。
--
-- 新增：
--   按钮码  92065 agent:wecom:user:list    查看绑定列表
--           92066 agent:wecom:user:manage  绑定 / 解绑 / 校验
--   API     92250 GET    /api/v1/agent-ops/channels/wecom/users
--           92251 POST   /api/v1/agent-ops/channels/wecom/users/{corpId}/{wecomUserId}/bind
--           92252 POST   /api/v1/agent-ops/channels/wecom/users/{corpId}/{wecomUserId}/unbind
--           92253 POST   /api/v1/agent-ops/channels/wecom/users/{corpId}/{wecomUserId}/verify
--
-- 幂等：固定 ID + WHERE NOT EXISTS；(method, path) 唯一约束 uk_api_method_path 兜底。
-- 约束：append-only，不得修改 V1–V114。
-- ---------------------------------------------------------------------------

-- 1. 按钮码（type=3，不进侧栏，父 92040）
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92065, 1, 92010, 92040, 'agent_wecom_user_list',   '查看企微用户绑定', 3, NULL, NULL, 'agent:wecom:user:list',   NULL, 2, 1, 1, NOW(), NOW()),
    (92066, 1, 92010, 92040, 'agent_wecom_user_manage', '绑定/解绑/校验',   3, NULL, NULL, 'agent:wecom:user:manage', NULL, 3, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_app WHERE id = 92010);

-- 2. API 行（挂 catalog 92090 / 模块 92020）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92250, 92020, 92090, '00920059', 'api'::sys_api_node_type, '企微用户绑定列表',   'GET',  '/api/v1/agent-ops/channels/wecom/users',                                         59, 1, NOW(), NOW()),
    (92251, 92020, 92090, '00920060', 'api', '人工绑定企微用户',   'POST', '/api/v1/agent-ops/channels/wecom/users/{corpId}/{wecomUserId}/bind',              60, 1, NOW(), NOW()),
    (92252, 92020, 92090, '00920061', 'api', '解绑企微用户',       'POST', '/api/v1/agent-ops/channels/wecom/users/{corpId}/{wecomUserId}/unbind',            61, 1, NOW(), NOW()),
    (92253, 92020, 92090, '00920062', 'api', '校验企微用户绑定',   'POST', '/api/v1/agent-ops/channels/wecom/users/{corpId}/{wecomUserId}/verify',            62, 1, NOW(), NOW()),
    (92254, 92020, 92090, '00920063', 'api', '同步回填企微绑定',   'POST', '/api/v1/agent-ops/channels/wecom/users/sync-backfill',                             63, 1, NOW(), NOW()),
    -- §11 企业配置（方案 B：运营台管企业清单 + 密钥）
    (92255, 92020, 92090, '00920064', 'api', '企微企业列表',       'GET',    '/api/v1/agent-ops/channels/wecom/corps',                                    64, 1, NOW(), NOW()),
    (92256, 92020, 92090, '00920065', 'api', '新增企微企业',       'POST',   '/api/v1/agent-ops/channels/wecom/corps',                                    65, 1, NOW(), NOW()),
    (92257, 92020, 92090, '00920066', 'api', '更新企微企业',       'PUT',    '/api/v1/agent-ops/channels/wecom/corps/{corpId}',                           66, 1, NOW(), NOW()),
    (92258, 92020, 92090, '00920067', 'api', '删除企微企业',       'DELETE', '/api/v1/agent-ops/channels/wecom/corps/{corpId}',                           67, 1, NOW(), NOW()),
    (92259, 92020, 92090, '00920068', 'api', '配置企业 corpsecret','PUT',    '/api/v1/agent-ops/channels/wecom/corps/{corpId}/secret',                    68, 1, NOW(), NOW()),
    (92260, 92020, 92090, '00920069', 'api', '删除企业 corpsecret','DELETE', '/api/v1/agent-ops/channels/wecom/corps/{corpId}/secret',                    69, 1, NOW(), NOW()),
    (92261, 92020, 92090, '00920070', 'api', '企业连通性测试',     'POST',   '/api/v1/agent-ops/channels/wecom/corps/{corpId}/test',                      70, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92090);

-- 3. sys_menu_api 关联（1 api -> 1 menu）
--    92250 -> 92065 agent:wecom:user:list
--    92251/92252/92253 -> 92066 agent:wecom:user:manage
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92250, 92065, 92250, 1, NOW()),
    (92251, 92066, 92251, 1, NOW()),
    (92252, 92066, 92252, 2, NOW()),
    (92253, 92066, 92253, 3, NOW()),
    (92254, 92066, 92254, 4, NOW()),
    -- 企业配置类端点复用既有按钮码 92061 agent:wecom:manage
    (92255, 92061, 92255, 1, NOW()),
    (92256, 92061, 92256, 2, NOW()),
    (92257, 92061, 92257, 3, NOW()),
    (92258, 92061, 92258, 4, NOW()),
    (92259, 92061, 92259, 5, NOW()),
    (92260, 92061, 92260, 6, NOW()),
    (92261, 92061, 92261, 7, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  a  WHERE a.id = v.api_id);

-- 4. 授权给内置租户管理员 role_id=1（与 V20 第 4 节口径一致）
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id IN (92065, 92066)
  AND m.app_id = 92010
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- 迁移后自检：
--   SELECT COUNT(*) FROM sys_api WHERE id BETWEEN 92250 AND 92261;            -- 期望 12
--   SELECT COUNT(*) FROM sys_menu_api WHERE id BETWEEN 92250 AND 92261;      -- 期望 12
--   SELECT COUNT(*) FROM sys_menu WHERE id IN (92065, 92066);                -- 期望 2
