# RAGFlow GraphRAG 能力探测记录（Wave B · T00）

- **项目**：`kb_wave_b_graphrag`
- **执行人**：高见远（软件架构师）
- **日期**：2026-08-11
- **目标实例**：`http://10.254.16.6:9380`（远程 RAGFlow，`deploy/ragflow/.env.example` 标注 v0.26.4）
- **API Key**：取自仓库根 `.env.integration`（`MIS_KB_ENGINE_API_KEY`，服务端持有，不入 Git，本文脱敏）
- **用途**：作为 Wave B GraphRAG PoC 设计/实现依据，固化「构图配置键 / 构图触发 / 状态查询 / 图谱增强检索 / 与 document_ids 共存」五组契约

> 探测命令均为 curl 原文（API Key 已省略），可复跑复核。延续 `docs/backend/ragflow-capability-probe-2026-08-10.md` 的 T00 范式。

---

## 1. 探测清单与结论

| # | 探测项 | 结论 | 影响实现的决策 |
|---|---|---|---|
| G1 | 实例是否支持 GraphRAG / 配置键名 | **支持**。dataset 响应含 `parser_config.graphrag` 对象与 `graphrag_task_id` / `graphrag_task_finish_at` 字段；启用键是 **`parser_config.graphrag.use_graphrag`**（布尔）+ `method`（`light`/`graph`）+ `entity_types`（可选）。**不是**顶层 `use_kg` | `RagflowClient.updateDatasetSettings` 在建库/更新时下发 `parser_config.graphrag{use_graphrag, method, entity_types}`；`EngineCapabilities.graphrag` 声明为 true |
| G2 | 构图触发方式 | **`POST /api/v1/datasets/{id}/index?type=graph`**（query 参数 `type` 的合法值是 **`graph`**，不是 `graphrag`——传 `graphrag` 返回 code:102 `Invalid index type`）。成功返回 `{"code":0,"data":{"task_id":"..."}}`；已有进行中任务（progress ∉ {-1,1}）拒绝二次触发 | `RagflowClient.buildGraph(datasetId)` 走 `POST .../index?type=graph`；`type=graph` 内部映射任务类型 `graphrag` |
| G3 | 构图状态查询端点 | **`GET /api/v1/datasets/{id}/index?type=graph`** → `{"code":0,"data":{task dict}}`；无任务时 `data={}`。task dict 含 `progress`（**1.0=完成 / -1=失败 / 其他=构建中**）、`progress_msg`（构建日志）、`task_type="graphrag"`、`process_duration`、`create_time` 等。dataset 级 `graphrag_task_id` + `graphrag_task_finish_at` 作佐证 | `RagflowClient.queryGraphBuildStatus(datasetId)` 走 `GET .../index?type=graph`；MIS 映射 progress→kgBuildStatus（1→ready / -1→failed / 其他→building） |
| G4 | 构图实测（小库） | probe 库（2 chunks、method=light）触发后 **~9 秒完成**（progress 1.0，`process_duration: 8.85`）；`GET /api/v1/datasets/{id}/graph` 返回 nodes/edges（实体 RAGFLOW / MIS KNOWLEDGE BASE 等） | 构图链路可端到端验证；大库耗时未知（风险 R4），状态必须轮询 + 异步 |
| G5 | 图谱增强检索参数 | **必须走 `POST /api/v1/datasets/search`（多库）或 `POST /api/v1/datasets/{id}/search`（单库）**，请求体带 **`use_kg: true`**。经典 `POST /api/v1/retrieval` **不支持** `use_kg`（v0.26.4 顶层未知字段被 pydantic 静默忽略 = 陷阱：看似 code:0 实则无增强） | `RagflowAdapter.retrieve` 按 `useKnowledgeGraph` 分流：false→保持 `/api/v1/retrieval`（零回归）；true→改走 `/datasets/{id}/search`（单库） |
| G6 | 与 document_ids 共存 | `/datasets/search` 的文档过滤字段是 **`doc_ids`**（**不是** `document_ids`），与 `use_kg` 同请求体共存 ✓；传不存在的 `doc_ids` → code:0 空结果（软过滤，**无** `/retrieval` 的 code:102 硬校验） | 图谱增强与 KE-08/KE-09 文档/时间过滤可叠加；适配器把 MIS `documentIds` 解析后放进 `doc_ids` |
| G7 | 响应结构差异 | `/datasets/search` 响应 `data={chunks[], doc_aggs?, labels?, total=len(chunks)}`；chunk 字段：`content_with_weight`（正文，**含 `<weight>` 标记需剥离**）、`docnm_kwd`（文档名）、`doc_id`、`similarity`、`kb_id`、`chunk_id`——**与 `/api/v1/retrieval` 的 `content`/`document_keyword` 不同** | 新增 `RfSearchChunk` DTO + 适配层映射；chunkText 用剥离标记后的 `content_with_weight` |
| G8 | 多库限制 | `/datasets/search` 多库要求**所有库同一 embedding_model**（源码校验）；单库 `/datasets/{id}/search` 无此限制 | 图谱增强**仅单库生效**；多库检索自动回落 hybrid-only + degradedReason |
| G9 | use_kg 降级 | 图未建 / 图谱检索无结果时 `use_kg:true` 正常返回普通 chunks（KG 失败记服务端 warning，不报错） | 检索期不强校验 kgBuildStatus，但命中测试回显实际生效状态供对比 |

