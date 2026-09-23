# MIS 平台项目记忆

## 启动与测试（黄金知识）
- 一键集成栈 `scripts/start-integration-stack.ps1` —— ⚠️ **只做「infra + flyway migrate + gateway:8080 + audit」，【不含】mis-iqd / BFF / ai-platform / 前端**；跑完它 ≠ 建模台可联调（**2026-09-23 实测**）。
- **端口权威值**：主前端 **5174**（`vite.config.ts:14`；⚠️ **旧记录 5173 有误**）/ mis-iqd **8109** / BFF **8081** / ai-platform **8000** / WrenAI 数据面 **9100**（控制）+ **9101**（数据）。前端 proxy：`/api`→gateway **8080**、`/api/events`+`/api/messages`+`/ws`→ai-platform gateway **3100**；依赖安装**必须 `pnpm install`**（`npm install` 必崩）。
- **联调启动清单**见 `docs/ai-fusion/wrenai/mis-iqd-modeling-runbook.md` **§2.0**（含前置确认 / 启动时间线 / env 表 / 8 条冒烟 / 失败对照）+ **§1.5**（首次接入：DBA profile + 建连接）。
- BFF `mis-admin-bff` :8081，聚合 mis-iam:8102/mis-org:8103/mis-system:8105；本地 `.\mvn.ps1 spring-boot:run -pl mis-admin-bff`。
- 前端门禁：**vitest 已配置**（`npm run test` = `vitest run`，`vitest ^2.1.0` 在 HEAD 即存在——2026-09-22 实测修正，旧记录「无 vitest/jest」有误）；typecheck `npm run typecheck`（tsc --noEmit strict+noUnusedLocals）；eslint 存量 `arch/no-cross-feature` 11 error 集中在 `features/ai/context/form-fill-bridge.tsx`+`features/system/`。
- Java 需 JDK17(`D:\software\jdk-17.0.2`)。Maven 直调坏（Git Bash 把 MAVEN_HOME 解析成 Unix 路径→classworlds ClassNotFoundException）。正确启动器：
  `JH=D:/software/jdk-17.0.2 MV=D:/software/apache-maven-3.9.16; "$JH/bin/java" -classpath "$MV/boot/plexus-classworlds-2.11.0.jar" "-Dmaven.home=$MV" "-Dclassworlds.conf=$MV/bin/m2.conf" "-Dmaven.multiModuleProjectDirectory=D:/code/mis-platform/backend" org.codehaus.plexus.classworlds.launcher.Launcher <args>`
- Python 测试在 `agent/ai-platform/backend`(pytest)。
- ⚠️ Maven `-pl X -am test -Dtest=Y` **必追加** `-Dsurefire.failIfNoSpecifiedTests=false`：否则 `-am` 把 `-Dtest` 带到上游模块(如 mis-common-core 无匹配用例)直接 `BUILD FAILURE`("No tests matching pattern")，**根本走不到目标模块**，掩盖真实编译失败/测试 ERROR。`-pl X -am test`(无 -Dtest)全模块跑才能暴露「构造器签名漂移打断整模块 testCompile」类问题。
- ⚠️ **前端依赖必须用 `pnpm add`，`npm install` 必崩**（2026-09-22 实测）：本仓 `node_modules` 是 pnpm 布局，`npm` 的 `@npmcli/arborist` 处理 `node_modules/.pnpm/...` 会报 `Cannot read properties of null (reading 'matches')`。施工单/文档里写 `npm install` 是错的。
- ⚠️ **本沙箱下 Java surefire 的 forked JVM 会被杀** → 单测加 `-Dsurefire.forkCount=0`（进程内执行）绕过。**仅本机绕行，勿进 CI 配置**。前端 vitest 偶发「空日志失败」，重跑即过（非代码问题）。
- ⚠️ **git 提交陷阱**：仓库里若有 `git mv` 过（重命名会自动暂存进索引），`git commit` 会**带上这些已暂存的 rename**，污染分组提交。**提交前先看 `git diff --cached --name-only`**。需要重新分组时用 `git reset --soft HEAD~1`（不动工作区）+ `git restore --staged <path>`。分组只能按**路径不重叠**切（docs / backend+agent / frontend 可行；按「任务批次」切不可行——文件是先建后改，签出中间态要重建历史）。git 用系统版 `"/c/Program Files/Git/cmd/git.exe"`（PortableGit 的 push 是坏的）。
- ℹ️ `.workbuddy/` 在 `.gitignore` 中，但 `memory/MEMORY.md` 已被跟踪（历史提交过），故仍可提交。

