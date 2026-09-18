# MIS 平台项目记忆

## 启动与测试（黄金知识）
- 一键集成栈 `scripts/start-integration-stack.ps1`。主前端 `frontend/mis-admin-web`：`npm run dev`→:5173，proxy `/api`→ mis-gateway:8080（非 BFF 8081），代码用相对 `/api/v1/**`。
- BFF `mis-admin-bff` :8081，聚合 mis-iam:8102/mis-org:8103/mis-system:8105；本地 `.\mvn.ps1 spring-boot:run -pl mis-admin-bff`。
- 前端门禁：无 vitest/jest，唯一 `npm run typecheck`（tsc --noEmit strict+noUnusedLocals）；eslint 存量 `arch/no-cross-feature` 11 error 集中在 `features/ai/context/form-fill-bridge.tsx`+`features/system/`。
- Java 需 JDK17(`D:\software\jdk-17.0.2`)。Maven 直调坏（Git Bash 把 MAVEN_HOME 解析成 Unix 路径→classworlds ClassNotFoundException）。正确启动器：
  `JH=D:/software/jdk-17.0.2 MV=D:/software/apache-maven-3.9.16; "$JH/bin/java" -classpath "$MV/boot/plexus-classworlds-2.11.0.jar" "-Dmaven.home=$MV" "-Dclassworlds.conf=$MV/bin/m2.conf" "-Dmaven.multiModuleProjectDirectory=D:/code/mis-platform/backend" org.codehaus.plexus.classworlds.launcher.Launcher <args>`
- Python 测试在 `agent/ai-platform/backend`(pytest)。
- ⚠️ Maven `-pl X -am test -Dtest=Y` **必追加** `-Dsurefire.failIfNoSpecifiedTests=false`：否则 `-am` 把 `-Dtest` 带到上游模块(如 mis-common-core 无匹配用例)直接 `BUILD FAILURE`("No tests matching pattern")，**根本走不到目标模块**，掩盖真实编译失败/测试 ERROR。`-pl X -am test`(无 -Dtest)全模块跑才能暴露「构造器签名漂移打断整模块 testCompile」类问题。

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

## Agent 控制台 + BFF（2026-08-06，务必看）
- 已交付：T03 fail-closed 闸门(Py `640294a`+`f0754b6`)、T05 前端 12 页(`b619f255`)。
- `features/agent/types.ts` 已按 ai-platform 真实 wire 对齐（原 6 类 DTO 臆造）；`features/agent` typecheck 0 错。
- ⚠️ **BFF→ai-platform 401 修复未提交**：`MisJwtCaptureFilter`+`DownstreamAuthContext`+`AgentOpsTransport.agentOpsHeaders()` 已改，回归测试 `AgentOpsTransportAuthHeaderTest`/`MisJwtCaptureFilterTest` 在，未 commit。
- T04 未交付端点（设计内，联调 501/404）：`/admin/worker-catalog`、`/sessions`、`/admin/channels/wecom/bots`、`/admin/approvals`(⚠️ BFF 路径应 `/push/approvals`)、`/agents/{id}/config-files`。
- P2 遗留（等 T04）：MonitorOverview 虚构(undefined/undefined)、MCP 四字段恒 0、`enabled_skill_count` 恒 0。

## KB 权限模型（2026-08-12 评审，改动前必读）
- 三层两套：分类管辖 `kb_category_admin`(子树继承已实现)+库 ACL `kb_acl`(read/manage/acl)；文档随库无独立权限。
- `hasLibraryManage = 节点管辖 ∨ kb_acl.manage`（NodeAdminResolver L230）；检索只认 read。
- ⚠️ 缺口：`KbLibraryService`+`RagSettingsService.save` 服务层不校验数据范围（仅 BFF 码）——改造须先补 `assertNodeManage`/`hasLibraryManage` 贯通 userId。
- 三步授权痛点：前端建库分类下拉列全部分类→非管辖→文档 40311。建议 UI 收敛+后端 `?scope=manageable|visible`。

## WrenAI 问数 APP（mis-iqd，2026-08-22 规划 v1.9）
- **命名**：项目 `mis-iqd`（类似 mis_kb）；表前缀 `iqd_*`（13 张，落 **mis_platform** 库，Java 侧 `backend/mis-iqd` 模块 + Flyway `V71__iqd_schema.sql`）；API `/api/v1/iqd/**`；权限码 `iqd:*`；前端 `features/agent/iqd`；Worker `mis_iqd`（IqdConfigClient 经 `/internal/v1/iqd/**` 消费，**不直连库**，缓存不可得 fail-closed 45204）；**对接外部 WrenAI 保留 wren**（命令/配置键/PyPI wrenai）。
- **权限双闸门**：BFF `iqd:*` 功能码 + Worker 表级 ACL 二次裁定（fail-closed）+ 字段脱敏（masking.py 唯一出口）；行级范围由**维度注册表 `iqd_row_scope_dimension` 驱动**（一期种子 dept + store 双维度，一表可多维度 AND；dept 走 dept_path 前缀 PATH_PREFIX、store 一期 ENUM≤500）。
- **决策固化**：ADR-019（落 ai_platform）已替代 → **ADR-020（落 mis_platform，对齐 mis_kb 范式）**；A11 行级本期、A12 物化 dept_path、A13 编码不统一→映射 X + 每库一张 + 中心每日同步。
- 规划文档：`docs/ai-fusion/wrenai/`（prd/architecture v1.9/tasks v1.9/deploy-iqd/README/两张 mermaid）。

## 主理人角色铁律
- SOP 完整流程须 TeamCreate + 派 software-engineer/software-qa-engineer 子 Agent（name=subagent_type=Agent ID）；BugFix/快速模式可跳 PRD/架构。
