# WrenAI 对接部署速查（规划版）

> 文档角色：`architecture.md §3.1` 的展开速查（规划阶段口径）。**实现期**以 `agent/ai-platform/deploy/wrenai/README.md` 为准，该 README 在 W0 实测时建立并钉入实测版本号。
> 状态：🔴 已修订（v1.9：A1 改判——问数配置落 `mis_platform` + Java 侧 `backend/mis-tqd` + Worker `TqdConfigClient` API+缓存消费；命名统一——平台问数业务域用 `tqd`，对接外部 WrenAI 适配层保留 `wren`）｜日期：2026-08-22｜语言：中文
> ✅ 本文档由主理人按架构师 v1.1 既定口径补完，架构师已于 2026-08-22 复核通过（见 docs/ai-fusion/wrenai/architecture.md v1.2 §4.2.1 权限方案全景）。

## 0. 版本钉位（决策结论）

| 项 | 值 | 说明 |
|---|---|---|
| 集成线 | **新 `wren`（wren-core）线** | `pip install wrenai` 得 `wren` CLI + wren-core（Rust/Apache DataFusion）+ 原生 MCP server；**弃用**经典 wren-ui + wren-ai-service + wren-engine 三服务 Docker 栈为主路径 |
| 组件版本 | **`wren: v0.13.3`**（2026-08-18，GitHub Latest） | 以 `wren --version` 实测为准 |
| 项目版本 | **`0.29.2`**（2026-08-05） | 整体项目标签，参考 |
| 记录位 | `agent/ai-platform/deploy/wrenai/README.md` | W0 实测后写入实测版本号与 MCP 工具清单 |

> 决策依据：`enable_column_pruning` 为旧 REST 线 0.22.0（2025-04）加入；2026 年主线已换代到 wren-core + MCP。**角色→表权限与版本无关**（两代均无「按角色限表」原生入口，由平台 `mis-tqd` Worker 双闸门兜底，见 `architecture.md §2 D2`）。
>
> 注（日期口径）：`architecture.md` / `README.md` 简写「2026-08-18」指 **`wren` 组件**（v0.13.3）的发布日期；整体项目标签 `0.29.2` 为 2026-08-05。两者是同一钉位的两个粒度，无冲突。

## 1. 安装与初始化（W0 实测脚本，单机）

```bash
# 1) 安装（钉版本，以 PyPI 实际可用版为准，安装后 wren --version 核对）
pip install 'wrenai[mcp]'

# 2) 连接 profile：业务数据源凭证只注入本机 profile（server-side），不落平台库、不落前端
wren profile add --help          # 查看字段（host/port/user/password/database/dataSource…）
wren context set-profile <名称>

# 3) MDL 构建/部署（替代旧 REST /v1/mdl/deploy；管理面走本地 CLI，不走 MCP 写）
#    平台编辑 MDL 文件（agent/ai-platform/deploy/wrenai/mdl/）→
wren context build

# 4) 启动 MCP server（本地 HTTP，服务端本机）
wren serve mcp --transport http --host 127.0.0.1 --port 8080
#    --no-connect  仅转译/模式工具，不触库（run_sql/dry_run/query_cube 禁用）
#    --allow-write 才开放 store_query 等写工具（本期默认不开）
```

## 2. MCP server 工具面（规划版清单，以实测为准）

- **查询/执行**：`run_sql`、`dry_run`、`dry_plan`、`query_cube`
- **语义/清单**：`get_mdl`、`list_models`、`describe_model`、`get_data_source`、`list_cubes`、`describe_cube`、`list_functions`、`describe_schema`
- **知识/引用**：`get_instructions`、`recall_queries`、`get_context`、`list_stored_queries`、`list_knowledge`
- **资源/提示**：`wren://mdl`、`wren://instructions`、`wren://project`、`wren://knowledge/{path}`；`wren_workflow` 提示

> `tqd_mcp_client.py` 将工具名抽成**模块常量**，升级只改常量（对齐 `kb_client.py` 范式）。

## 3. 安全约束（官方，前端不直连的兜底依据）

