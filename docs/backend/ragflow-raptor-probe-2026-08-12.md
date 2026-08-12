# RAGFlow RAPTOR 能力探测记录（Wave C · T00）

- **项目**：`kb_wave_c_raptor`
- **执行人**：寇豆码（软件工程师）
- **日期**：2026-08-12
- **目标实例**：`http://10.254.16.6:9380`（远程 RAGFlow v0.26.4）
- **API Key**：取自 `.env.integration`（`MIS_KB_ENGINE_API_KEY`，服务端持有，不入 Git，本文脱敏为 `$KEY`）
- **用途**：作为 Wave C RAPTOR/TOC PoC 设计/实现依据，固化「parser_config.raptor 字段白名单与校验范围 / 构建任务触发与状态 / 检索融合路径 / 响应字段差异」四组契约
- **前置文档**：`docs/backend/mis-kb-wave-c-independent-analysis-2026-08-12.md`（§1.4 条件 C1/C2、§2.0 参数口径差异表）

> 探测命令均为 curl 原文（API Key 已省略为 `$KEY`），可复跑复核。延续 `docs/backend/ragflow-graphrag-probe-2026-08-11.md` 的 Wave B T00 范式。
> 环境备注：本机 Git Bash 的 `curl -F` multipart 上传到远程实例时连接被拒（HTTP:000 TIME:0.000s，GET/PUT JSON 均正常），改用 Python `urllib` multipart 上传成功——上传类探测需走 Python 或其它客户端。

---

## 1. 探测清单与结论总表

