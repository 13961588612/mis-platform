# RAGFlow 切片设置参数对齐 — T0 真机实测记录（overlap% / auto 键 / 文件级 PUT）

- **项目**：`kb_chunk_settings`（增量 PRD 2026-08-19）
- **执行人**：software-architect（架构师 高见远）
- **日期**：2026-08-19
- **目标实例**：`http://10.254.16.6:9380`（`.env.integration` → `MIS_KB_ENGINE_BASE_URL`；RAGFlow v0.26.4 时代）
- **API Key**：取自 `.env.integration` 的 `MIS_KB_ENGINE_API_KEY`（51 字符，服务端持有；本记录脱敏不展示）
- **用途**：PRD §6 Q1（overlap% 键名/单位/默认值）与 R-P1-03（文件级 PUT 键接受度）的实测裁决依据
- **前置文档**：`deliverables/software-company/ragflow-chunk-settings-prd-2026-08-19.md`、`docs/backend/ragflow-physical-delete-design-2026-08-12.md`

> 延续 Wave B/C T00 探测范式（`ragflow-graphrag-probe` / `ragflow-raptor-probe`）。JSON PUT 用 curl 即通；multipart 上传用 Python urllib（Git Bash `curl -F` 对远程实例连接被拒，与前探测记录一致）。

---

## 1. 探测清单与结论总表

| # | 探测项 | 结论 | 影响实现的决策 |
|---|---|---|---|
| A1 | 建库回读 parser_config 键集 | 含 `auto_keywords=0`/`auto_questions=0`/`chunk_token_num`/`delimiter`/`raptor`/`graphrag`/`html4excel`/`parent_child` 等；**无任何 overlap 键**；无 `toc_extraction` 回显；`image_context_size`/`table_context_size`（=0）存在 | naive 写 schema 中 auto 两键是正规键；overlap 键不存在 |
| A2 | dataset PUT `auto_keywords=5, auto_questions=3` | **code:0**；GET 回读 5/3 持久化 | auto 两键库级**恒下发**（P1f） |
| A3 | dataset PUT `auto_keywords=33` / `auto_questions=11` | **code:101** `Input should be less than or equal to 32` / `10` | MIS 先验 [0,32] / [0,10]，引擎亦拒 |
| A4 | dataset PUT overlap 候选键：`overlapped_percent`/`overlap_percent`/`overlap_token_count`/`chunk_overlap_token_num`/`overlap` | **全部 code:101** `Extra inputs are not permitted` | **overlap% 本实例不支持 → 能力闸门只落库不下发 + 置灰（与 OCR 同款）**；新增字段 `overlapPercent` 仅承载配置 |
| A5 | dataset PUT `toc_extraction=true` / `image_table_context_window=256` | **code:101** | T01 已下发键在本实例被拒 → **改配置闸门**（默认 false），否则该键使每次 PUT 整单失败 |
| A6 | dataset PUT `image_context_size=128` / `table_context_size=128` | **code:101**（GET 回读里有但为只读/派生） | 不做任何使用 |
| B1 | document PUT `chunk_token_num=256/delimiter` | **code:0** | 文件级基线不变 |
| B2 | document PUT `auto_keywords=7, auto_questions=4` | **code:0**，GET 回读持久化 7/4 | **文件级 PUT 支持 auto 两键 → 下发** |
| B3 | document PUT `toc_extraction/image_table_context_window/overlapped_percent` | **code:102** | 文件级**不下发**（含 toc/上下文/overlap） |
| B4 | 上传新文档（不带文件级参数） | 文档 parser_config **自动快照 dataset**（auto_keywords/auto_questions 继承） | 快照式继承确认沿用；MIS 列保持 null=继承 |

> **探测后清理**：临时 dataset `t00-chunk-settings-probe-0819`（id 前缀 `a49f5...`）已 `DELETE /api/v1/datasets`（code 0, success_count 1）删除；业务库/业务文档零触碰。

---

## 2. 探测原文（脱敏）

