-- ===========================================================================
-- V90__iqd_modeling_cube_upsert_seed.sql —— 建模台「Cube 级 upsert」端点登记
--                                            （v1.11 / T04a）
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V87（建模台主页 92600 / 权限按钮 92631-92633 / 12 条 sys_api 92601-92612 +
--       sys_menu_api 92613-92624）；V88（补登 5 端点 92640-92644 / 绑定 92645-92649，
--       code 至 00960037）；V89（model_ref 列 + MCP 端点 92650-92655 / 绑定 92657-92662，
--       code 至 00960043）
--
-- 内容（1 条 sys_api + 1 条 sys_menu_api）：
--   PUT /api/v1/iqd/catalog/cube  → iqd:modeling:edit（与 POST /catalog/cube 同权限码）
--
-- ⚠️ V87 / V88 / V89 **一字不动**。
--
-- 为什么需要这个端点
-- ------------------
-- 既有的 Cube 目前改不了（T03c 把三条路都验证堵死）：
--   * `POST /catalog/cube`   —— create-only + 双幂等：同 key 返回首次结果、不应用新字段，
--                               做成「可编辑」=「提示保存成功但实际没改」的静默缺陷；
--   * `PUT  /catalog/node`   —— 只能改单节点自身字段，动不了 measure/dimension 子节点；
--   * `POST /catalog/batch`  —— 是「MDL/物料镜像」语义、不写 edit_revision，而派生用
--                               findEditedItems（edit_revision IS NOT NULL）取节点
--                               ⇒ 用它写子节点会让 Cube 永远进不了 build（比不支持更糟）。
-- 故新增本端点：语义明确的「更新既有 Cube」（自身字段 + measures/dimensions 子节点增删改
-- + 孤儿清理）。POST /catalog/cube（92606）保持 create 语义不变，二者并列。
--
-- 段位（已 grep 全仓核实空闲）：
--   sys_api      ：…至 92655（V89）→ 本文件取 92700
--   sys_menu_api ：…至 92662（V89）→ 本文件取 92701
--   sys_api code ：module 92020 下至 00960043（V89）→ 续 00960044
--   （92702+ 预留后续任务，本文件不使用）
--
-- 硬规则（同 V72-V89）：每个 /api/v1/iqd/** 端点必须**同时**写 sys_api + sys_menu_api
-- （BFF 注册表 = sys_api ⋈ sys_menu_api ⋈ sys_menu INNER JOIN；deny-unmapped=true 时只插一个表
-- → 40300「接口未授权映射」）。`/internal/v1/**` 一律不登记（无 MIS JWT，登记反 401）。
--
-- 权限码选择：iqd:modeling:edit（与 POST /catalog/cube 一致 —— 同为「编辑模型语义对象」，
-- 校验码与 mis-iqd `@PreAuthorize("hasAuthority('iqd:modeling:edit')")` 逐条对齐）。
-- 挂菜单 92632（V87 的 iqd-modeling-edit 权限按钮），与 92618（POST /catalog/cube）同菜单。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + (method,path) 去重；append-only，可安全重跑。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sys_api —— PUT /api/v1/iqd/catalog/cube（module 92020；code 00960044）
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (92700, 92020, 92550, '00960044', 'api'::sys_api_node_type, '建模台-更新 Cube', 'PUT', '/api/v1/iqd/catalog/cube', 44, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.module_id = 92020 AND a.code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 92550);

-- ---------------------------------------------------------------------------
-- 2. sys_menu_api —— 绑定到 92632（iqd:modeling:edit，与 POST /catalog/cube 92618 同菜单）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (92701, 92632, 92700, 1, NOW())    -- PUT /catalog/cube → iqd:modeling:edit
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu_api ma WHERE ma.menu_id = v.menu_id AND ma.api_id = v.api_id
  )
  AND EXISTS (SELECT 1 FROM sys_menu m WHERE m.id = v.menu_id AND m.status = 1)
  AND EXISTS (SELECT 1 FROM sys_api  a WHERE a.id = v.api_id);

-- ---------------------------------------------------------------------------
-- 迁移后自检（取消注释执行；不在迁移中运行）
--
--   -- 1) 端点 + 绑定（期望 1 行；PUT /api/v1/iqd/catalog/cube，permission=iqd:modeling:edit）
--   SELECT a.id, a.http_method, a.path_pattern, m.id AS menu_id, m.permission
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   WHERE a.id = 92700;
--
--   -- 2) 与既有 POST 共存（期望 2 行：POST 92606 + PUT 92700，同一 path_pattern 不同 method）
--   SELECT id, http_method, path_pattern FROM sys_api
--   WHERE path_pattern = '/api/v1/iqd/catalog/cube' ORDER BY http_method;
--
--   -- 3) 前序迁移未受影响（期望 12 / 5 / 6）
--   SELECT COUNT(*) AS v87_apis FROM sys_api WHERE id BETWEEN 92601 AND 92612;
--   SELECT COUNT(*) AS v88_apis FROM sys_api WHERE id BETWEEN 92640 AND 92644;
--   SELECT COUNT(*) AS v89_apis FROM sys_api WHERE id BETWEEN 92650 AND 92655;
-- ---------------------------------------------------------------------------
