# MIS 平台记忆（curated v5 — 2026-10-15）

> 只留跨会话黄金知识（「规则 + 为什么」，去掉考证出处）。详细日志见 `YYYY-MM-DD.md`。

## 端口 / 登录
前端 5174 · gateway 8080 · BFF 8081 · taskflow 8104 · iqd 8109 · iam 8102 · org 8103 · system 8105 · ai-platform 8000 · WrenAI 9100/9101。
🔴 登录链路**带 `/api/v1/auth` 前缀**：`GET /api/v1/auth/captcha?appCode=system`（`imageBase64` 是 SVG，正则 `<text>` 取 4 位码）→ `POST /api/v1/auth/login` `{appCode,username,password,captchaId,captchaCode}`（admin/Mis@123456）；**token 字段名 `accessToken`**。业务成败看 JSON `code` 字段（HTTP 永远 200）。
沙箱：长服务放单条前台命令(timeout≤600000)；禁 cmd.exe；PowerShell 走 PowerShell 工具。

## 门禁（🔴 OOM 极具误导）
前端只用 **pnpm**（npm 必崩）。`exit 1`+空输出=OOM kill≠代码错。
- 测试 `NODE_OPTIONS="--max-old-space-size=700" npx vitest run --pool=threads --poolOptions.threads.singleThread=true`
- 类型：`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit`（1400MB 高负载会假挂）
- 🔴 **串行跑 + `run_in_background` + 绝对路径日志**（`D:/code/mis-platform/tmp/x.log`）。前台会被工具超时/OOM 连带 SIGKILL，连 `echo EXIT` 都打不出；`| tail` 管道不关也会假性「永不返回」。日志勿用相对 `../tmp`。
- 🔴 700MB 跑**大目录会整组 OOM**（尤其 `biz/forms`）；改**精准子集 + 1536MB**（26 文件/305s 稳）。
Java：JDK17 `D:\software\jdk-17.0.2`；`backend/mvn.sh`；`-Dtest=Y` 加 `-Dsurefire.failIfNoSpecifiedTests=false`；JVM 被杀加 `-Dsurefire.forkCount=0`；集成测试须 `MIS_DB_TEST=true`（否则静默 skip → **假绿**）；Mockito 沙箱不稳加 `JAVA_TOOL_OPTIONS=-Djdk.attach.allowAttachSelf=true`。真实数看 `target/surefire-reports/*.txt`。

## 迁移（Flyway 只追加）
- 🔴 **checksum 覆盖整文件含注释；已落库迁移立刻被锁** → 改注释也 mismatch，阻塞全链含 CI。派工前必问是否已落库；已落库只能 `flyway:repair`（需授权）或把说明挪到实体/文档。
- 测试库直连：`cd backend/mis-migrator; ../mvn.sh flyway:migrate "-Ddb.host=10.254.16.6" "-Ddb.port=5432" "-Ddb.name=mis_platform" "-Ddb.user=mis" "-Ddb.password=mis123"`。真实 PG `10.254.16.6:5432`；alembic 宿主机跑须 `$env:POSTGRES_HOST=10.254.16.6`。
- 🔴 **Hibernate6 native query 禁 `NULL::bigint`**：解析器当成「空值 + 命名参数 `:bigint`」→ PG `syntax error at or near ":"`。统一用 **`CAST(NULL AS bigint)`**。
- 菜单授权真值源 = `sys_role_permission`（`perm_type='menu'`、`target_id=菜单id`），**无 `sys_role_menu` 表**。**新菜单必须迁移补授权给角色**，否则前端 `PermissionGate` 静默隐藏按钮（「页面没编辑功能」头号成因）。
- 技术债：`wf_task.sys_task_id` 无唯一约束/外键 → JOIN 多行 `UPDATE...FROM` 取任意行。

## 🔴 BFF deny-unmapped（最大教训）
`application.yml deny-unmapped:true`：每端点须登记 `sys_api` + 绑授权菜单，否则 403 且**静默失效**，单测测不出（历史漏登记 5 批次）。BFF 包路径 `com/mis/adminbff/`。多表回填用 JOIN 防笛卡尔积。**给已有端点加可选 query 参数 path_pattern 不变 ⇒ 无需重新登记。**

