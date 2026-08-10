# RAGFlow 能力探测记录（T00）

- **项目**：`kb_settings_model_chunk`
- **执行人**：寇豆码（软件工程师）
- **日期**：2026-08-10
- **目标实例**：`http://10.254.16.6:9380`（远程 RAGFlow）
- **API Key**：取自 `deploy/nacos-config/integration/mis-kb.yaml`（`MIS_KB_ENGINE_API_KEY`，服务端持有，不入 Git）
- **用途**：作为 T02/T03/T04 实现依据，固化接口路径 / 字段名 / id 格式 / 两步式语义

> 探测命令均为 curl 原文（已脱敏 API Key），可复跑复核。

---

## 1. 探测清单与结论

| # | 探测项 | 结论 | 影响实现的决策 |
|---|---|---|---|
| P1 | 模型列表接口路径与字段 | **`GET /api/v1/models`**（`/api/v1/llm/list` 等均 404）；响应字段为 `name` / `model_type`(数组) / `provider_name` / `instance_name` / `provider_id` / `instance_id`；embedding 分类码值 `["embedding"]`、rerank 分类码值 `["rerank"]`；**无** `dimension`/`language` 字段 | `RfModel` 按实际字段建模；`RagflowClient.listModels()` 走 `/api/v1/models`；`EngineModel.dimension/language` 留空（列表接口不提供） |
| P2 | embedding id 格式 | **必须全限定** `name@provider@provider`（如 `text-embedding-v3@Tongyi-Qianwen@Tongyi-Qianwen`）；裸名 `text-embedding-v3` → `code:101 "Embedding model identifier must follow <model_name>@<provider> format"` | 模型池返回的 embedding id = `name@instance_name@provider_name` 全限定拼接；创建向导下拉提交该 id |
| P3 | 文档级 PUT 配置 | `PUT /api/v1/datasets/{id}/documents/{docId}` body `{"chunk_method":"naive","parser_config":{"chunk_token_num":256,"delimiter":"###"}}` → **code:0 接受**；键名是 **`chunk_token_num`**（非 `chunk_token_count`）；`parser_config` 内未知键 → `code:102 "Extra inputs are not permitted"`（严格）；**顶层**多余键（如 `top_k`）被静默忽略（code:0） | 文档级 PUT 只下发白名单键 `chunk_method` + `parser_config{chunk_token_num, delimiter}`；键名用 `chunk_token_num` |
| P4 | rerank 全限定格式 | 裸名 `qwen3-rerank` → `code:100 "Provider not found for model qwen3-rerank."`；全限定 `qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen` → code:0 | 与 B3 结论一致：rerank id 必须 `name@provider@provider`；模型池 rerank id 即该格式 |
| P5 | 两步式触发 | 文档 PUT 配置后 `run` 仍为 `UNSTART`（**不自动重解析**）；显式 `POST /api/v1/datasets/{id}/chunks {"document_ids":[...]}` 后 `run=DONE / chunk_count=1` | 上传/改参链路必须「PUT 文档配置 → 显式 POST /chunks」两步式；PUT 后不自动重解析 |

---

## 2. 探测原文（curl + 响应节选）

### 2.1 P1 模型列表

```bash
# 候选路径探测（仅列出有响应者）
curl -s -H "Authorization: Bearer $KEY" http://10.254.16.6:9380/api/v1/models
```

响应（节选，embedding/rerank 条目）：

```json
{"code":0,"data":[
  {"instance_id":"e241d...","instance_name":"Tongyi-Qianwen","model_type":["embedding"],
   "name":"text-embedding-v2","provider_id":"e1b8a...","provider_name":"Tongyi-Qianwen"},
  {"instance_id":"e241d...","instance_name":"Tongyi-Qianwen","model_type":["embedding"],
   "name":"text-embedding-v3","provider_id":"e1b8a...","provider_name":"Tongyi-Qianwen"},
  {"instance_id":"e241d...","instance_name":"Tongyi-Qianwen","model_type":["rerank"],
   "name":"gte-rerank","provider_id":"e1b8a...","provider_name":"Tongyi-Qianwen"},
  {"instance_id":"e241d...","instance_name":"Tongyi-Qianwen","model_type":["rerank"],
   "name":"qwen3-rerank","provider_id":"e1b8a...","provider_name":"Tongyi-Qianwen"}
]}
```

- 404 的候选：`/api/v1/llm/list`、`/api/v1/llm/`、`/api/v1/llm`、`/api/v1/system/llm`、`/api/v1/llms`、`/api/v1/model/list`。

### 2.2 P2 embedding id 格式