---

## 2. 探测原文（curl + 响应节选）

### 2.1 G2 构图触发（合法值是 `graph`）

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" \
  "http://10.254.16.6:9380/api/v1/datasets/6e74b5fe948111f1b45c7dc3cecfbcd9/index?type=graph"
# {"code":0,"data":{"task_id":"987fa14c959411f1b45c7dc3cecfbcd9"}}

# 传 graphrag 被拒（关键坑）
curl -s -H "Authorization: Bearer $KEY" \
  "http://10.254.16.6:9380/api/v1/datasets/6e74b5fe948111f1b45c7dc3cecfbcd9/index?type=graphrag"
# {"code":102,"message":"Invalid index type 'graphrag'. Must be one of ['artifact', 'graph', 'mindmap', 'raptor', 'skill']"}
```

### 2.2 G3 状态查询（progress 语义）

```bash
# 触发后立即查 → 构建中
curl -s -H "Authorization: Bearer $KEY" \
  "http://10.254.16.6:9380/api/v1/datasets/6e74b5fe948111f1b45c7dc3cecfbcd9/index?type=graph"
# {"code":0,"data":{"progress":0.0823383,"task_type":"graphrag",...,"progress_msg":"22:54:47 created task graphrag\n22:54:50 Task has been received.","create_time":1786460087141,"update_time":1786460091606,...}}

# ~1.5 分钟后 → 完成
# {"code":0,"data":{"progress":1.0,"task_type":"graphrag","progress_msg":"22:54:47 created task graphrag\n22:54:50 Task has been received.\n22:54:51 [GraphRAG] dataset:6e74b5fe948111f1b45c7dc3cecfbcd9 | process_duration: 8.85292",...}}

# dataset 级佐证：graphrag_task_id / graphrag_task_finish_at
# graphrag_task_id: 987fa14c959411f1b45c7dc3cecfbcd9 | graphrag_task_finish_at: 2026-08-11T22:54:56
```

### 2.3 G5/G6 图谱增强检索 + 与 doc_ids 共存

```bash
# 多库 + use_kg + doc_ids 共存（合法 doc → 命中；不存在 doc → code:0 空结果）
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"dataset_ids":["6e74b5fe948111f1b45c7dc3cecfbcd9"],"question":"embedding switch","use_kg":true,"doc_ids":["79dfe5ee948111f1b45c7dc3cecfbcd9"],"size":5,"similarity_threshold":0.1}' \
  "http://10.254.16.6:9380/api/v1/datasets/search"
# {"code":0,"data":{"chunks":[{"chunk_id":"f9d91921399961f3","content_with_weight":"...","docnm_kwd":"probe-embed.txt","doc_id":"79dfe5ee948111f1b45c7dc3cecfbcd9","similarity":0.242,...}],"doc_aggs":[...],"labels":null,"total":1}}

# 单库变体
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"question":"embedding switch","use_kg":true,"doc_ids":["79dfe5ee948111f1b45c7dc3cecfbcd9"],"size":5,"similarity_threshold":0.1,"keyword":false}' \
  "http://10.254.16.6:9380/api/v1/datasets/6e74b5fe948111f1b45c7dc3cecfbcd9/search"
# {"code":0,"data":{"chunks":[...],"total":1}}
```

### 2.4 G7 响应字段对照（/retrieval vs /datasets/search）

| 字段含义 | `/api/v1/retrieval`（现状） | `/api/v1/datasets/search`（图谱增强） |
|---|---|---|
| 正文 | `content` | `content_with_weight`（含 `<weight>` 标记） |
| 文档名 | `document_keyword` | `docnm_kwd` |
| 文档 id | `document_id` | `doc_id` |
| 分数 | `similarity` | `similarity` |
| 库 id | — | `kb_id` |
| 文档过滤键 | `document_ids` | `doc_ids` |
| 图谱开关 | **不支持 use_kg**（静默忽略） | `use_kg: true` 生效 |

---

## 3. 对设计的硬约束（写回主设计文档）

1. **配置键**：启用图谱走 `parser_config.graphrag.use_graphrag`（建库/更新期），**不是**顶层 `use_kg`。
2. **构图 type 值必须是 `graph`**：`RagflowClient` 内统一常量 `INDEX_TYPE_GRAPH = "graph"`，禁止写 `graphrag`。
3. **图谱增强必须换端点**：`/api/v1/retrieval` 对 `use_kg` 静默忽略，绝不能在旧端点硬塞 `use_kg`。
4. **单库限制**：图谱增强仅单库检索生效（多库回落 hybrid-only + degradedReason）。
5. **新响应 DTO**：`RfSearchChunk` 承载 `/datasets/search` 响应，正文剥离 `<weight>` 标记后映射 `ChunkHit.chunkText`。
6. **构图异步**：大库构图耗时不可控，`kgBuildStatus` 状态机 + 前端轮询 + 失败重试。
