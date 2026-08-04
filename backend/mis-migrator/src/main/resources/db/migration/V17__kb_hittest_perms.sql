-- MIS Platform — 知识库「命中测试」菜单与权限（二期 Wave A / WA-08）
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-phase2-wave-a-design-2026-08-04.md §5.2-T13 / §7.4
--
-- 【修订记录】
--   r2（本次，QA P0-A + 主理人裁决「方案 C」）：删除原「执行命中测试」按钮节点
--     （原 ID 落在 9105x 按钮段，本次修订后该 ID 位重新释放为未占用）。
--     原因：本文件初版同时插入页面菜单 91039 与该按钮节点，两行的
--     (app_id, permission, status) 三元组完全相同（91010 / 'kb:hittest:run' / 1），
--     直接违反 V1__init_schema.sql:269 的部分唯一索引
--       CREATE UNIQUE INDEX uk_menu_app_permission ON sys_menu (app_id, permission)
--         WHERE status = 1 AND permission IS NOT NULL;
--     → 首次 flyway migrate 即抛唯一键冲突、整个迁移事务回滚、该版本被标记 failed、
--       后续所有迁移被阻断。**即：本文件 r1 从未真实执行成功过**，故直接原地修订，
--       不存在 checksum 冲突风险，也无需另出 V18。
--     结论：本仓库不能使用「页面菜单 + 按钮节点共用同一 permission」这一常见写法。
--     该权限码改由页面菜单 91039 单独承载，详见下方 B 段。
--
-- 背景：
--   Q-04 命中测试是知识管理员的调参工具，能读取跨密级知识库的 chunk 原文，
--   必须有独立权限码门控（前端 PermissionGate + 后端 ApiPermissionInterceptor 双侧）。
--
-- 内容：
--   A. 页面菜单 91039「命中测试」（父 91030，path /kb/hit-test，permission kb:hittest:run），
--      要求展示在「智能问答」(91036, sort=6) 与「问答运营」(91037, sort=7) 之间。
--      sort 是 INT 插不进 6.5，故取 sort=7 并把其后两个页面各后移一位（7→8、8→9），
--      与前端静态清单 kb-nav.ts 的顺序保持一致（T17 已对齐）。
--   B. **不建按钮节点**。权限码 kb:hittest:run 由页面菜单 91039 单独承载。
--      为什么不建：uk_menu_app_permission 是 (app_id, permission) 上 status=1 且
--      permission 非空的部分唯一索引，同一 app 下两行不可能共用同一个 permission，
--      「页面菜单 + 按钮节点挂同一权限码」这种其它项目里常见的写法在本仓库直接违约。
--      为什么可以不建（两条已核实的依据）：
--        * 前端显隐：MenuService.permissionCodes()（mis-system/.../service/MenuService.java:78-88）
--          走 findByIdInAndStatus → getPermission → filter(hasText)，**不过滤菜单 type**，
--          页面节点自带的权限码即可进入用户权限码集合。
--        * 后端判权：SysApiRepository.findRegistryRows()（同模块 domain/repository:44-58）
--          的 JOIN sys_menu 同样**不过滤 type**；sys_menu_api 表（V1__init_schema.sql:294-302）
--          只有 menu_id / api_id 两列，对被挂载菜单的类型无任何约束。
--          故 D.3 把接口直接挂到页面菜单 91039 上，注册表照常取到 permission。
--      不选的两个替代方案（主理人已排除，勿回退）：
--        * 按钮 permission 置 NULL —— ApiPermissionRegistry.java:69-73 判定
--          「permission 为空 ⇒ authOnly」，而 ApiPermissionInterceptor.java:72-73 对
--          authOnly 直接 return true，等于把 hit-test 退回「登录即可调」，D 段白做。
--        * 按钮换用 kb:hittest:exec —— 同一功能拆两个码，前端与角色授权都要跟改，
--          运营漏授一个即失效；MenuService.java:98-100 的应用层校验也表明
--          本系统语义是「一码一功能」。
--   C. 授权给内置租户管理员 role_id=1。
--   D. **API 级登记**：sys_api + sys_menu_api，让 ApiPermissionInterceptor 真正拦得住。
--
-- 【为什么必须有 D —— 主理人复核发现的越权缺口】
--   BFF 的 API 判权规则源是 SysApiRepository.findRegistryRows()：
--     sys_api JOIN sys_menu_api JOIN sys_menu JOIN sys_module，permission 取自 sys_menu。
--   而 KB 模块自 V13 起从未写入 sys_api / sys_menu_api，叠加 mis-admin-bff 配置
--   api-permission.deny-unmapped=false（未映射即放行），结果是：
--     只做 A/C 的话，kb:hittest:run 只控制菜单是否显示，
--     任何登录用户都能直接 POST /api/v1/kb/hit-test 拿到 chunk 原文。
--   服务端 ACL hasPermission(userId, libraryId, 'read') 挡不住这个口子——
--   它回答的是「能不能读这个库」，不是「能不能用命中测试这个功能」，语义不同。
--   故本次为 hit-test 单个端点补登记；KB 其余端点的历史欠账不在本波次范围内。
--
-- 【ID / code 段位选取依据】
--   * sys_api.id / sys_menu_api.id 取 9106x：KB 已用 91010(app) / 91020(module) /
--     9103x(菜单页) / 9104x-9105x(V13/V14 建的按钮，本文件 r2 起不再新增按钮位)，
--     9106x 全仓无占用（已 grep 核实），
--     且仍落在 KB 的 91xxx 私有段内，不与其他模块的 1xxx/6xxx 段冲突。
--   * sys_api.code 取 0090 / 00900001：V8 起唯一约束是 uk_api_module_code(module_id, code)，
--     KB 模块（91020）下当前零行，理论上任何 code 都可用。刻意跳到 0090 段，
--     是把 0001–0089 留给将来 KB 全模块补登记（S-xx/L-xx/Q-xx 端点），
--     免得那时候回头跟本行撞码。
--
-- 【schema 版本注意】V8__module_api_refactor.sql 已 DROP 掉 sys_api 的 tenant_id 与 app_id 列，
--   并把唯一约束从 uk_api_app_code(app_id, code) 改为 uk_api_module_code(module_id, code)、
--   新增 FK fk_api_module → sys_module(id)。所以本文件的 sys_api INSERT 列清单
--   与 V2/V6 的写法**不同**（那两个文件是 V8 之前的旧 schema），照抄旧模板会直接报
--   「column "tenant_id" of relation "sys_api" does not exist」。
--
-- 幂等：固定 ID + WHERE NOT EXISTS + ON CONFLICT DO NOTHING，可重复执行。
-- 约束：不得修改已发布的 V13/V14。

