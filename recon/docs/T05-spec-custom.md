# T05-custom 引擎规格 — 自定义扩展（custom 家族）

> 版本：v1.0 ｜ 日期：2026-08-26 ｜ 状态：已落地（第三批 C1~C7 全量交付）
> 适用范围：recon-service 对账引擎的自定义扩展点（strategy=custom / strategy=custom_check / compare_mode=custom）
> 上游规格：《对账框架V3-方案设计.md》§7.1 / §8.1 / §十三（扩展机制权威口径）、《custom-需求规格说明书.md》（需求基线 §3.1~§3.7）、《第三批-批次说明.md》（批次范围与验收）
> 关联文档：`T05-spec.md`（引擎主规格，G1/G2 已翻转）、`T05-spec-sum-check.md`（勾稽引擎）

---

## 0. 裁决摘要（先读）

| # | 裁决点 | 结论 |
|---|--------|------|
| D1 | 引用方式 | 配置写**全限定类名**；无包名简名自动补 `com.mis.recon.custom.` 前缀（CustomLoader.resolveClassName） |
| D2 | 实例化 | 优先 **Spring 容器按类型获取**（可注入 DataSource/RestTemplate 等依赖），容器无则**反射无参构造**兜底（§13.2） |
| D3 | 保存校验 | 类可加载（6215）+ 实现对应接口（6216）+ 类名必填（6214）+ 参数 JSON 对象（6217）；管理端失焦实时校验走 `POST /checks/validate-custom-class` |
| D4 | 参数透传 | `config_json` 除 `class` 外键值原样作为 Map 传入实现类；规则行 `comparator_params` 原样传入比较器 |
| D5 | 诊断上下文 | 自定义实现可选附带 Map → 合并进 diff_diagnosis_json 根级 `custom_context`；不提供则默认空诊断（功能降级可用，§13.2） |
| D6 | 差异语义 | custom → 复用两两匹配差异机制；custom_check → 直接 confirmed、身份由实现类决定；compare_mode=custom → 复用规则级差异写入 |
| D7 | 消费模式 | incremental / time_window 均可用（引擎不拦截） |

---

## 1. 扩展点契约（`com.mis.recon.custom` 包）

### 1.1 CustomMatcher（strategy=custom，C2）

```java
MatchResult match(Map<String, List<LedgerRow>> dataset, Map<String, Object> params);
```

- 入参：`dataset` = ds_code → 行集合（已合流增量∪池∪索引；**第 1=left、第 2=right**，与配置 datasets_json 顺序一致）；`params` = config_json 除 class 外键值原样。
- 出参：`MatchResult`（pairs / unmatched / anomalies），复用既有两两匹配判定链路（VerdictService.apply）。
- 返回 null 视为全空结果（引擎兜底为无差异）。
- 可选在 MatchResult 附带 `diagnosisContext` → 合并进 diff_diagnosis_json 根级 `custom_context`。

### 1.2 CustomCheckExecutor（strategy=custom_check，C3）

```java
List<CustomDiff> execute(CustomCheckContext ctx);
```

- 入参 `CustomCheckContext`：`scenarioCode` / `checkName` / `dataset`（ds_code → 行集合，多数据集）/ `params`。
- 出参 `List<CustomDiff>`：匹配+比较整体自定义，差异**直接 confirmed**（同 sum_check 单源自证思路）。
- `CustomDiff` 字段：`matchKeyHash`（**差异身份，必填**，唯一确定一条差异）/ `matchKeyDisplay`（可读值）/ `diffDesc` / `diffAmountCent`（分，可选）/ `diffPoint`（积分，可选）/ `leftDataJson` / `rightDataJson`（现场数据，可选）。

### 1.3 CustomComparator（compare_mode=custom，C4）

```java
CompareResult compare(MatchPair pair, Map<String, Object> params);
```

- 入参：匹配对（leftSingle / rightSingle 参与比较）+ **行级参数**（`comparator_params` 原样传入，规则行配置；可为 null/空）；出参：`CompareResult.ok`（一致）或 `CompareResult.fail`（差异）。
- Tab C 规则行 compare_mode=custom 时该行走自定义比较器，与内置 equal 行**可混用**。

---

## 1.4 内置示例类（位于 `com.mis.recon.custom.example` 子包，可直接配置使用）

> 示例实现与契约包分离：配置须写**全限定类名**（`com.mis.recon.custom.example.*`）；简名补全（`com.mis.recon.custom.` 前缀）仅对契约包生效（方案 §13 / CustomLoader.resolveClassName）。

| 全限定类名 | 实现接口 | 用途（strategy/compare_mode） | 参数（config_json / comparator_params） |
|---|---|---|---|
| `com.mis.recon.custom.example.CrossSystemIdMatcher` | CustomMatcher | `strategy=custom` | `id_mapping_table`（可选，映射表名）/ `fallback`（可选）；按 record_key 直配，附带诊断计数 |
| `com.mis.recon.custom.example.OrderLifecycleCheck` | CustomCheckExecutor | `strategy=custom_check` | `status_flow`（合法状态白名单，`;` 分隔 / `->` 流转）/ `notify_channel`（可选）；校验 status 合法性，非法 → CustomDiff 直接 confirmed |
| `com.mis.recon.custom.example.TieredPricingComparator` | CustomComparator | `compare_mode=custom` | `amount_field`（必填）/ `tiers`（`[{min,max,tolerance}]` 区间容差，元）/ `round`（可选，默认 2）；按左金额区间容差比较 |

---

## 2. 配置落库形态（§3.7 权威）

