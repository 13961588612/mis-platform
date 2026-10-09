# MIS 平台项目记忆

> 维护规则：追加式更新；发现与实测冲突时**先核实再改**。历史快照数据只保留仍有效的。

## 端口与启动（黄金知识，实测优先）
- 端口：主前端 **5174**（`vite.config.ts:14`）/ gateway **8080** / BFF **8081** / ai-platform **8000** / ai-platform-gateway **3100** / mis-iqd **8109** / mis-iam 8102 / mis-org 8103 / mis-system 8105 / WrenAI 控制 9100 + 数据 9101。
- 一键集成栈 `scripts/start-integration-stack.ps1` ⚠️ **只做 infra + flyway + gateway:8080 + audit，不含 mis-iqd / BFF / ai-platform / 前端**；跑完 ≠ 可联调。
- 联调清单见 `docs/ai-fusion/wrenai/mis-iqd-modeling-runbook.md` §2.0 + §1.5。
- 登录链路：GET `/api/v1/auth/captcha`(SVG 文本解码 4 位) → POST `/api/v1/auth/login`(admin/Mis@123456) → Bearer；需 appCode=system。
- **沙箱硬限制**：只回收脱离父命令的孤儿子进程（~13s），常驻 java/`Start-Process` 会被 SIGKILL → 长服务须放**单条前台命令**内（start→用→停，timeout≤600000）。禁 cmd.exe；.bat 纯 ASCII。

## 构建/测试门禁
- **前端必须 `pnpm install`/`pnpm add`，`npm install` 必崩**（node_modules 是 pnpm 布局，arborist 报 `matches` null）。文档里写 npm install 的都是错的。
- 前端：`npm run test`（vitest run，`^2.1.0` HEAD 就有）、`npm run typecheck`（tsc strict + noUnusedLocals）。eslint 存量 `arch/no-cross-feature` 11 error 集中在 `features/ai/context/form-fill-bridge.tsx` + `features/system/`。
- Java：JDK17 `D:\software\jdk-17.0.2`；Maven 直调坏（Git Bash 解析 MAVEN_HOME 成 Unix 路径）→ 用 classworlds Launcher：
  `"$JH/bin/java" -classpath "$MV/boot/plexus-classworlds-2.11.0.jar" -Dmaven.home=$MV -Dclassworlds.conf=$MV/bin/m2.conf -Dmaven.multiModuleProjectDirectory=D:/code/mis-platform/backend org.codehaus.plexus.classworlds.launcher.Launcher <args>`
- ⚠️ `-pl X -am test -Dtest=Y` **必加** `-Dsurefire.failIfNoSpecifiedTests=false`（否则上游模块无匹配用例直接 BUILD FAILURE，走不到目标模块）。要暴露 testCompile 问题就跑不带 `-Dtest` 的全模块。
- ⚠️ 本沙箱 surefire forked JVM 会被杀 → 加 `-Dsurefire.forkCount=0`（**仅本机绕行，勿进 CI**）。Python 测试在 `agent/ai-platform/backend`(pytest)。
- ⚠️ git：提交前必看 `git diff --cached --name-only`（`git mv` 会把 rename 静默暂存进去污染分组提交）；重分组用 `git reset --soft HEAD~1` + `git restore --staged <path>`；分组只能按**路径不重叠**切。git 用系统版 `"/c/Program Files/Git/cmd/git.exe"`（PortableGit push 坏的），`-C` 用 `D:/...` 形式。

## 数据库/迁移
- Flyway **只追加**：绝不改历史迁移（checksum 变更阻塞整条链），一律新文件补登。
- ID 段位规约：① 一段一文件/按域分段 ② 冲突自检**须基于迁移源文件**（只查运行后的库会漏检被 `WHERE NOT EXISTS` 跳过的行）③ 派工前 grep `sys_api`+`sys_menu_api` 核实权限码真值，否则「前端放行后端 40300」。同类坑踩过两次（92158/V51、92586/V91）。
- alembic 连接串来自 `src/config.py` 的 `POSTGRES_HOST`（默认 `postgres`，仅 Docker 内网可达）；**宿主机跑须 `$env:POSTGRES_HOST=10.254.16.6`**，真实 PG 在 10.254.16.6:5432。
- 部署边界：AI 融合 `deploy/docker-compose.ai.yml` 叠加主栈；共享 PG 库 `ai_platform`(role aiplatform)，Redis db2 前缀 `aip:`；边缘 nginx `deploy/nginx/edge.conf` 反代 `/api`+`/ws`→ai-platform-gateway:3100。

