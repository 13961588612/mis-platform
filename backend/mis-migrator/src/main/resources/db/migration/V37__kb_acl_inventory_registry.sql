-- ===========================================================================
-- V37__kb_acl_inventory_registry.sql —— KBP-10 存量授权只读清单补登（端点登记收尾）
-- PostgreSQL 16 | 库名: mis_platform
-- 目的：BFF KbController.listLegacyAclInventory（GET /api/v1/kb/acls/inventory，
--       requirePermission(PERM_ACL_REVOKE=kb:acl:revoke)，返回 List<LegacyAclInventoryVO>）
--       由并行 KB 工作（KBP-10）新增，但无任何迁移登记（mis-migrator / mis-kb 全量
--       迁移 grep 查无），SEC-02 差集盘点 BffApiRegistryDiffSurveyTest 因此红灯。
--       本迁移将该端点登记进 sys_api + sys_menu_api，收尾端点注册登记。
--
-- 版本号说明（主理人裁决，2026-08-12）：
--   迁移目录当前最新为 V36__kb_agent_api_domain_catalogs.sql（KB/Agent 业务域
--   catalog 91168-91176 / 92160-92168），本文件顺延为 **V37**，Flyway 只追加不修改
--   已发布版本；V36 先于 V37 执行，故父 catalog 91171 必存在（守卫仅防御）。
--
-- 号段选取依据（2026-08-12 代码库 grep 核验）：
--   sys_api      91177            —— V36 用到 91168-91176（KB catalog），本文件顺延
--   sys_api.code 00900082         —— V36 KB catalog 用到 00900073-00900081，本文件顺延；
--                                    唯一约束 uk_api_module_code(module_id, code)，
--                                    module 91020 内不冲突（V35 同码 00900082 属 module 4）
--   sys_menu_api 91267            —— V35 用到 91257-91266，本文件顺延
--   sort         103              —— 注意：任务稿原定 102，但核验发现 V27 已用 sort 102
--                                    （sys_api 91099 /api/v1/kb/engine/datasets/rename/logs/
--                                    {batchId}，同属 module 91020 树）；按 V35 头部
--                                    「sort 非本树亦避开」惯例，本文件改取 **103**
--                                    （代码库+集成库 103-119 段 0 占用，已核验）
--
-- 内容一段：
--   A. sys_api 登记 1 个叶子（id 91177 / code 00900082 / sort 103），
--      挂 module 91020 下「搜索权限」catalog 91171（V36 建；V36 B.2 规则
--      将 %acls% 叶子归其下，inventory 路径含 /acls/ 应同归）。
--   B. sys_menu_api 关联 1 行（91267 → 菜单 91050 kb:acl:revoke；与 V30
--      DELETE /api/v1/kb/acls/{id} 同挂一菜单，一码一菜单不破）。
--   零 DDL、零新增权限码/菜单行（复用既有菜单 91050）。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + (module_id, code) 去重 + (method, path) 去重
--       + 父 catalog 存在性检查，可重复执行。约束：不得修改已发布的 V1-V36。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. sys_api 叶子（id 91177 / code 00900082 / sort 103；挂 91171 搜索权限）
--     uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1
--     的部分唯一索引，故额外用 method+path 去重。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91177, 91020, 91171, '00900082', 'api'::sys_api_node_type, '存量授权只读清单', 'GET', '/api/v1/kb/acls/inventory', 103, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = 'GET' AND a.path_pattern = '/api/v1/kb/acls/inventory'
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91171);

-- ---------------------------------------------------------------------------
-- B. sys_menu_api 关联：接口 → 承载权限码的既有菜单节点（一码一菜单，零新增菜单）
--     91177 → 91050（kb:acl:revoke；与 V30 91222 DELETE /api/v1/kb/acls/{id} 同菜单）
--     uk_menu_api_pair(menu_id, api_id) 守卫；V8 已 DROP uk_menu_api_api(api_id)。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91267, 91050, 91177, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = 91050 AND api_id = 91177)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 91050)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = 91177);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) inventory 端点已登记且权限码正确（kb:acl:revoke）
--   SELECT a.id, a.http_method, a.path_pattern, a.parent_id, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id = 91177;
--   -- 期望：1 行；parent_id=91171，permission=kb:acl:revoke
--
--   -- 2) 一码一菜单回归：91177 只挂一个菜单
--   SELECT api_id, count(*) FROM sys_menu_api
--   WHERE api_id = 91177
--   GROUP BY api_id HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) (module_id, code) 无重复：module 91020 内 00900082 唯一
--   SELECT module_id, code, count(*) FROM sys_api
--   WHERE module_id = 91020 AND code = '00900082'
--   GROUP BY module_id, code HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 4) (method, path) 无重复：GET /api/v1/kb/acls/inventory 全局唯一
--   SELECT http_method, path_pattern, count(*) FROM sys_api
--   WHERE type = 'api' AND status = 1
--     AND http_method = 'GET' AND path_pattern = '/api/v1/kb/acls/inventory'
--   GROUP BY http_method, path_pattern HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 5) 幂等回归：重复执行本文件后 1) 仍是 1 行、2)/3)/4) 仍是 0 行
--   -- 6) 行为验收：无 kb:acl:revoke 的登录用户 GET /api/v1/kb/acls/inventory 期望 HTTP 403
--   --    （有该码的管理员 200；BFF 需重启或等注册表 refresh-interval-seconds=300s 到期重载）。
-- ---------------------------------------------------------------------------
