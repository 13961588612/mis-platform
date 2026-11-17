# T05 池驱动对账引擎 — 架构规格锁定

> 适用范围：recon-service 对账引擎（ReconRunner + Match/Compare/Pool/MatchedIndex + 差异沉淀 + DiffController）
> 上游规格：《对账平台V3-开发任务分解》T05（952~959 行）+ §6.4/§7/§8/§10/§18.2~18.5 + 技术适配 §2.5/§2.8 + T03-spec（配置模型）+ T04-spec（输入侧）
> 状态：**已锁定**（裁决项回写 §16）

---

## 0. 全局裁决摘要（先读）

| # | 裁决点 | 结论 |
|---|--------|------|
| G1 | strategy MVP 范围 | exact_key / composite_key **全实现**；**sum_check 已支持（第二批，勾稽引擎）**，实现见 `T05-spec-sum-check.md`；**custom 已支持（第三批 C2，自定义匹配）**、**custom_check 已支持（第三批 C3，整检查自定义）**，契约见 `custom-需求规格说明书.md` §3.1/§4 与方案 §十三；fuzzy / chain 仍抛 `7009 未支持策略` |
| G2 | compare_mode 引擎能力 | equal / lte / gte / lt / gt / contains / regex **全实现**（7 种）；**compare_mode=custom 已支持（第三批 C4，规则级自定义比较 CustomComparator，行级 comparator_class / comparator_params 落库）**；7010 仅对未识别模式兜底；管理端开放 equal / custom（第三批 C6），string/lte/gte/lt/gt/contains/regex 引擎保留全集（方案 §8.3 定案） |
| G3 | value_transform 能力 | none / trim_comma / trim / uppercase / trim_space / lower **全实现**；语义=比较前值归一，非显示格式（方案 §8.1） |
| G4 | tolerance | absolute / percentage / both / null 全实现；percentage 分母=**左侧值**、左侧 0 退化相等（§8.2）；**is_amount=true 字段在"分"整数域比较**（tolerance 单位=分），is_amount=false 原值比较 |
| G5 | is_amount → diff_amount_cent | is_amount=true 字段产生差异时，差值 `|left-right|`（分，long）写入 diff_amount_cent；**取第一个产生差异的 is_amount 字段**（§8.1 A-R2-09）；流转刷新时更新，resolved 保留末次判定值 |
| G6 | 金额值转分 | is_amount=true 字段：值归一 → BigDecimal → 转分（unit 取该数据集 amount_fields_json 中该字段的 unit，缺失默认 `yuan`→×100，`point`→×1；复用 AmountUtil.toCent 语义，非 amount_fields 声明字段按 yuan） |
| G7 | 匹配键现算 | 复用 T04 KeyExprEvaluator（{field} 模板）；key_fields_json **对象形式权威**、列表 [f] 兼容等价（→ `{ds:"{f}"}` 同名单字段）；执行链路=**字段值归一 → 拼接匹配键 → 两侧比较**（§6.4）；transform_chain 记诊断 |
| G8 | multi_row | aggregate（数值字段 BigDecimal 求和、非数值取第一条：record_time 升序 NULL 最后，record_time NULL 退 update_seq）/ latest（record_time 最大，NULL 退 update_seq）/ reject（默认）；**空匹配键 → anomaly**（身份 `__nullkey__:ds:record_key`）；reject 一组一条差异、锚表挂全部行（§7.3/§18.2） |
| G9 | 合流 merge | 增量 ∪ 池还原 ∪ 索引回查，按 (ds_code, record_key) 去重、保留来源标记（incr/pool/matched_index）；池还原读 is_deleted=0 当前值；索引回查 IN 分批 1000（§10.2/§10.4） |
| G10 | 差异状态机 + 两轮确认 | §18.2 完整状态机在 ReconRunner 判定阶段实现；**两轮确认双条件在引擎内判定**（对端 MAX(pull_run_id WHERE ds=peer AND status='success') 越过 pending_peer_pull_run_id **OR** now-pending_at > pending_max_wait_hours）；T06 只补独立定时巡检 + 健康闸门完整 + backlog 补算触发 |
| G11 | per-check 事务与幂等 | TransactionTemplate(REQUIRES_NEW) 编程式（技术适配 §2.5，禁 @Transactional 注解）；差异身份 upsert（ON CONFLICT 四元组）；matched 不落明细写 matched_index（先删后插）；游标 advance 到冻结上界 hi |
| G12 | DiffController + 最小健康闸门 | 列表+统计条走 **JPA 只读 Specification**（技术适配 §2.4 查询侧）；最小健康闸门纳入 T05（on_*=block 且最近 pull_run 对应 health → 整轮 skip 写 recon_run + backlog_window），T06 增强 |