## 前端 UI 规范（高频踩坑）
- 表格吸顶：`min-h-0 flex-1 overflow-auto` 单层滚动，禁 `h-full overflow-auto` 嵌套；禁 sticky th `backdrop-blur`；用 `border-separate border-spacing-0`；全局 `thead th` 已 sticky。
- 页面内**勿加内层 padding**（间距由 app-layout `p-4 md:p-6` 控制）；列宽 `components/common/use-column-widths.ts`；sidenav sectionLabel 由 app-layout 传。
- 风格已落地：圆角 4px、表头/标签 13px、列间竖线 `border-l border-border/60`、主色 `#4f46e5` 不动。

## AI 平台现状
- `agent/ai-platform/backend/src` = **223 py / 64k 行**，25 个子包（coordinator / agent / runtime / llm / mcp / skills / memory / channels / router / hitl / adapters / cluster …）。两个 Worker 已在 `src/agent/`：`mis_iqd`、`mis_rag`。
- gateway 是 Node/TS：`src/{a2ui,adapters/{h5,wecom},channels,cluster,config,middleware,queue,router,utils}`。
- `configs/agents/` = 8 个 agent 声明式定义（crm-assistant / mis-admin-helper / mis-copilot / mis-extract / mis-iqd / mis-rag / mis-summary / mis-user-helper）。
- BFF `mis-admin-bff` 网关路由走 Nacos `lb://mis-admin-bff`(ns=integration, group=MIS_GROUP)；启动须 `MIS_REMOTE=true`+Nacos 三项+DB/Redis 指向 10.254.16.6+JWT 绝对路径+显式 `SERVER_PORT=8081`（`SERVER__PORT=20231` 会覆盖导致启动失败）。缺 `sys_api`/`sys_menu_api`/`sys_role_permission` 行 → 40300。
- ⚠️ 历史待核实项：BFF→ai-platform 401 修复（`MisJwtCaptureFilter`+`DownstreamAuthContext`）曾未提交，接手先确认是否入库。

## KB 权限模型（改动前必读）
- 三层两套：分类管辖 `kb_category_admin`(子树继承) + 库 ACL `kb_acl`(read/manage/acl)；文档随库无独立权限。
- `hasLibraryManage = 节点管辖 ∨ kb_acl.manage`（NodeAdminResolver L230）；检索只认 read。
- ⚠️ 缺口：`KbLibraryService` + `RagSettingsService.save` 服务层不校验数据范围（仅 BFF 层）→ 须补 `assertNodeManage`/`hasLibraryManage` 贯通 userId。

## mis-iqd 问数（v1.12 实施收口）
- 命名：项目 `mis-iqd`，表前缀 `iqd_*`（13 张，mis_platform 库，Java `backend/mis-iqd` + Flyway `V71`）；API `/api/v1/iqd/**`；权限码 `iqd:*`（7 族）；前端 `features/agent/iqd`；Worker `mis_iqd`（经 `/internal/v1/iqd/**`，**不直连库**，fail-closed 45204）；对接外部 WrenAI 保留 wren 字样。
- **核心不变量**：编辑落 `iqd_catalog_item`（真值）→ 派生 MDL（视图）→ `wren context build` → memory index → MCP 门禁。**catalog 真值，MDL 派生，单向**。建模台不新增写路径。
- 权限**双闸门**：BFF `iqd:*` 功能码 + Worker 表级 ACL 二次裁定（fail-closed）+ `masking.py` 唯一脱敏出口；行级由维度注册表 `iqd_row_scope_dimension` 驱动（dept 走 dept_path 前缀；store ENUM）。
- 决策固化：ADR-019(ai_platform) 已被 **ADR-020**(mis_platform，对齐 mis_kb) 替代。
- ⚠️ architecture.md 有**双 v1.10**：line6 的 v1.10 = 样本方言转化（被 6 文档 40+ 处引用，**不可改号**）；涉建模台 → v1.11+。引用章节号前必须 grep。
- 迁移：V87 种子 / V88 补端点 / V89 model_ref+MCP / V90 cube / V91 sql-pairs / V92 连接更新(92800/92801，码 `iqd:modeling:edit`)。docs 在 `docs/ai-fusion/wrenai/mis-iqd-modeling-*.md`。
- `PUT /iqd/connections/{id}` 与 `PUT /iqd/config`（主连接 upsert）**并存不收敛**；更新必须用 `IqdConnectionUpdateRequest`（复用 Save 请求会因 Java 默认值静默覆盖）；`secret_ref` 留空 = 省略字段。**多条 enabled=true 合法**，主连接 = `name='default'`，Java 权威 `findPrimaryConnection()`，Python 消费 `is_primary` 计算字段。
- ⚠️ 文案铁律：启用连接「**不影响其它连接**」，绝不出现「将自动停用其它连接」。
- ⚠️ **M-G1~M-G6 六条黄金用例全部未真机执行**（沙箱无 docker/wren CLI）。M-G1 不得判通过。开放项：模拟角色 WHERE 预览端点（从未落地）、enhance 页权限闸门、`@EnableMethodSecurity` 缺失。

