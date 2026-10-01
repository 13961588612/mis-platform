# MIS 平台消息中心·操作日志·工作流 — 架构设计总览

> **状态**: 设计方案已完成 | **日期**: 2026-09-30  
> **范围**: 统一消息/代办、操作审计报表、灵活工作流整合

---

## 📋 文档清单

| # | 文档 | 内容 | 状态 |
|---|------|------|------|
| 1 | [01-message-task-design.md](./01-message-task-design.md) | 统一消息中心与代办任务体系设计 | ✅ 完成 |
| 2 | [02-operational-logging-design.md](./02-operational-logging-design.md) | 统一操作日志体系设计 | ✅ 完成 |
| 3 | [03-workflow-integration-design.md](./03-workflow-integration-design.md) | 工作流整合设计规范 | ✅ 完成 |

---

## 🎯 三个设计的协同关系

`
┌─────────────────────────────────────────────────────────────┐
│                    MIS 平台运营中枢                           │
│                                                             │
│ ┌───────────────┐    ┌──────────────┐    ┌───────────────┐ │
│ │ 消息 + 代办     │    │ 操作审计      │    │ 工作流引擎     │ │
│ │ (第 1 篇)       │◀──▶│ (第 2 篇)     │◀──▶│ (第 3 篇)      │ │
│ └───────────────┘    └──────────────┘    └───────────────┘ │
│        ▲                       ▲                      ▲    │
│        │                       │                      │    │
│        ▼                       ▼                      ▼    │
│   WebSocket 推送           变更快照记录            审批节点触发   │
│   实时角标更新               结构化查询             自动创建待办   │
│                                                             │
│         ↕ 共享基础设施: LoginUser / tenant_id / Redis ↕      │
└─────────────────────────────────────────────────────────────┘
`

**协同场景示例 — 采购审批流程:**

| 步骤 | 消息中心 | 操作审计 | 工作流引擎 |
|------|---------|---------|-----------|
| 1. 员工提交采购单 | 给采购主管发通知消息 | 记录「创建了 PO-2026-0012」 | 启动 PURCHASE_APPROVAL 流程 |
| 2. 主管收到代办 | 代办卡片显示在收件箱 | 无（仅被动查询） | 创建 APPROVAL 节点任务 |
| 3. 主管审批通过 | 生成「采购单已批准」通知 | 记录「更新了 PO-2026-0012」 | 推进到下一节点或结束 |
| 4. 申请人看到结果 | 「您的采购已获批」通知 | 可追溯整个操作链 | 流程状态变为 COMPLETED |

---

## 🏗️ 现有架构适配

### 后端复用点

| 现有模块 | 复用的能力 |
|---------|-----------|
| mis-common-jpa | BaseEntity 审计基类 + JPA 规范 |
| mis-common-security | LoginUser 上下文安全模型 |
| mis-common-redis | Redis 缓存 + Token 管理 |
| mis-audit | 保留并增强现有 sys_oper_log |
| mis-gateway | JWT 透传 + 请求过滤 |
| mis-admin-bff | BFF 代理层 |
| mis-system | Menu 表配置导航项 |

### 前端复用点

| 现有模块 | 复用的能力 |
|---------|-----------|
| shadcn-ui | Button, Card, Table, Dialog, Select... |
| eatures/a2ui | FormSheet, ApprovalCard, DataTable |
| components/layout | header-toolkit, app-layout, side-nav |
| stores | Zustand store 模式 |
| lib/api | API 客户端封装 |
| outer.tsx | KeepAliveOutlet 懒加载路由 |

---

## 🚀 实施路线图

### Phase 1: 消息+代办基础 (约 5 天)

`
Week 1:
├── Day 1-2: Flyway V1 + 建表 (sys_message, sys_task, sys_biz_reference)
├── Day 3-4: Backend Service + Controller API
└── Day 5: Frontend InboxPage + FilterBar + BadgeCounter
`

### Phase 2: 操作审计增强 (约 4 天)

`
Week 2:
├── Day 1-2: Flyway V2 + ALTER TABLE sys_oper_log
├── Day 3: AOP AuditAspect + @BusinessOperation 注解
└── Day 4: Frontend AuditListPage + DiffViewer
`

### Phase 3: 工作流引擎 (约 7 天)

`
Week 3-4:
├── Day 1-3: Flyway V3 + 流程定义/实例 CRUD
├── Day 4-5: 表单集成 + FormSheet 扩展
├── Day 6: 审批处理 + 转办/退回
└── Day 7: 时间线视图 + 统计面板
`

### Phase 4: 联调优化 (约 3 天)

`
Week 4:
├── Day 1-2: 端到端场景测试 (采购审批全流程)
└── Day 3: 性能调优 + 文档完善
`

---

## 📊 核心数据表一览

| 表名 | 所在模块 | 用途 |
|------|---------|------|
| sys_message | mis-notification | 消息主表 |
| sys_task | mis-notification | 代办任务表 |
| sys_biz_reference | mis-notification | 业务关联桥接 |
| sys_oper_log | mis-audit (已有) | HTTP 调用轨迹(保留) |
| sys_audit_op | mis-audit (增强) | 业务语义化操作 |
| wf_definition | mis-workflow | 流程定义 |
| wf_node | mis-workflow | 流程节点 |
| wf_instance | mis-workflow | 流程实例 |
| wf_task | mis-workflow | 流程任务(绑定代办) |
| wf_history | mis-workflow | 流程历史 |

---

## 🔍 快速查找

**搜索消息？** → 见 [01-message-task-design.md §4.3 Search API](./01-message-task-design.md#43-search-api)

**查看操作日志？** → 见 [02-operational-logging-design.md §六 前端审计报表](./02-operational-logging-design.md#%E5%89%8D%E7%AB%AF%E5%AE%A1%E8%AE%A1%E6%8A%A5%E8%A1%A8%E8%AE%BE%E8%AE%A1)

**表单加工作流？** → 见 [03-workflow-integration-design.md §六.1 FormSheet 扩展](./03-workflow-integration-design.md#%E5%87%BD%E5%BC%8Fformsheet-%E4%B8%8A%E6%89%A9%E5%B1%95)

**审批人在哪处理？** → 见 [03-workflow-integration-design.md §六.2 审批中心页面](./03-workflow-integration-design.md#%E5%AE%A1%E6%89%B9%E4%B8%AD%E5%BF%83%E9%A1%B5%E9%9D%A2)

**三种消息模式对比？** → 见 [01-message-task-design.md §2.1 关系说明](./01-message-task-design.md#21-%E4%B8%89%E5%AE%9E%E4%BD%93%E5%85%B3%E7%B3%BB)

**无工作流的表单？** → 见 [03-workflow-integration-design.md §2.1 模式 A](./03-workflow-integration-design.md#21-%E4%B8%89%E7%A7%8D%E4%B8%9A%E5%8A%A1%E6%A8%A1%E5%BC%8F)