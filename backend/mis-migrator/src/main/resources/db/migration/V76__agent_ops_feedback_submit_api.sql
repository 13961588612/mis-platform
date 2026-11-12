-- ===========================================================================
-- V76__agent_ops_feedback_submit_api.sql —— 用户端评价提交端点 sys_api + 菜单绑定
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V43（Agent 反馈四端点 92169-92172 登记）；V6（ai:chat:use 菜单 613）；
--       V72（92550-92555 iqd 段位）；V73（92560-92575）；V74（92576-92585）。
--
-- 内容（feedback-enhance 设计 §2.2 / §4.2）：
--   1. sys_api 登记：POST /api/v1/agent-ops/sessions/{session_id}/feedback
--      （父节点 92162「会话与对话」catalog；module 92020）
--   2. sys_menu_api 绑定：接口 ⇄ 菜单 613（复用既有 ai:chat:use，不新增权限码）
--
-- 权限语义：用户已具备对话能力（ai:chat:use），评价提交是对话的自然延伸，复用同码。
-- 无新增 sys_menu / sys_role_permission（613 已在 V7 授权内置租户管理员）。
--
-- ⚠️ 段位说明（已 grep V1-V75 核实）：
--   sys_api id 925xx 段：92550-92585 已被 V72/V73/V74 占用 → 本文件取 **92586**（空闲）。
--   sys_api code 0097 段：module 92020 下 0092=V20/0093=V68/0094=V72/0095=V73/0096=V74，
--   0097 空闲 → 取 '00970001'。
--   sys_menu_api id 与 api_id 同号（对齐 V20/V43 先例便于人工比对）。
--
-- 硬规则：端点必须**同时**写 sys_api + sys_menu_api（BFF 注册表 = sys_api ⋈
-- sys_menu_api ⋈ sys_menu INNER JOIN；deny-unmapped=true 时只插一个表 →
-- 40300「接口未授权映射」，V61 教训）。
-- 幂等：固定 ID + WHERE NOT EXISTS + (method,path) 去重；append-only。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_api —— 用户端评价提交端点（type='api'）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92586, 92020, 92162, '00970001', 'api'::sys_api_node_type, '用户端评价提交', 'POST', '/api/v1/agent-ops/sessions/{session_id}/feedback', 36, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92162);

-- ---------------------------------------------------------------------------
-- 2. sys_menu_api —— 接口 ⇄ 菜单 613（ai:chat:use，V6 既有；复用，不新增码）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92586, 613, 92586, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   -- 1) sys_api 注册表（1 行，应带非空 permission = ai:chat:use）
--   SELECT a.id, a.http_method, a.path_pattern, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id = 92586;
--   -- 期望：POST /api/v1/agent-ops/sessions/{session_id}/feedback → ai:chat:use
--
--   -- 2) uk_api_module_code / uk_api_method_path 回归项
--   SELECT module_id, code, COUNT(*) FROM sys_api
--   WHERE module_id = 92020 GROUP BY module_id, code HAVING COUNT(*) > 1;
--   SELECT http_method, path_pattern, COUNT(*) FROM sys_api
--   WHERE type = 'api' AND status = 1 GROUP BY http_method, path_pattern HAVING COUNT(*) > 1;
--   -- 期望：均 0 行
-- ---------------------------------------------------------------------------
