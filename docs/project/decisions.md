# 全局决策记录

> 状态：✅ 已确认（2026-06-23 持续更新，2026-07-21 Sprint 2 服务边界）| 变更请同步 ADR 与 schema 文档

## 1. 产品与范围

| 项 | 决策 |
|----|------|
| Phase 1 数据库 | 单库 `mis_platform`（ADR-001） |
| Phase 1 功能 | F1/F2 不做；F3/F4/F5/F6 做（改密、个人中心、**多 Tab**、**AI 占位**）；**门户九宫格 + APP 切换**（仅 `system` 可进，其它占位） |
| 流程引擎 | Phase 2 Flowable |
| UI 语言 | 默认中文，i18n 预留 |
| 生产部署 | Kubernetes |
| LLM | Phase 3 |

## 2. 安全与权限

| 项 | 决策 |
|----|------|
| 认证 | JWT + Refresh Cookie；**mis-auth 独立服务** |
| superadmin | `sys_platform_user`，管理全租户 |
| 租户 admin | 每租户 `admin`，`is_tenant_admin=1`，**不可删自己** |
| 内置角色 | 仅 `TENANT_ADMIN`；`DEPT_MANAGER` 等后期自建 |
| 权限通配符 | **不支持** |
| 默认密码 | `Mis@123456`；**首次登录强制改密** |
| 测试账号 | Phase 1 **不预置** |
| 权限存储 / API 鉴权 | ADR-009/011/012；PDP = **mis-iam**（ADR-008 / ADR-016） |

## 3. 组织与岗位

| 项 | 决策 |
|----|------|
| 部门 | `sys_dept` + `sys_dept_category`（ADR-013） |
| 岗位 | `sys_post_type` + `sys_post` + `sys_employee_post`（ADR-014） |
| 兼职 | 员工可多岗任职 |

## 4. 工程栈

| 项 | 决策 |
|----|------|
| Java | Maven 多模块 |
| 服务边界 | **mis-auth**（认证）与 **mis-iam**（身份+权限）**分开**；**不**再拆 mis-user / mis-rbac |
| 组织人事 | **mis-org**（组织/部门/员工/岗位）；员工不进 mis-iam |
| 服务间 HTTP | BFF WebClient；领域 RestClient；**内部直连**（不经 Gateway） |
| 缓存 | Redis 单级（ADR-006） |
| 持久层 | **Spring Data JPA**（ADR-015） |
| Flyway | `mis-migrator` |
| SonarQube | Phase 1 **不接入** |
| 本地开发 | **Docker Compose 基础设施 + IDE 直跑** 应用服务（双模式） |

## 5. 待定

| 项 | 状态 |
|----|------|
| 团队分工 | 待定 |

## 6. Schema 状态

**SQL 已生成并持续追加** — `docs/db/migrations/`：

| 版本 | 说明 |
|------|------|
| V1 / V2 | 建表 + 种子 |
| V3 | `sys_module` → mis-iam / mis-org |
| V4 | API path 对齐 |
| V5 | `sys_app` 门户字段（kind/runtime/description/portal_group）+ 占位 APP |

执行：`cd backend && .\mvn.ps1 -pl mis-migrator flyway:migrate`
