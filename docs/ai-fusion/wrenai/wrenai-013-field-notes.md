# WrenAI 0.13.3 真机实测笔记

> **文档角色**：Wren Engine CLI 0.13.3 的**真机实测**行为总结（命令行为 / 文件格式 / 错误原文 / 根因）。
> **来源**：2026-09-28 在连接 `900001`（Doris；ads 两张 + dwd 一张表；46/56/88 列；1 cube、1 relationship、1 计算列）现场排查所得，每条都有实测证据（wren CLI / MCP 探针 / 目标文件读回）。
> **关系**：补足 `wrenai-ops-runbook.md` 与 `mis-iqd-modeling-runbook.md` 中标注「真机待核验」的部分。
> **实现锚点**：`agent/ai-platform/backend/src/adapters/iqd_cli.py`。

---

## 0. 一句话总纲（最重要）

wren 0.13.3 的**工程真源是 YAML 工程**：

```
wren_project.yml
models/<name>/metadata.yml    (+ ref_sql.sql)
views/<name>/metadata.yml     (+ sql.yml)   ← 这是 SQL 视图，不是 cube
relationships.yml
cubes/<name>/metadata.yml
knowledge/
```

`target/mdl.json` **只是 `wren context build` 的产物**，不是真源。任何一次 `context build`（自愈 force-rebuild / 手工执行 / `context init`）都会**用 YAML 工程重新生成并覆盖 `target/mdl.json`**。

所以：平台若**只写 `target/mdl.json`**，这次发布是**易失的**；model / relationship / cube 必须**镜像进 YAML 工程**才耐久。

同时注意读取方不一致（本轮最大的坑）：

- **MCP（问数链路）与 `wren context show` / `wren context validate` 读 YAML 工程**；
- **`wren cube list` / `wren cube query` 读 `target/mdl.json`**。

因此会出现「`cube list` 有 cube，但 MCP `list_cubes` 是空」这种自相矛盾的现象 —— 两个命令读的不是同一份东西。

---

## 1. 版本与进程形态（真机实测）

| 项 | 实测值 |
|---|---|
| CLI 版本 | `wren --version` → 0.13.3 |
| CLI 路径 | `/root/wren-venv/bin/wren` |
| agent python | 3.9.25 |
| 控制面 | `http://<wren>:9100/internal/v1/wren-mcp/*`（ensure / start / stop / restart / status / cli） |
| 数据面 | `http://<wren>:9101/mcp/{conn_id}`，bearer token |

MCP 进程行为：

- `wren serve mcp` 每连接一个进程，数据面 `/mcp/{conn_id}` + bearer。
- MCP Python SDK 的 streamable-http **session 不能跨 asyncio task 复用**（anyio cancel scope 绑定创建它的 task）。跨 FastAPI 请求复用会报 `Attempted to exit cancel scope in a different task than it was entered in`，表现为 HTTP 连接被重置（日志里 `receive_response_headers.failed / CancelledError`）。
- 修法：**每次工具调用独立建/关 session**（同一 task 内 `AsyncExitStack` + `streamable_http_client` + `ClientSession`，`terminate_on_close=True`）。代价是每次一次 initialize 握手（本地环回，百毫秒级）。
- 关闭 session 时 SSE GET 流被取消，日志会出现 `receive_response_headers.failed / CancelledError` —— **这是正常关闭噪音，不是错误**；不关闭（复用）才会出上面那个崩。

A/B 实测（同一个 client、3 个并发 task 调 `list_models`）：旧代码 3 个里挂 2 个（CancelledError）；新代码 3/3 成功。热重载后 discovery 端到端 17/17 全 200。

---

## 2. wren CLI 命令面（0.13.3，来自 `--help` 实测）

顶层命令：

```
query / dry-plan / dry-run / version / ask / docs
context   init|import|validate|build|show|instructions|set-profile|upgrade
cube      list|describe|query
utils     parse-type|parse-types|translate-type|translate-types
skills    list|get          （内置 agent 技能文档）
memory    store|index|check|reset|forget|...
genbi / profile / serve
```

关键子命令的真实语义：