**范围外（T06/T07）**：独立 TwoRoundConfirm 定时服务、ReadinessGateEvaluator 完整实现、backlog 补算触发、报告（ReportRunner/渠道）、人工处理端点（recon_diff_handle 写入）、僵尸巡检、数据清理。

---

## 1. 目标与验收

**目标**：把 T04 拉进台账的源数据，按 check 配置消费（游标增量 ∪ 池还原 ∪ 索引回查）→ 匹配（归一→拼接）→ 比较（金额分域/容差）→ 差异按身份沉淀 → 游标推进，产出 recon_run 统计 + 差异只读 API。

**验收标准**（任务分解 T05，4 条）：
1. 一轮走通：增量 ∪ 池还原 ∪ 索引回查 → 匹配（匹配键现算 + field_transform）→ 比较 → 差异按身份 upsert → 游标推进；
2. 幂等：同游标区间重跑不产生重复差异（uk_detail_identity 兜底）；matched 不落明细、写 matched_index（先删后插）；
3. per-check 事务：一个 check 抛错不影响其他 check，整轮 status=partial_success/failed；
4. 差异列表 API：按场景/状态/diff_type/match_key 模糊筛选 + 分页 + 统计条。

---

## 2. 依赖与包结构

**复用（T03/T04 已交付）**：8 配置实体 + Repository（读配置快照）、LedgerDao（upsert/fetchOne）、WatermarkDao（get/commit）、CursorDao（get/advance）、PullRunDao、LedgerService/SeqWatermarkService/CursorService、KeyExprEvaluator/JsonUtil/AmountUtil、TransactionTemplate 模式（PullRunner 先例）。

**T05 新增/扩展**：

| 编号 | 文件 | 职责 |
|---|---|---|
| F91 | `service/engine/MatchEngine.java` | 匹配：键现算 + 归一 + multi_row 分组 → MatchPair 列表 |
| F92 | `service/engine/CompareEngine.java` | 比较：compare_mode/tolerance/is_amount/value_transform → CompareResult |
| F93 | `service/engine/PoolService.java` | 池扫描 + 锚表还原台账当前值 |
| F94 | `service/engine/MatchedIndexService.java` | 索引回查（IN 1000 分批）+ 先删后插 + 按身份删除 |
| F95 | `service/pull/ReconRunner.java` | ★ 主流程：快照→闸门→冻结上界→per-check→合流→匹配→比较→判定→游标 |
| F97 | `service/engine/DiagnosisBuilder.java` | diff_diagnosis_json 三阶段构建（≤32KB 截断） |
| F98 | `service/engine/DiffDescBuilder.java` | diff_desc 中文摘要（§18.4 规则，≤2000 截断） |
| F109 | `job/ReconJob.java` | Quartz Job → ReconRunner.run(scenarioCode) |
| F117 | `controller/DiffController.java` | 差异只读列表 + 统计条（JPA Specification） |
| - | `dao/DetailDao.java` | 差异身份 upsert / 池扫描 / 锚表先删后插 / 状态流转 |
| - | `dao/MatchedIndexDao.java` | matched_index 回查 / 先删后插 / 按身份删除 |
| - | `dao/ReconRunDao.java` | recon_run 启动 / 收尾 / 统计 |
| - | `dao/LedgerDao` 扩展 | `queryBySeq(ds, cursor, hi)` / `queryByKeys(ds, keys)`（IN 分批 1000） |
| - | `domain/runtime/` | MatchPair / CompareResult / MatchResult / DiagnosisContext / LedgerRow（运行期模型，纯 POJO） |
| - | `util/HashUtil.java` | SHA-256 hex（match_key_hash） |