| 配置 | 形态 |
|---|---|
| `strategy` | `custom` / `custom_check`（枚举扩展，见 T05-spec G1） |
| `custom_class` | 全限定类名（必填） |
| `config_json` | JSON 对象，含 `class` 键（与 custom_class 一致）+ 其余参数键；除 class 外键值原样传入实现类 |
| `datasets_json` | 参与数据源 alias 列表（custom 恰好 2 个；custom_check 1~N 个，无左右角色） |
| `rules_json`（custom） | 规则表保留；`compare_mode=custom` 行含 `comparator_class`（全限定类名）+ `comparator_params`（行级参数 JSON 对象，可选）；无需 left_field/right_field/容差/归一 |
| `rules_json`（custom_check） | 空数组（整检查无规则表） |

---

## 3. 引擎行为

### 3.1 分发（ReconRunner）

```
exact_key / composite_key → match（匹配键现算）→ compare（逐 pair，CompareEngine）
custom              → runCustomMatch：CustomLoader.load(custom_class, CustomMatcher)
                      → match(dataset, params) → MatchResult → 复用既有判定链路
custom_check        → runCustomCheck：CustomLoader.load(custom_class, CustomCheckExecutor)
                      → execute(ctx) → List<CustomDiff> → VerdictService.applyCustomCheck
compare_mode=custom → CompareEngine.compareCustom：CustomLoader.load(comparator_class, CustomComparator)
                      → compare(pair) → CompareResult（未配置类名 → 降级为差异）
```

### 3.2 custom_check 差异落池（VerdictService.applyCustomCheck）

| 项 | 值 |
|---|---|
| diff_type | `custom_check` |
| status | `confirmed`（直接 confirmed，不走两轮确认） |
| pair_segment | `-` |
| identity（match_key_hash） | 实现类给的 `matchKeyHash`；空白 → 跳过该条（降级可用） |
| 锚点 | 不写（CustomDiff 无行引用；现场数据经 left/right_data_json 展示） |
| 诊断 | `reason=custom_check`（+ 实现类可选 custom_context） |

### 3.3 配置解析（SnapshotParser）

- `buildCheck`：custom 分支（class 优先 custom_class、config_json.class 兜底；params 除 class 外键值原样；datasets 恰好 2 个）；custom_check 分支（多数据集入参、match=null、sumRules/compareRules 空）。
- `parseRules`：custom 行解析 comparator_class / comparator_params（JSON 对象）；无字段 custom 行允许入列。

---

## 4. 校验与错误码

| 码 | 含义 | 触发点 |
|---|---|---|
| 6214 | 自定义类名必填 | CustomLoader.validate 空白类名 |
| 6215 | 自定义类不存在 | ClassNotFoundException |
| 6216 | 未实现对应接口 | 类不满足 CustomMatcher / CustomCheckExecutor / CustomComparator |
| 6217 | 自定义参数 JSON 格式错误 | config_json / comparator_params 非 JSON 对象 |

- **保存校验**：ConfigValidationService.validateCheck（validateCustomStrategy / validateCustomComparatorRows），对全部策略生效。
- **实时校验端点**（C6）：`POST /internal/v1/recon/checks/validate-custom-class`，body `{className, checkType}`（`custom`→CustomMatcher / `custom_check`→CustomCheckExecutor / `custom_compare`→CustomComparator）；通过返回 `{ok, className}`，不通过抛 6215/6216 由全局处理器转 Result。

---

## 5. 测试计划（已落地）

| 组 | 范围 | 文件（用例数） |
|---|---|---|
| L | CustomLoader 加载（Spring 优先 / 反射兜底 / 简名补全 / 类与接口校验） | `CustomLoaderTest`（6） |
| M | CustomMatcher 集成（配置解析 / 主流程分发 / 差异判定） | `SnapshotParserCustomTest`、`ReconRunnerCustomTest`、`CustomVerdictTest` |
| X | CustomCheckExecutor（多数据集解析 / 分发 / 直接 confirmed / 空白身份跳过） | `SnapshotParserCustomTest`、`ReconRunnerCustomTest`、`CustomVerdictTest` |
| P | CustomComparator（规则级一致 / 差异 / 混用 / 未配置类名降级 / 行级解析） | `CompareEngineCustomTest`（4）、`SnapshotParserCustomTest` |
| V | 保存校验（类名必填 / 可加载 / 接口 / 参数 JSON） | `CustomLoaderTest` L-4~L-6、ConfigValidationService 分支 |

合计 23 条 custom 相关测试，全量 **203 测试 BUILD SUCCESS**，exact_key / composite_key / sum_check 无回归。

---

## 6. 验收口径

1. `strategy=custom`（类名 + 参数）可保存、调度执行，自定义匹配产出 pair 并走既有差异判定链路。
2. `strategy=custom_check` 可保存、调度执行，整检查产出差异直接 confirmed。
3. Tab C 规则行 `compare_mode=custom` 可配置类名并生效（规则级自定义比较）。
4. `config_json` 参数（除 class 外）原样透传实现类，运行期与保存校验一致。
5. 类名校验：不可加载 / 未实现对应接口 / 参数 JSON 非法时保存拦截并红字提示（管理端另有失焦实时校验）。
6. exact_key / composite_key / sum_check 全量回归无破坏。

---

## 7. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-26 | 初版：custom 家族引擎规格锁定（扩展点契约 / 落库形态 / 引擎行为 / 校验错误码 / 测试映射 / 验收），对齐方案 §十三、custom-需求规格 §3.1~§3.7、批次说明 §3/§4/§6 | 第三批 C1~C7 交付后补齐引擎规格文档 | 全文档 |
