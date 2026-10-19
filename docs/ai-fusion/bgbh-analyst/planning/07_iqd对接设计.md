# iqd 问数智能体对接设计 v1.0

> 定位：**通用取数执行器**。上游（协调者/百购分析）给它规范问句，它调 WrenAI 拿 SQL、执行、返回结构化结果。
> **iqd 不持有任何业务域知识**——这是它能被超市/财务等域复用的前提。
> 配套：《06_智能体协作架构设计》第 3 节接口契约、第 9 节双通道。

---

## 1. 职责边界（红线）

| iqd 做 | iqd 不做 |
|--------|----------|
| 接规范问句 → 调 wrenai → 拿 SQL | 不认业务术语（"客单价"是百购口径，iqd 不知道） |
| 表白名单硬校验 | 不做槽位业务判断（只判断"缺不缺"，不判断"该填什么"） |
| 执行 SQL / 控制超时与限流 | 不写 SQL、不改 SQL 语义 |
| 敏感列名脱敏 | 不做业务合理性判断（流失率为负归百购分析管） |
| 缓存、重试、trace 日志 | 不做回答组织（结论/追问建议归百购分析） |

---

## 2. 上游接口契约

### 2.1 请求

```json
{
  "trace_id": "bg-20261013-001",
  "mode": "fast | full",
  "skill_id": "bgbh-s1-daily-report",
  "question": "【S1】昨天 八佰伴嘉兴店 销售金额",
  "constraints": {
    "wrenai_project": "bgbh_member",
    "table_whitelist": ["ads_trd_mall_sale_d_df"],
    "required_slots": ["时间", "门店"],
    "row_limit": 200,
    "timeout_ms": 15000
  },
  "options": { "return_sql": true, "use_cache": true }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| trace_id | 是 | 贯穿协调者→百购分析→iqd→wrenai，用于未命中归因 |
| mode | 否 | fast=快通道（iqd 自升级判断），full=已过百购分析 |
| constraints.table_whitelist | 是 | 缺失时 iqd 用 project 默认白名单兜底（见第 5 节） |
| constraints.required_slots | 否 | 快通道下必带，iqd 据此判断 need_upgrade |
| row_limit / timeout_ms | 否 | 缺省取 iqd 配置 |

### 2.2 响应与状态码

```json
{
  "trace_id": "bg-20261013-001",
  "status": "success",
  "sql": "SELECT SUM(sale_amt) ...",
  "tables_used": ["ads_trd_mall_sale_d_df"],
  "columns": ["销售额"],
  "rows": [[3865210.55]],
  "row_count": 1,
  "cache_hit": false,
  "execution_ms": 830,
  "error": null
}
```

| status | 含义 | 上游该做什么 |
|--------|------|--------------|
| `success` | 正常出数 | 组织回答 |
| `need_upgrade` | 缺必填槽位 / 需多步 / 命中敏感口径 | 转交百购分析智能体 |
| `out_of_whitelist` | SQL 涉及未授权表 | 拒答 + 重试一次 |
| `no_data` | 查询成功但无行 | 降级重问（换时间口径） |
| `sql_error` | SQL 执行失败 | 重试一次，仍失败转人工 |
| `timeout` | 超时 | 收缩条件后重试（加 LIMIT、缩时间范围） |
| `wrenai_error` | 语义层未生成 SQL | 记录未命中日志，转人工 |

---

## 3. 内部流水线（8 步）

```
① 接单校验：trace_id / question / project 是否齐全（缺则直接参数错误）
② 快通道判断（mode=fast 时）：
     required_slots 缺失 → return need_upgrade（列出 missing）
     question 含多步信号（"再看/再查/分别/同时"）→ need_upgrade
     skill_id 属敏感清单（S5/S7-C/D）→ need_upgrade
③ 缓存查询：key = hash(project + question + whitelist)
     命中 → 直接返回上次 SQL 与结果（cache_hit=true，仍回源校验不过期可选）
④ 调 WrenAI：POST ask{question, project_id, thread_id?}
     拿到 sql（未拿到 → wrenai_error）
⑤ 白名单校验：解析 SQL 的 FROM/JOIN 表名
     越界 → out_of_whitelist（**不执行**）
⑥ 执行 SQL：走 Doris，带 timeout 与 row_limit
     失败 → sql_error（重试 1 次）/ 超时 → timeout
⑦ 脱敏与裁剪：按列名黑名单处理；超 row_limit 截断并标记
⑧ 返回：组装响应 + 写 trace 日志（含 question、sql、耗时、行数、cache_hit）
```

**伪代码骨架**

```python
def ask(req):
    if not req.trace_id or not req.question or not req.project:
        return error("bad_request")
    if req.mode == "fast":
        up = check_upgrade(req)          # 缺槽位/多步/敏感
        if up: return need_upgrade(up)
    key = cache_key(req)
    if req.options.use_cache and (hit := cache.get(key)):
        return hit
    sql = wrenai.ask(req.question, req.constraints.wrenai_project)   # ← endpoint 待确认
    if not sql: return status("wrenai_error", log_unhit(req))
    tables = extract_tables(sql)
    if not set(tables) <= set(whitelist(req)):
        return status("out_of_whitelist", tables)
    rows, cols = doris.run(sql, timeout=req.constraints.timeout_ms, limit=req.constraints.row_limit)
    rows = mask(cols, rows)
    res = build_response(sql, tables, cols, rows, cache_hit=False)
    cache.set(key, res)
    trace.log(req.trace_id, req.question, sql, len(rows), res.execution_ms)
    return res