**依赖方向**：engine/dao 只依赖 JdbcTemplate + util + runtime 模型，**零 JPA**（配置读取除外，ReconRunner 读快照用 Repository）；配置 → 引擎数据单向。

---

## 3. 运行期模型（domain/runtime，纯 POJO）

```
LedgerRow        { dsCode, recordKey, recordData(JsonNode), recordTime, updateSeq, amountCent, isDeleted, source(incr|pool|matched_index) }
MatchPair        { matchKeyHash, matchKeyDisplay, left: List<LedgerRow>, right: List<LedgerRow>,
                   multiRowGroupSize, anomalyReason(null|empty_key|reject) }
CompareResult    { consistent, mismatches: List<Mismatch>, diffAmountCent(Long), comparedFields: int }
Mismatch         { name, field, leftValue, rightValue, tolerance, eqRule }
MatchResult      { pairs: List<MatchPair>, unmatchedLeft: List<LedgerRow>, unmatchedRight: List<LedgerRow>, anomalies: List<AnomalyRow> }
DiagnosisContext { checkName, matchKeyHash, matchKeyDisplay, matchPhase, comparePhase, verdictPhase }  // 三阶段快照
```

匹配算法（MatchEngine 产出 MatchResult）：
1. 每侧行按匹配键模板现算 hash（KeyExprEvaluator + field_transform 先归一）；空键行 → anomalies（`__nullkey__:ds:record_key` 身份）；
2. 两侧按 hash 分组：同 hash 两侧都有 → MatchPair（组内行数=multi_row_group_size）；仅一侧 → unmatched 侧集合；
3. multi_row 按策略处理组内行（aggregate/latest 压成单行参与比较；reject → anomalies，身份=真实匹配键 hash，锚挂全部行）。

---

## 4. 配置解析（运行期语义）

| 配置 | 解析规则 |
|---|---|
| consume_json | `{alias: {mode: incremental/time_window, start, end, time_field?}}`；mode 一致性 T03 已校验；**incremental** → 游标增量；**time_window** → record_time 全量圈定 [start,end]（start/end 回退 T03 已定：行内省略取 check 级汇总窗口，已回写兼容） |
| datasets_json | 参与匹配的 alias 列表（有序，**第 1 个=left、第 2 个=right**，T09 收敛 2.0 后 = consume_json 全量）；左右角色=清单顺序 |
| key_fields_json | 对象 `{ds: "{expr}"}` 权威；列表 `[f]` → 每 ds 均 `{f}`（同名单字段兼容） |
| field_transform_json | `[{dataset, field, type, pattern, replacement}]`；type=regex_replace/prefix_add/prefix_remove/none；按 (dataset,field) 匹配，作用于匹配键拼接前 |
| multi_row_json | `{alias: aggregate/latest/reject}`；NULL/缺省 → reject |
| rules_json | `[{name, left_field, right_field, compare_mode, tolerance{type,value}, is_amount, value_transform}]`；left_field/right_field 形如 `ds.field`；tolerance type=absolute/percentage/both/null；tolerance value 单位：is_amount=true→分，false→原值 |
| match_rule.custom_class | strategy=custom / custom_check：全限定类名（第三批 C2/C3，优先 custom_class，config_json.class 兜底） |
| match_rule.config_json | custom / custom_check：参数 JSON 对象；除 `class` 外键值原样作为 Map 传入实现类（C5）；custom 家族含 `class` 键 |
| rules_json 行 compare_mode=custom | `{name, compare_mode:"custom", comparator_class, comparator_params?}`（第三批 C4）：comparator_class=全限定类名（CustomComparator），comparator_params=行级参数 JSON 对象（可选）；无需 left_field/right_field/容差/归一 |

---

## 5. DAO 层（JdbcTemplate 原生 SQL，热路径）