```bash
curl -s -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"embedding_model":"text-embedding-v3"}' \
  http://10.254.16.6:9380/api/v1/datasets/96622574946d11f1b45c7dc3cecfbcd9
# {"code":101,"message":"Field: <embedding_model> - Message: <Embedding model identifier must follow <model_name>@<provider> format> - Value: <text-embedding-v3>"}

curl -s -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"embedding_model":"text-embedding-v3@Tongyi-Qianwen@Tongyi-Qianwen"}' \
  http://10.254.16.6:9380/api/v1/datasets/96622574946d11f1b45c7dc3cecfbcd9
# {"code":0,"data":{...,"embedding_model":"text-embedding-v3@Tongyi-Qianwen@Tongyi-Qianwen",...}}
```

### 2.3 P3 文档级 PUT 配置

```bash
curl -s -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"chunk_method":"naive","parser_config":{"chunk_token_num":256,"delimiter":"###"}}' \
  http://10.254.16.6:9380/api/v1/datasets/96622574946d11f1b45c7dc3cecfbcd9/documents/9d3c9f6e946d11f1b45c7dc3cecfbcd9
# {"code":0,"data":{...,"chunk_method":"naive","parser_config":{...,"chunk_token_num":256,"delimiter":"###",...}}}

# parser_config 内未知键（严格）
curl -s -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"parser_config":{"chunk_token_count":256}}' \
  http://10.254.16.6:9380/api/v1/datasets/96622574946d11f1b45c7dc3cecfbcd9/documents/9d3c9f6e946d11f1b45c7dc3cecfbcd9
# {"code":102,"message":"Field: <parser_config.chunk_token_count> - Message: <Extra inputs are not permitted> - Value: <256>"}

# 顶层多余键（静默忽略，不报错）
curl -s -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"chunk_method":"naive","top_k":5}' \
  http://10.254.16.6:9380/api/v1/datasets/96622574946d11f1b45c7dc3cecfbcd9/documents/9d3c9f6e946d11f1b45c7dc3cecfbcd9
# {"code":0,"data":{...}}  # top_k 被忽略；parser_config 未携带时回落 dataset 当前快照
```

### 2.4 P4 rerank 全限定格式

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  --data-binary '{"question":"test","dataset_ids":["96622574946d11f1b45c7dc3cecfbcd9"],"rerank_id":"qwen3-rerank"}' \
  http://10.254.16.6:9380/api/v1/retrieval
# {"code":100,"data":null,"message":"LookupError('Provider  not found for model qwen3-rerank.')"}

curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  --data-binary '{"question":"test","dataset_ids":["96622574946d11f1b45c7dc3cecfbcd9"],"rerank_id":"qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen"}' \
  http://10.254.16.6:9380/api/v1/retrieval
# {"code":0,"data":{"chunks":[],"doc_aggs":[],"total":0}}
```

### 2.5 P5 两步式触发

```bash
# ① PUT 配置后（未 POST /chunks）：run 仍 UNSTART，chunk_count=0
# ② 显式 POST /chunks 后：run=DONE，chunk_count=1
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"document_ids":["9d3c9f6e946d11f1b45c7dc3cecfbcd9"]}' \
  http://10.254.16.6:9380/api/v1/datasets/96622574946d11f1b45c7dc3cecfbcd9/chunks
# {"code":0}
```

---

## 3. 对设计文档 §7.3 的修订

> 以下修订已由 T00 实测固化，实现按此执行；设计文档 §3.2.3 / §3.2.7 以本节为准。

1. **模型列表接口**：`GET /api/v1/models`（不是 `/api/v1/llm/list`）。`RfModel` 字段：
   `name` / `model_type`(List&lt;String&gt;) / `provider_name` / `instance_name`（T00 实测）。
   分类：`model_type.contains("embedding")` / `model_type.contains("rerank")`。
   `dimension` / `language` 列表接口不提供 → `EngineModel` 这两个字段保持 null。
2. **id 全限定拼接**：embedding 与 rerank 均用
   `name + "@" + instance_name + "@" + provider_name`（本实例三者为 `xxx@Tongyi-Qianwen@Tongyi-Qianwen`）。
   `RagflowClient` 内负责拼接，`RfModel` 只承载原生字段。
3. **文档级 PUT 白名单**：`chunk_method`（顶层）+ `parser_config{chunk_token_num, delimiter}`。
   `parser_config` 严格（未知键 code:102）；顶层多余键静默忽略，但仍只下发白名单键（防御性）。
4. **两步式语义**：上传/改参后必须显式 `POST /chunks` 才重解析；PUT 文档配置本身不触发。
