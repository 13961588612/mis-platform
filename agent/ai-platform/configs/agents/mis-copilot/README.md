# mis-copilot 配置导读

平台按固定路径加载，**不要随意改名/挪文件**。

| 文件 | 职责 |
|------|------|
| `agent.yaml` / `metadata.yaml` | 身份与展示 |
| `coordination.yaml` | **可派 Worker 真相源**、硬委派/透传、超时 |
| `intent-router.yaml` | 规则兜底 + JEV（选人预路由） |
| `template-report-router.yaml` | 已停用；逻辑在 Worker `template-report` |
| `runtime/runtime.yaml` | 工具白名单 / excludeLlmTools |
| `runtime/prompts/system.md` | 纪律骨架；`{{DELEGATION_WORKER_TABLE}}` 运行时注入 |
| 各 Worker `metadata.yaml` → `when_to_use` | 意图表「何时委派」文案来源 |
| `system/model.yaml` | 主模型 |
| `memory/*` | 短人格 |
| `skills/enabled-skills.yaml` | 保持空 |

## 选人与双写

1. 详情页勾选 → `coordination.worker_ids`（硬闸）  
2. 运行时 system prompt 意图表 = **worker_ids ∩ Catalog** + 各 Worker `when_to_use`（自动生成）  
3. 选人预路由：`intent-router.yaml`（规则 / JEV）→ `hard_dispatch_workers` **硬委派**（跳过 LLM）  
4. 未硬委派 → Coordinator LLM **只调** `coordinator__decide`（`agent__invoke` 对 LLM 隐藏）  
5. `action=route` → 系统执行 `agent__invoke` 并结束本轮；clarify/refuse/chitchat 短文收口  

**不要**再在 `system.md` 手写死 Worker 列表；改名单或 `when_to_use` 后重载配置即可。