**LedgerDao 扩展**：
```
queryBySeq(dsCode, cursorSeq, hi)         SELECT ... WHERE ds_code=? AND update_seq>? AND update_seq<=? AND is_deleted=0 ORDER BY update_seq
queryByKeys(dsCode, keys)                 IN 分批 1000；SELECT 当前值（含 is_deleted 标记，还原时区分）
```

**DetailDao（新建）**：
```
openPool(scenario, check, poolMaxAgeDays)   池扫描：status IN (pending,confirmed) AND handle_status='unhandled'
                                            AND first_seen_at > now()-interval 'N days'（GREATEST 账龄起点，§10.2）
                                            AND 非 time_window 检查（§18.3 汇总差异不参与池还原合流）
                                              → List<PoolRow{detailId, matchKeyHash, pairSegment, dsCode, recordKey, side}>
upsertDetail(identity, diffType, status, diffDesc, diffAmountCent, diagnosisJson,
             leftDataJson, rightDataJson, pendingPeer*)   ON CONFLICT (scenario,check,pair_segment,match_key_hash) DO UPDATE
upsertAnchor(detailId, side, dsCode, recordKey)           先删后插（按 detail_id 删全部再插）
markResolved(detailId, reopen=false)                      status=resolved + resolved_at + updated_at（保留 diff_type/handle_status）
reopen(detailId)                                          status=confirmed + reopen_seq+1 + reported_at=NULL + resolved_at=NULL
resetPending(detailId)                                    流转时清 pending_peer_* 三字段
markSkippedRun(...) / 统计查询                            池/运行相关
```

**MatchedIndexDao（新建）**：
```
lookup(scenario, check, pairSegment, hashSet)   IN 分批 1000 → (match_key_hash, ds_code, record_key)
replace(scenario, check, pairSegment, hash, rows)  先删（按 hash）后插（两侧行）
deleteByIdentity(scenario, check, pairSegment, hash)   field_mismatch 时删索引 / resolved 重开时删索引
```

**ReconRunDao（新建）**：`insertRun(scenario) → id` / `finishRun(id, status, stats, errMsg)`；status 枚举 running/success/failed/skipped（CK 约束；partial_success 不落库，err_msg 记失败 check 清单，status=failed——验收 3"partial_success/failed"：整轮 status 为 success（全过）/ failed（有 check 失败），err_msg 记明细）。

---

## 6. MatchEngine（G1/G7/G8）

```java
public MatchResult match(CheckCtx ctx, MatchConfig cfg, Map<String, List<LedgerRow>> dataset) {
    // 1. 每侧行：field_transform 归一（transform_chain 记录）→ KeyExprEvaluator 现算匹配键 → SHA-256
    // 2. 空键行 → anomalies（empty_key，身份 __nullkey__:ds:record_key，match_key_display=该字符串）
    // 3. 按 hash 分组：双侧同 hash → pairs；仅单侧 → unmatched 集合
    // 4. multi_row：pairs 内组行数>1 按策略处理（aggregate 压行/latest 取最新/reject 转 anomalies 附全部行）
}
```

- matcher_type（诊断）：`key_fields`（exact/composite 统一按模板，无需区分类型）
- composite_key 与 exact_key **引擎同构**（都是模板表达式现算），策略枚举仅约束管理端可选范围
- multi_row aggregate 压行：数值字段（record_data JSON 值可转 BigDecimal）求和；非数值取第一条（record_time 升序、NULL 最后；record_time 全 NULL 退 update_seq 升序）；`amount_cent` 列按求和覆盖

---

## 7. CompareEngine（G2~G6）

```java
public CompareResult compare(List<CompareRuleRow> rules, MatchPair pair) {
    // 逐规则：取 left_field/right_field 值（record_data JSON 路径，ds 前缀定位侧）
    // 1. value_transform 归一两侧值（none/trim_comma/trim/uppercase/trim_space/lower）
    // 2. is_amount=true → BigDecimal 转分（G6）→ long 域比较 |l-r| vs tolerance.value（分）
    //    is_amount=false → 原值：equal=字符串相等；lte/gte/lt/gt=BigDecimal 数值比较；contains/regex=字符串
    // 3. tolerance：absolute=|l-r|<=value；percentage=|l-r|/|l|<=value（l=0 退化相等）；both=两者都过；null=严格相等
    // 4. 任一规则不一致 → consistent=false；第一个 is_amount 不一致规则的 |l-r|（分）→ diffAmountCent
}
```