## 部署边界（2026-07-24 锁）
- AI 融合 `deploy/docker-compose.ai.yml` 叠加主栈；共享 PG 库 `ai_platform`(角色 aiplatform,Alembic)、Redis db2 前缀 `aip:`。边缘 nginx `deploy/nginx/edge.conf` 反代 `/api`+`/ws`→ai-platform-gateway:3100。
- ⚠️ alembic 迁移连接串由 `src/config.py` 的 `POSTGRES_HOST`(`pydantic` 自动读同名 env，默认 `"postgres"`)经 `env.py`→`settings.postgres_dsn_sync` 提供，**不读 `alembic.ini` 的 url**；**宿主机跑须 `$env:POSTGRES_HOST=10.254.16.6`**（`postgres` 主机名仅 Docker 内网可达，真实 PG 在 `10.254.16.6:5432`，role aiplatform，库 ai_platform）再 `alembic upgrade head`。
- 技术债归属：前端 13 tsc/网关 20 tsc 属 **agent/ai-platform**，与 `frontend/mis-admin-web` 无关。

## 前端 UI 规范（高频踩坑）
- 表格吸顶：`min-h-0 flex-1 overflow-auto` 单层滚动，禁 `h-full overflow-auto` 嵌套；禁 sticky th `backdrop-blur`；用 `border-separate border-spacing-0` 非 `border-collapse`。全局 `thead th` 已 sticky。
- 列宽拖拽 `components/common/use-column-widths.ts`；间距由 app-layout 外层 `p-4 md:p-6` 控制，页面内勿加内层 padding；sidenav sectionLabel 由 app-layout 传。
- 风格对齐（已落地）：圆角 4px、表头/标签 13px、列间竖线 `border-l border-border/60`，主色 `#4f46e5` 不动。

## BFF 启动与网关（2026-08-10 实锤）
- 网关 `/api/v1/**` 走 Nacos `lb://mis-admin-bff`(ns=integration,group=MIS_GROUP)；BFF 须注册心跳正常否则 503。
- 启动必须：`MIS_REMOTE=true`+`NACOS_SERVER=10.254.16.6:8848`+`NACOS_NAMESPACE=integration`+`NACOS_CONFIG_GROUP=MIS_GROUP`+DB/REDIS 指向 10.254.16.6+JWT 绝对路径+显式 `SERVER_PORT=8081`（宿主机 `SERVER__PORT=20231` 会覆盖 server.port→启动失败）。
- BFF 未映射即拒：缺 `sys_api`+`sys_menu_api`+`sys_role_permission` 行→40300（V55 补 dept-types 5 端点映射后 CRUD 恢复）。
- 一键脚本 `backend/start-bff-standalone.bat`（纯 ASCII）。
- 环境硬限制：① **沙箱只回收「脱离父命令的孤儿子进程」(~13-15s)**——java 服务/`&` 后台 install/`Start-Process` 起的常驻进程会被 SIGKILL；但 **AI 管理的后台 Bash / Agent 子任务本身存活**(实测后台心跳跑满 157s 不中断)。→ 长服务须放在**单条前台命令**内(start→用→停，显式 `timeout`≤600000ms=10min)或跑在真实宿主机，勿用 `run_in_background`/`Start-Process` 起常驻服务。② 禁调 cmd.exe；③ .bat 纯 ASCII；④ 登录需 appCode=system；⑤ 验证码 SVG 可文本解码；⑥ **PortableGit 残缺 git push 坏**，须系统 Git `"/c/Program Files/Git/cmd/git.exe"`(且 git `-C` 用 `D:/...` 形式，勿用 `/d/...` 偶发解析失败)。
- 登录链路：GET `/api/v1/auth/captcha`(SVG 解码 4 位)→POST `/api/v1/auth/login`(admin/Mis@123456)→Bearer。