| # | 探测项 | 结论 | 影响实现的决策 |
|---|---|---|---|
| P1a | `parser_config.raptor` 字段白名单 | **11 个可下发字段**：`use_raptor`(bool) / `max_token`(int) / `threshold`(float) / `max_cluster`(int) / `prompt`(str) / `random_seed`(int) / `clustering_method`(enum) / `scope`(enum) / `tree_builder`(enum) / `auto_disable_for_structured_data`(bool) / `ext`(dict)。建库默认：`use_raptor=false, max_token=256, threshold=0.1, max_cluster=64, random_seed=0, clustering_method=gmm, scope=file, tree_builder=raptor, auto_disable_for_structured_data=true` | `RagflowClient.updateDatasetSettings` 建库/更新时下发 `parser_config.raptor{...}`；字段名以本文实测白名单为准（**`random_seed` 不是官方文档的 `seed`**） |
| P1b | **max_token 真实校验范围** | **合法区间 `[1, 2048]`**。256/512/1024/2048 → code:0；**4096 → code:101** `Field: <parser_config.raptor.max_token> - Message: <Input should be less than or equal to 2048>`；0/-1 → code:101 `Input should be greater than or equal to 1`。默认值 256（建库默认，PUT 不传保持原值） | **用户期望 4096 被引擎拒**；MIS 范围收窄为 **[512, 2048]** 或适配层 clamp（见 §3）；超限报 code:101 而非 102 |
| P1c | raptor + graphrag 共存 | **可共存**：同一 parser_config 内 `raptor.use_raptor=true` + `graphrag.use_graphrag=true` → code:0，回读确认双 true | Wave C 与 Wave B 共存前提成立；`useRaptor` 与 `useKnowledgeGraph` 可同时为 true |
| P1d | parser_config 未知键 | 顶层未知键（`foo`）→ **code:101** `Extra inputs are not permitted`（pydantic extra=forbid） | **⚠️ 修正 Wave B P3 记录**：RAPTOR 场景未知键报 **101** 不是 102；PUT body 只放白名单键 |
| P1e | raptor 内未知键 | `raptor.unknown_raptor_key` → code:101 `Extra inputs are not permitted` | 同上，raptor 子对象同样严格 |
| P1f | chunk_method 是否影响 raptor | `chunk_method=paper` + raptor 参数同时 PUT → **code:0 接受**；**但切换 chunk_method 会把 parser_config 重置为该方法的默认模板**（raptor 变回 `{"use_raptor": false}`） | **关键契约**：MIS 每次 PUT 必须同时带 `chunk_method` + 完整 `parser_config`，否则切换切片方式会静默清空 RAPTOR/图谱配置 |
| P1g | prompt 与聚类字段 | `prompt` 可自定义，**不含 `{cluster_content}` 占位符也接受**（code:0，引擎不强制）；`clustering_method` 枚举 **`gmm`\|`ahc`**；`scope` 枚举 **`file`\|`dataset`**；`tree_builder` 枚举 **`raptor`\|...**；`auto_disable_for_structured_data` 必须 bool | `raptorPrompt` 长度校验可宽松（引擎无占位符强校验）；`clustering_method`/`scope`/`tree_builder` MIS 侧如暴露需枚举白名单 |
| P1h | PUT 合并语义 | PUT parser_config 是**部分更新（深合并）**：不传的键保留原值（如只 PUT `use_raptor` 后 `max_token` 保留） | MIS 更新 RAPTOR 单字段不会丢其它字段；但见 P1f（chunk_method 切换除外） |
| P1i | 官方文档 `seed` 键 | **`seed` → code:101 被拒**；正确键是 **`random_seed`**（回读确认生效） | **修正官方文档**：v0.26.4 用 `random_seed`；MIS 字段映射 `raptorSeed → random_seed` |
| P2a | 构建任务触发 | `POST /api/v1/datasets/{id}/index?type=raptor` → **code:0** `{"data":{"task_id":"..."}}`（与 graph 同构） | `RagflowClient.buildRaptor(datasetId)` 走 `POST .../index?type=raptor` |
| P2b | 状态查询结构 | `GET /api/v1/datasets/{id}/index?type=raptor` → task dict 含 `progress`（**1.0=完成 / -1=失败 / 其他=构建中**）、`progress_msg`、`task_type="raptor"`、`process_duration`、`create_time`——**与 graph 完全同构**。dataset 级佐证：`raptor_task_id` + `raptor_task_finish_at`（与 `graphrag_task_id` 同模式） | `RagflowClient.queryRaptorBuildStatus(datasetId)` 走 `GET .../index?type=raptor`；MIS 映射 progress→raptorBuildStatus（1→ready / -1→failed / 其他→building） |
| P2c | graph/raptor 互斥性 | **不互斥，可并行**。实测①：graph 构建中（progress=0.044）触发 raptor → code:0 并行成功，两任务各自完成（raptor 10:10:47 / graph 10:11:48，互不覆盖）；实测②：raptor 完成后触发 graph → code:0 成功；实测③：raptor 构建中触发 graph → code:0 成功。重复触发 raptor → **幂等跳过**（`already has raptor RAPTOR chunks, skipping`） | MIS 侧独立状态机即可，无需互斥拦截；但为避免 LLM token 竞争建议试点排期错峰（分析报告 C4） |
| P2d | LLM chat 模型依赖 | 构建**走系统默认 chat 模型**（`llm_id` 不在 `parser_config` PUT 白名单，code:101 被拒；probe 库 llm_id=None 时构建成功，系统默认 `qwen3.6-flash` 生效）。小库（1 chunk）建树 **1.68s** 完成；大库（250 chunks）约 **35s** | 引擎侧无需 MIS 传 chat 模型；若系统未配置 chat 模型，构建失败场景**未验证**（实例已配置，见 §4）——MIS 前置校验建议保留「chat 模型可用性」软提示 |
| P3a | 经典检索是否自动融合 RAPTOR | **是**：建树后 `POST /api/v1/retrieval` **无需额外参数**即返回 RAPTOR 摘要（结果首位出现 `**Summary of RAPTOR Algorithm Descriptions**`） | **零回归**：MIS 检索期不需要改 `/retrieval` 请求体，RAPTOR 融合是引擎内部行为 |
| P3b | `/datasets/{id}/search` + `use_kg` 共存 | `use_kg:true` 与 RAPTOR **同请求体共存 code:0**，返回内容同时含 RAPTOR 摘要 + 普通 chunks；`use_kg:true` + `doc_ids` + RAPTOR 三者共存 code:0 | 图谱增强与 RAPTOR 可叠加；RAPTOR 摘要也受 `doc_ids` 过滤（返回同文档摘要+正文） |
| P3c | 多库检索限制 | 多库 `/datasets/search` 仍受 **embedding 一致性**限制：probe 库(v4) + Wave B 库(v2) → code:102 `Datasets use different embedding models`（与 Wave B G8 一致） | RAPTOR 不改变多库限制；单库检索无此限制 |
| P4a | chunk 响应字段差异 | **RAPTOR 摘要 chunk 与普通 chunk 字段结构完全一致**（无新增层级/树节点标记字段）。`/retrieval`：`content/document_keyword/document_id/similarity/id` 等；`/datasets/search`：`content_with_weight/docnm_kwd/doc_id/similarity/kb_id/chunk_id` 等 | 无需新 DTO；沿用 Wave B `RfSearchChunk` 映射；RAPTOR 摘要仅靠内容前缀（`**Summary of ...**`）可识别 |
| P4b | 对照组（未建树库） | Wave B 库 `6e74b5fe`（`raptor_task_id=None` 未建树）走 `/retrieval` **无 RAPTOR 摘要** → 证明融合确为「建树后」行为，非恒有 | 检索期不强校验 raptorBuildStatus，但命中测试可回显「库已建树」状态供对比 |
| P5 | probe 库清理 | probe 库 `t00-raptor-probe-0812`（`fcee947895f111f1b45c7dc3cecfbcd9`，250 chunks + RAPTOR 树 + graph）**已删除**（DELETE code:0；GET 返回 code:102 不存在）。现有 3 个业务库未改动 | 后续 Wave C 金标如需复用，重建 probe 库即可；也可直接用业务库（注意其 `use_raptor=true` 但均未建树） |