| 命令 | 真实行为 |
|---|---|
| `wren context build` | **默认读 YAML 工程**，产物写到 `target/mdl.json`；**会覆盖该文件**。没有 `--mdl` 参数（旧参数会被 agent 剥掉）。 |
| `wren context build --help` 原文 | `Default mode: reads wren_project.yml, models/*/metadata.yml (+ref_sql.sql), views/*/metadata.yml (+sql.yml), relationships.yml, and knowledge/.` |
| `wren context show` | 读 **YAML 工程**，不是 `target/mdl.json`；`--output json` 含 `models/views/relationships/cubes/data_source`。 |
| `wren context validate` | 读 **YAML 工程**；退出码 0 仍可能带 warning；**cube / relationship 的语义缺陷它查不出来**（见第 5 节）。 |
| `wren context init` | 无参 = 脚手架（`--empty` 跳过示例 model/view）。带 `--from-mdl` 会导入 MDL JSON，但**丢 cubes 且覆盖 `wren_project.yml`（丢 `name`）** → 后续 build 中止，不适合直接当发布通道。 |
| `wren cube list` | 读 `target/mdl.json`（`--mdl` 可覆盖）。 |
| `wren cube query --sql-only` | 结构化 cube 查询；会做表达式规划校验（很多格式错误只在这一步暴露）。 |
| `wren skills get enrich-context --full` | **cube YAML 模板的官方出处**（参考文档 `cube_proposals`）。 |

---

## 3. YAML 工程文件 schema（真机验证过的模板）

### 3.1 `wren_project.yml`

- 必填 `name`。缺失会让 `context build` 直接中止：`wren_project.yml: missing required field 'name'`。
- 还承载 `profile` / `data_source` / `schema` / `catalog`。
- 注意：`context init --from-mdl --force` 会**覆盖**它并丢掉 `name` → 不能拿来重新生成真机工程。

- **顶层 `catalog` / `data_source` 必须是字符串，不能是 map**（2026-09-30 实测）。旧的平台占位写成 `catalog:\n  schema: public` 与 `data_source:\n  profile: ''\n  type: ''`，下游页面直接报：
  - `wren context build` 报 `wren_project.yml: missing required field 'data_source'`（`data_source` 取不到字符串）；
  - `wren dry-plan` 报 `Serde JSON error: invalid type: map, expected a string`（顶层 `catalog` 是 map）。
  正确写法：`catalog: wren` + `schema: public` + `data_source: doris`（或 `postgres`）；`wren context set-profile <name>` 会把 `data_source` 补成真实方言（含上下文）但**不会**修 map 形态的 `catalog`。
- **MDL 顶层 `catalog` / `dataSource`（`target/mdl.json`）同样受约束**：`catalog` 必须是非空字符串（缺失 → `missing field catalog`；map → `invalid type: map, expected a string`）；`dataSource` 必须是受控枚举字符串或**整键缺失**（map → `unknown variant 'profile'`；缺失可通行）。平台发布时已在 `build_mdl_from_catalog` 里归一顶层头。

### 3.2 `models/<name>/metadata.yml`

```yaml
name: <model_name>            # 必须等于目录名
table_reference:
  catalog: ''
  schema: adhoc               # 真机 context show 显示 adhoc
  table: <physical_table>
columns:
  - name: <col>               # 列名是引用锚点，不能改
    type: VARCHAR(65533)      # 必填：缺了 validate 报 column missing 'type'
    is_calculated: false
    not_null: false
    is_primary_key: true
    properties:
      description: <列业务说明>
  - name: calc_col
    type: DOUBLE              # 计算列必须显式给 type
    is_calculated: true
    expression: kds / cust_cnt
primary_key:                  # 复合主键 = 列表
  - ord_date
  - data_type
cached: false
properties:
  description: <模型业务说明>  # 缺失只有 warning，不阻断
```

要点：

- **每列都必须有 `type`**。真机缺 190 列类型时，validate 报 190 条 `column missing 'type'`。
- **计算列必须显式给 `type` 与 `expression`**，引擎不给默认值。平台派生 MDL 里的计算列只有 `name`+`expression`（catalog 的 `data_type` 为空），所以镜像时要做类型推断（按表达式主列推断，兜底 `DOUBLE`）。
- 描述镜像：列 `description`（或 `properties.description`）→ `properties.description`；模型级 `properties.description` 为空时回落到 MDL 顶层 `description`。
- `primary_key` 顺序不重要（引擎自己会重排）。
- PK「只增不减」的保护仍由平台侧 `_apply_primary_keys` 负责。

### 3.3 `relationships.yml` —— 必须是 mapping

```yaml
relationships:              # 顶层必须是 mapping，不能是裸列表
  - name: sale_ord_store
    models:
      - ads_spm_trd_sale_category_day_df
      - dwd_spm_trd_sale_ord_detl_df
    join_type: ONE_TO_MANY  # 基数枚举，不是 INNER/LEFT
    condition: a.store_id = b.store_id
```

