# T05-spec-sum-check：sum_check（同一数据源内部勾稽）引擎实现规格

> 版本：v1.1 ｜ 日期：2026-08-25 ｜ 状态：**已实现（第二批交付）**：G1~G7 全部落地，单测 E 10 + C 5 + S 判定 4 + V 4 全绿，recon-service 全量回归通过
> 批次：2026-08-24 批次重排，sum_check 归第二批（第一批 = exact_key/composite_key 已闭环）；管理端界面（v5.6/v5.7）已实现并验收、保留复用，本规格仅覆盖**引擎侧**（G1~G7）。
> 权威需求口径：《对账框架V3-方案设计.md》§十二（sum_check 目标形态）；批次总览：《第二批-批次说明.md》。

## 1. 背景与目标

同一数据源内部勾稽（业务盘点 D12「同源自比」）：每行独立比较 `left_expr` 与 `right_expr`（如「订单总额 = 积分 + 现金 + 券」、「净额 = 总额 - 退款 = 分量之和」）。当前引擎侧 sum_check **未实现**：

- `SnapshotParser.buildCheck` 硬性要求 `datasets.size()==2`，单数据源 check 被**静默跳过**；
- `CompareEngine` 仅有 leftField/rightField 两两匹配形态，无 left_expr/right_expr 表达式能力；
- `T05-spec G1` 至今定案「sum_check 抛 7009 未支持」；
- 任务分解 F24 规划的 `ExpressionEvaluator` 从未创建。

目标：实现 sum_check 引擎全链路（解析 → 消费 → 逐行勾稽 → 落池/配平），与方案 §十二 语义完全一致。

## 2. 术语

| 术语 | 含义 |
|---|---|
| 勾稽（sum_check） | 单数据源内部，逐行比较左右表达式是否相等 |
| left_expr / right_expr | 勾稽规则左右表达式：单字段引用（`orders.total_amount`）或算术表达式（`orders.a + orders.b - orders.c`） |
| record_key | 台账行的业务标识（row key），sum_check 差异身份来源 |
| 配平出池 | 重跑一致时，将池内旧差异置 resolved（幂等闭环） |

## 3. 配置形态（落库）

```
strategy: sum_check
datasets: [单数据源 alias]           # 恰好 1 个；不产生 key_fields/field_transform/multi_row
rules:                                # 每条 = 一个勾稽规则
  - { name: "总额勾稽",
      left_expr: "orders.total_amount",
      right_expr: "orders.integral_amount + orders.cash_card_amount + orders.coupon_amount",
      tolerance: {type, value},       # 复用既有 tolerance 语义（单位=分）
      is_amount: true }
```

- `rules_json` 行结构 = `{name, left_expr, right_expr, tolerance:{type,value}, is_amount}`，与方案 §十二 comparator.fields 一致，管理端落库格式不变。
- 消费模式默认 `incremental`（逐行勾稽）；`time_window` 不拦截（两模式可用）。

## 4. 引擎流程（总览）

```
ReconRunner.runCheck(strategy=sum_check)
  └─ SnapshotParser.buildCheck（datasets=1、match=null、sumRules 解析）
      └─ 单源消费（incremental/time_window）
          └─ CompareEngine.compareSum：每行 evalSum(left_expr) vs evalSum(right_expr)（含容差）
              ├─ 一致  → VerdictService.applySumCheck：findIdentity(record_key 哈希) → resolved 配平出池 + 状态历史
              └─ 不一致 → upsertDetail：status=confirmed、match_key_hash=SHA-256(record_key)、side=left、diff_type=field_mismatch
```

## 5. ExpressionEvaluator（G1 · 新建）

**类**：`com.mis.recon.util.ExpressionEvaluator`

- **接口**：`BigDecimal evaluate(String expr, Map<String, BigDecimal> fieldValues)`；失败（缺失字段/非法语法/除零）返回 `null`，不抛异常。
- **语法**：`+ - * / ( )`，操作数为 `alias.field` 字段引用或十进制数字；支持单目负号 `-x`（实现为 `0 - x`）。
- **实现**：递归下降解析（tokenize → expression/term/factor 三级），运算用 `BigDecimal`（除零返回 null；金额除法按既有 AmountUtil 语义处理精度）。
- **引用解析**：`alias.field` → 在传入字段值 Map 中取 `alias.field` 键；缺失键返回 null（记 missing 差异）。
- **边界**：空表达式/纯空白 → null；未知运算符/括号不配对/操作数缺失 → null。

## 6. CompareEngine.compareSum（G2）

**类**：`com.mis.recon.service.engine.CompareEngine`（新增方法，不动既有 match 路径）

- 新增 `SumRuleConfig`：`{name, leftExpr, rightExpr, tolerance, isAmount}`。
- `compareSum(rowData, SumRuleConfig)`：
  1. `leftVal = ExpressionEvaluator.evaluate(leftExpr, rowValues)`、`rightVal = evaluate(rightExpr, rowValues)`；
  2. 任一侧 null → 返回 `MISSING`（缺字段/非法表达式，差异落池，diff 原因可区分）；
  3. 两侧均非 null → 复用既有 `amountMatch`（is_amount=true，分单位容差）/ `plainMatch`（非金额）判定：`|left - right| <= tolerance` → 一致，否则 `FIELD_MISMATCH`。

## 7. SnapshotParser / ConfigSnapshot（G3）

**现状**：`buildCheck` 硬性要求 `datasets.size()==2`，否则跳过该 check（sum_check 单源被静默跳过）。