---

## 2. 探测原文（curl + 响应节选，脱敏）

### 2.1 P1a 建库 + 默认 raptor 配置（白名单来源）

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"t00-raptor-probe-0812","description":"Wave C T00 RAPTOR probe","embedding_model":"text-embedding-v4@Tongyi-Qianwen@Tongyi-Qianwen","chunk_method":"naive","parser_config":{"chunk_token_num":512}}' \
  "http://10.254.16.6:9380/api/v1/datasets"
# {"code":0,"data":{"id":"fcee947895f111f1b45c7dc3cecfbcd9",...,"parser_config":{...,"raptor":{
#   "auto_disable_for_structured_data": true,
#   "clustering_method": "gmm",
#   "ext": {},
#   "max_cluster": 64,
#   "max_token": 256,
#   "prompt": "Please summarize the following paragraphs. Be careful with the numbers, do not make things up. Paragraphs as following:\n      {cluster_content}\nThe above is the content you need to summarize.",
#   "random_seed": 0,
#   "scope": "file",
#   "threshold": 0.1,
#   "tree_builder": "raptor",
#   "use_raptor": false
# },...}}}
# 注：建库 body 传 language → code:101 Extra inputs are not permitted（建库 schema 白名单外）
```

### 2.2 P1b max_token 校验范围（重点）

```bash
# 合法区间下界/上界
curl -s -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"parser_config":{"raptor":{"use_raptor":true,"max_token":256}}}' \
  "http://10.254.16.6:9380/api/v1/datasets/fcee947895f111f1b45c7dc3cecfbcd9"
# {"code":0}   ← 256 / 512 / 1024 / 2048 均 code:0

# 超上限
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true,"max_token":4096}}}' ...
# {"code":101,"message":"Field: <parser_config.raptor.max_token> - Message: <Input should be less than or equal to 2048> - Value: <4096>"}

# 低于下界
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true,"max_token":0}}}' ...
# {"code":101,"message":"Field: <parser_config.raptor.max_token> - Message: <Input should be greater than or equal to 1> - Value: <0>"}

# 默认值：不传 max_token → 保持 256
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true}}}' ...
# {"code":0}
# GET 回读 raptor.max_token = 256
```

### 2.3 P1c raptor + graphrag 共存

```bash
curl -s -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"parser_config":{"raptor":{"use_raptor":true,"max_token":1024},"graphrag":{"use_graphrag":true,"method":"light"}}}' \
  "http://10.254.16.6:9380/api/v1/datasets/fcee947895f111f1b45c7dc3cecfbcd9"