两个实测坑：

1. 裸列表会报：`relationships.yml must be a mapping with a 'relationships' key, got list`。
2. `join_type` 是**基数枚举**，只接受 `ONE_TO_ONE` / `ONE_TO_MANY` / `MANY_TO_ONE` / `MANY_TO_MANY`。写 `INNER` 时 **validate 不报错**，只在 `wren cube query` 规划期炸：`unknown variant INNER, expected one of ...`。
   - 修法：从平台关系信封的 `cardinality`（`1:N`）映射到枚举；拿不到基数**就不写这个字段**（宁缺勿错）。

### 3.4 `cubes/<name>/metadata.yml` —— cube 的唯一 YAML 落点

```yaml
name: sale_by_store           # snake_case，必须与目录同名
base_object: <model_or_view>  # 必须已存在于工程
measures:
  - name: kds_sum
    expression: SUM(kds)
    type: DOUBLE
dimensions:
  - name: store_id
    expression: store_id
    type: VARCHAR
properties:
  description: <一句话说明>
```

注意：`views/<name>/metadata.yml` **不是** cube 的落点 —— 那是 SQL 视图，必须有 `statement`（缺了报 `view missing 'statement'`）；即使写了 `measures`/`dimensions`，build 出来仍然是 view（`cubes: []`）。cube 只能放 `cubes/<name>/metadata.yml`，这个路径出自 wren 自带技能 `wren skills get enrich-context --full` 的 `cube_proposals` 参考。

---

## 4. 真源层级与「易失」坑（实测对照）

| 层 | 它是什么 | 谁读它 |
|---|---|---|
| YAML 工程（真源） | `wren_project.yml` + `models/*` + `views/*` + `relationships.yml` + `cubes/*` + `knowledge/` | `context build` 的输入；`context show` / `context validate`；**MCP（`get_mdl` / `list_cubes` / `query_cube` / `get_context`）** |
| `target/mdl.json`（产物） | `context build` 的输出 | `wren cube list` / `wren cube query` / 顶层 `--mdl` 默认读它 |

实测序列（连接 `900001`）：

1. 平台只写 `target/mdl.json`：`wren cube list` 能看到 cube，但 **MCP 的 `get_mdl` / `list_cubes` / `query_cube` 全看不到**（`cubes=0`），`context show` 也看不到 → 问数链路实际拿不到 cube。
2. 手工跑一次 `wren context build`：输出 `Built: 3 models, 0 views -> target/mdl.json`，**`target/mdl.json` 被 YAML 工程覆盖**，cube 与 relationship 一起消失（当时 YAML 里还没镜像它们）。
3. 把 `relationships.yml`（mapping + 基数枚举）与 `cubes/<name>/metadata.yml`（官方模板）写进工程后：`context show` `cubes=1 rels=1`、MCP `get_mdl` `cubes=1 rels=1`、`cube query --sql-only` 规划通过。
4. **耐久性**：再独立跑一次 `context build`，models/cubes/relationships 全部保留 —— 因为它们在 YAML 真源里。

---

## 5. 真机错误速查（原文 + 根因 + 修法）

| 报错原文 | 根因 | 修法 |
|---|---|---|
| `views/probe_cube: view missing 'statement'` | 把 cube 写成了 `views/` | cube 放 `cubes/<name>/metadata.yml`；`views/` 是 SQL 视图 |
| `relationships.yml must be a mapping with a 'relationships' key, got list` | 文件写成裸列表 | 顶层写成 `relationships:` + 列表 |
| `unknown variant INNER, expected one of ONE_TO_ONE/ONE_TO_MANY/MANY_TO_ONE/MANY_TO_MANY` | `join_type` 用了 SQL 连接类型；validate 查不出，只在 cube query 规划期炸 | 用基数枚举；拿不到基数就不写该字段 |
| `column missing 'type'` | 计算列派生 MDL 只有 name+expression；YAML 每列都要 type | 镜像时按表达式主列推断（兜底 DOUBLE）；物理列兜底 VARCHAR |
| `wren_project.yml: missing required field 'name'` | `context init --from-mdl --force` 覆盖了工程清单 | 不要用 `--from-mdl` 覆盖真机工程；平台自己镜像 YAML |
| MCP `Known cubes: []` 但 `cube list` 有 cube | MCP 读 YAML 工程，`cube list` 读 `target/mdl.json` | cube 必须落 `cubes/<name>/metadata.yml` |
| `Attempted to exit cancel scope in a different task than it was entered in` | MCP session 跨 task 复用 | 每次调用独立 session |