-- ---------------------------------------------------------------------------
-- A. 页面菜单节点（type=2）
-- ---------------------------------------------------------------------------
INSERT INTO sys_menu (id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91039, 1, 91010, 91030, 'kb-hit-test', '命中测试', 2, '/kb/hit-test', 'kb/hittest/index', 'kb:hittest:run', 'Crosshair', 7, 1, 1, NOW(), NOW())
) AS v(id, tenant_id, app_id, parent_id, code, name, type, path, component, permission, icon, sort, visible, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = v.id);

-- 把「问答运营」「引擎配置」后移一位，让命中测试稳定落在「智能问答」之后。
-- 仅在两行仍为 V13 初始 sort 值时才调整，避免覆盖运营手工排序。
UPDATE sys_menu SET sort = 8, updated_at = NOW() WHERE id = 91037 AND sort = 7;
UPDATE sys_menu SET sort = 9, updated_at = NOW() WHERE id = 91038 AND sort = 8;

-- ---------------------------------------------------------------------------
-- B. 按钮节点 —— 本次修订后**不再创建**（uk_menu_app_permission 禁止同 app 两行共用
--    同一 permission，详见文件头「修订记录 r2」与「内容 B」）。
--    权限码 kb:hittest:run 由上方页面菜单 91039 单独承载，D.3 的 sys_menu_api
--    也直接挂到 91039 上。此处不留任何 INSERT。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- C. 授权给内置租户管理员 role_id=1（口径与 V14 完全一致）
--
-- 【待补授权 —— 主理人决策 U1】
--   设计文档 §7.4 要求同时授予「知识管理员」与「运营」两个角色，但当前仓库
--   sys_role 种子中并未固化这两个角色的稳定 role_id（V2__seed_data.sql 只有内置
--   租户管理员 role_id=1）。凭空写死一个 id 会在角色体系确定后造成错授/漏授，
--   风险高于收益。故 Wave A 按主理人裁决 **仅授权 role_id=1**，
--   待角色体系落定后另出 V18 补授，形如：
--     INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
--     SELECT <新id>, <知识管理员role_id>, 'menu'::sys_perm_type, m.id, NOW()
--     FROM sys_menu m WHERE m.id = 91039 ...;
-- ---------------------------------------------------------------------------
INSERT INTO sys_role_permission (id, role_id, perm_type, target_id, created_at)
SELECT m.id, 1, 'menu'::sys_perm_type, m.id, NOW()
FROM sys_menu m
WHERE m.id = 91039
  AND m.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_permission rp
    WHERE rp.role_id = 1 AND rp.perm_type = 'menu' AND rp.target_id = m.id
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- D. API 级登记：让 POST /api/v1/kb/hit-test 进入 ApiPermissionRegistry
--
-- 注册表查询（SysApiRepository.findRegistryRows）要求同时满足：
--   a.type = 'api' AND a.status = 1 AND a.http_method IS NOT NULL
--   AND a.path_pattern IS NOT NULL AND m.status = 1
--   且 a.module_id 必须能 JOIN 上 sys_module（V8 加了 FK，指向不存在的模块会直接报错）。
-- KB 模块 sys_module.id = 91020（V13 写入），此处引用它。
-- ---------------------------------------------------------------------------

