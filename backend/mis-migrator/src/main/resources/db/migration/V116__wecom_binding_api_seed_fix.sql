-- MIS Platform — V116 补偿：V115 的企微绑定/企业配置 API 行未落库
-- PostgreSQL 16 | 库名: mis_platform | append-only
--
-- 背景（为什么必须补偿）：
--   V115 用 code 段 '00920059'..'00920070' 登记 12 条 API。但 sys_api 的唯一键是
--   uk_api_module_code(module_id, code)，而该模块(92020)下 V29/V50/V61 等已占用
--   同段 code（如 00920059=GET /agent-ops/mcp/tools）。V115 的 INSERT 带
--   `AND NOT EXISTS(... same module_id AND code ...)` 守卫，于是 12 条 API 全被静默跳过；
--   sys_menu_api 又因 `EXISTS(sys_api.id = api_id)` 不成立而同样未插入。
--   净结果：只进了 2 个按钮码（92065/92066），权限等于没生效（12 端点仍 403）。
--
--   V115 已应用，checksum 已固定，不得修改；故由本文件用**空闲** ID/code 补登记。
--   全量执行顺序天然正确：V115 在已有/全新库上都是「API 空转」，本文件负责真正落库，
--   两种环境收敛到同一结果。
--
-- 本文件新增：
--   sys_api      92270–92281（12 条）code '00920100'..'00920111'
--   sys_menu_api 92270–92281（12 条，1 api → 1 menu）
--
-- 权限归属（与 V115 注释一致）：
--   #59 列表            -> 92065 agent:wecom:user:list
--   #60–#63 绑定/解绑/校验/回填 -> 92066 agent:wecom:user:manage
--   #64–#70 企业配置 CRUD/密钥/测试 -> 92061 agent:wecom:manage
--
-- 幂等：固定 ID + (method,path) 去重守卫，可重复执行。
-- ---------------------------------------------------------------------------

-- 1. API 行（catalog 92090 / 模块 92020）
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    -- 企微用户身份绑定（#59–#63）
    (92270, 92020, 92090, '00920100', 'api'::sys_api_node_type, '企微用户绑定列表',   'GET',    '/api/v1/agent-ops/channels/wecom/users',                                    59, 1, NOW(), NOW()),
    (92271, 92020, 92090, '00920101', 'api', '人工绑定企微用户',   'POST',   '/api/v1/agent-ops/channels/wecom/users/{corpId}/{wecomUserId}/bind',         60, 1, NOW(), NOW()),
    (92272, 92020, 92090, '00920102', 'api', '解绑企微用户',       'POST',   '/api/v1/agent-ops/channels/wecom/users/{corpId}/{wecomUserId}/unbind',       61, 1, NOW(), NOW()),
    (92273, 92020, 92090, '00920103', 'api', '校验企微用户绑定',   'POST',   '/api/v1/agent-ops/channels/wecom/users/{corpId}/{wecomUserId}/verify',       62, 1, NOW(), NOW()),
    (92274, 92020, 92090, '00920104', 'api', '同步回填企微绑定',   'POST',   '/api/v1/agent-ops/channels/wecom/users/sync-backfill',                       63, 1, NOW(), NOW()),
    -- 企微企业配置（#64–#70，方案 B）
    (92275, 92020, 92090, '00920105', 'api', '企微企业列表',       'GET',    '/api/v1/agent-ops/channels/wecom/corps',                                     64, 1, NOW(), NOW()),
    (92276, 92020, 92090, '00920106', 'api', '新增企微企业',       'POST',   '/api/v1/agent-ops/channels/wecom/corps',                                     65, 1, NOW(), NOW()),
    (92277, 92020, 92090, '00920107', 'api', '更新企微企业',       'PUT',    '/api/v1/agent-ops/channels/wecom/corps/{corpId}',                            66, 1, NOW(), NOW()),
    (92278, 92020, 92090, '00920108', 'api', '删除企微企业',       'DELETE', '/api/v1/agent-ops/channels/wecom/corps/{corpId}',                            67, 1, NOW(), NOW()),
    (92279, 92020, 92090, '00920109', 'api', '配置企业 corpsecret','PUT',    '/api/v1/agent-ops/channels/wecom/corps/{corpId}/secret',                     68, 1, NOW(), NOW()),
    (92280, 92020, 92090, '00920110', 'api', '删除企业 corpsecret','DELETE', '/api/v1/agent-ops/channels/wecom/corps/{corpId}/secret',                     69, 1, NOW(), NOW()),
    (92281, 92020, 92090, '00920111', 'api', '企业连通性测试',     'POST',   '/api/v1/agent-ops/channels/wecom/corps/{corpId}/test',                       70, 1, NOW(), NOW())
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

-- 2. sys_menu_api 关联（1 api → 1 menu）
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    -- 用户绑定：列表 → 92065；绑定/解绑/校验/回填 → 92066
    (92270, 92065, 92270, 1, NOW()),
    (92271, 92066, 92271, 1, NOW()),
    (92272, 92066, 92272, 2, NOW()),
    (92273, 92066, 92273, 3, NOW()),
    (92274, 92066, 92274, 4, NOW()),
    -- 企业配置 → 92061 agent:wecom:manage
    (92275, 92061, 92275, 1, NOW()),
    (92276, 92061, 92276, 2, NOW()),
    (92277, 92061, 92277, 3, NOW()),
    (92278, 92061, 92278, 4, NOW()),
    (92279, 92061, 92279, 5, NOW()),
    (92280, 92061, 92280, 6, NOW()),
    (92281, 92061, 92281, 7, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  a  WHERE a.id = v.api_id);

-- 迁移后自检（期望：12 条 sys_api / 12 条 sys_menu_api，且 permission 全部非空）：
--   SELECT COUNT(*) FROM sys_api WHERE id BETWEEN 92270 AND 92281;             -- 12
--   SELECT COUNT(*) FROM sys_menu_api WHERE id BETWEEN 92270 AND 92281;       -- 12
--   SELECT a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id BETWEEN 92270 AND 92281 ORDER BY a.sort;                        -- 12 行，permission 无 NULL