**改造**：
- `ConfigSnapshot.CheckSpec` 增加 `strategy` 字段；`match` 允许为 null（sum_check 无两两匹配）；新增 `sumRules`（List<SumRuleConfig>）。
- `SnapshotParser.buildCheck` 分支：`strategy == sum_check` → 校验 `datasets.size()==1`（不满足记配置错误而非静默跳过），解析 `rules_json` 为 `sumRules`，`match=null`；`exact_key`/`composite_key` 维持现状（恰好 2 个、match 必填）。

## 8. ReconRunner（G4）

**现状**：所有 check 统一走 `matchEngine.match`，无 sum_check 分支。

**改造**：`runCheck` 分支 `strategy == sum_check` → 走 `runSumCheck`：
- 单数据源消费（incremental 为主；time_window 兼容，不拦截）；
- 逐行读取台账行 → 逐条 `compareSum` → 结果交 `VerdictService.applySumCheck`；
- 跳过匹配/索引构建（无匹配键）。

## 9. VerdictService.applySumCheck（G5）

**现状**：`apply` 只处理 pairs/unmatched/anomaly。

**改造**：新增 `applySumCheck(recordKey, matchResult, ...)`：

- **不一致（MISSING / FIELD_MISMATCH）**：
  - `upsertDetail`：`status=confirmed`（直接 confirmed，不进两轮确认）、`match_key_hash=SHA-256(record_key)`、`match_key_display=record_key`、`side="left"`（单源无左右概念，决策 R1）、`diff_type=field_mismatch`（missing 可附原因）。
- **一致**：
  - `findIdentity(match_key_hash)` 查找池内旧差异 → 存在则 `markResolved` 置 resolved **配平出池** + 写状态历史（`reason=sum_check_matched`，决策 R2）；不存在则无事（幂等：重跑 N 次一致均无新增差异）。
- 复用既有 `DetailDao` 能力：upsertDetail / findIdentity / markResolved / touchConfirmedAt / insertStatusHistory（均已有）。

## 10. ConfigValidationService（G6）

**现状**：strategy 枚举放行 sum_check，但无 sum_check 专属校验。

**改造**：`strategy == sum_check` 时：
- 消费清单（datasets）**恰好 1 个**（拦截：`汇总校验 sum_check 需要恰好 1 个参与数据源（当前 N 个）`）；
- 每条勾稽规则 `left_expr` / `right_expr` **必填**；
- 跳过匹配键/字段归一/同键多行/字段比较规则校验；
- exact_key / composite_key 维持「恰好 2 个」既有校验不变（无回归）。

## 11. 边界与实现决策

| # | 决策 | 取值 | 依据 |
|---|---|---|---|
| R1 | 差异锚表 side | 统一 `"left"` | 单源无左右概念 |
| R2 | 一致配平写状态历史 | 写，reason=`sum_check_matched` | V4 埋点惯例 |
| R3 | time_window 消费 | 引擎不拦截（incremental 为文档默认） | 方案 §十二 |
| R4 | 单目负号 `-x` | 支持（实现为 `0 - x`） | 成本低 |

**一致行语义**（已与用户确认）：重跑一致 → `findIdentity(record_key 哈希)` 将池内旧差异置 `resolved` 配平出池，与 exact_key `handleMatched` 机制一致，保证幂等闭环。

## 12. 非目标（第二批不做）

- `aggregate_group` Hook（按日汇总勾稽）——后续形态；
- fuzzy / chain / custom / custom_check 引擎——后续形态；
- 表达式函数调用（sum/min/max 等）——后续形态（当前仅四则）。

## 13. 测试计划

### 13.1 E 组：ExpressionEvaluator 单测（10 条）
1. 单字段引用 `orders.total_amount` 取值
2. 四则混合 `a + b - c * d / e`（BigDecimal 精度）
3. 括号优先级 `(a + b) * c`
4. 单目负号 `-a + b`
5. 纯数字表达式 `100 + 50`
6. 除零 → null（不抛异常）
7. 缺失字段引用 → null
8. 非法语法（`a + + b` / `(a + b` / `a b`）→ null
9. 空表达式/空白 → null
10. 金额精度（0.1 + 0.2 无浮点误差）

### 13.2 C 组：compareSum 单测（5 条）
1. 左右相等 → 一致
2. 差在容差内 → 一致（is_amount 分单位）
3. 差超容差 → FIELD_MISMATCH
4. 左/右缺字段 → MISSING
5. 金额 vs 非金额（is_amount=false）分支正确

### 13.3 S 组：引擎集成（7 条）
1. SnapshotParser 解析 sum_check 配置（datasets=1、match=null、sumRules）
2. 单数据源 check 不再被静默跳过
3. ReconRunner.runSumCheck 全流程：消费 → 勾稽 → 差异落池（confirmed + record_key 哈希）
4. 一致行重跑 → 旧差异 resolved 配平出池
5. 重跑幂等：N 次一致无新增差异
6. exact_key/composite_key 全量回归无破坏
7. 配置错误（datasets=2 的 sum_check）明确报错而非静默跳过

### 13.4 V 组：保存校验（4 条）
1. sum_check datasets=2 → 拦截
2. sum_check left_expr 为空 → 拦截
3. sum_check 合法配置 → 通过
4. exact_key/composite_key 校验无回归

### 13.5 UI 组（管理端，第二批放开时）
- stub-DOM 冒烟恢复 sum_check 场景：63/63 断言基线（v5.7 已验证，放开下拉后回归确认）。

## 14. 文档同步（G7）

- `T05-spec.md`：G1「sum_check 抛 7009 未支持」→「已支持（第二批）」；
- `T05-spec-sum-check.md`：本规格标注「已实现」；
- 原型 README：追加第二批交付记录（放开下拉 + 联调结果）；
- 《第二批-批次说明.md》：验收标准打勾。