-- D.1 catalog 节点：sys_api 是树形结构，api 行需要一个父目录才符合既有组织方式
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91060, 91020, 0, '0090', 'catalog'::sys_api_node_type, '知识库工具', NULL::VARCHAR, NULL::VARCHAR, 90, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_module WHERE id = 91020);

-- D.2 接口行
--     注意 uk_api_method_path 是 (http_method, path_pattern) WHERE type='api' AND status=1 的
--     部分唯一索引，故这里额外用 path 去重，避免将来 KB 全量补登记时重复插入同一路径。
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.* FROM (VALUES
    (91061, 91020, 91060, '00900001', 'api'::sys_api_node_type, '命中测试', 'POST', '/api/v1/kb/hit-test', 1, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api WHERE id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = 'POST' AND a.path_pattern = '/api/v1/kb/hit-test'
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91060);

-- D.3 菜单 → 接口 关联：permission 取自**页面菜单 91039**（kb:hittest:run）。
--     挂页面菜单而非按钮节点，是 r2 修订的直接后果（见文件头）；
--     findRegistryRows 的 JOIN sys_menu 不过滤 type，页面节点同样能提供 permission。
--     V8__module_api_refactor.sql:37 已 DROP uk_menu_api_api(api_id)（已核对原文），
--     仅剩 uk_menu_api_pair(menu_id, api_id)。
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (91061, 91039, 91061, 1, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE menu_id = 91039 AND api_id = 91061)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = 91039)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 91061);

-- ---------------------------------------------------------------------------
-- 迁移后自检（在你方环境执行 flyway migrate 后手工跑一遍）
--
--   -- 0) r2 回归项：kb:hittest:run 在 app 91010 下必须有且仅有一行启用菜单
--   --    （多于一行即说明 uk_menu_app_permission 被绕过或按钮节点被重新引入）
--   SELECT id, name, type FROM sys_menu
--   WHERE app_id = 91010 AND permission = 'kb:hittest:run' AND status = 1;
--   -- 期望：恰好 1 行 → 91039 | 命中测试 | 2
--
--   -- 1) 注册表里应当出现且仅出现一行 hit-test 规则，permission 为 kb:hittest:run
--   SELECT a.http_method, a.path_pattern, m.permission, sm.status AS module_status
--   FROM sys_api a
--   JOIN sys_menu_api ma ON ma.api_id = a.id
--   JOIN sys_menu m      ON ma.menu_id = m.id
--   JOIN sys_module sm   ON sm.id = a.module_id
--   WHERE a.path_pattern = '/api/v1/kb/hit-test';
--   -- 期望：POST | /api/v1/kb/hit-test | kb:hittest:run | 1
--
--   -- 2) 菜单排序
--   SELECT id, name, sort FROM sys_menu WHERE id IN (91036,91039,91037,91038) ORDER BY sort;
--   -- 期望：91036=6, 91039=7, 91037=8, 91038=9
--
--   -- 3) 行为验收：无 kb:hittest:run 的登录用户 POST /api/v1/kb/hit-test
--   --    期望 HTTP 403（ResultCode.FORBIDDEN，由 ApiPermissionInterceptor 抛出），
--   --    而不是改造前的 200。BFF 需重启或等 refresh-interval-seconds(300s) 到期重载注册表。
-- ---------------------------------------------------------------------------