## Agent 控制台 + BFF（2026-08-06 快照，部分状态可能已变）
- `features/agent/types.ts` 已按 ai-platform 真实 wire 对齐；`features/agent` typecheck 0 错。
- ⚠️ BFF→ai-platform 401 修复（`MisJwtCaptureFilter`+`DownstreamAuthContext`+`AgentOpsTransport.agentOpsHeaders()`）曾**未提交**，回归测试 `AgentOpsTransportAuthHeaderTest`/`MisJwtCaptureFilterTest` 在 —— **接手前先确认是否已入库**。

## KB 权限模型（2026-08-12 评审，改动前必读）
- 三层两套：分类管辖 `kb_category_admin`(子树继承已实现)+库 ACL `kb_acl`(read/manage/acl)；文档随库无独立权限。
- `hasLibraryManage = 节点管辖 ∨ kb_acl.manage`（NodeAdminResolver L230）；检索只认 read。
- ⚠️ 缺口：`KbLibraryService`+`RagSettingsService.save` 服务层不校验数据范围（仅 BFF 码）——改造须先补 `assertNodeManage`/`hasLibraryManage` 贯通 userId。
- 三步授权痛点：前端建库分类下拉列全部分类→非管辖→文档 40311。建议 UI 收敛+后端 `?scope=manageable|visible`。

## WrenAI 问数 APP（mis-iqd，2026-08-22 规划 v1.9）
- **命名**：项目 `mis-iqd`（类似 mis_kb）；表前缀 `iqd_*`（13 张，落 **mis_platform** 库，Java 侧 `backend/mis-iqd` 模块 + Flyway `V71__iqd_schema.sql`）；API `/api/v1/iqd/**`；权限码 `iqd:*`；前端 `features/agent/iqd`；Worker `mis_iqd`（IqdConfigClient 经 `/internal/v1/iqd/**` 消费，**不直连库**，缓存不可得 fail-closed 45204）；**对接外部 WrenAI 保留 wren**（命令/配置键/PyPI wrenai）。
- **权限双闸门**：BFF `iqd:*` 功能码 + Worker 表级 ACL 二次裁定（fail-closed）+ 字段脱敏（masking.py 唯一出口）；行级范围由**维度注册表 `iqd_row_scope_dimension` 驱动**（一期种子 dept + store 双维度，一表可多维度 AND；dept 走 dept_path 前缀 PATH_PREFIX、store 一期 ENUM≤500）。
- **决策固化**：ADR-019（落 ai_platform）已替代 → **ADR-020（落 mis_platform，对齐 mis_kb 范式）**；A11 行级本期、A12 物化 dept_path、A13 编码不统一→映射 X + 每库一张 + 中心每日同步。
- 规划文档：`docs/ai-fusion/wrenai/`（prd / architecture / tasks / deploy-iqd / README / 多张 mermaid）。