- 值缺失语义（§8.2）：JSON 字段不存在或 JSON null = 缺失 → 与任何值比较均不一致；空串 "" = 空值（与 null 不同）；regex 模式用 Java Pattern（replacement 语义仅归一用）
- contains：左侧包含右侧子串
- 全部规则一致 → consistent=true，comparedFields=规则数（诊断）

---

## 8. PoolService / MatchedIndexService（G9）

**PoolService**：
```
openPool(scenario, check, poolMaxAgeDays)   → 池差异列表（DetailDao.openPool）
restore(poolRows)                          → 经锚表 (ds_code, record_key) 查台账当前值（LedgerDao.queryByKeys）
                                              is_deleted=1 的行视为该侧为空（判定 unmatched 出池/流转依据）
                                              → List<LedgerRow>（source=pool，带 detailId 回指）
```

**MatchedIndexService**：
```
lookupBack(hashSet) → 索引 → 对端台账行（queryByKeys；台账行已清理则跳过该索引条目，§10.4）
writeMatched(scenario, check, pairSegment, hash, display, rows)  先删后插（两侧行）
deleteOnMismatch(...) / deleteOnReopen(...)
```

合流 merge（ReconRunner 内）：增量行（source=incr）∪ 池还原行（source=pool）∪ 索引回查行（source=matched_index），按 (ds_code, record_key) 去重——**来源含 pool 优先保留 pool 标记**（配平需回指差异身份）。

---

## 9. ReconRunner 主流程（G10/G11/G17/G18）

```java
public long run(String scenarioCode, LocalDateTime startOverride, LocalDateTime endOverride) {
    // 0. 配置快照：scenario + checks(seq_no 排序) + 每 check match_rule/compare_rule（JPA Repository 读）
    // 1. 健康闸门（最小版）：任一 uses ds 最近 pull_run health=degraded 且 scenario.on_degraded=block → skip
    //      写 recon_run(status=skipped) + recon_backlog_window(全 check 窗口记录) → 返回
    // 2. 冻结上界：watermarkDao.getAll() → {ds_code: committed_seq}（无 → 0）
    // 3. insertReconRun(running)
    // 4. for check（seq_no 升序）:
    //      tx = TransactionTemplate(REQUIRES_NEW)
    //      tx.execute:
    //        4.1 合流：incremental ds → queryBySeq(cursor, hi)；time_window ds → queryByTime(window)；+ pool restore + index back
    //        4.2 hooks：scenario.hooks_json 仅 aggregate_group 支持；无 hooks 跳过（hooks 已实现则执行，MVP 可不配）
    //        4.3 按策略分发：exact_key/composite_key → match → compare（逐 pair）；
    //            custom → runCustomMatch（CustomMatcher，复用既有 pair 判定链路）；
    //            custom_check → runCustomCheck（CustomCheckExecutor，整检查直接出差异）
    //        4.4 判定（§18.2 状态机，见下）
    //        4.5 matched 写索引；unmatched/不一致/异常 → upsertDetail + upsertAnchor + diagnosis
    //        4.6 incremental ds → cursor.advance(scenario, check, ds, hi)
    // 5. finishRun(id, success/failed, stats)   // 统计：matched_count/diff_count/resolved_count/consumed_seq_json
}
```

**判定逻辑（per result）**：

