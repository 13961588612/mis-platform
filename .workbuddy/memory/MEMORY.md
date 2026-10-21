# MIS 平台记忆（curated v6 — 2026-10-20 精简）

> 只留跨会话黄金知识（「规则 + 为什么」）。详细日志见 `YYYY-MM-DD.md`。

## 端口 / 登录
前端 5174 · gateway 8080 · BFF 8081 · taskflow 8104 · iqd 8109 · iam 8102 · org 8103 · system 8105 · ai-platform 8000 · WrenAI 9100/9101。
🔴 登录链路**带 `/api/v1/auth` 前缀**：`GET /api/v1/auth/captcha?appCode=system`（SVG，正则 `<text>` 取 4 位码）→ `POST /api/v1/auth/login`（admin/Mis@123456）；**token 字段名 `accessToken`**。业务成败看 JSON `code`（HTTP 恒 200）。

## 门禁（🔴 OOM 极具误导）
- 前端只用 **pnpm**（npm 必崩）。`exit 1`+空输出=OOM kill≠代码错。
- 测试 `NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true`；类型 `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit`。
- 🔴 **串行跑 + `run_in_background` + 绝对路径日志**（`D:/code/mis-platform/tmp/x.log`）；`| tail` 不关会假性「永不返回」。
- 🔴 700MB 跑大目录整组 OOM（尤其 `biz/forms`）；改**精准子集 + 1536MB**。
- Java：JDK17 `D:\software\jdk-17.0.2`；`backend/mvn.sh`；集成测试须 `MIS_DB_TEST=true`（否则静默 skip → 假绿）；真实数看 `target/surefire-reports/*.txt`。

## 迁移（Flyway 只追加）
- 🔴 **checksum 覆盖整文件含注释；已落库迁移立刻被锁** → 改注释也 mismatch。已落库只能追加新版本，说明挪到实体/文档。
- 测试库直连 PG `10.254.16.6:5432`（mis/mis123，库 mis_platform）。alembic 宿主机须 `$env:POSTGRES_HOST=10.254.16.6`。
- 🔴 **Hibernate6 native query 禁 `NULL::bigint`**（解析成命名参数 `:bigint`）→ 统一 `CAST(NULL AS bigint)`。
- 菜单授权真值源 = `sys_role_permission`（`perm_type='menu'`），**无 `sys_role_menu` 表**。**新菜单必须迁移补授权**，否则按钮被 `PermissionGate` 静默隐藏。

## 🔴 BFF 三大坑
1. **deny-unmapped**：每端点须登记 `sys_api` + 绑授权菜单，否则 403 且**静默失效**。给已有端点加可选 query 参数 path_pattern 不变 ⇒ 无需重新登记。
2. **出站 URI 编码**：`builder.toUriString()` 喂 `WebClient.uri(String)` 会二次编码 → 非 ASCII 恒 0。✅ 用 `uri(Function)` + `{qN}` 占位 helper；❌ 禁 `.build(true)`。⚠️ `buildAndExpand(...).toUriString()` 本安全勿误判。
3. **构建/进程过期伪装成代码缺陷**：接口缺字段常因跑旧构建。重建 `build-dev.ps1 <svc>` + `start-dev.ps1 <svc> -Restart`；判新代码看进程启动时间，别信 jar 时间戳。`ApiPermissionRegistry` 异步灌 300s ⇒ 头 20s 全 40300。

## 前端坑
- 表格吸顶 `min-h-0 flex-1 overflow-auto`；圆角 4px、主色 `#4f46e5`；icon 须在 `icons.ts ICON_MAP` 登记。
- 🔴 `cn()`=tailwind-merge 只同类组去重：覆写 `TabsList` 须显式 `h-auto`。
- 🔴 `keep-alive-outlet` 页面**不在 Route 上下文** ⇒ `useParams` 恒空；动态路径登记 `DYNAMIC_PAGES`；详情页 ID 用 `useState(()=>parse(pathname))` 冻结。
- 🔴 **`auth-store` 是 zustand persist** ⇒ `SessionBootstrap` 绝不能 `if(menus.length>0) return` 早退（权限永不刷新）。
- 🔴 **mock 残留让回归门假绿**：`afterEach` 必须清 mock，改断言后跑变异验证门有区分度。
- 测试：api 层 `vi.mock`；zustand 不 mock；`next-themes` 必须 mock；断 className 按精确 token（`split(/\s+/)`→Set）。
- ⚠️ 凡「APP 分组名 == 菜单项名」（如 iqd「问数」）文案断言用 `getByRole('button',{name})`，禁 `getByText`。

## 多 Agent 纪律
单批 ≤2–4 新文件；禁删测试/skip/`as any`/改 fixture；**主理人验证不信转述，查磁盘+独立跑门禁**；三脚本 build/start/stop-dev.ps1 硬编码服务清单须同步、须 UTF-8 BOM。
🔴 **方案类任务必须过"独立审查 + 仓库现状对齐"两关**：派架构任务必须**显式列出待核对的活代码位置**（文件:行号 + 当前行为），外部核实再好也不能替代本地对齐；DDL 草案/伪代码当代码审（散文全对 ≠ SQL 可运行）。
🔴 派"只出方案"任务时，**审查者要独立 grep 复核关键断言**，不能只读文档措辞。

## 现状 / 里程碑
- **分支 `flow`（领先 origin，未 push）**：①外部工作流对接致远 Seeyon 方案评审 **PASS_WITH_ISSUES 全量放行**（4 轮评审，12 项问题全关闭；关键结论：`freeReplaceNode`=替换非追加 ⇒ 动态审批链降级为「模板槽位+填人」；EXTERNAL 撤销不提供、只终止，合并 `TERMINATED` 零 DDL）。详见 `2026-10-16.md` 与 `docs/architecture/msg-log-workflow/19-23`。②门户「全部事项」三源聚合 + 三增量（71 文件，commit `24ef5f6`）。
- **遗留（非阻塞）**：测试库 `wf_category.id=990001` 外部漂移（唯一失败源，非代码）；KB「中文 0 命中」查 RAGFlow；表单 EXTERNAL 运行时对接无规划无代码，真做需新建规划文档。

## 工作记忆（本项目外）
用户主理人「齐活林」，多智能体团队；百货/购物中心 + 超市数据分析体系研究中（范式文档 `docs/ai-fusion/bgbh-analyst/planning/01`）；超市数据字典在 `D:\project\AI数据分析\超市`（会员/销售两份模型清单）。