## mis-iqd 可视化建模台（2026-09-22 规划 v1.11 → 实施收口 v1.12）
- **定位**：wren-ui 级前端建模台 = 「编辑体验的前端升级」，**不新增写路径**。平台自建页面（非 iframe）。三栏（模型树 + @xyflow 画布 + 属性面板）+ 5 步向导。5 任务（T01–T05）/ 3 阶段 / 46 人日。
- **核心不变量**：一切编辑落 `iqd_catalog_item`（真值）→ 派生 MDL（视图）→ `wren context build` → memory index → MCP 就绪门禁。**catalog 真值，MDL 派生，单向。**
- **Q1–Q8**：Q1 编辑权威闭环（不直写 MDL）/ Q2 迁 `ai/iqd`→`iqd` / Q3 `@xyflow/react@^12.3.0` / Q4 CodeMirror 6 / Q5 TanStack Query 服务端态 + zustand 仅 UI 态 / Q6 独立 `iqd_model_layout` JSONB / Q7 ≤200 节点 60fps / Q8 multiconn T1 硬前置。
- **实施结果**：**21 commit**（`134a5c7` 规划 → `39cc620` 联调文档补全）。测试：前端 **429** / Java **69** / Python **110**；`typecheck` 0 error；build 通畅。architecture.md 升 **v1.12（基线 v1.11）**，章节 **§10**（v1.11 规划）+ **§11**（v1.12 实施回写）+ **§7.10**（ID 段位规约）。
- **迁移**：`V87` 种子 / `V88` 补 5 端点 / `V89` `model_ref`+MCP 6 端点+`iqd:mcp:manage` / `V90` `PUT /catalog/cube` / `V91` 补登 `sql-pairs/translate`（**均不动历史迁移**）。
- **权限码 7 族**（`modeling`/`catalog`/`enhance`/`mask`/`dimension`/`scope`/`mcp:manage`）⇒ **派工必先 grep `sys_api`+`sys_menu_api` 核实真码**，否则「前端放行后端 40300」。
- **⚠️ ID 段位规约（`architecture.md §7.10`）**：① 一段一文件/按域分段 ② 冲突自检**须基于迁移源文件**（只看运行后的库会漏检被 `WHERE NOT EXISTS` 跳过的行）③ **绝不改历史迁移**（Flyway checksum → 阻塞整条链），一律新文件补登 ④ 派工前置 grep。**同类坑已踩两次**（92158 由 V51 修 / 92586 由 V91 修）。
- **⚠️ 版本号体系（踩坑）**：architecture.md 有**双 v1.10** —— line 6 的 **v1.10=「样本对方言转化」增量**，被 6 文档/40+ 处引用**不可改号**；判别口诀：涉样本（sql_pairs/translate/trial）→ v1.10，涉建模台 → v1.11+。**引用章节号前必须 grep 核实。**
- **待真机复验（不可免）**：**M-G1~M-G6 六条黄金用例全部未真机执行**（沙箱无 docker/wren CLI/PG 非业务库）。**M-G1 不得判通过**（依赖模型物化；`build_mdl_from_catalog` 对全新 model 刻意不物化，真实 MDL model schema 未过 W0 实测）。开放项：模拟角色 WHERE 预览端点（从未落地）、enhance 页权限闸门、`@EnableMethodSecurity` 缺失。
- **文档**：`mis-iqd-modeling-{prd,system-design,tasks,verify-checklist,runbook}.md` + 2 mermaid + 前端 `features/agent/iqd/README.md`。

