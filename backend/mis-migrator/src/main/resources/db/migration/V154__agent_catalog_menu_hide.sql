-- =============================================================================
-- V154：Worker Catalog 侧栏菜单下线（并入 Agent 总览）
-- =============================================================================
-- 背景：/agent/catalog 与 /agent/agents 内容重叠；调度编辑本就深链到
--       /agent/agents/:id/coordination。产品确认方案 2：删除独立 Catalog 菜单，
--       指标与调度只读列并入 Agent 总览。
--
-- 本迁移：
--   1) 将菜单 92035（Worker Catalog）visible=0，侧栏不再展示
--   2) 保留 permission agent:catalog:list / manage 与 API 绑定（总览仍调 GET catalog）
--
-- 前端：agent-nav.ts 去掉该叶节点；/agent/catalog 路由 Navigate → /agent/agents
-- =============================================================================

UPDATE sys_menu
SET visible = 0,
    updated_at = NOW()
WHERE id = 92035
  AND path = '/agent/catalog'
  AND permission = 'agent:catalog:list';