### 2.1 建库 + parser_config 默认键集（T0-a 白名单来源）

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"t00-chunk-settings-probe-0819","chunk_method":"naive","parser_config":{"chunk_token_num":512}}' \
  "http://10.254.16.6:9380/api/v1/datasets"
# {"code":0,"data":{"id":"a49fa1049b8711f1b45c7dc3cecfbcd9",...,"parser_config":{
#   "auto_keywords":0,"auto_questions":0,"chunk_token_num":512,"delimiter":"\\n",
#   "html4excel":false,"layout_recognize":"DeepDOC","image_context_size":0,"table_context_size":0,
#   "raptor":{...,"use_raptor":false},"graphrag":{...,"use_graphrag":false},...}}}
# 注：建库回读中无任何 overlap 键；无 toc_extraction；image/table 上下文是 image_context_size/table_context_size（只读派生）
```

### 2.2 dataset 级逐键 PUT（T0-a 核心）

```bash
# overlap 候选 —— 全部被拒
curl ... -d '{"parser_config":{"overlapped_percent":10}}' PUT /api/v1/datasets/{id}
# {"code":101,"message":"Field: <parser_config.overlapped_percent> - Message: <Extra inputs are not permitted>"}
# overlap_percent / overlap_token_count / chunk_overlap_token_num / overlap 同款 code 101

# auto 键接受且越界拒
curl ... -d '{"parser_config":{"auto_keywords":5,"auto_questions":3}}' PUT
# {"code":0}   → GET /datasets/{id} 回读 auto_keywords=5, auto_questions=3
curl ... -d '{"parser_config":{"auto_keywords":33,"auto_questions":11}}' PUT
# {"code":101,"message":"Field: <parser_config.auto_keywords> - Message: <Input should be less than or equal to 32> - Value: <33>\nField: <parser_config.auto_questions> - Message: <Input should be less than or equal to 10> - Value: <11>"}

# T01 遗留键复核
curl ... -d '{"parser_config":{"toc_extraction":true}}' PUT
# {"code":101,"message":"Field: <parser_config.toc_extraction> - Message: <Extra inputs are not permitted>"}
curl ... -d '{"parser_config":{"image_table_context_window":256}}' PUT
# {"code":101,"message":"Field: <parser_config.image_table_context_window> - Message: <Extra inputs are not permitted>"}
```

### 3.3 文件级 PUT（T0-b，Python urllib）

```python
# 上传 probe_doc.txt → 文档 parser_config 自动继承 auto_keywords=5, auto_questions=3（快照）
PUT /api/v1/datasets/{ds}/documents/{doc}
  {"parser_config":{"auto_keywords":7,"auto_questions":4}}  → {"code":0}，GET 回读 7/4 持久化
  {"parser_config":{"toc_extraction":true}}                 → {"code":102} Extra inputs
  {"parser_config":{"image_table_context_window":768}}      → {"code":102} Extra inputs
  {"parser_config":{"overlapped_percent":10}}               → {"code":102} Extra inputs
  {"parser_config":{"auto_keywords":33}}                    → {"code":102} ≤32 校验
```

---

## 3. 最终裁决（写入设计文档 §1/§8）

1. **overlap%（Q1）**：本实例不支持任何 overlap 键 → **能力闸门「只落库不下发 + 置灰提示」（与 OCR 同款）**；新增 `RagSettings.overlapPercent`（Double，[0,100]，默认 0），`EngineCapabilities.parser_overlap` 翻 true 即放行；文件级不新增 overlap 列/控件。
2. **auto 两键**：官方 naive 写 schema 键（0~32 / 0~10，默认 0），库级**恒下发**；文件级 PUT **白名单包含** → 文件级下发。
3. **T01 遗留修正**：`toc_extraction`/`image_table_context_window` 在本实例被拒（A5）→ 改为配置闸门（`mis.kb.engine.parser-toc-supported` / `parser-image-table-context-supported`，默认 false）；`RagflowAdapter.capabilities()` 声明新能力位，前端置灰；引擎升级后翻 true 即恢复。
4. **快照继承（Q4）**：上传时引擎自动复制 dataset parser_config（含 auto 键）→ 沿用；MIS 文档列保持 `null=继承库级`，不拷贝。