### 🔌 联调接入（2026-09-22 补全，`c3eabee`+`39cc620`）
- **要更新的程序**：`mis-migrator`（V87–V91，**V91 必须执行**）/ `mis-iqd`(28 文件) / `mis-admin-bff`(8) / `ai-platform`(7) / `frontend mis-admin-web`(95 + 7 依赖，**必须 `pnpm install`**)。**`wren-mcp-agent` 零改动 → 不更新**（18 commit 未碰它及 client/registry/lifecycle；控制面 9100 + 数据面 9101 契约未变），但**必须已部署运行**（V89 的 6 条 MCP 启停端点依赖它）。
- **建连接是三方协作**：① DBA（wren 机）`wren profile add` + `wren context set-profile`（凭证只落主机，平台不代敲）→ ② 平台向导 4 步（`conn:basic`/`datasource`/`profile`/`test`）→ `POST /api/v1/iqd/connections` → ③ `POST /api/v1/iqd/mcp/enable?connectionId=` 拉起 MCP（应 `mcp_status=ready`）。
- ~~**⚠️ 一期仅一条 `enabled=true`**（业务约定 `architecture.md:882`；DB 层只有 `UNIQUE(name)`）→ 首次接入前先把旧启用连接置 false。~~ **【2026-09-22 作废】用户拍板放开多条并存** ⇒ **多条 `enabled=true` 合法**，无需先停旧的；**主连接 = `name='default'`**（否则 id 最小 enabled）。订正见 `architecture.md:882` / `mis-iqd-modeling-system-design.md §14.5 / §14.5.1`。
- **`PUT /iqd/connections/{id}` 已实现**（T06/T07/T08，`fbefca7`/`937b0e5`/`d95c1a8`）：按 id 精确更新/停用**指定**连接，与 `PUT /api/v1/iqd/config`（主连接 upsert）**并存不收敛**。迁移 `V92`（sys_api **92800** / sys_menu_api **92801** → menu 92632），权限码 **`iqd:modeling:edit`**。要害：① **必须用新 DTO `IqdConnectionUpdateRequest`**（字段全 null → 局部更新；复用 `IqdConnectionSaveRequest` 会因 Java 默认值静默覆盖未提交字段）② `secret_ref` 留空 = **省略字段**（不传空串；不依赖后端对空串的宽容分支）③ UI 落点 = `ConnectionWizard` 的 `McpStatusCard`（编辑/停用/启用 + 二次确认；**不放 config 页**——会造第二套连接列表真值，违反 Q5）。
- ⚠️ **「启用」文案铁律**：「启用后该连接纳入问数，**不影响其它连接**」——**绝不出现**「将自动停用其它连接」。已用正反双向单测钉死。
- ⚠️ **主连接口径跨端不一致已修**（T08）：Java 权威 = `findPrimaryConnection()`（`name='default'` 优先 → 最小 id enabled → 首行）；Python 原有 **3 处同构拷贝**只取 `connections[0]`（无视 default）——单条 enabled 时必然同值故从未暴露。现统一消费内部面新增的 **`is_primary`** 计算字段（不落库）。**另修掉 Python 一个悬空调用**：`sync_coordinator` 调 `client.get_connections()` 但该方法此前不存在 → AttributeError 被 `except` 吞掉 → 主连接解析静默降级 `None`。
- **其他联调前置**：WrenAI 侧 `DEEPSEEK_API_KEY` + 离线 embedding（缺则「记忆索引」段失败）/ `WREN_AGENT_ENDPOINT`+`WREN_AGENT_TOKEN`（跨机必配）/ 业务库须从 **wren 机**网络可达 / `~/.wren/config.json`（strict_mode/denied_functions）。

### 📐 多 Agent 实施纪律（本日沉淀，可复用）
1. **容量边界**：单批 ≤2–4 新文件、无 >15KB 超大单文件（超量必跑满 150 轮 → T01/T03b 两次实测）
2. **临时脚本/输出必须放系统临时目录**，**不得落仓库工作区**（T03d 曾污染提交，需 `git rm` 补一个清理 commit）
3. **测试真实性**：禁删测试 / `skip` / `as any` / 改 fixture 迎合类型让门禁变绿（T03c 工程师主动拒绝，为正面范例）
4. **主理人验证纪律**：不信转述，查磁盘 + 独立跑门禁；**提交前看 `git status --short` 全量文件名**（不是只看数量）；**转述数据前先跑命令核实**（曾把 18 commit 说成 20/21，被架构师纠正）
5. **结论先核实再写**：路径结论先 `ls`/`find`（T03b 双锁文件归属报错）；写给成员的技术主张要自证
6. **派工前置**：`sys_api` 权限码 grep + 章节号 grep + 迁移 ID 段位 grep
7. **验证链有效**：工程师自测 → QA 独立验证（挖出 F-1）→ 主理人核实（纠正 QA 修法）→ 工程师复核（推翻 QA 另一条定性）。**每层都要敢纠正上一层，不 rubber-stamp。**

## 主理人角色铁律
- SOP 完整流程须 TeamCreate + 派 software-engineer/software-qa-engineer 子 Agent（name=subagent_type=Agent ID）；BugFix/快速模式可跳 PRD/架构。