| 本轮结果 | 池中身份 | 动作 |
|---|---|---|
| 匹配一致 | 池有 | markResolved（配平出池，diff_type 保留末态） |
| 匹配一致 | 无 | 不落明细；写 matched_index（先删后插） |
| 不一致（首次） | 无 | upsert：diff_type=field_mismatch，status=confirmed，无 pending 三字段 |
| 不一致（旧 unmatched） | 有(pending) | upsert 流转：diff_type=field_mismatch，status=confirmed，resetPending |
| unmatched（首次） | 无 | upsert：diff_type=unmatched_side，status=pending，记 pending_peer_ds_code（=对端 ds）+ pending_peer_pull_run_id（对端 MAX success id）+ pending_at |
| unmatched（旧 pending） | 有 | 两轮确认双条件：对端新成功拉取越过 OR 超时 → confirmed；否则原地刷新（left/right_data_json、diff_desc、updated_at） |
| unmatched（旧 confirmed） | 有 | 刷新证据，不再升级 |
| anomaly（空键/reject） | 有/无 | diff_type=anomaly，status=confirmed（直接 confirmed，不走两轮确认） |
| custom_check 差异（第三批 C3） | 有/无 | diff_type=custom_check，status=confirmed（直接 confirmed）；pair_segment=-、身份=match_key_hash（由实现类决定）；现场数据经 left/right_data_json 展示，锚点不写 |
| resolved 后又出现不一致 | 有(resolved 不在池) | reopen：status=confirmed + reopen_seq+1 + 清 reported_at + 删 matched_index（重新入池走池还原） |

- diff_type 流转时（unmatched_left↔unmatched_right↔field_mismatch）**重置 pending 三字段**（§18.2/§10.4）
- 池中差异本轮未在增量/索引中出现：留在池（不动作，账龄按 first_seen_at）
- consumed_seq_json：`{"<check>": {"<ds>": <maxSeq>, ...}}`；time_window 检查的 ds 记 0 + `"window": "start~end"` 追踪键
- **幂等**：全部写入走身份 upsert/先删后插；同游标区间重跑结果一致（验收 2）

**失败语义（验收 3）**：check 事务异常 → 捕获记 errMsg（check 名 + 异常摘要），**不中断后续 check**；整轮 finishRun(status=failed, err_msg=失败 check 清单)；全过 → success。

---

## 10. 诊断与摘要（G23/G24）

**DiffDescBuilder（§18.4 规则，≤2000 字符截断加 `...`）**：
```
field_mismatch:   "比较项name: 左值 vs 右值" 分号拼接（值取台账原始值，取匹配键字段+第一个不一致字段）
unmatched_left:   "仅{左侧别名}有 ({匹配键字段=值, ...})"
unmatched_right:  "仅{右侧别名}有 ({匹配键字段=值, ...})"
anomaly:          "数据异常: {原因} ({匹配键字段=值, ...})"   // 原因=同键多行拒绝/空匹配键
```

**DiagnosisBuilder（§18.5 三阶段，≤32KB 截断）**：
```jsonc
{
  "match_phase":   { "matcher_type", "raw_key", "normalized_key", "transform_chain":[{field,rule,before,after}],
                     "left_rows":[{ds_code,record_key,record_time,role}], "right_rows":[...],
                     "unmatched_side", "multi_row_group_size", "matched_index_hit": true/false },
  "compare_phase": { "compared_fields": n, "mismatches":[{field,left,right,tolerance,eq_rule}], "aggregate_summary": null },
  "verdict_phase": { "diff_type_decided", "reason", "pending_peer_pull_run_id", "upgrade_condition", "resume_reason", "generated_at" }
}
```
与 recon_detail upsert 同事务整体重写（§18.5：描述"最新一次判定现场"，不做历史累积）。

---

## 11. DiffController（F117，G12）

```
GET /internal/v1/recon/diffs        列表：params = scenarioCode?/checkName?/status?/diffType?/handleStatus?/
                                        matchKey?(match_key_display 模糊，ilike)/dateFrom?/dateTo?(first_seen_at 范围)
                                        page(1 起)/size(≤100)，sort=first_seen_at desc
GET /internal/v1/recon/diffs/stats  统计条：{ totalUnhandled, totalConfirmedUnhandled, amountCentTotal, diffTypeRatio: {field_mismatch: n, ...} }
```
- **JPA 只读 Repository**（`DetailQueryRepository`，@Entity ReconDetail 挂 JPA？——**裁决**：差异查询实体 ReconDetail 挂 @Entity（查询侧 JPA 允许，技术适配 §2.4），与 ledger 热路径 POJO 并存；Entity 与 POJO 同字段，仅查询用，禁止在热路径注入其 Repository）
- 金额合计 = SUM(diff_amount_cent) WHERE status IN (pending,confirmed) AND handle_status='unhandled'；前端 ÷100 转元
- 枚举中文翻译由前端/API 展示层承担（§18.4 翻译表），存储值不变