---

## 6. 对平台实现的含义（已落地）

发布（ai-platform 的 `enhance/sync scope=model`）时，除 `target/mdl.json` 外，把派生 MDL 镜像进 YAML 工程：

| 镜像方法（`iqd_cli.py`） | 产物 | 说明 |
|---|---|---|
| `_models_mirror_files` | `models/<name>/metadata.yml` | 列 / 类型 / not_null / is_calculated / expression / 描述 / PK；计算列类型按表达式推断 |
| `_relationships_mirror_files` | `relationships.yml` | mapping 结构；`join_type` 由 cardinality 映射（取不到就不写） |
| `_cube_mirror_files` | `cubes/<name>/metadata.yml` | measure / dimension 的 type 由 `base_object` 同名列推断；度量兜底 DOUBLE、维度 VARCHAR |
| `_infer_calc_column_type` | — | 计算列类型推断的辅助实现 |

两个实现细节（踩过的坑）：

1. **manifest 与 YAML 镜像不要同一次调用下发**：agent 在「只部署 manifest」时会短路返回（`command=deploy target/mdl.json`），该响应**不含 `written` 回执** → 平台 fail-loud 校验会误报「agent 未升级」。正确做法是 manifest 走一次调用、YAML 镜像另走一次 project-files 调用（有 `written` 回执）。
2. **不要指望 `context build` 帮你补齐**：它读 YAML、覆盖 `target/mdl.json`；只补 `target/mdl.json` 的做法在一次 build 之后就没了。

本轮实测验证结果：

| 检查点 | 修复前 | 修复后 |
|---|---|---|
| `wren context validate` | 193 条 warning（190 列缺 type） | 3 条 warning（只剩模型缺描述），0 error |
| YAML 缺 `type` 的列数 | 190 | 0 |
| `context show` | cubes=0 rels=0 | cubes=1 rels=1 |
| MCP `get_mdl` | cubes=0 rels=0 | cubes=1 rels=1 |
| MCP `query_cube --sql-only` | `Known cubes: []` 报错 | 生成正确 SQL（`SELECT store_id, SUM(kds) ... GROUP BY 1`） |
| 独立再跑 `context build` | cube / 关系全丢 | 全部保留（耐久） |

---

## 6bis. cube 已接入问数主链路（2026-09-28）

**动机**：cube 打通到 MCP 之后，平台问数仍走「LLM 手写聚合 SQL」，
没用上 cube 这个「结构化聚合原语」（官方称其为聚合正确性的最高杠杆）。
典型风险：`GROUP BY` 漏列 / 口径写错 / 日期截断方言写错。

**做法（关键设计）**：**cube 只做「SQL 生成器」**，不绕过任何安全链路。

```
list_cubes（MCP 读 YAML 真源）
  → _pick_cube（问题与 cube 名/度量/维度关键词打分；无信号或平局 → 不命中）
  → LLM 产出 cube 查询规格（type=cube_query + measures/dimensions/filters/time_dimension）
  → 白名单校验（LLM 只能选清单内的名字，防臆造）
  → query_cube(sql_only=True) 让 wren 生成 SQL
  → 包装成等价的 Nl2SqlResult(sql=<cube SQL>)
  → 原有管线零改动：inject_row_scope → lineage 断言 → dry_run → run_sql → masking
```

**为什么安全**：cube 生成的 SQL 与手写 SQL 走**同一条**注入/血缘/脱敏通路。
cube 若引用了未授权模型，`_scope_resolver_assert` 会 fail-closed（45204），
无需在 cube 分支另建一套授权。

**降级策略**：`list_cubes` 不可用 / 无 cube / 未命中 / LLM 判为非 cube 问题 /
规格不合格 / `query_cube` 规划失败 → **一律回落到 NL→SQL**，不阻断问数。

**真机实测（连接 900001，真实 wren + 真实 LLM qwen3.7-plus）**：

| 步骤 | 实测结果 |
|---|---|
| `list_cubes` | `sale_by_store`：measures `[kds_sum, cust_cnt_sum]`、dimensions `[store_id, ord_date]` |
| `_pick_cube`（问题「各门店的 kds_sum 是多少」） | 命中 `sale_by_store` |
| LLM 规格 | `type=cube_query`、`measures=[kds_sum]`、`dimensions=[store_id]` |
| `query_cube(sql_only)` | `SELECT store_id AS store_id, SUM(kds) AS kds_sum FROM ads_spm_trd_sale_category_day_df GROUP BY 1` |
| `run_sql` + 结果构造 | **32 行**，列 `[store_id, kds_sum]`（真实业务数据） |

