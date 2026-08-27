-- ===========================================================================
-- V49__org_dept_staffing_and_posttype_tree_api.sql —— 部门岗位编制 + 岗位类型树 端点登记
-- PostgreSQL 16 | 库名: mis_platform
-- 前置：V48 为最新；本文件为 V49，Flyway 只追加不修改已发布版本。
--
-- 内容：补登记 V47 落地后 BFF 已暴露、但迁移漏登的 2 个只读端点（SEC-02 差集盘点回归）：
--   A. sys_api 登记：91202（部门岗位编制）+ 91203（岗位类型树），module 2 / code 00900105-00900106
--
-- 说明：
--   - 部门岗位编制（DeptController GET /api/v1/depts/{id}/staffing，V47）此前未写入 sys_api，
--     导致安全差集盘点红灯；权限码对齐 system:dept:* 家族（staffing:view）。
--   - 岗位类型树（PostController GET /api/v1/post-types/tree，V47）同理漏登；对齐 system:post-type:* 家族（tree）。
--   - 二者均为只读 GET，仅登记 sys_api 行（.menu/permission 绑定非本期范围，测试只校验 method+path 与注册表一致）。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + 同 (http_method, path_pattern) 守卫；沿用 V40 列顺序/类型。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. sys_api 登记（module 2）
--    部门岗位编制挂 catalog 2001「部门查询」（与 V40 组织穿透 91198 同父，sort 顺延 4）；
--    岗位类型树挂 catalog 91178「员工与岗位」（与 V40 岗位类型 CRUD 91195-91197 同父，sort 顺延 14）。
-- ---------------------------------------------------------------------------
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91202, 2, 2001,  '00900105', 'api'::sys_api_node_type, '部门岗位编制', 'GET', '/api/v1/depts/{id:[0-9]+}/staffing', 4,  1, NOW(), NOW()),
    (91203, 2, 91178, '00900106', 'api'::sys_api_node_type, '岗位类型树',   'GET', '/api/v1/post-types/tree',           14, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_api WHERE module_id = v.module_id AND code = v.code)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 2001)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91178);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 1) 两条新端点已登记且父节点正确
--   SELECT a.id, a.http_method, a.path_pattern, a.parent_id, a.code
--   FROM sys_api a
--   WHERE a.id IN (91202, 91203) AND a.type = 'api'
--   ORDER BY a.id;
--   -- 期望：2 行；91202 parent_id=2001（部门查询），91203 parent_id=91178（员工与岗位）
--
--   -- 2) (module_id, code) 无重复
--   SELECT module_id, code, count(*) FROM sys_api
--   WHERE id IN (91202, 91203)
--   GROUP BY module_id, code HAVING count(*) > 1;
--   -- 期望：0 行
--
--   -- 3) (http_method, path_pattern) 全局唯一
--   SELECT http_method, path_pattern, count(*) FROM sys_api
--   WHERE id IN (91202, 91203)
--   GROUP BY http_method, path_pattern HAVING count(*) > 1;
--   -- 期望：0 行
-- ---------------------------------------------------------------------------