---

## 12. 调度与端点

- **ReconJob**（F109）：Quartz Job，jobData `scenarioCode` → reconRunner.run；misfire=skip
- **SchedulerManager 扩展**：registerReconJob(scenarioCode, cronExpr)/removeReconJob —— 参照 T04 PullJob 模式；ScenarioService save/update 后调用（T05 同步接线）
- **OpsController 扩展**：`POST /ops/recon/{scenarioCode}`（手动触发对账，异步线程池）+ 可选 body {start,end} 覆盖窗口（time_window 检查用）
- 幂等并发：同一 scenarioCode 运行中互斥（running map，参照 PullRunner G6）

---

## 13. 修订项

| 项 | 修订 |
|---|---|
| ErrorCode | 追加 7xxx：7009 未支持策略 / 7010 未支持比较模式 / 7011 字段缺失 / 7012 数值解析失败 / 7013 运行中冲突 |
| 配置校验 ErrorCode（第三批 C1） | 追加 6214~6217：6214 自定义类名必填 / 6215 类不存在 / 6216 未实现对应接口 / 6217 参数 JSON 非法（ConfigValidationService，保存拦截） |
| CustomLoader（第三批 C1） | 新建 `service/engine/CustomLoader.java`：全限定类名加载，优先 Spring 容器按类型获取（可注入依赖），容器无则反射无参构造兜底；简名自动补 `com.mis.recon.custom.` 前缀；提供 validate(类名, 接口) 供保存校验（方案 §13.2） |
| CompareEngine（第三批 C4） | 注入 CustomLoader；compare_mode=custom 行 → 加载 comparator_class → CustomComparator.compare(pair)，行级 comparator_params 原样传入；未配置类名降级为差异 |
| util/HashUtil | 新建：SHA-256 hex（match_key_hash 身份列） |
| pom | **无新增依赖**（Quartz/JPA/JdbcTemplate 已在） |
| LedgerDao | 扩展 queryBySeq/queryByKeys（只读，不破坏 T04 契约） |
| 测试 | 新增：MatchEngineTest/CompareEngineTest/DetailDao 单测（MockJdbcTemplate 或 h2？——**裁决**：引擎纯内存单测（构造 LedgerRow 直测）+ DAO 层 SQL 用真实 PG 集成验证（复用 T02 实库，T05 验收手动序列），单测不依赖 PG，沿用 T04 模式） |

---

## 14. 验收标准与验证命令

**自动**：
1. `mvn clean compile` BUILD SUCCESS
2. 新增单测全绿（引擎纯内存 + 解析类），全量回归无新增失败
3. 门禁：emoji/紫粉扫描、单文件 ≤300 行、依赖只向下（engine/dao 零 JPA 注入）

**实库手动序列**（用户环境，recon 库已迁移）：
1. 配 huadi2_order 数据源 → 手动拉取（T04 验收序列）→ 数据进台账
2. 建场景 sc_online_order + check（exact_key，orders vs wechat_pay，compare equal + is_amount）→ `POST /ops/recon/sc_online_order`
3. 复核：recon_run 统计、差异身份 upsert（unmatched → pending）、同窗口重跑无重复差异（幂等）
4. `GET /diffs` 列表筛选 + `GET /diffs/stats` 统计条

---

## 15. 风险与待确认

