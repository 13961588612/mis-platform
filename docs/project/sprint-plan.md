# Sprint 计划与验收标准

> 状态：✅ 已更新 | 版本：v1.1 | 更新：Sprint 2 服务边界重构（mis-user/mis-rbac → mis-iam）  
> 预估：约 4 人 × 8 周（Phase 1）

## 1. Phase 1 目标

交付可运行的企业管理后台 MVP：

- 登录 / 登出 / Token 刷新；**门户应用九宫格**（Phase 1 仅 system 可进）
- 用户、组织、角色、菜单、字典 CRUD
- RBAC + 数据权限
- 登录/操作审计日志
- 仪表盘基础统计
- Agent Gateway 健康检查 + Mock 对话

## 2. Sprint 分解

### Sprint 0 — 基建（3 天）

| 任务 | 产出 | 负责 |
|------|------|------|
| Monorepo 初始化 | 目录结构、pom.xml、package.json | 后端+前端 |
| EditorConfig + Git hooks | lint-staged | 前端 |
| docker-compose.dev.yml | PG/Redis/Nacos/MinIO | 运维 |
| Flyway V1/V2 | 建表+种子 | 后端 |
| Nacos 配置模板 | mis-common-dev.yaml 等 | 后端 |
| Gateway 骨架 | 路由+健康检查 | 后端 |
| 统一响应 Result | mis-common-core | 后端 |

**验收：** `docker compose up` 成功；Flyway 迁移无报错；Gateway 8080 健康检查 200。

---

### Sprint 1 — 认证闭环（1.5 周）

| 任务 | 产出 |
|------|------|
| mis-common-security | JWT 工具、SecurityContext |
| mis-auth 登录/验证码/refresh/logout | 完整认证 API |
| mis-audit 登录日志 | 写入+查询 API |
| Gateway JWT 验签 | 白名单+黑名单 |
| 前端 Login 页 | 表单+验证码 |
| axios 拦截器 + auth-store | refresh 单飞锁 |
| 前端路由守卫 | 未登录跳 /login |

**验收：** admin 可登录进 **门户 `/portal`**，再进入 `system`；错误密码 5 次锁定；登出后 Token 失效。

---

### Sprint 2 — 组织与身份（1.5 周）

| 任务 | 产出 |
|------|------|
| mis-org 组织树 CRUD | ancestors 维护、员工档案 |
| mis-iam 用户/角色 CRUD | APP/用户/角色、权限分配 |
| DataScopeSpecification v1 | 员工列表行级过滤（mis-org + IAM data-scope） |
| BFF IAM/Org Controller | 对外 API |
| 前端 UserListPage | 左树右表+弹窗 |
| 前端 OrgTreePage | 树形管理 |

**验收：** 用户 CRUD 全流程；按部门筛选；TENANT_ADMIN 不可删除。

---

### Sprint 3 — 菜单与权限（1 周）

| 任务 | 产出 |
|------|------|
| mis-iam 角色-菜单分配 | perm_version 缓存失效 |
| mis-system 菜单 CRUD | router 树组装 |
| `/menus/router` 动态路由 | 前端注册 |
| 前端 RoleListPage | 含菜单权限树 |
| 前端 MenuTreePage | |
| PermissionButton + usePermission | 按钮级权限 |
| 仪表盘 stats API + 页面 | 统计卡片 |

**验收：** 角色菜单分配后用户菜单变化；无权限按钮不显示。

---

### Sprint 4 — 系统与审计（1 周）

| 任务 | 产出 |
|------|------|
| mis-system 字典 CRUD | 公共字典 API |
| @OperLog AOP | 操作日志采集 |
| 前端 DictPage | 类型+项管理 |
| 前端 LoginLogPage / OperLogPage | |
| 脱敏逻辑 | 手机、密码 |

**验收：** 操作日志可查到用户创建记录；字典下拉正常。

---

### Sprint 5 — 联调与质量（1 周）

| 任务 | 产出 |
|------|------|
| Playwright E2E 5 条 | ci 可跑 |
| OpenAPI 文档 | BFF swagger |
| README 启动文档 | 新人 30 分钟跑起来 |
| agent-gateway 骨架 | health + mock chat |
| 前端 TabBar + tab-store | 多 Tab 工作区 |
| 前端 CopilotPanel 占位 | AI 侧栏占位 UI |
| Bug 修复 + UI 打磨 | |
| 单测补充 | 核心 Service ≥ 60% |

**验收：** 见下方 Phase 1 功能验收清单全部通过。

---

### 缓冲（3 天）

联调问题、性能抽查、文档修订。

## 3. Phase 1 功能验收清单

| # | 场景 | 预期结果 | 状态 |
|---|------|----------|------|
| 1 | admin 登录 | 成功进入 **门户 `/portal`**，可进 system | ⏳ |
| 2 | 错误密码连续 5 次 | 账号锁定 30 分钟 | ⏳ |
| 3 | 无权限用户访问 /system/user | 403 或菜单不可见 | ⏳ |
| 4 | 用户 CRUD | 增删改查、分页、部门筛选 | ⏳ |
| 5 | 重置密码 | 新密码可登录，有 oper_log | ⏳ |
| 6 | 组织树三级增删 | 有用户/子部门时删除失败 | ⏳ |
| 7 | 角色分配菜单 | 用户菜单随之变化 | ⏳ |
| 8 | 数据范围 | DEPT_MANAGER 仅本部门及下级 | ⏳ |
| 9 | 字典 | gender/status 下拉正常 | ⏳ |
| 10 | 审计日志 | 登录/操作可查询 | ⏳ |
| 11 | Token 刷新 | access 过期自动 refresh | ⏳ |
| 12 | 暗色主题 | 切换并持久化 | ⏳ |
| 13 | 多 Tab | 菜单打开多页、切换关闭 Tab | ⏳ |
| 14 | AI Copilot 占位 | 侧栏可打开，无真实对话 | ⏳ |
| 13 | Agent health | GET :8200/health → 200 | ⏳ |

## 4. 非功能验收

| 项 | 标准 |
|----|------|
| 用户列表 1 万条分页 | P95 < 300ms（本地） |
| 前端 Lighthouse Performance | > 70 |
| 核心 Service 单测覆盖率 | ≥ 60% |
| 无 SQL 注入 / XSS | 安全扫描通过 |

## 5. 里程碑

| 里程碑 | 时间（相对） | 标志 |
|--------|-------------|------|
| M0 | D+3 | 基建就绪 |
| M1 | D+10 | 可登录 |
| M2 | D+24 | 用户组织可用 |
| M3 | D+31 | 权限菜单完整 |
| M4 | D+38 | 字典审计完成 |
| M5 | D+45 | Phase 1 验收通过 |

## 6. 风险登记

| 风险 | 影响 | 缓解 |
|------|------|------|
| 微服务过多联调复杂 | 延期 | Phase 1 单库；可合并部署 |
| Windows 开发环境差异 | 环境问题 | 提供 PS 脚本 + Docker |
| 数据权限边界 case 多 | 质量 | 种子数据覆盖多角色测试 |
| shadcn 组件定制耗时 | UI 延期 | 优先标准组件 |

## 7. 待确认项

- [ ] 团队人数与分工（影响 Sprint 并行度）
- [ ] Sprint 周期是否 1 周还是 2 周
- [ ] Phase 1 结束标准是否包含 E2E 进 CI
- [ ] 是否需要 UAT 签字流程

## 8. 关联文档

- [项目总览](../architecture/01-overview.md)
- [本地开发环境](../devops/local-dev.md)
- [文档待确认项](../README.md#待确认项汇总全局)