## 🔴 构建/进程过期伪装成代码缺陷
接口缺新字段/值 null，常因跑的构建过期（源码对）。重建 `backend/build-dev.ps1 <svc>`；**进程跑 target/classes，重建后须 `start-dev.ps1 <svc> -Restart`**。判新代码看进程启动时间 + 接口实际返回，别信 jar 时间戳。`ApiPermissionRegistry` 异步灌 300s ⇒ 头 20s 任何 `/api/v1` 返 40300。

## 🔴 BFF 出站 URI 编码范式
病：`builder.toUriString()`（已预编码）喂 `WebClient.uri(String)` → 二次编码 `%E9→%25E9` → 非 ASCII 检索恒 0（单测全 ASCII 从不暴露）。
✅ 用 `uri(Function<UriBuilder,URI>)` + `{qN}` 占位 helper（`AbstractDownstreamClient.queryUri`/`TaskflowWebClient.uriOf`）；❌ 禁 `.build(true)`、禁 `.uri(URI)`（丢 baseUrl）。⚠️ `buildAndExpand(...).toUriString()` 走 `build(false)` 本就安全，勿误判为 bug。

## 前端坑
- 表格吸顶 `min-h-0 flex-1 overflow-auto` 单层；圆角 4px、表头/标签 13px、主色 `#4f46e5`；icon 须在 `icons.ts ICON_MAP` 登记（漏则静默回退）。
- 🔴 `cn()`=tailwind-merge **只同类组去重**：覆写 `TabsList` 必须显式 `h-auto`。jsdom 测不出，靠盒高手算 + 真浏览器。
- 🔴 路由：`keep-alive-outlet` 页面以 `<Comp/>` 渲染**不在 Route 上下文** ⇒ `useParams` 恒空；动态路径须登记 `DYNAMIC_PAGES`（prefix 以 `/` 结尾）。详情页 ID 用 `useState(()=>parse(pathname))` 冻结。
- 门户三 Tab 激活态在 `stores/portal-tab-store.ts`（不进 URL）；相关测试 `beforeEach` 复位 store。
- 🔴 **`auth-store` 是 zustand `persist`（含 permissions+menus）** ⇒ `SessionBootstrap` **绝不能 `if(menus.length>0) return` 早退**（否则权限永不刷新，F5 无效、只能重登）。后端 `/menus/permissions` 实时查 ⇒ 补授权即生效，无需重启。
- 🔴 **mock 残留让回归门假绿**：`afterEach` 只 `cleanup()` 不清 mock 时，残留 spy 调用让 `toHaveBeenCalled()` 永真。改断言后必须**跑变异**验证门有区分度。
- 测试：api 层 `vi.mock`；zustand 不 mock（`setState`）；`next-themes` 必须 mock。断 className 按精确 token（`split(/\s+/)`→Set），子串 `toContain` 会假命中。
- ⚠️ 凡「APP 分组名 == 菜单项名」（如 iqd「问数」）的测试文案不能用 `getByText`，须 `getByRole('button',{name})`。

## 多 Agent 纪律
单批 ≤2–4 新文件；临时脚本放系统临时目录；禁删测试/skip/`as any`/改 fixture；**主理人验证不信转述，查磁盘 + 独立跑门禁**；派活前 `git status` + `git log`。三脚本 build/start/stop-dev.ps1 有硬编码服务清单须同步；须 UTF-8 BOM。**成员报 completed≠有产出。**