# {"code":0}
# GET 回读：raptor.use_raptor=True | max_token=1024 ; graphrag.use_graphrag=True | method=light
```

### 2.4 P1d/P1e 未知键严格校验

```bash
# parser_config 顶层未知键
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true},"foo":123}}' ...
# {"code":101,"message":"Field: <parser_config.foo> - Message: <Extra inputs are not permitted> - Value: <123>"}

# raptor 内未知键
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true,"unknown_raptor_key":1}}}' ...
# {"code":101,"message":"Field: <parser_config.raptor.unknown_raptor_key> - Message: <Extra inputs are not permitted> - Value: <1>"}
```

### 2.5 P1f chunk_method 切换重置 parser_config（关键坑）

```bash
# 先下发完整配置
curl -s -X PUT ... -d '{"chunk_method":"naive","parser_config":{"raptor":{"use_raptor":true,"max_token":1024,"threshold":0.2,"max_cluster":32,"random_seed":42,"prompt":"Summarize: {cluster_content}"},"graphrag":{"use_graphrag":true,"method":"light"}}}' ...
# {"code":0}

# 只切 chunk_method=paper（不传 parser_config）
curl -s -X PUT ... -d '{"chunk_method":"paper"}' ...
# {"code":0}
# GET 回读：chunk_method=paper ; raptor={"use_raptor": false} ; graphrag={"use_graphrag": false}
# → 切换切片方法会把 parser_config 重置为该方法的默认模板，RAPTOR/图谱配置被清空！
```

### 2.6 P1g/P1i 枚举与字段名修正

```bash
# 官方文档 seed 键被拒；正确键 random_seed
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true,"seed":123}}}' ...
# {"code":101,"message":"Field: <parser_config.raptor.seed> - Message: <Extra inputs are not permitted> - Value: <123>"}
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true,"random_seed":42}}}' ...
# {"code":0}  ← GET 回读 random_seed=42

# clustering_method 枚举 gmm | ahc
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true,"clustering_method":"kmeans"}}}' ...
# {"code":101,"message":"Field: <parser_config.raptor.clustering_method> - Message: <Input should be 'gmm' or 'ahc'> - Value: <kmeans>"}

# scope 枚举 file | dataset（报错文案截断显示 'file' or 'datas...'）
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true,"scope":"global"}}}' ...
# {"code":101,"message":"Field: <parser_config.raptor.scope> - Message: <Input should be 'file' or 'datas..."}

# tree_builder 枚举 raptor | ...（报错文案截断显示 'raptor' ...）
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true,"tree_builder":"xxx"}}}' ...
# {"code":101,"message":"Field: <parser_config.raptor.tree_builder> - Message: <Input should be 'raptor' ..."}

# prompt 不含 {cluster_content} 也接受
curl -s -X PUT ... -d '{"parser_config":{"raptor":{"use_raptor":true,"prompt":"no placeholder here"}}}' ...
# {"code":0}
```

### 2.7 P2a 构建触发 + P2b 状态（与 graph 同构）

```bash
# 触发（小库 1 chunk）
curl -s -X POST -H "Authorization: Bearer $KEY" \
  "http://10.254.16.6:9380/api/v1/datasets/fcee947895f111f1b45c7dc3cecfbcd9/index?type=raptor"
# {"code":0,"data":{"task_id":"63488ba295f211f1b45c7dc3cecfbcd9"}}

# 状态轮询（~2s 完成）
curl -s -H "Authorization: Bearer $KEY" \
  "http://10.254.16.6:9380/api/v1/datasets/fcee947895f111f1b45c7dc3cecfbcd9/index?type=raptor"
# {"code":0,"data":{...,"progress":1.0,"task_type":"raptor","process_duration":1.67607,
#   "progress_msg":"10:06:10 created task raptor\n10:06:11 Task has been received.\n10:06:11 Processing...\n10:06:11 RAPTOR done",...}}

