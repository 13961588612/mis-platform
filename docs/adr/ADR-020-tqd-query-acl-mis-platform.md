# ADR-020: 问数（mis-tqd）ACL 等配置落 mis_platform、对齐 mis_kb 项目范式

## 状态

已接受 | 2026-08-22（A1 业务改判，主理人记录）——**替代 [ADR-019](ADR-019-wren-query-acl-ai-platform.md)**

## 背景

MIS 平台对接 WrenAI 问数 APP（规划见 `docs/ai-fusion/wrenai/`，v1.9 起项目名 **`mis-tqd`**、表前缀 **`tqd_`**）需要存放表级 ACL、维度注册表、连接/数据源、样本/知识、脱敏规则、问数审计等问数配置数据。落库位置在 [ADR-019](ADR-019-wren-query-acl-ai-platform.md) 曾裁定落 `ai_platform` 库（Python 侧统一管理）。

**2026-08-22 业务改判（主理人记录，用户原话）**：问数配置表**不落 ai_platform 库，改落 `mis_platform` 库**，对齐 **mis_kb 项目范式**（kb 开头的表在 mis_platform 库）；项目名定为 **`mis-tqd`**（类似 mis_kb）、表前缀 **`tqd_`**（替代全文档 `wren_*` 表名）。

## 决策

1. **问数配置落 `mis_platform` 库（PostgreSQL，表前缀 `tqd_`）**：表级 ACL（`tqd_table_acl`）、维度注册表（`tqd_row_scope_dimension`）、连接（`tqd_connection`）、数据源（`tqd_datasource`）、MDL 快照、内容清单、范围策略、样本/知识、脱敏规则、问数审计（`tqd_ask_log`）等全部落 mis_platform 库，**与 `kb_*` 表同库并列、互不冲突**（tqd_ = 问数域表前缀，kb_ = 知识库域表前缀，两者均在 mis_platform 库）。
2. **新建 Java 领域服务 `mis-tqd`（对齐 mis_kb 模块形态）**：`backend/mis-tqd` 独立模块，`api/controller` + `api/dto` + `domain/entity`（JPA `@Table(name="tqd_*")`）+ `domain/repository` + `domain/service`，与 mis-kb 结构一致；Flyway 迁移追加在 `backend/mis-migrator`（`V69__tqd_menu_api_seed.sql` 权限码种子 + `V71__tqd_schema.sql` 业务表与维度种子）。
3. **BFF 对外门面 `/api/v1/tqd/**`（对齐 `/api/v1/kb/**`）**：BFF 对外不再用 `wrenai` 品牌命名空间，权限码统一 **`tqd:*`**（config/catalog/scope/acl/enhance/test/trace）；BFF 经 HTTP 调 mis-tqd Java 服务；Python 侧 Worker 经 `TqdConfigClient`（对齐 `kb_client.py` 范式）调 mis-tqd **配置读取 API**（`/internal/v1/tqd/**`），**Worker 不直连 mis_platform 库**。
4. **权限裁定仍在领域服务层**：`scope_resolver.py` 负责表级 ACL 二次裁定与行级注入（fail-closed 语义不变），只是**配置数据源从「同进程读 ai_platform 库」改为「经 BFF/Java 侧配置读取 API + Worker 本地缓存 + 变更事件/定期刷新」**。
5. **命名边界（防混淆铁律）**：平台问数业务域全部用 `tqd`（项目/表/API/权限码/模块）；**对接外部 WrenAI 产品的适配层保留 `wren`**——`wren` CLI、`wren serve mcp`、`wren profile`、`wren context build` 命令，`wren_mcp_host/port` 等 Nacos 配置键，`WrenMcpClient`/`wren_mcp_client.py`、`WrenCli`/`wren_cli.py` 适配器，`WrenAI` 品牌名。**保留 wren 的是「外部系统名」，改 tqd 的是「平台问数业务域」**。

## 依据

