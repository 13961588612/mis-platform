# ADR-016: Sprint 2 服务边界 — mis-iam / mis-org 合并原规划

## 状态
已接受

## 日期
2026-07-21

## 背景

Phase 1 初版规划将身份与权限拆为 **mis-user（8102）**、**mis-rbac（8104）**、**mis-org（8103）**。  
实际落地时进程偏多、用户列表常需并行补全角色与组织信息，且权限 PDP 与用户账号强耦合。

## 决策

| 服务 | 端口 | 职责 |
|------|------|------|
| **mis-iam** | 8102 | APP、用户、角色、角色-权限、权限聚合 / Redis（合并原 mis-user + mis-rbac） |
| **mis-org** | 8103 | 组织、部门、**员工**、岗位（员工从原 mis-user 迁入） |
| **mis-system** | 8105 | 菜单、`sys_api` / `sys_menu_api`、字典（菜单-API 绑定不在 mis-iam） |

- **取消** 独立进程 mis-user、mis-rbac；端口 **8104 回收**。
- **mis-auth** 仍独立；登录查用户 / 写 permissions → **mis-iam**。
- PDP 组件名：ADR-008 中的 mis-rbac 改为 **mis-iam**。

## 备选方案

| 方案 | 评价 |
|------|------|
| A. 维持三服务拆分 | 边界清晰，联调与部署成本高 |
| B. **mis-iam + mis-org（选定）** | 身份与权限同进程；组织人事独立 |
| C. 单一「平台」巨型服务 | 违背微服务边界，否决 |

## 后果

### 正面
- 减少服务数与内部 RPC
- 与现有 `backend/mis-iam`、`backend/mis-org` 代码一致

### 负面
- 历史文档 / ADR 需修订服务名（本次已同步）
- 数据迁移需追加 V3：`sys_module` 中 mis-user/mis-rbac → mis-iam（见 `V3__rename_sys_module_services.sql`）

## 关联

- [02-system-architecture](../architecture/02-system-architecture.md)
- [microservices.md](../backend/microservices.md)
- [decisions.md](../project/decisions.md)
- [ADR-008](ADR-008-bff-centralized-api-authz.md)