## 多 Agent 实施纪律
1. 单批 ≤2–4 新文件，无 >15KB 超大单文件（超量必跑满 150 轮，T01/T03b 两次实测）。
2. 临时脚本/输出放系统临时目录，**不得落仓库工作区**。
3. 测试真实性：禁删测试/skip/`as any`/改 fixture 迎合类型。
4. 主理人验证纪律：不信转述，查磁盘 + 独立跑门禁；转述数据前先跑命令核实。
5. SOP 完整流程须 TeamCreate + 派 software-engineer/software-qa-engineer 子 Agent（name=subagent_type=Agent ID）；BugFix/快速模式可跳 PRD/架构。

## 任务流 mis-taskflow（2026-10-08 新增）
- 新模块 `backend/mis-taskflow`，端口 **8104**（`server.port`）；BFF 走 `mis.bff.taskflow-*`（默认 `http://localhost:8104`），网关无需改（`/api/v1/**` 统一到 BFF）。
- 探针：内部 `GET /internal/v1/taskflow/health`；对外 `GET /api/v1/taskflow/health`（BFF 透传）。
- Flyway 落在 `mis-migrator`：V120 消息/代办、V121 流程+Outbox+锁表、V122 审计增强。全部幂等（IF NOT EXISTS / 固定列 ADD COLUMN IF NOT EXISTS），已实测可重复执行。
- **测试库 Flyway 用法**（本机无 Docker/PG，直连远端联调库）：
  `cd backend/mis-migrator; ..\mvn.ps1 flyway:migrate "-Ddb.host=10.254.16.6" "-Ddb.port=5432" "-Ddb.name=mis_platform" "-Ddb.user=mis" "-Ddb.password=mis123"`
- 验证长服务**不要用 Start-Process 起 jar**（沙箱 ~13s 杀子进程）；改用 `@SpringBootTest(RANDOM_PORT)` + `TestRestTemplate`，用环境变量 `MIS_DB_TEST=true` 门控（`@EnabledIfEnvironmentVariable`），并把 `DB_HOST/DB_USER/...` 传进去，跑 `mvn.ps1 -q -pl mis-taskflow test`。
- ⚠️ 迁移实际已到 **V127**（V123 种子/V124 wf_edge/V125 审计/V126 /tasks/handled/V127 个人事务权限置 NULL）。**V127 是正确设计修正不是 bug**（个人事务 permission 置 NULL + 全角色授权），但 `sys_api` 95020-95029 仍登记 → 排障看权限码会被误导。
- **已实测的四个致命缺陷**（动这块必看 `docs/architecture/msg-log-workflow/09-unified-inbox-plan.md`）：
  ① `TaskService.java:206-208` `syncLinkedMessagesToHandled()` **空实现**（`:144` 调用）→ 处理完待办消息永不变；② 铃铛未读是**前端假算**（`header-toolkit.tsx:59,77,92`：前4待办+前4消息 slice(0,8)）；③ 同意/驳回**走两套后端**（`task-list-page.tsx:90-93`）；④ **消息无详情**（`/messages/{id}` 零调用方，`inbox-page.tsx:83-84` 点消息一律跳 `/task/pending`）。
- ⚠️ `sys_task` 与 `wf_task` **双表镜像**（`V120:61-83` vs `V121:87-102` 字段一一对应），`ProcessService.java:347-375` 每节点插两行、`:184-191` 靠 try/catch 吞异常同步、**无对账** → 规划裁定 `sys_task` 为唯一真相源、`wf_task` 降级为节点身份表。
- ⚠️ `sys_task.read_flag` 是**死字段**（全模块 0 处 `setRead(TRUE)`）；`TaskflowStatus.Task` 6 值实际只出 3 值（`APPROVING` 仅 `:244` 判断，`EXPIRED/CANCELLED` 零引用）；`SysMessageReceiver.status` 的 HANDLED/IGNORED/ARCHIVED 零写入。
- 状态机语义病根：**「已读」被当成「已处理」** → 规划裁定 `seen`（看过）与 `resolved`（处理了）正交分字段，`read_flag` 改名 `seen`。
- 文档基线：`msg-log-workflow/` 下 **v3 与 v4 同名并存**（只索引 v4）、`001-` 未索引、README 的模块名 `mis-notification` 与表 `sys_biz_reference` **都不存在**；WebSocket 推送在 README/01 反复承诺但**代码零落地**（建议 ADR 判死，改轮询→SSE）。

## 开发脚本模块清单（易漏）
- `backend/build-dev.ps1`（knownServices）、`start-dev.ps1`（servicePorts）、`stop-dev.ps1`（servicePorts）**三处都有硬编码服务清单**；新增后端模块必须同时补三处，否则 `build/start/stop <模块>` 报「未知服务」。
- 三脚本须保留 **UTF-8 BOM**（Windows PowerShell 5.1 中文输出乱码）；改写时用 `encoding='utf-8-sig'`。