- ① **业务改判（用户原话）**：类似 mis_kb 项目，kb 表在 mis_platform；问数项目 mis-tqd 对齐——平台配置类数据（权限、连接、审计）统一收口 mis_platform 库，问数与知识库同范式，运维与治理口径一致。
- ② **对齐 mis_kb 项目范式**：`kb_*` 表在 mis_platform 库（V12__kb_schema.sql 明确 `PostgreSQL 16 | 库名: mis_platform`）；mis-kb 为独立 Java 模块（controller/service/repository/entity 分层）；Flyway 集中在 `backend/mis-migrator`；BFF 对外 `/api/v1/kb/**`；Python 侧经 `kb_client.py` 调 `/internal/v1/kb/**`。mis-tqd 完全对齐该形态，消除 ADR-019「与 KB 范式不一致」的负面项。
- ③ **配置消费路径补偿**：原「Worker 同进程读库、热路径零跨服务」优势因落库改道而消失，改用 **API + 缓存**方案（详见 architecture.md §1.5 / §4.2.2 D.7.3）：BFF/Java 侧提供配置读取 API（对齐 kb_client 范式），Worker 本地缓存（连接自检/启动时加载 + 变更事件 + 每日定期刷新兜底），缓存不可得 → fail-closed `45204`；权限裁定仍在 Worker `scope_resolver`，双闸门语义不变。
- ④ **不选 Worker 只读直连 mis_platform 库**：需引入 DB 驱动、持有库只读账号（安全面扩大）、与「Worker 不直连库」既有约束冲突、跨服务一致性靠库本身（无缓存层、无变更事件）、运维成本高；API + 缓存与 mis-kb 的 mis-rag 交互范式一致，一致性与可维护性最优。

## 备选方案

- **维持 ADR-019 落 ai_platform（否决）**：与业务拍板相悖；平台配置类数据分散两库（ai_platform + mis_platform），治理口径分裂；与 mis_kb 范式不一致。
- **Worker 只读直连 mis_platform 库（否决）**：热路径延迟最低，但引入 DB 驱动/只读账号/跨服务边界，安全与运维成本高，与既有「Worker 不直连库」约束冲突；且无法获得 Java 侧变更事件与统一缓存语义。
- **BFF 中转 + 无缓存逐次拉取（否决）**：每次问数跨 HTTP 拉配置会把 P99 拉高一个数量级（ADR-019 依据①仍成立），故必须 Worker 本地缓存。

## 后果

- **正面**：问数配置（tqd_*）与知识库配置（kb_*）同库（mis_platform）同范式，治理口径统一；Java 侧统一管理（实体/Service/Flyway），审计口径与平台一致；BFF 权限码 `tqd:*` 与 `/api/v1/tqd/**` 命名自洽；Worker 权限裁定（scope_resolver + fail-closed 45204）语义不变，双闸门不破。
- **负面**：原「热路径零跨服务」优势不再，改为「配置读取 API + Worker 本地缓存 + 变更事件/定期刷新」——需实现配置缓存与失效机制（约 0.5–1 人日增量）；mis-tqd 需按 mis-kb 全套分层实现（Flyway + JPA + 服务 + 控制器），比「Python 侧 create_all」重，但与 KB 范式一致、一次性投入。

## 待确认

- 无（A1 改判已由业务拍板，2026-08-22）。关联执行期确认项（A2/A3/A6/A7/A8/A9/A10）见 `architecture.md §8`；维度注册表一期（dept/store 双维度）与门店维度实例化见 `architecture.md §4.2.2 D.8/D.9`。

## 关联

- **被替代**：[ADR-019](ADR-019-wren-query-acl-ai-platform.md)（原裁定落 ai_platform，2026-08-22 已替代）
- 完整规划：`docs/ai-fusion/wrenai/architecture.md` §8 A1（改判记录，v1.9）、§1.5（数据落库位置决策）、§4.2.2 D.7/D.8/D.9（行级权限数据放置与维度扩展）
- 任务分解：`docs/ai-fusion/wrenai/tasks.md` T-W2-01（表级 ACL，v1.9：mis_platform + tqd_ 表 + Java 侧实现）、T-W2-02a/b（维度注册表驱动 + dept/store 双维度）
- 对照范式：[ADR-018](ADR-018-knowledge-base-mis-kb.md)（mis-kb 独立 Java 模块、kb_* 表落 mis_platform 库）