## 🔴 智能体调度 / 问数（iqd）要点
- **Worker 不可再 spawn Agent**（`INVOKE_AGENT_MAX_DEPTH=1`，worker 剥离 spawn 工具）⇒ 新业务域智能体取数只能**持 `iqd__ask` 工具**，不能「委派 mis-iqd Agent」。
- **iqd 两层**：Java `backend/mis-iqd`(8109)=**管理面**（配置/ACL/脱敏/样本/审计，不直连 WrenAI）；Python `agent/ai-platform/.../mis_iqd/`=**执行面**（orchestrator/nl2sql/sql_guard/masking/scope_resolver）。改造先分清层。
- `iqd__ask` 已支持 `connection_id` 入参 ⇒ 多域路由靠它，工具层无需改造。⚠️ 但 `IqdInternalController` 6 个内部读端点全走 `resolvePrimaryConnectionId()` 单连接 ⇒ 非主连接域取不到 catalog/scope/样本/术语（多连接 PRD 仍草案）。
- Coordinator=`mis-copilot`（`configs/agents/mis-copilot/coordination.yaml`，timeout 1680）；行级维度 dept/store（头 X-Mis-Dept-Scope / X-Mis-Stores），fail-closed 45204。
- Doris 通：连接 `900001`/wren 0.13.3；`service.py` 有 `starrocks→doris` 映射；wren 不接受 LIMIT。
- 百购方案书 `deliverables/百购分析智能体_落地方案书_v1.md`（未开发）；Skill 源码 `D:\project\AI数据分析\百购问数上线\skills\`。
- 🔴 **custom skill frontmatter 必须含 `skill_id`**，缺则加载时静默跳过（只有一条 warning）⇒ 文件在磁盘但技能永不生效。
- 🔴 **技能要进 OpenHarness 视图必须放 `configs/skills/packages/<域>/<skill_id>/SKILL.md`**：只扫 packages，不扫 custom 落盘目录 `data/skills/`，且无报错。OH 用**父目录名作 command_name** ⇒ 目录名必须严格 = skill_id。验证看 `configs/.runtime/oh-skills/<agent>/`。
- package 范式 frontmatter（源：`packages/iqd/business-analysis/SKILL.md`）：`name`/`skill_id`/`description`/`version:"1.0.0"`/`category`/`tags`(末位放自身 skill_id)/`source: package`/`status`/`timeout:120`/`requires_approval`/`required_permissions`。**不含** `handler`/`parameters`/`priority`/`agent_created`（那是 custom 路径字段）。
- ✅ `category` 非枚举硬校验（任意字符串合法），只参与检索打分（权重 0.15）⇒ 选有语义的值即可。
- 🔴 **Skill 层拿不到 SQL**：`projector.py` 在 `view=user` 删 `sql`/`sql_dialect` ⇒ 禁止在 Skill 写 SQL 解析/校验规则（死规则），表级校验必须在 iqd 侧。
- 🔴 **`iqd__ask` 的 question 有三重消费**（喂 WrenAI / `recall_queries` 召回 / `_rank_model_candidates` 打分）⇒ Skill 侧改写**直接影响选表与召回**：必须**保留中文业务词**（换成英文列名会丢别名、打分退化）；`【S#】` 前缀需样本库同格式才有效。

## 现状 / 里程碑（分支 flow）
- **最新（已提交 `24ef5f6`，工作区干净）**：门户「全部事项」三源聚合 + 三项增量（71 文件）。①`GET /api/v1/tasks/matters`（native `UNION ALL`：`sys_task`(assignee=我) ∪ `wf_instance`(initiator=我)，外层统一过滤/排序/分页 + 独立 COUNT，`wf_task` 只在 EXISTS/标量子查询防膨胀）；「全部」子 Tab 新增并设默认。②搜索加发起人/参与人。③首页三板块改表格。④三项增量：流程/表单业务分类改下拉树单选（`CategorySingleTreeSelect`）；待办/消息「全部」Tab 缺省不过滤；命令面板恢复各 APP 菜单（system/agent/kb/iqd/finance，排除 task）。⑤`V140` 授权菜单 95012 给 role1；`V141` 登记 `sys_api 95100` 绑菜单 95002。
- 上一轮 `01921f3b`：统一业务分类（V138/V139）+ app_code 显式化；门户精修 `e5bd412`/`e9869e8`/`262d13e`；BFF 双编码修复 `72cfaa5`；表单分类独立成表 V133。
- **分支 `flow` 领先 origin 3 个 commit，未 push。** 历史雷区见 `2026-10-09.md`/`2026-10-10.md`。

## 遗留（非阻塞）
- 测试库 `wf_category.id=990001` 外部漂移（`WfCategoryMigrationIntegrationTest` 唯一失败源，**非代码**）。`scope=APP` 无 `appCode` 时降级 ALL（over-disclosure，待收紧）。
- KB「中文 0 命中」根因不在 BFF → 查 chunk 匹配 / RAGFlow。
- **表单 EXTERNAL 工作流形态：仅落了元数据字段**（`V149__form_workflow_binding.sql` → `external_workflow_system` / `external_workflow_ref`，实体 `FormDefinition`），**运行时对接无规划文档、无代码**。真要做需新建规划文档。