| # | 风险/待确认 | 处理 |
|---|-------------|------|
| 1 | time_window 双向对比（§18.3）复杂度高，MVP check 均 incremental | **T05 实现基础窗口圈定 + 差异 upsert（confirmed）；双向对比（new vs old 对账）完整版 T06**——裁决：T05 窗口检查差异直接按身份 upsert + 同窗口重算时 upsert 刷新，不做 old_diffs 双向对比（验收不含 time_window check） |
| 2 | hooks_json（aggregate_group）MVP 可不配 | T05 读取 hooks_json，action=aggregate_group 且配置存在才执行；否则跳过；复杂加工 T09+ |
| 3 | 差异查询实体 ReconDetail 挂 @Entity 与热路径 POJO 并存 | 查询 Repository 仅 DiffController 用；**热路径严禁注入**（门禁检查依赖方向） |
| 4 | consumed_seq_json 结构 | 采用 `{check:{ds:seq}}` + window 追踪；T06 报告侧可扩展 |
| 5 | 整轮 status 枚举无 partial_success | CK 约束只有 running/success/failed/skipped；partial 语义用 failed + err_msg 清单表达（验收 3 语义对齐） |

---

## 16. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-14 | 初版：T05 对账引擎规格锁定（12 项裁决 G1~G12 + 状态机 + 算法 + DAO 契约 + 验收） | T05 规格锁定，供后端工程师落地 | 全文档 |
| 2026-08-15 | 交付完成：F91/F92/F93/F94/F95/F97/F98/F109/F117 + DetailDao/MatchedIndexDao/ReconRunDao/LedgerDao 扩展 + 运行期模型 + DiffController/DetailQueryRepository/ReconDetailEntity + 引擎单测（MatchEngineTest 13 / CompareEngineTest 16）全绿；实现细化：MatchEngine 压行抽 RowSquasher、配置解析抽 SnapshotParser（单文件≤300 行门禁）、金额路径 value_transform 归一、transform_chain 诊断落地；`mvn clean compile` + 全量 103 测试 BUILD SUCCESS | T05 后端实现交付 | §2 文件清单（F95 路径修正 + 新增 RowSquasher/SnapshotParser） |
| 2026-08-26 | 第三批 C3+C4+C5+C6+C7：custom 家族全量落地。**C3** strategy=custom_check：`CustomCheckExecutor.execute(CustomCheckContext)` → `List<CustomDiff>`（差异直接 confirmed、身份由实现类决定），SnapshotParser buildCheck custom_check 分支（多数据集入参、match=null），ReconRunner `runCustomCheck` 分发，VerdictService `applyCustomCheck`（diffType=custom_check、status=confirmed、pair_segment=-、现场数据经 left/right_data_json）；**C4** compare_mode=custom：`CustomComparator.compare(MatchPair)` → CompareResult，RuleConfig 增 comparator_class/comparator_params，SnapshotParser.parseRules 解析行级类名/参数（custom 行无需左右字段），CompareEngine 注入 CustomLoader + `compareCustom` 分支（未配置类名降级差异），ConfigValidationService 增 validateCustomComparatorRows（行级类名必填 6214 / 可加载 6215 / 接口 6216 / 参数 JSON 对象 6217）；**C5** 参数透传：config_json 除 class 外键值原样 Map 传入、行级 comparator_params 原样传入；**C6** 管理端前端：策略下拉 5 项、自定义类配置区块（类名 + config_json 编辑器实时语法校验）、Tab A 联动（custom 恰好 2 个 / custom_check 1~N 无角色）、Tab C compare_mode=custom 行（比较器类名 + 行级参数）、custom_check 隐藏 Tab C、保存落库 custom_class/config_json/rules_json、custom_check 差异类型标签；**C7** 本文档 G1/G2 翻转 + 变更记录。新增 23 条 custom 相关测试（CustomLoaderTest 6 / SnapshotParserCustomTest 6 / ReconRunnerCustomTest 3 / CustomVerdictTest 4 / CompareEngineCustomTest 4，覆盖 L/M/X/P/V 各组），**全量 203 测试 BUILD SUCCESS**，exact_key/composite_key/sum_check 无回归 | 第三批 custom 全量开发（custom-需求规格 §3.1~§3.7，方案 §十三） | §0 G1/G2、§4 配置解析、§7 CompareEngine、§9 主流程、§13 修订项 |

> 裁决依据来源：方案 §6.4/§7/§8/§10.1~10.5/§18.2~18.5、任务分解 T05/T06 边界、技术适配 §2.4/§2.5/§2.8、T03/T04-spec 复用面。