```

---

## 4. WrenAI 对接要点（路径以你们实际部署为准）

**概念契约**（不绑定具体版本）：`question + project_id → sql (+可选执行结果)`。

**必须与平台侧确认的 6 项【待验证】：**

| # | 待确认项 | 为什么关键 |
|---|----------|-----------|
| 1 | ask 接口地址、鉴权方式、是否流式 | 决定超时与重试怎么写 |
| 2 | `project_id` 命名与取值（百购=？） | 多域隔离的开关 |
| 3 | 是否支持传入"可用表集合"约束 | 若能，白名单可在语义层前置拦截（双重保险） |
| 4 | 长查询是同步返回还是异步+轮询 | 决定 timeout 策略 |
| 5 | **返回的是 SQL 还是 SQL+数据** | 决定第 5 节的执行归属 |
| 6 | 错误码与失败语义（无匹配/生成失败/超长） | 决定 status 枚举映射 |

---

## 5. 关键决策：谁来跑 SQL

| 方案 | 做法 | 评价 |
|------|------|------|
| **A. iqd 自己跑（推荐）** | wrenai 只出 SQL，iqd 拿 SQL 查 Doris | 白名单、限流、脱敏、缓存、审计全在自己手里；执行超时可控 |
| B. wrenai 返回数据 | iqd 只透传 | 省一次连接；但执行不可控，脱敏/限流要事后做，且拿不到行数前无法限流 |

**建议 A**。若你们 wrenai 已经返回结果，也请它**同时回传 SQL**，iqd 保留 SQL 用于白名单校验与审计日志（这是事后归因的唯一依据）。

---

## 6. 白名单的兜底来源

快通道下协调者可能不传 whitelist → iqd 必须有兜底，否则等于裸奔：

```
优先级：请求 constraints.table_whitelist  >  project 默认白名单（配置文件）  >  拒绝执行
```

`project 默认白名单` 按域配置（如 bgbh_member = 29 张 ADS 白名单全集），配置化维护，与《02》1.1 建模批次一致。

---

## 7. 脱敏规则（列名黑名单，iqd 层强制）

| 命中列名 | 处理 |
|----------|------|
| mbr_phone / phone / MOBILEPHONE / 含 phone | 不返回或掩码（138****1234） |
| mbr_address / ADDRESS_DESC / txdz | 不返回 |
| mbr_id / mbr_card_id / cst_id | 不返回 |
| oneid | 保留但前端展示层截断（iqd 只标记 `sensitive: true`） |
| 含 id_card / license_plate | 不返回 |

> 快通道绕过了百购分析，脱敏责任**完全落在 iqd**——这是快通道必须的前提条件之一。

---

## 8. 缓存 / 重试 / 超时 / 限流

| 项 | 建议值 | 说明 |
|----|--------|------|
| 缓存 key | hash(project + question + whitelist) | 追问链里同一问句重复出现可命中 |
| 缓存 TTL | 按数据新鲜度（T+1 数据可 30 分钟~2 小时） | 涉及当日实时的域设短 |
| 重试 | wrenai_error / sql_error 各重试 1 次 | 重试前不改问句（改问句是上游职责） |
| 超时 | wrenai 15s / Doris 30s（可按域配） | 超时后**收缩条件**重试：加 LIMIT、缩时间范围 |
| 限流 | 单 project 并发 ≤ N，单用户 QPS ≤ M | 防止一个用户拖垮 Doris |
| 行数上限 | 默认 200，最大 1000 | 超限时截断并明确告知"结果已截断" |

---

## 9. 日志（未命中归因的唯一依据）

每条 trace 至少记录：
`trace_id | 上游(mode/skill_id) | 原始question | 改写后question | wrenai返回的sql | tables_used | 状态 | 耗时 | 行数 | cache_hit | 错误`

> 用途：每周导出 `wrenai_error` 与 `no_data` 的 question → 补进《03_样本问题树》。**没有这套日志，样本库就只能靠拍脑袋补。**

---

## 10. 配置项清单

| 配置 | 示例 | 来源 |
|------|------|------|
| wrenai.endpoint / token | — | 平台侧提供【待验证】 |
| wrenai.project_id | bgbh_member | 与《02》建模一致 |
| project_default_whitelist | 29 张 ADS | 《02》1.1 |
| sensitive_columns | 见第 7 节 | 本文件 |
| timeout_ms / row_limit / cache_ttl | 15000 / 200 / 3600 | 按域覆盖 |
| upgrade_rules | 缺槽位、多步、S5/S7敏感清单 | 《06》9.2 + 各 Skill required_slots |

---

## 11. iqd 层验收用例（10 条）

| # | 输入 | 期望 |
|---|------|------|
| 1 | 合法请求、槽位全 | status=success，返回 sql + rows + tables_used |
| 2 | mode=fast，required_slots 缺"门店" | status=need_upgrade，missing=["门店"]，**不查数** |
| 3 | mode=fast，问句含"再看第一名的厅房" | need_upgrade（多步） |
| 4 | mode=fast + skill_id=S5 | need_upgrade（敏感口径禁快通道） |
| 5 | 伪造请求让 SQL 命中 DWD 表 | out_of_whitelist，**SQL 不执行** |
| 6 | 不传 whitelist | 用 project 默认白名单兜底，正常执行 |
| 7 | 查询命中会员手机号 | 返回掩码或不返回该列 |
| 8 | 同一问句第二次 | cache_hit=true，execution_ms 显著下降 |
| 9 | wrenai 返回空结果集 | no_data（不是 error），上游可降级重问 |
| 10 | wrenai 无响应 20s | timeout，收缩条件重试一次，仍失败返回 timeout |
