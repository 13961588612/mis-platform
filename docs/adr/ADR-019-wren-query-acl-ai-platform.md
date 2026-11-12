# ADR-019: WrenAI 问数 ACL 归属 ai-platform 的架构一致性裁定

## 状态

**已替代** | 原裁定 2026-08-22（A1 业务已确认，主理人记录）→ **由 [ADR-020](ADR-020-iqd-query-acl-mis-platform.md) 替代（2026-08-22 业务改判：落库改道 mis_platform，对齐 mis_kb 项目范式，项目名 mis-iqd、表前缀 iqd_）**

> **⚠️ 修订记录（2026-08-22，主理人记录）**：本 ADR 原裁定「表级 ACL 等 `wren_*` 问数配置落 `ai_platform` 库」**已被业务改判（A1 改判）**——问数配置改落 **`mis_platform` 库**，对齐 **mis_kb 项目范式**（kb 开头的表在 mis_platform 库），项目名 **`mis-iqd`**、表前缀 **`iqd_`**（替代 `wren_*`）。本文档按 ADR 惯例保留为**历史决策记录（状态=已替代）**，正文原样留存便于追溯；**当前有效决策见 [ADR-020](ADR-020-iqd-query-acl-mis-platform.md)**。关联规划文档 `docs/ai-fusion/wrenai/` 已整体修订为 v1.9（architecture.md §8 A1 改判、§4.2.2 D.7/D.8 重写、tasks.md、README.md、两张 mermaid）。

## 背景

MIS 平台对接 WrenAI 问数 APP（规划见 `docs/ai-fusion/wrenai/`）需要存放表级 ACL（`wren_table_acl`）、范围策略（`wren_scope_policy`）、样本/知识、脱敏规则、问数审计等 `wren_*` 配置数据。落库位置出现分叉：

- **mis-system（Java 领域）**：与平台既有 `sys_*` 主数据同域，但本需求**没有**对应的 Java 领域主数据。
- **ai-platform（Python）**：`mis-wren` Worker 与管理面同进程消费，问数热路径零跨服务调用。

KB 范式（[ADR-018](ADR-018-knowledge-base-mis-kb.md)）把 ACL 留在 Java 侧（`mis-kb`），是因为 KB 的 ACL 与文档主数据本就在 `mis-kb` 领域内。本需求不具备该前提：WrenAI 问数没有独立的 Java 领域服务，`wren_*` 表是问数运行时与后台管理面的共享数据。

业务已拍板（2026-08-22，主理人记录）：**表级 ACL 等 `wren_*` 问数配置落 `ai_platform` 库**。

## 决策（历史裁定，已被 ADR-020 替代）

1. **落 `ai_platform` 库（PostgreSQL，表前缀 `wren_`）**：表级 ACL、范围策略、连接/数据源、MDL 快照、内容清单、样本/知识、脱敏规则、问数审计等全部落 ai-platform（详见 `architecture.md §1.5` 数据落库位置决策）。
2. **Python 侧统一管理**：`models/wren.py`（ORM）+ `WrenAdminService`（CRUD / 同步作业 / 审计写入）。
3. **BFF 经 HTTP 读写，不新建 Java 领域服务**：`WrenAiAclController` 等经 `/api/v1/wren/**` 读写（BFF 对外 `/api/v1/wrenai/**`，对内 `/api/v1/wren/**` 一次映射，见 `architecture.md §3.3` 命名裁定）。
4. **裁定逻辑仍在领域服务层**：`scope_resolver.py` 负责表级 ACL 二次裁定与行级注入，而非 BFF/前端——**双闸门语义不变**（BFF `wrenai:*` 功能码 + Worker 侧二次裁定）。

## 依据（历史裁定，已被 ADR-020 替代）

- ① **热路径零跨服务调用**：Worker 与管理面同进程消费 `wren_*` 表；表级 ACL 每次问数都要读，若跨 HTTP 会把 P99 拉高一个数量级。
- ② **对齐既有 BFF→ai-platform 链路**：`AiPlatformClient` 已实现 identity enrichment，管理面 `/api/v1/wren/**` 已是既有通道（`architecture.md §1.3`「管理面/运行面同库不同入口」）。
- ③ **不为一张表起微服务**：本需求无 Java 领域主数据；为 ACL 新建 Java 领域服务等于为一张表起一个微服务（与 ADR-018 的差异点）。

## 备选方案（历史裁定）

- **落 mis-system 建 Java 领域服务**（否决）：为一张 ACL 表起一个微服务，需 Flyway + JPA + 服务分层全套，工作量与维护成本不成比例；且问数热路径每次读 ACL 都要跨 HTTP，P99 显著抬升。
- **落 BFF 内存**（否决）：状态不持久、多实例不一致，无法支撑「保存立即生效、无缓存」的验收要求（`architecture.md §7.9`）与审计追溯。

## 后果（历史裁定）

- **正面**：问数热路径零跨服务调用（表级 ACL 每次问数都读，Worker 与管理面同进程消费）；最小新增（复用 ai-platform 既有 `Base.metadata.create_all` 建表机制，无 Alembic 负担）；BFF 不持有权限语义，仅透传。
- **负面**：平台问数权限配置与 Java 侧主数据（`mis-system`）隔离，需经 BFF HTTP 读写——与 KB 范式（ACL 留 Java，ADR-018）不一致。

> **⚠️ 改判后（ADR-020）的后果修正**：历史「负面」项（与 KB 范式不一致）即业务改判的动因——**对齐 mis_kb 项目范式**（kb 表在 mis_platform 库）后，问数配置（iqd_* 表）与 KB 配置（kb_* 表）**同库同范式**，一致性差异消除；「热路径零跨服务」优势改为「BFF/Java 侧配置读取 API + Worker 本地缓存 + 变更事件/定期刷新」方案补偿（详见 ADR-020 与 architecture.md §1.5/§4.2.2 D.7）。

## 待确认（历史裁定）

- 无（A1 已由业务拍板，2026-08-22）。改判后见 [ADR-020](ADR-020-iqd-query-acl-mis-platform.md)。

## 关联

- **当前有效决策**：[ADR-020](ADR-020-iqd-query-acl-mis-platform.md)（问数配置落 mis_platform、项目 mis-iqd、表前缀 iqd_，2026-08-22 替代本 ADR）
- 完整规划：`docs/ai-fusion/wrenai/architecture.md` §8 A1（改判记录，v1.9）、§4.2.2 D.7/D.8（行级权限数据放置与扩展设计）
- 任务分解：`docs/ai-fusion/wrenai/tasks.md` T-W2-01（表级 ACL，v1.9 改 mis_platform + iqd_ 表 + Java 侧实现）
- 对照 ADR：[ADR-018](ADR-018-knowledge-base-mis-kb.md)（知识库 ACL 留 Java；本改判后问数 ACL 同样对齐 Java 侧范式）
