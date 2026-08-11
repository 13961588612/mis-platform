-- MIS Platform — MCP 工具权限配置（方案 B′）：新增 2 条 sys_api 登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V20__agent_ops_api_perms.sql（sys_api 92090 catalog / sys_menu 92039、92059）
--
-- ---------------------------------------------------------------------------
-- 【为什么必须建 sys_api —— 不建就等于没做后端判权】
--   BFF 的 API 判权规则源是 SysApiRepository.findRegistryRows()：
--     sys_api ⋈ sys_menu_api ⋈ sys_menu ⋈ sys_module，permission 取自 sys_menu。
--   mis-admin-bff 配置 `mis.api-permission.deny-unmapped: false`（未映射即放行），
--   叠加「permission 为空 ⇒ authOnly」，结果是：
--     只写 Controller 不建 sys_api ⇒ 任何登录用户都能直接调
--     POST /api/v1/agent-ops/mcp/tools/cleanup-offline 清理任意 Skill —— 越权。
--
-- ---------------------------------------------------------------------------
-- 【权限码复用 —— 不新增 agent:mcp:grant】
--   方案 B′ 决策 ④：入口在 MCP 管理页内 Tab，复用管理页现有权限。
--   本文件不新建任何 sys_menu 按钮节点，只把两条新接口挂到既有菜单：
--     GET  /api/v1/agent-ops/mcp/tools                → 92039  agent:mcp:list    （只读）
--     POST /api/v1/agent-ops/mcp/tools/cleanup-offline → 92059  agent:mcp:manage （破坏性）
--
-- ---------------------------------------------------------------------------
-- 【ID / code 段位】接续 V20（92157 之后）
--   92158–92159   sys_api    接口行，code='00920059'…'00920060'，sort=59…60
--   92158–92159   sys_menu_api 关联行（与 api_id 同号，便于人工比对）
--
-- 幂等：固定 ID + WHERE NOT EXISTS + (method,path) 去重，可重复执行。
-- 约束：append-only，不得修改 V1–V28。
-- ---------------------------------------------------------------------------

-- 2. 接口行（type='api'）。列清单没有 tenant_id / app_id（V8 已 DROP）。
--    path_pattern 用 Spring AntPathMatcher 模板变量（与 V20 同风格）。
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92158, 92020, 92090, '00920059', 'api'::sys_api_node_type, 'MCP 工具授权聚合', 'GET',  '/api/v1/agent-ops/mcp/tools',                 59, 1, NOW(), NOW()),
    (92159, 92020, 92090, '00920060', 'api', '清理已下线 MCP 工具（破坏性）', 'POST', '/api/v1/agent-ops/mcp/tools/cleanup-offline', 60, 1, NOW(), NOW())
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


-- 3. sys_menu_api —— 接口 ⇄ 菜单 关联（判权真正生效的开关）。
--    GET 挂 92039 agent:mcp:list；POST 挂 92059 agent:mcp:manage（V20 已建）。
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92158, 92039, 92158, 1, NOW()),
    (92159, 92059, 92159, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);