# dataset 级佐证
# raptor_task_id: 63488ba295f211f1b45c7dc3cecfbcd9 | raptor_task_finish_at: 2026-08-12T10:06:12
```

### 2.8 P2c 互斥性实测（不互斥，可并行）

```bash
# ① graph 构建中（progress=0.044）触发 raptor → 成功并行
curl -s -X POST -H "Authorization: Bearer $KEY" ".../index?type=graph"  # task_id=ee8bca3a...  progress=0.044
curl -s -X POST -H "Authorization: Bearer $KEY" ".../index?type=raptor" # task_id=f3466846...  code:0
# 轮询：graph 10:11:48 done (103.63s) ; raptor 10:10:47 done → 各自 task_id/finish_at，互不覆盖

# ② raptor 完成后触发 graph → code:0（task_type=graphrag）
# ③ raptor 构建中触发 graph → code:0
# ④ 重复触发 raptor → 幂等跳过
# {"code":0,"data":{"task_id":"7645386295f311f1b45c7dc3cecfbcd9"}}
# GET：progress 1.0 | progress_msg:"...already has raptor RAPTOR chunks, skipping. ... RAPTOR done"
```

### 2.9 P2d LLM 依赖

```bash
# llm_id 不在 parser_config PUT 白名单
curl -s -X PUT ... -d '{"parser_config":{"llm_id":"nonexistent-model@Tongyi-Qianwen@Tongyi-Qianwen"}}' ...
# {"code":101,"message":"Field: <parser_config.llm_id> - Message: <Extra inputs are not permitted> ..."}
# probe 库 llm_id=None（GET 回读）时 RAPTOR 构建成功 → 走系统默认 chat 模型
```

### 2.10 P3 检索融合路径

```bash
# ① 经典 /api/v1/retrieval（建树后，无任何 RAPTOR 专属参数）→ 自动融合摘要
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"question":"What is max token limit for RAPTOR?","dataset_ids":["fcee947895f111f1b45c7dc3cecfbcd9"],"document_ids":[],"page":1,"page_size":5,"similarity_threshold":0.1}' \
  "http://10.254.16.6:9380/api/v1/retrieval"
# {"code":0,"data":{"chunks":[
#   {"id":"d8b4836a018750c9","content":"**Summary of RAPTOR Algorithm Descriptions**  The provided text consis...","similarity":0.437,...},   ← RAPTOR 摘要
#   {"id":"bd25487fd0f2a9da","content":" Paragraph 499: The RAPTOR recursive abstractive processing tree const...","similarity":0.405,...}
# ]}}

# ② /datasets/{id}/search + use_kg:true + doc_ids（RAPTOR 与 Wave B 参数全共存）
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"question":"What is max token limit for RAPTOR?","use_kg":true,"doc_ids":["ab73784295f211f1b45c7dc3cecfbcd9"],"size":3,"similarity_threshold":0.1,"keyword":false}' \
  "http://10.254.16.6:9380/api/v1/datasets/fcee947895f111f1b45c7dc3cecfbcd9/search"
# {"code":0,"data":{"total":3,"chunks":[
#   {"chunk_id":"d8b4836a018750c9","content_with_weight":"**Summary of RAPTOR Algorithm Descriptions**...","similarity":0.437,"docnm_kwd":"raptor-probe-big.txt","doc_id":"ab73784295f211f1b45c7dc3cecfbcd9",...},
#   ...]}}

# ③ 对照组：未建树库（raptor_task_id=None）走 /retrieval → 无摘要
curl -s -X POST ... -d '{"question":"embedding switch","dataset_ids":["6e74b5fe948111f1b45c7dc3cecfbcd9"],...}' \
  "http://10.254.16.6:9380/api/v1/retrieval"
# {"code":0,"data":{"chunks":[{"id":"...","content":" MIS knowledge base supports embedding model switching test."}]}}   ← 无 Summary 节点

# ④ 多库限制（与 Wave B G8 一致）
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"dataset_ids":["fcee947895f111f1b45c7dc3cecfbcd9","6e74b5fe948111f1b45c7dc3cecfbcd9"],"question":"What is max token limit for RAPTOR?","use_kg":false,"size":3,"similarity_threshold":0.1}' \
  "http://10.254.16.6:9380/api/v1/datasets/search"
