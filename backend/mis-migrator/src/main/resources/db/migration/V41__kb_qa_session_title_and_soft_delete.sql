-- ===========================================================================
-- V41__kb_qa_session_title_and_soft_delete.sql
--   增量：问答会话标题 + 用户侧软删除
--   设计：KB 智能问答页会话管理（手动新建 + 会话标题 + 删除会话）
--   前置：V40 为当前最新版本；本文件为 V41，Flyway 只追加不修改已发布版本。
--
--   内容：
--   A. kb_qa_session 两列：
--        title       VARCHAR(255) NULL  —— 会话标题：新建时取首问前 30 字符（mis-rag 侧截断）；
--                                        null 时前端兜底展示「会话 #id」。
--        deleted_at  TIMESTAMPTZ NULL   —— 软删除时间戳；非 null 表示已删除。
--                                        用户侧列表/删除后不再显示；运营侧保留全量（运营看板/导出不受影响）。
--   B. sys_api 登记删除问答会话端点（id=91199 / code=00900083 / parent=91172，挂知识库域模块 91020）。
--   C. sys_menu_api 绑定（id=91288 / menu=91036 / api=91199）。
--
--   幂等：ADD COLUMN IF NOT EXISTS / 固定 COMMENT；登记段 WHERE NOT EXISTS 三重去重（id / code / method+path）
--   + 父节点存在性校验；可重复执行。约束：不得修改已发布的 V1-V40。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A/B. kb_qa_session 会话标题 + 软删除时间戳
-- ---------------------------------------------------------------------------
ALTER TABLE kb_qa_session
    ADD COLUMN IF NOT EXISTS title      VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN kb_qa_session.title      IS '会话标题：新建时取首问前30字符（mis-rag 侧截断）；null 前端兜底"会话 #id"';
COMMENT ON COLUMN kb_qa_session.deleted_at IS '软删除时间戳；非 null 表示已删除（用户侧不可见，运营侧保留全量）';

-- ---------------------------------------------------------------------------
-- B. sys_api 登记：删除问答会话（DELETE /api/v1/kb/qa/sessions/{sessionId}）
--    权限码沿用既有 kb:qa:ask（无新增权限码）；父节点 91172 存在才落，避免孤儿登记。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91199, 91020, 91172, '00900083', 'api'::sys_api_node_type, '删除问答会话', 'DELETE', '/api/v1/kb/qa/sessions/{sessionId}', 78, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.type='api' AND a.status=1
        AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91172);

-- ---------------------------------------------------------------------------
-- C. sys_menu_api 绑定：菜单 91036（知识问答）→ API 91199
--    注意：绑定 id 必须是 91288（91268 已被 V39 占用，误写会被 NOT EXISTS(id) 静默跳过）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91288, 91036, 91199, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = v.menu_id AND api_id = v.api_id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 91036)
  AND EXISTS (SELECT 1 FROM sys_api  WHERE id = 91199);