**本轮踩到的 MCP 返回形状（与文档假设不同，务必按实测）**：

| 工具 | 真实返回 |
|---|---|
| `list_cubes` | `{"cubes":[{"name":..., "base_object":..., "measures":["kds_sum",...], "dimensions":["store_id",...], "time_dimensions":[]}]}` —— **measures/dimensions 是字符串数组**（不是对象数组） |
| `query_cube(sql_only=True)` | `{"sql":"<生成的 SQL>"}` |
| `run_sql` | `{"columns":["store_id","kds_sum"], "rows":[{"store_id":"0027","kds_sum":12980593.0}, ...]}` —— **columns 是字符串数组、rows 是 dict 数组**（`_normalize_result_rows` 已按 dict 行归一化） |
| `describe_cube` | 入参名为 `name`（与 `describe_model` 同构），不是 `cube` |

**实现锚点**：`orchestrator._try_cube_query / _pick_cube / _cube_child_names`、
`nl2sql.generate_cube_query / _parse_cube_response / CubeQuerySpec`、
`iqd_mcp_client.list_cubes / describe_cube`。
单测：`tests/test_iqd_cube_query.py`（11 条：选 cube 纯函数、规格解析容错、mock 生成、
端到端「命中 cube 则不走 nl2sql.generate 且安全管线仍执行」、无 cube 时回落 NL→SQL）。

---

## 7. 已知坑位清单（排障用）

| 症状 | 真因 | 处置 |
|---|---|---|
| 界面保存成功，但 wren 里没变化 | 只写了 `target/mdl.json`（产物），YAML 才是真源 | 发布时镜像 models / relationships / cubes 进 YAML |
| 跑过一次 `context build` 后 cube / 关系消失 | build 用 YAML 覆盖了 `target/mdl.json` | 同上；YAML 里有就不丢 |
| validate 只报 `column missing type` | 平台计算列没有 type | 镜像时推断 type；平台 catalog 也建议回填 `data_type` |
| `cube query` 报 `unknown variant INNER` | `join_type` 是基数枚举不是连接类型 | `cardinality` → 枚举映射 |
| MCP `list_cubes` 空 | MCP 读 YAML 工程 | cube 必须进 `cubes/` 目录 |
| 界面无法改主键 | `PUT /catalog/node` 的 patch 原先不支持 `is_primary_key` | 已补（仅 `column`；写 `iqd_catalog_item.is_primary_key` + bump revision） |
| `dry-plan` 报 `invalid type: map, expected a string` / `missing field catalog` | MDL 顶层 `catalog` 是 map 或缺失（常由旧 `wren_project.yml` map 形态经 `context build` 流入 `target/mdl.json`） | 归一为 `"wren"` 字符串；兼修 `wren_project.yml` |
| `dry-plan` 报 `unknown variant 'profile'` | MDL 顶层 `dataSource` 是 map（`{profile, type}`） | 改为受控枚举字符串（`starrocks`→`doris`）或删除该键 |
| `context build` 报 `missing required field 'data_source'` | `wren_project.yml` 的 `data_source` 是 map / 空 | 改写为字符串（`doris`/`postgres`）；`context set-profile` 也可补齐 |
| `context show` 恒为 0 models | `wren_project.yml` 用 `version: 1`（旧 schema） | 改 `schema_version: 5`；`context upgrade` 不修 map 头 |

---

## 8. 相关实现锚点

| 文件 | 说明 |
|---|---|
| `agent/ai-platform/backend/src/adapters/iqd_cli.py` | 三个镜像方法 + 类型 / 基数推断 + 发布编排 |
| `agent/ai-platform/backend/src/agent/mis_iqd/service.py` | `build_mdl_from_catalog`（派生 MDL、物化、PK 回填） |
| `agent/ai-platform/deploy/wrenai/wren-mcp-agent/agent.py` | 跨机器 CLI 通道（`mdl_manifest` 落 `target/mdl.json`；`files` / `delete_paths` / `list_path`） |
| `backend/mis-iqd/.../IqdAdminService.java` | `updateCatalogNode`（含新增的 `is_primary_key` patch） |

---

> **维护约定**：本文只记录**真机实测事实**（命令行为、文件格式、错误原文、根因）。设计决策看 `mis-iqd-modeling-system-design.md`，运维步骤看 `mis-iqd-modeling-runbook.md`。若后续升级 wren（> 0.13.3），需按本文逐条复测并标注版本。