| 约束 | 值 | 含义 |
|---|---|---|
| 绑定 | 默认 **127.0.0.1** | 仅本机/同网络可达，**不可对终端用户开放** |
| 鉴权 | **本版本无 bearer-token** | 暴露即裸奔 → 必须由服务端 `mis-tqd` Worker 本地持有 MCP client |
| 写权限 | **默认只读**（`--allow-write` 才开） | `store_query` 等写工具默认不可用 |
| 凭证 | **server-side**（profile 注入，启动时解析一次） | 跨 MCP 边界只过 SQL 文本 / 结果 / 元数据 |
| 知识资源 | 路径逃逸防护 | `wren://knowledge/{path}` 越界即拒 |

> **结论**：前端/用户端**绝不直连 MCP**；MCP client 一律由 `mis-tqd` Worker 在服务端本机持有（见 `architecture.md §2 D4`）。

## 4. 与 `mis-tqd` Worker 的部署关系

```
前端 → BFF(/api/v1/tqd/** 仅平台 tqd_* 表，mis_platform 库，Java 侧 backend/mis-tqd 管理) → mis-copilot Coordinator → mis-tqd Worker
                                                                          │ 本地 MCP client (HTTP @127.0.0.1:8080)
                                                                          │ TqdConfigClient → /internal/v1/tqd/**（配置 API+缓存，v1.9）
                                                                          ▼
                                                              wren serve mcp / wren-core
                                                                          │ profile 注入凭证
                                                                          ▼
                                                                      业务库（网络可达）
```

- `wren serve mcp` 与 `mis-tqd` Worker **同机/同网络**部署（localhost http，数据不出域）。
- Worker **不直连业务库**：只经 MCP 工具拿 SQL/结果文本，血缘解析只解析 SQL 文本不执行；执行一律由 wren-core 完成。
- **Worker 不直连 mis_platform 平台库（v1.9）**：配置（连接/ACL/维度注册表/脱敏规则/字典同步状态）经 `TqdConfigClient` 调 `backend/mis-tqd` 的 `TqdInternalController` `/internal/v1/tqd/**` 读取 + 本地缓存（启动全量 + 变更事件 + 每日兜底；缓存不可得 fail-closed 45204），对齐 `kb_client.py` 范式（见 architecture.md §4.2.2 D.7.3）。
- BFF 的 `/api/v1/tqd/**` 仅管理平台自身 `tqd_*` 表（连接配置/清单/ACL/样本/知识/审计，落 `mis_platform` 库），**与 WrenAI 无直接网络关系**。
- **命名边界（v1.9）**：平台问数业务域一律 `tqd`（项目 `mis-tqd`、表 `tqd_*`、API `/api/v1/tqd/**`、Worker 配置 `configs/agents/mis-tqd/**`）；**对接外部 WrenAI 产品的适配层保留 `wren`**——`wren serve mcp` / `wren profile` / `wren context build` 命令、Nacos 配置键 `wren_mcp_host`/`wren_mcp_port`/`wren_mcp_transport`/`wren_mcp_allow_write`/`wren_cli_bin`/`wren_profile_name`/`wren_timeout_seconds`/`wren_language`、PyPI 包 `wrenai`、外部部署目录 `deploy/wrenai/`、表内外部引用字段 `tqd_sql_pair.wren_ref_id` / `tqd_ask_log.wren_status_trail`、`WRENAI_*` 错误码常量均保留（详见 architecture.md §1.5/§3.3 命名边界）。

## 5. 待核实项（W0 实测时确认）

- [ ] `wren --version` 实测版本号，钉入 `agent/ai-platform/deploy/wrenai/README.md`
- [ ] `wren serve mcp --transport http` 实际暴露的工具清单（尤其 `get_context`/`recall_queries`/`list_knowledge` 是否给出**原生引用**，决定 Q5 归一化走法）
- [ ] `wren context build` 跑通 MDL 构建；wren-ui 是否随包发布（A3：建模入口 = 平台编辑 MDL JSON + `wren context build`，还是 wren-ui）
- [ ] 单 project 多 connector 跨源 join 能力（Q10，决定一期是否多库可问）

## 6. 版本升级策略

1. 升级前：`wren --version` 记录旧版 → 升级 → 记录新版。
2. 跑一遍 §1 四步初始化 + §5 核对清单（工具面变化）。
3. 只改 `tqd_mcp_client.py` 工具常量与 `deploy-tqd.md` 版本记录位，**不动上层契约**（`AskResult` / 引用结构 / 步骤化计划）。