# {"code":102,"message":"Datasets use different embedding models."}
```

### 2.11 P4 响应字段对照

| 字段含义 | `/api/v1/retrieval`（RAPTOR 摘要 chunk） | `/api/v1/retrieval`（普通 chunk） | `/api/v1/datasets/search`（RAPTOR 摘要 chunk） |
|---|---|---|---|
| 正文 | `content` = `**Summary of ...**` | `content` = 正文 | `content_with_weight` = `**Summary of ...**` |
| 文档名 | `document_keyword` | `document_keyword` | `docnm_kwd` |
| 文档 id | `document_id` | `document_id` | `doc_id` |
| 分数 | `similarity` | `similarity` | `similarity` |
| chunk id | `id` | `id` | `chunk_id` |
| 库 id | — | — | `kb_id` |
| 层级/树节点标记 | **无**（`mom_id`/`doc_type_kwd`/`tag_kwd` 与普通 chunk 相同，`imp_kw=[]`） | 无 | **无** |
| 区分标志 | 内容前缀 `**Summary of ...**` | — | 内容前缀 `**Summary of ...**` |

---

## 3. 对分析报告的修正（`mis-kb-wave-c-independent-analysis-2026-08-12.md`）

### 3.1 §2.0 参数口径差异表修正

| 项 | 分析报告 §2.0 口径 | T00 实测（v0.26.4） | 修正后口径 |
|---|---|---|---|
| `max_token` 范围 | 官方 256/2048，用户期望 512–4096/默认 1024，未实测 | **合法区间 `[1, 2048]`**；默认 256；**4096 → code:101**；0/-1 → code:101 | **MIS 范围收窄为 `[512, 2048]`（或 `[256, 2048]`），默认 1024 合法但引擎默认 256**；严禁下发 4096 |
| `threshold` 范围 | 官方 默认0.1 上限1，未实测 | **合法区间 `[0, 1]`**（含 0），默认 0.1 | 采用官方口径；MIS 范围 `[0, 1]`（注意可含 0） |
| `max_cluster` 范围 | 官方 默认64 上限1024，未实测 | **合法区间 `[1, 1024]`**，默认 64 | 采用官方口径；MIS 范围 `[1, 1024]` |
| `seed` 字段名 | 官方文档 `seed` | **`seed` 被拒（code:101），正确键 `random_seed`** | MIS 映射 `raptorSeed → parser_config.raptor.random_seed` |
| `prompt` | 官方递归摘要 prompt 含 `{cluster_content}` | 可自定义，**占位符不强制**（缺省也 code:0） | 长度校验可宽松；默认用官方 prompt |
| 开关 | `use_raptor` 默认 false | 确认 | 不变 |
| 未知键错误码 | （Wave B P3 记录 code:102） | **RAPTOR 场景未知键报 code:101** `Extra inputs are not permitted` | **修正**：pydantic 校验错误码是 101；102 是业务校验（如非法 index type/多库 embedding） |
| 新增字段（官方文档未提） | 无 | v0.26.4 另有 `clustering_method`(gmm\|ahc) / `scope`(file\|dataset) / `tree_builder`(raptor\|...) / `auto_disable_for_structured_data`(bool) / `ext`(dict) | MIS 白名单可不暴露这些（默认值即可），若要暴露需枚举校验 |
| `parser_config.llm_id` | 分析报告未涉及 | **不在 PUT 白名单**（code:101） | 构建用系统默认 chat 模型；MIS 无需传 chat 模型 |

### 3.2 §1.4 条件 C1/C2 实测闭环结论

- **C1（T00 实测契约）→ 已闭环**：`parser_config.raptor` 白名单与校验范围（§1 P1）、`POST /datasets/{id}/index?type=raptor` 触发与状态（P2a/P2b）、检索融合路径（P3a：**经典 `/retrieval` 自动融合，无需专属参数**）、与 `use_kg` 共存（P3b）。
- **C2（构建任务互斥性）→ 已闭环**：**graph/raptor 构建任务不互斥、可并行**（P2c 双向实测），重复触发幂等跳过。MIS 侧独立状态机 + 失败重试兜底即可，无需互斥拦截。

### 3.3 对设计文档新增硬约束

1. **chunk_method 切换重置 parser_config（最高优先级新契约）**：`RagflowClient.updateDatasetSettings` 每次 PUT 必须同时携带 `chunk_method` + 完整 `parser_config`（含 raptor + graphrag），否则切换切片方式会静默清空 RAPTOR/图谱配置。
2. **max_token 上限 2048**：`RaptorConfig.MAX_TOKEN_NUM = 2048`（可复用 `DocumentChunkConfig` 常量模式但独立常量）；MIS 校验区间建议 `[512, 2048]`（对齐用户期望下限）+ 适配层 clamp；超限错误码 code:101。
3. **字段名 `random_seed`**：`RagflowClient` 白名单写 `random_seed`，**禁止**写官方文档的 `seed`。
4. **检索零回归**：RAPTOR 建树后 `/api/v1/retrieval` 自动融合，MIS 检索期不改请求体；`use_kg` 路径与 RAPTOR 可叠加（P3b）。
5. **构建互斥不需要**：`buildRaptor` 与 `buildGraph` 可并行；MIS 侧 `raptorBuildStatus` 与 `kgBuildStatus` 各自独立状态机。
6. **幂等跳过**：重复触发 raptor 引擎直接跳过（已建树），MIS 触发前可先查状态，避免无谓请求。
7. **响应 DTO 复用**：RAPTOR 不新增 chunk 字段，沿用 Wave B `RfSearchChunk`；RAPTOR 摘要命中可依据内容前缀 `**Summary of ...**` 识别（命中测试回显用）。

---

## 4. 未验证项清单

| # | 未验证项 | 原因 | 影响 |
|---|---|---|---|
| U1 | 系统**未配置 chat 模型**时 RAPTOR 构建的失败行为（报错 code/文案） | 目标实例已配置系统默认 chat 模型（`qwen3.6-flash`），无法在不破坏现有环境的前提下模拟 | MIS 前置校验建议保留「chat 模型可用性」软提示；实现期可加 try/catch 兜底（构建失败 → progress=-1 → `raptorBuildStatus=failed` + `raptorBuildMessage`） |
| U2 | `tree_builder` 枚举完整取值列表 | 报错文案被截断（`Input should be 'raptor' ...`），仅确认 `raptor` 合法 | MIS 若暴露该字段，需先确认完整枚举；默认不下发即可规避 |
| U3 | `scope` 枚举完整取值（`file` 之外的第二值） | 报错文案截断（`'file' or 'datas...'`），推测 `dataset` | 同上；默认 `file` 即可 |
| U4 | 大库（>250 chunks）RAPTOR 建树耗时与 token 消耗 | 探测库 250 chunks 约 35s，未压测更大规模 | 试点库金标时记录；构建必须异步 + 轮询（对齐 Wave B） |
| U5 | RAPTOR 摘要 chunk 在底层 `/chunks` 列表接口的存储形态（是否有 type 标记） | v0.26.4 的 `/chunks` 列表端点 GET/POST 均 405/102，未找到可用调用方式；已通过检索响应间接确认字段结构 | 不阻塞实现（检索响应已足够）；若需管理端展示可后续补 SDK 方式 |
| U6 | RAPTOR 与 TOC 增强（`toc_enhance`）的交互 | TOC 属 Wave C 第二部分，本次未探测 | 独立任务再测 |

---

## 5. 关联文档

- 分析报告：[mis-kb-wave-c-independent-analysis-2026-08-12.md](mis-kb-wave-c-independent-analysis-2026-08-12.md)（§1.4/§2.0 修正见本文 §3）
- Wave B T00 探测：[ragflow-graphrag-probe-2026-08-11.md](ragflow-graphrag-probe-2026-08-11.md)（同范式、G2/G5/G7/G8 对照）
- Wave B 设计：[mis-kb-wave-b-graphrag-design-2026-08-11.md](mis-kb-wave-b-graphrag-design-2026-08-11.md)
- RAGFlow 官方 RAPTOR 文档：https://ragflow.io/docs/enable_raptor（v0.6.0，与 v0.26.4 存在差异，以本文实测为准）
