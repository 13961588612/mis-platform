# T04 拉取引擎规格锁定 — recon-service（ledger 实体 + 台账/游标/水位 DAO + 动态连接池 + 方言 + 参数绑定 + PullRunner + 调度 + Ops）

| 项 | 值 |
|----|----|
| 文档状态 | 已锁定（T04 执行依据；T04 只产出规格与类设计，正式 Java 代码由后端工程师按本规格落地） |
| 负责人 | 架构师 高见远 |
| 日期 | 2026-08-14 |
| 适用阶段 | T04 拉取引擎（PullRunner：窗口 + 键集分页 + 台账 upsert + update_seq + 健康度） |
| 物理位置 | `D:\work\mis-platform\recon\`（独立工程，独立 database `recon`） |

执行依据（唯一口径，本规格不得偏离）：
- 《对账平台V3-开发任务分解.md》§六 类图（686~799 行）、§7.1 拉取时序（804~831 行）、T04 章节（941~950 行）、§九 共享知识（1047~1062 行）
- 《对账平台V3-接入MIS技术适配.md》§2.2（JSONB 热路径约定）/ §2.3（update_seq + 台账 upsert SQL 骨架）/ §2.4（JdbcTemplate 热路径 DAO 划分）/ §2.5（每 2000 行一批 TransactionTemplate）/ §2.6（Quartz JDBC JobStore）/ §2.7（动态 DataSource 注册表 + DbDialect + 键集分页）/ §2.8（ojdbc11 保留为源库驱动）/ §四 T04 修订段（359~369 行）
- 《V3瘦身版-修订草案-架构-补丁02-异构源与规模化.md》§2.2~§2.5（金额标准化 toCent 公式、V17/V18/V19 试拉校验、V25 唯一性探针）、§6.1（V20 管 key_scan_sql 增量窗口 / V22 管 agg_sql 禁窗口）
- 《第一批-check配置文档.md》§1.3（时间口径：fetch_time_field 与 biz_time_field 分离）、§1.4（huadi2_order 取数 SQL 骨架，LEFT JOIN pay_detail，`:p_start`/`:p_end` 窗口参数）
- 《后台原型需求说明书-第一批-线上订单.md》§3.3（测试连接=试拉 BR-18：小窗口取数返回样例）、§3.2（fetch_config_json：窗口 SQL `{time_start}`/`{time_end}` 占位 + 可选 fetch_one_sql `{record_key}` 占位）
- T01/T02/T03 已落位：`docs/T01-spec.md`、`docs/T02-spec.md`、`docs/T03-spec.md`、`V1__init.sql`（recon_source_record/pull_run/seq_watermark/consume_cursor 第 187~247 行）、`application.yml`（Quartz JDBC JobStore + 调度开关）

产出文件对应关系（后端工程师落代码时的目标文件）：

| 编号 | 目标文件 | 内容 | 本规格章节 |
|------|----------|------|-----------|
| 补建 | `util/AmountUtil.java` | 金额标准化唯一入口 | §2 |
| 补建 | `util/KeyExprEvaluator.java` | record_key 模板现算 | §3 |
| 补建 | `util/JsonUtil.java` | JSON 读写（替代 JsonSupport 的公共版） | §2 |
| F36~F39 | `domain/ledger/ReconSourceRecord.java / ReconPullRun.java / SeqWatermark.java / ReconConsumeCursor.java` | 台账/拉取运行/水位/游标 POJO（**不挂 @Entity**） | §4 |
| F65 | `dao/LedgerDao.java` | 台账 upsert（ON CONFLICT）+ fetch_one | §5 |
| F66 | `dao/PullRunDao.java` | pull_run 启动/收尾/最近成功窗口查询 | §5 |
| F67 | `dao/CursorDao.java` | 游标 get/advance（T05 消费，T04 建好） | §5 |
| F68 | `dao/WatermarkDao.java` | 水位 getAll/commit | §5 |
| F82 | `service/support/ConnectionPoolManager.java`（改造 T03 版） | HikariCP 完整池 + evict | §6 |
| F83 | `service/support/DbDialect.java` | 三方言 LIMIT/键集/时间函数 | §6 |
| F84 | `service/support/SqlParamBinder.java` | `:p_start` 等 → `?` 预编译绑定 | §6 |
| F85 | `service/ledger/LedgerService.java` | upsertRows / fetchOne 编排 | §7 |
| F86 | `service/ledger/SeqWatermarkService.java` | 水位 commit | §7 |
| F87 | `service/ledger/CursorService.java` | 游标 get/advance（T05 消费） | §7 |
| F88 | `service/ledger/HealthEvaluator.java` | 健康度评估 | §7 |
| F90 | `service/pull/PullRunner.java` | 拉取引擎主流程 | §8 |
| F108 | `job/PullJob.java` | Quartz Job | §9 |
| F112 | `service/pull/SchedulerManager.java` | 动态注册 pull 任务 | §9 |
| F118 | `controller/OpsController.java` | 手动拉取 / fetch_one / 试拉 | §10 |
| 修订 | `common/ErrorCode.java` | 追加 7xxx 拉取码段 | §11 |
| 修订 | `recon-service/pom.xml` | 追加 ojdbc11（runtime） | §11 |
| 修订 | `service/config/DatasourceService.java` | TODO(T04) → SchedulerManager 调用 | §9 |

---

## 0. 全局裁决摘要（先读）

| # | 裁决项 | 结论 | 理由（一句） |
|---|--------|------|--------------|
| G1 | ledger 实体是否挂 @Entity | **不挂。纯 POJO + RowMapper 手工映射** | 技术适配 §2.4：引擎热路径全走 JdbcTemplate 原生 SQL，不经过 JPA EntityManager；挂 @Entity 会进 Hibernate 元数据验证/一级缓存生命周期，与热路径隔离原则冲突；类图（§六）中 ReconSourceRecord 即普通类 |
| G2 | 取数 SQL 窗口参数占位符 | **统一 `:p_start` / `:p_end`（pk 模式 `:p_last_pk`），与 T03 V20/V22 校验、第一批配置文档 §1.4 骨架、共享知识 #4 三处口径一致**；`{time_start}`/`{time_end}`/`{record_key}` 花括号写法作为**兼容输入**由 SqlParamBinder 归一 | V20 校验已锁 `:p_start`/`:p_end`（T03 交付），配置文档实际 SQL 用 `:p_start`/`:p_end`；花括号是需求说明书 UI 层描述，双轨并存必出 bug，绑定器两者都吃 |
| G3 | 键集分页列 | **二元组 `(time_field, keyset_pk_field)`；keyset_pk_field 默认 = record_key_expression 首个 `{field}`，可在 fetch_config_json.keyset_pk_field 覆盖** | 取数 SQL 是配置人手写（输出列平台不可控），record_key 是现算表达式非列；单列 time_field 键集在同秒多行截断时漏数，必须二元组；默认取 record_key 首字段覆盖 99% 场景（huadi2_order=order_no），零新增配置 |
| G4 | 窗口衔接 | **window_start = 上次成功 window_end − overlap（fetch_overlap_sec 默认 300）；window_end = 平台 now()；首次拉取起点 = fetch_config_json.initial_start（可选，默认 now − 24h）** | 验收 2「窗口衔接取上次成功 window_end」；overlap 防源库窗口边界行漏拉（T02 连接表 fetch_overlap_sec 默认 300 已落 DDL） |
| G5 | 水位提交与批事务 | **每批（2000 行）一个 TransactionTemplate 事务：upsert 批次 + 更新 watermark 同一事务提交；批失败整批回滚、水位不前进** | 技术适配 §2.3「每批提交后更新 committed_seq」+ §2.5「每 2000 行一批一个事务」；批内原子性保证水位=真实已提交数据 |
| G6 | 并发互斥 | **应用级 `ConcurrentHashMap<String, Boolean> running`（key=dsCode），入口 putIfAbsent，finally remove** | 同 ds 重复触发（Ops + Quartz 撞车）必须在入口拦截；DB 级 pull_run status=running 检查作为兜底留 T06（僵尸巡检归属） |
| G7 | fetch_one 是否写 pull_run | **不写 pull_run**（单条重拉无窗口语义），直接 upsert 抬高 update_seq 并返回结果 | 类图 fetchOne 与 run 分离；验收 4「fetch_one 单条重拉并抬高 update_seq」无需运行记录 |
| G8 | Ops 手动拉取同步/异步 | **T04 同步执行并返回 pull_run 摘要**（OpsController 直调 PullRunner.run）；窗口默认 now−24h~now，可传 start/end 覆盖 | T04 验收 1「手动触发拉取」要直接看到结果；MVP 窗口受控同步可接受，异步化留 T09 管理端 |
| G9 | record_data 键名 | **按取数 SQL 输出列名原样存储（不按 fields_json 做 source→target 重命名）**；record_key/time_field/amount 取值按「源字段名」匹配 | 字段重命名映射是展示层/比较层语义（T05/T09 细化），T04 台账先行原样落；fields_json 重命名映射登记为风险 |
| G10 | 健康度 MVP 口径 | rows==0 → `empty`；本次行数 vs 最近一次成功 pull_run 行数波动超 row_count_delta_pct → `degraded`；异常 → `error`；否则 `healthy` | 验收 3「pull_run 记录健康度（healthy/empty/degraded）」；row_count 波动阈值取自 health_rules_json（第一批默认 50） |
| G11 | 金额方向 amount_direction | 读 amount_fields_json primary 字段的 `direction` 声明（in/out/none），无声明 → none | V1 DDL 注释：in(收)/out(付)/none(非资金行)；T04 从配置读，不推断 |
| G12 | 批次行数 | 每批固定 2000（与技术适配 §2.5 一致），不做自适应 | 规模优化留后；2000 是既有契约 |
| G13 | ojdbc11 | **recon-service/pom.xml 追加 `com.oracle.database.jdbc:ojdbc11`（scope=runtime）** | 技术适配 §2.8：平台库不再用 Oracle，但源库 Oracle 直连是领域刚需，ojdbc11 以源库驱动身份保留 |
| G14 | 调度注册时机 | DatasourceService.save/update 后调用 `schedulerManager.refreshPullJob(dsCode, pullCron)`（替换 T03 TODO(T04) 注释位）；启动加载 enabled=1 且 pull_cron 非空的 ds | 任务分解 F112「SchedulerManager 先支持 pull」+ 配置即对账（cron 变更即时生效） |

---

## 1. 依赖与包结构

### 1.1 新增包

```
com.mis.recon.util            # AmountUtil / KeyExprEvaluator / JsonUtil（F15~F24 计划落地）
com.mis.recon.domain.ledger   # 台账/运行/水位/游标 POJO（纯 POJO，不挂 @Entity）
com.mis.recon.dao             # LedgerDao / PullRunDao / CursorDao / WatermarkDao（JdbcTemplate）
com.mis.recon.service.ledger  # LedgerService / SeqWatermarkService / CursorService / HealthEvaluator
com.mis.recon.service.pull    # PullRunner / SchedulerManager
com.mis.recon.job             # PullJob（Quartz）
```

### 1.2 依赖注入

- DAO 注入 `JdbcTemplate`（平台库，T01 JdbcTemplateConfig 已配 `@Primary` JpaTransactionManager）
- PullRunner 注入 `PlatformTransactionManager`（构建 TransactionTemplate，技术适配 §2.5）
- SchedulerManager 注入 `Scheduler`（Spring Boot 自动装配）
- ConnectionPoolManager 增加注入 `ConnectionRepository`（构建池时查连接配置）
- OpsController 注入 PullRunner（异步线程池由 T01 AsyncConfig 提供）

### 1.3 热路径纪律（技术适配 §2.4 落地）

- PullRunner / LedgerDao / PullRunDao / WatermarkDao / CursorDao **全部 JdbcTemplate 原生 SQL**，不触碰 JpaRepository（防一级缓存读旧值）
- PullRunner 只在入口读配置（ds/conn 由 JPA Repository 查一次，快照化），批循环内零 JPA
- JSONB 写 `CAST(? AS jsonb)`，读 `col::text`（技术适配 §2.2 约定），不裸用 PGobject

---

## 2. util 包（F15~F24 计划落地，T04 只建本任务所需 3 个）

### 2.1 AmountUtil（F 类图 AmountUtil，金额三态律唯一换算入口）

```java
package com.mis.recon.util;

public final class AmountUtil {
    private AmountUtil() {}

    /**
     * 原始金额 → 整数分（共享知识 #1：ROUND(原始值 × (unit=yuan?100:1)) × sign_factor）
     * @param raw     源行金额原始值（String，可能为 null/空/非法）
     * @param unit    单位：yuan / point / non_monetary（AmountEnums.AmountUnit.name()）
     * @param signRule 符号规则：as_is / negate（RefundSignRule 语义；same_table_negative=as_is）
     * @return 整数分 Long；unit=point/non_monetary → null（V33：积分不是钱）；raw 非法 → null
     */
    public static Long toCent(String raw, String unit, String signRule) { ... }

    public static long abs(long v) { return v < 0 ? -v : v; }

    /** 展示层：分 → 元（BigDecimal 两位，非比较路径） */
    public static BigDecimal toYuan(Long cent) { ... }
}
```

实现要点（裁决 G-金额）：
- **BigDecimal 运算禁 double**（共享知识 #1）：`new BigDecimal(raw.trim())` → `stripTrailingZeros()` 得原始精度
- `unit=yuan`：`raw.multiply(100)`；`unit=point/non_monetary`：直接返回 `null`（不进 amount_cent）
- `signRule=negate`：结果取反（`sign_factor = -1`）
- 结果 `longValueExact()`（超 BIGINT 抛 ArithmeticException → 上层捕获记 error 行，不中断整批——见 §5.1 异常策略）
- `raw` 为 null / 空白 / 非数字 / 三位以上小数（V19 语义：ROUND 会丢精度）：返回 `null`，**不进 amount_cent**（amount_raw 仍落原始串可回溯）
- 单测对齐共享知识 #1 验收样例：`toCent("100.00","yuan","as_is")=10000`、`toCent("1.50","yuan","negate")=-150`、ROUND 边界（`"1.005"` 非两位小数 → null）

### 2.2 KeyExprEvaluator（F21 计划，T04 落地 record_key 求值）

```java
package com.mis.recon.util;

public final class KeyExprEvaluator {
    private KeyExprEvaluator() {}

    /**
     * 模板表达式 → 值（Java 侧现算，LedgerDao.upsert 前调用）
     * 语法：{field} 占位；{f1}_{f2} 复合键（分隔符为模板字面量，可 `_`/`-`/自定义）
     * @param expr  record_key_expression（如 "{order_no}" 或 "{order_no}_{pay_channel}"）
     * @param row   源行数据（key=输出列名/源字段名，value=任意类型 → toString）
     * @return 拼接后的字符串键；缺失字段 → null（上层记 error 行）
     */
    public static String evaluate(String expr, Map<String, Object> row) { ... }

    /** 提取模板中全部 {field}，按出现顺序（G3 默认 keyset_pk = 首个） */
    public static List<String> extractFields(String expr) { ... }
}
```

实现要点：
- 正则 `\{([A-Za-z0-9_]+)\}` 匹配占位，逐字段替换
- 字段值 null → 返回 null（键不可缺，缺键行无法 upsert，记 error 行）
- 字段值 `toString()` 后原样拼接（不做大小写归一；key_case_mode 属匹配键语义，T05 消费）
- `extractFields` 供 DbDialect 键集包装取默认 keyset_pk 列

### 2.3 JsonUtil（公共 JSON 读写，替代 JsonSupport 的公共版）

```java
package com.mis.recon.util;

public final class JsonUtil {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private JsonUtil() {}

    /** 解析 JSON 字符串；null/空白返回 null；非法抛 BizException(1003) */
    public static JsonNode parse(String json) { ... }

    /** 解析为对象；非对象抛 BizException(1003) */
    public static ObjectNode parseObject(String json) { ... }

    /** 任意对象 → JSON 字符串（record_data 组装用）；null → "null" */
    public static String toString(Object value) { ... }
}
```

> 说明：T03 的 `service/config/JsonSupport` 为 package-private 辅助，保持不动（T03 已交付）；JsonUtil 是公共版，T04 起新代码统一用 JsonUtil；F21 落地时 JsonSupport 迁移合并（登记 §12 风险）。

---

## 3. fetch_config_json 结构与取数 SQL 契约（T04 运行期解析）

### 3.1 结构（fetch_config_json，JSONB）

```json
{
  "fetch_mode": "time",
  "fetch_time_field": "update_time",
  "fetch_time_kind": "db_guaranteed",
  "fetch_time_evidence": "update_time 带 ON UPDATE",
  "biz_time_field": "create_time",
  "sql": "SELECT o.order_no, o.amount, o.wx_pay_amount, o.create_time, pd.serial_code AS wechat_pay_no FROM huadi2.order o LEFT JOIN huadi2.pay_detail pd ON o.code = pd.code WHERE o.update_time >= :p_start AND o.update_time < :p_end",
  "fetch_one_sql": "SELECT ... WHERE o.order_no = :record_key",
  "initial_start": "2026-08-01 00:00:00",
  "keyset_pk_field": "order_no"
}
```

字段语义（T04 只消费标 ★ 的字段，其余忽略——JSON 未知字段不报错，与 G13/T03 兼容约定一致）：

| 字段 | T04 消费 | 说明 |
|------|---------|------|
| `fetch_mode` ★ | 是 | `time`（窗口增量，MVP 唯一支持）/ `pk` / `full`；非 time 且非 pk → T04 抛 7004（MVP 只实现 time；pk/full 登记待确认） |
| `sql` ★ | 是 | 窗口取数 SQL（含 `:p_start`/`:p_end`）；缺失 → 7004 |
| `fetch_one_sql` ★ | 是（fetch_one） | 单条重拉 SQL（含 `:record_key`）；fetch_one 缺它 → 7005 |
| `initial_start` ★ | 是（G4） | 首次拉取窗口起点；缺省 → now − 24h |
| `keyset_pk_field` ★ | 是（G3） | 键集第二列；缺省 → record_key_expression 首个字段 |
| `fetch_time_field` | 否 | 拉取窗口字段（`sql` 内 `:p_start` 绑定的字段语义）；T04 键集 time_field 用 ds.time_field（业务时间），此处留 T06 水位精细化 |
| `biz_time_field` | 否 | biz_date 业务归属字段（第一批配置文档 §1.3 分离口径）；T04 biz_date 从 record_time 截断（验收 1：biz_date=TRUNC(record_time)） |
| `fetch_time_kind` / `fetch_time_evidence` | 否 | 证据字段，配置期已定，引擎不读 |

### 3.2 取数 SQL 契约（T04 硬性要求）

1. **窗口参数只能 `:p_start` / `:p_end`**（G2；V20 保存校验已拦）——SqlParamBinder 翻译为 `?` 预编译绑定，**禁字符串拼接、禁自写 DATE_FORMAT/TO_DATE**（共享知识 #4）
2. **输出必须含 time_field 列**（ds.time_field，写台账 record_time）
3. **输出必须含 keyset_pk 列**（G3，默认 = record_key 首字段；如 huadi2_order 的 `o.order_no` 输出为列名 `order_no`）
4. **输出列的列名/别名即 record_data 键名**（G9：`pd.serial_code AS wechat_pay_no` → record_data 键 `wechat_pay_no`）
5. JOIN 形态允许（LEFT JOIN pay_detail 骨架），UNION 已被 V34/V35 保存校验管辖，运行期不再重复校验

---

## 4. ledger 实体（F36~F39，纯 POJO，G1）

> 无 `@Entity`/`@Table`/`@Column` 注解，无 `@DynamicUpdate`；`@Data @Builder` 可用（Lombok 与 JPA 无关）。RowMapper 在对应 DAO 内以 `private static` 内部类实现（单一职责、不跨类）。

### 4.1 ReconSourceRecord（台账行，V1 187~203 行）

| 字段 | Java 类型 | 说明 |
|------|-----------|------|
| id | Long | BIGSERIAL |
| dsCode | String | 源数据源编码 |
| recordKey | String | 存储键（三层键·存储层，现算） |
| recordData | String | JSONB 整行（写 CAST(? AS jsonb)） |
| recordTime | LocalDateTime | ds.time_field 值 |
| bizDate | LocalDate | TRUNC(record_time)（Java 侧 toLocalDate） |
| updateSeq | Long | nextval('recon_update_seq')（SQL 内取，Java 不设） |
| isDeleted | Integer | 0/1 |
| deletedAt | LocalDateTime | 逻辑删除时间（T04 恒 NULL） |
| amountCent | Long | 标准化主金额（toCent 结果，可 null） |
| amountRaw | String | 源原始金额字符串（amount_raw 列） |
| amountDirection | String | in/out/none（G11） |
| lastPullRunId | Long | 最近写入它的拉取运行 |
| createdAt / updatedAt | LocalDateTime | DB now() 维护 |

### 4.2 ReconPullRun（拉取运行记录，V1 210~228 行）

| 字段 | Java 类型 | 说明 |
|------|-----------|------|
| id | Long | BIGSERIAL |
| dsCode | String | |
| windowStart / windowEnd | LocalDateTime | 本次拉取窗口（业务库 update_time 区间） |
| rowCount / insertCount / updateCount | Integer | 统计 |
| healthStatus | String | healthy/degraded/empty/error |
| healthDetailJson | String | JSONB（T04 记 row_count/last_row_count/delta_pct/error_msg 等） |
| readinessPassed / readinessDegraded | Integer | 就绪门（T04 恒 0） |
| readinessLog | String | JSONB（T04 恒 null） |
| clockSkewMs | Integer | 时钟探针（T04 可选：取 `now()` 差值记录，null 允许） |
| status | String | running/success/failed |
| errMsg | String | TEXT |
| startedAt / finishedAt | LocalDateTime | |

### 4.3 SeqWatermark（水位，V1 232~236 行）

| 字段 | Java 类型 | 说明 |
|------|-----------|------|
| dsCode | String | PK |
| committedSeq | Long | 已提交安全水位 |
| updatedAt | LocalDateTime | |

### 4.4 ReconConsumeCursor（消费游标，V1 239~247 行，T05 消费，T04 建好）

| 字段 | Java 类型 | 说明 |
|------|-----------|------|
| id | Long | |
| scenarioCode | String | |
| checkName | String | |
| dsCode | String | |
| cursorSeq | Long | 已消费最大 update_seq |
| updatedAt | LocalDateTime | |

---

## 5. DAO 层（F65~F68，JdbcTemplate 原生 SQL）

### 5.1 LedgerDao（F65，台账，包 `com.mis.recon.dao`）

```java
@Repository
@RequiredArgsConstructor
public class LedgerDao {
    private final JdbcTemplate jdbcTemplate;

    /**
     * 批量 upsert 台账（技术适配 §2.3 骨架 + 金额/方向/biz_date）
     * @param dsCode      数据源编码
     * @param rows        源行数据 List（key=输出列名）
     * @param pullRunId   本次拉取运行 id（last_pull_run_id）
     * @param timeField   业务时间列（record_time 取值）
     * @param amountSpec  AmountSpec（见下：amount_fields_json primary 字段解析结果）
     * @return BatchResult{insertCount, updateCount, maxSeq}
     */
    public BatchResult upsertBatch(String dsCode, List<Map<String, Object>> rows,
                                   long pullRunId, String timeField, AmountSpec amountSpec) { ... }

    /** fetch_one：单条 upsert（同一 SQL，单行） */
    public BatchResult upsertOne(String dsCode, Map<String, Object> row,
                                 long pullRunId, String timeField, AmountSpec amountSpec) { ... }

    /** 逻辑删除（T05 消费，T04 建签名留实现——markDeleted SQL 骨架见下） */
    public void markDeleted(String dsCode, String recordKey) { ... }
}
```

**upsert SQL 骨架（技术适配 §2.3 逐字对齐 + T04 扩展列）**：

```sql
INSERT INTO recon_source_record
  (ds_code, record_key, record_data, record_time, biz_date, update_seq,
   is_deleted, deleted_at, amount_cent, amount_raw, amount_direction, last_pull_run_id, created_at, updated_at)
VALUES (?, ?, CAST(? AS jsonb), ?, CAST(? AS date), nextval('recon_update_seq'),
        0, NULL, ?, ?, ?, ?, now(), now())
ON CONFLICT (ds_code, record_key)
DO UPDATE SET
  record_data  = EXCLUDED.record_data,
  record_time  = EXCLUDED.record_time,
  biz_date     = EXCLUDED.biz_date,
  update_seq   = EXCLUDED.update_seq,
  is_deleted   = 0,                    -- ★ 重拉复活逻辑删除行
  deleted_at   = NULL,
  amount_cent  = EXCLUDED.amount_cent,
  amount_raw   = EXCLUDED.amount_raw,
  amount_direction = EXCLUDED.amount_direction,
  last_pull_run_id = EXCLUDED.last_pull_run_id,
  updated_at   = now()
```

实现要点：
- **逐行执行**（batchUpdate 无法取回每行 nextval 后的 update_seq）：`jdbcTemplate.update(sql, args...)` 循环；2000 行 × 单条 update 在 TransactionTemplate 内可接受（MVP），批量执行优化登记风险
- **insert/update 区分**：PG `ON CONFLICT ... DO UPDATE` 后无法直接区分，用 **`RETURNING (xmax = 0) AS inserted`**（PG 官方技巧：xmax=0 表示刚插入行）——`query` 带 RowMapper 取 boolean；或简化：insert 计数 = rows − update 计数不可靠，**裁决：用 RETURNING (xmax=0) 精确区分**（一条 SQL 双语义，性能可接受）
- **maxSeq**：每行执行后 `queryForObject("SELECT lastval()", Long.class)` 或 upsert 前 `nextval` 先取号再传入——**裁决：SQL 内 nextval 无法取回，改为 Java 先 `nextval('recon_update_seq')` 再 INSERT（值显式传入）**，每行取号+插入两步，update_seq 与 maxSeq 完全可控（发号顺序=提交顺序由 TransactionTemplate 单事务保证）
  - 修正后的 SQL：`VALUES (?, ?, CAST(? AS jsonb), ?, CAST(? AS date), ?, 0, NULL, ?, ?, ?, ?, now(), now())`（update_seq=? 显式传入）
  - maxSeq = 批内最后一行的 seq（TransactionTemplate 提交前本地累加 max）
- **异常策略（行级）**：单行 upsert 抛异常（键拼不出/金额超范围/数据非法）→ **捕获记录 error 行到 pull_run.health_detail_json 的 error_rows 数组，不中断整批**（MVP：error 行丢弃，health=degraded 标记）；整批级异常（SQL 语法/连接断）→ 抛出，TransactionTemplate 回滚整批
- **AmountSpec（amount_fields_json primary 解析结果）**：

```java
public static class AmountSpec {
    String primaryField;      // primary 字段名（源列名）
    String unit;              // yuan/point/non_monetary
    String signRule;          // as_is/negate（refund_sign_rule 联动：same_table_negative→as_is、separate_table→negate、same_table_type_col→按 refund_flag_expr 判定）
    String direction;         // in/out/none
}
```

- **markDeleted SQL 骨架（T05）**：`UPDATE recon_source_record SET is_deleted=1, deleted_at=now(), update_seq=nextval('recon_update_seq') WHERE ds_code=? AND record_key=?`（T04 建签名留实现，不 gate）

### 5.2 PullRunDao（F66，拉取运行）

```java
@Repository
@RequiredArgsConstructor
public class PullRunDao {
    private final JdbcTemplate jdbcTemplate;

    /** 启动：insert running 行，返回 id */
    public long start(String dsCode, LocalDateTime windowStart, LocalDateTime windowEnd) { ... }

    /** 最近一次成功运行的 window_end（G4 窗口衔接）；无 → null */
    public LocalDateTime findLastSuccessWindowEnd(String dsCode) { ... }

    /** 最近一次成功运行的行数（G10 健康度波动基准）；无 → null */
    public Integer findLastSuccessRowCount(String dsCode) { ... }

    /** 收尾：success（含健康度+统计） */
    public void finishSuccess(long runId, String healthStatus, String healthDetailJson,
                              int rowCount, int insertCount, int updateCount, Integer clockSkewMs) { ... }

    /** 收尾：failed（含 err_msg） */
    public void finishFailed(long runId, String errMsg, String healthDetailJson) { ... }
}
```

SQL 要点：
- `start`：`INSERT INTO recon_pull_run (ds_code, window_start, window_end, status, started_at) VALUES (?, ?, ?, 'running', now()) RETURNING id`
- `findLastSuccessWindowEnd`：`SELECT window_end FROM recon_pull_run WHERE ds_code=? AND status='success' ORDER BY id DESC LIMIT 1`（idx_pull_run_ds 命中）
- `finishSuccess`：`UPDATE recon_pull_run SET status='success', health_status=?, health_detail_json=CAST(? AS jsonb), row_count=?, insert_count=?, update_count=?, clock_skew_ms=?, finished_at=now() WHERE id=?`

### 5.3 WatermarkDao（F68，水位）

```java
@Repository
@RequiredArgsConstructor
public class WatermarkDao {
    private final JdbcTemplate jdbcTemplate;

    public Long get(String dsCode) { ... }                       // SELECT committed_seq ...；无 → 0
    public void commit(String dsCode, long seq) { ... }          // ON CONFLICT upsert
    public Map<String, Long> getAll() { ... }                    // T05 冻结上界用
}
```

SQL：`INSERT INTO recon_seq_watermark (ds_code, committed_seq, updated_at) VALUES (?, ?, now()) ON CONFLICT (ds_code) DO UPDATE SET committed_seq=EXCLUDED.committed_seq, updated_at=now()`（技术适配 §2.3 逐字）

### 5.4 CursorDao（F67，游标，T05 消费，T04 建好）

```java
@Repository
@RequiredArgsConstructor
public class CursorDao {
    private final JdbcTemplate jdbcTemplate;

    public long get(String scenarioCode, String checkName, String dsCode) { ... }   // 无 → 0
    public void advance(String scenarioCode, String checkName, String dsCode, long seq) { ... } // ON CONFLICT upsert
}
```

---

## 6. 支撑层（F82~F84：ConnectionPoolManager 完整池 / DbDialect / SqlParamBinder）

### 6.1 ConnectionPoolManager（F82，改造 T03 基础版为完整池）

```java
@Service
@RequiredArgsConstructor
public class ConnectionPoolManager {
    private final ConnectionRepository connectionRepository;
    private final ConcurrentHashMap<String, DataSource> pool = new ConcurrentHashMap<>();

    /** 取连接池（缓存未命中则构建）；enabled=0 → 抛 7008；构建失败 → 抛 7008 */
    public DataSource getDataSource(String connCode) { ... }

    /** 连接 CRUD 保存后调用：close() + remove（G-变更刷新）；enabled=0 时同样 evict 并拒绝新建 */
    public void evict(String connCode) { ... }

    /** T03 保留：DriverManager 直连测试，不污染池（G15 不变） */
    public void testConnection(ReconConnection conn) { ... }

    /** 应用关闭：全池 close（@PreDestroy） */
    public void closeAll() { ... }
}
```

构建要点（技术适配 §2.7 落地）：
- `HikariDataSource`（HikariCP 随 spring-boot-starter-jdbc 传递依赖，无需新增 pom）
- `readOnly=true`（源库只读）；`jdbcUrl/username/password` 取自 recon_connection 行（明文存库决策，共享知识/T03）
- 池参数（connectionTimeout/maximumPoolSize 等）解析自 `propsJson`（JSONB，如 `{"maximum_pool_size":5,"connection_timeout_ms":5000}`）；**jdbc_props_locked 锁定集**（连接行 jdbc_props_locked 列，锁定字段不可被 props_json 覆盖——防配置漂移）
- `connectionRepository.findByConnCode(connCode)` 不存在 → 抛 7008（连接不存在）；`enabled=0` → 抛 7008
- 驱动 Class 映射沿用 T03 DRIVER_CLASS（mysql/pg/oracle，ojdbc11 T04 pom 引入后 oracle 可用）
- 懒加载缓存：`pool.computeIfAbsent(connCode, code -> build(conn))`；构建异常时 `computeIfAbsent` 抛异常不缓存

### 6.2 DbDialect（F83，三方言）

```java
public enum DbDialect {
    mysql, oracle, postgresql;

    /** 分页包装：mysql/pg 追加 "LIMIT ?"；oracle 外层 ROWNUM 子查询（11g/12c+ 兼容，禁 FETCH FIRST） */
    public String wrapLimit(String sql, int limit) { ... }

    /**
     * 键集分页包装（G3）：给窗口 SQL 加二元组键集过滤 + 排序 + 分页
     * SQL 形态（PG/MySQL）：
     *   SELECT * FROM ( <sql> ) AS _t
     *   WHERE _t."timeField" > ? OR (_t."timeField" = ? AND _t."pk" > ?)
     *   ORDER BY _t."timeField", _t."pk" LIMIT ?
     * Oracle 同构（ROWNUM 外层包装；表别名禁用 AS）
     */
    public String wrapKeyset(String sql, String timeField, String pkField, int limit) { ... }

    /** 标识符引用：mysql/pg 双引号；oracle 双引号（默认大写语义由 PG 保留——统一双引号） */
    public String quote(String ident) { return "\"" + ident + "\""; }

    /** 时钟探针：mysql "SELECT NOW(3)"；oracle "SELECT SYSTIMESTAMP FROM DUAL"；pg "SELECT now()" */
    public String clockProbeSql() { ... }

    public static DbDialect from(String type) { ... }   // 非法抛 7008
}
```

**键集 SQL 逐字（PostgreSQL 形态，验收对齐）**：

```sql
SELECT * FROM ( <原窗口SQL> ) AS _t
WHERE _t."update_time" > ? OR (_t."update_time" = ? AND _t."order_no" > ?)
ORDER BY _t."update_time", _t."order_no"
LIMIT ?
```

实现要点：
- 原窗口 SQL 作为子查询，`SELECT *` 输出列即配置 SQL 的列名/别名（G9 原样）
- `timeField` = ds.time_field（**T04 键集时间列用业务时间字段**，与台账 record_time 一致；fetch_time_field 窗口精细分离留 T06，登记风险）；`pkField` = keyset_pk_field（G3）
- 键集参数序：`(lastTime, lastTime, lastPk, limit)`——`time > lastTime OR (time = lastTime AND pk > lastPk)`
- Oracle 尾缀：`FETCH FIRST ? ROWS ONLY`（无 LIMIT，12c）；MySQL/PG：`LIMIT ?`
- **首轮（无 lastTime）**：`WHERE _t."time" >= :p_start AND _t."time" < :p_end` 由窗口 SQL 自身承担，PullRunner 直接执行窗口 SQL + LIMIT（不加键集条件）；**后续批**才 wrapKeyset 带 (lastTime, lastPk)

### 6.3 SqlParamBinder（F84）

```java
public final class SqlParamBinder {
    private SqlParamBinder() {}

    /**
     * 命名/花括号占位符 → ? 预编译绑定（G2 归一）
     * 支持：:p_start / :p_end / :p_last_pk（配置文档/校验口径）
     *       {time_start} / {time_end} / {record_key}（需求说明书 UI 口径，兼容）
     * @return BoundSql{sql（全 ? 占位）, args（按出现序）}
     */
    public static BoundSql bind(String sql, Map<String, Object> params) { ... }
}
```

实现要点：
- 正则替换：`:p_start` → `?`（词边界 `(?<![A-Za-z0-9_])`，防 `:p_start_x` 误匹配）；`{time_start}` → `?`（花括号精确）
- 参数值映射：`p_start`/`time_start` → params.get("p_start")；`p_end`/`time_end` → p_end；`record_key` → record_key
- **时间参数传 `java.sql.Timestamp`**（`Timestamp.valueOf(LocalDateTime)`），驱动级时区按连接 props（db_timezone 字段 T04 不强制解析，登记风险）
- 缺失参数值 → 抛 7007（窗口参数绑定失败）
- 支持同一参数多次出现（`?` 位置各自占位，args 按序重复绑定值）
- 单测：`:p_start` 出现 2 次 → 2 个 `?` 2 个值；`{time_start}` 兼容；`:p_start_x` 不误匹配；缺值抛 7007

---

## 7. ledger 服务层（F85~F88）

### 7.1 LedgerService（F85）

```java
@Service
@RequiredArgsConstructor
public class LedgerService {
    private final LedgerDao ledgerDao;

    /** 批 upsert（PullRunner 每批调用，事务由调用方 TransactionTemplate 提供） */
    public LedgerDao.BatchResult upsertRows(String dsCode, List<Map<String, Object>> rows,
                                            long pullRunId, String timeField, LedgerDao.AmountSpec amountSpec) { ... }

    /** fetch_one 单条 upsert */
    public LedgerDao.BatchResult upsertOne(String dsCode, Map<String, Object> row,
                                           long pullRunId, String timeField, LedgerDao.AmountSpec amountSpec) { ... }

    /** record_key 现算 + AmountSpec 解析（从 ds 配置 JSON） */
    public LedgerDao.AmountSpec resolveAmountSpec(ReconDatasource ds) { ... }
}
```

`resolveAmountSpec` 要点：
- 解析 `ds.amountFieldsJson`（JSON 对象 `{field: {unit, role, sign_rule, direction}}`，补丁02 §2.2 结构）
- 找 `role=primary` 的字段 → primaryField；无 primary → AmountSpec 全 null（amount_cent/amount_raw/amount_direction 均 null，V33 语义：该 ds 无金额主列）
- `signRule`：字段级 `sign_rule` 优先；缺省 → 按 `ds.refundSignRule` 联动：`same_table_negative` → `as_is`（负数天然）、`separate_table` → `negate`（独立退款表整体取反）、`same_table_type_col` → 按 `ds.refundFlagExpr` 判定（T04 简化：same_table_type_col 未实现 → 抛 7002 拒绝启用，登记风险）、null/none → `as_is`
- `direction`：字段级 `direction`；缺省 → `none`

### 7.2 SeqWatermarkService（F86）

```java
@Service
@RequiredArgsConstructor
public class SeqWatermarkService {
    private final WatermarkDao watermarkDao;
    public void commit(String dsCode, long seq) { watermarkDao.commit(dsCode, seq); }
    public Map<String, Long> getAll() { return watermarkDao.getAll(); }   // T05 用
}
```

### 7.3 CursorService（F87，T05 消费，T04 建好）

```java
@Service
@RequiredArgsConstructor
public class CursorService {
    private final CursorDao cursorDao;
    public long get(String scenarioCode, String checkName, String dsCode) { return cursorDao.get(scenarioCode, checkName, dsCode); }
    public void advance(String scenarioCode, String checkName, String dsCode, long hi) { cursorDao.advance(scenarioCode, checkName, dsCode, hi); }
}
```

### 7.4 HealthEvaluator（F88，G10）

```java
@Service
public class HealthEvaluator {

    /**
     * 健康度评估（MVP 口径，G10）
     * @return HealthResult{status, detailJson}
     */
    public HealthResult eval(ReconDatasource ds, int rowCount, Integer lastSuccessRowCount, String errorMsg) { ... }
}
```

判定表：

| 条件 | status | health_detail_json |
|------|--------|-------------------|
| errorMsg != null | error | `{error_msg, row_count}` |
| rowCount == 0 | empty | `{row_count:0}` |
| lastSuccessRowCount != null 且 `abs(rowCount-last)/last > row_count_delta_pct` | degraded | `{row_count, last_row_count, delta_pct}` |
| 其余 | healthy | `{row_count, last_row_count}` |

- `row_count_delta_pct` 取自 `ds.healthRulesJson.row_count_delta_pct`（第一批默认 50，即 50%）；null_rate_threshold 等健康项 T06 扩展（登记风险）
- 健康度枚举对齐 ResultEnums.HealthStatus（healthy/degraded/empty/error）

---

## 8. PullRunner（F90，★ 拉取引擎主流程）

```java
@Component
@RequiredArgsConstructor
public class PullRunner {
    private final DatasourceRepository datasourceRepository;
    private final ConnectionRepository connectionRepository;
    private final ConnectionPoolManager connectionPoolManager;
    private final LedgerService ledgerService;
    private final SeqWatermarkService seqWatermarkService;
    private final PullRunDao pullRunDao;
    private final HealthEvaluator healthEvaluator;
    private final PlatformTransactionManager txManager;

    private final ConcurrentHashMap<String, Boolean> running = new ConcurrentHashMap<>();   // G6

    /** 手动/调度入口：窗口拉取。同步执行；返回 pull_run id。 */
    public long run(String dsCode) { return run(dsCode, null, null); }

    /** 窗口拉取（start/end 可覆盖默认；null → G4 衔接计算） */
    public long run(String dsCode, LocalDateTime startOverride, LocalDateTime endOverride) { ... }

    /** 单条重拉（G7：不写 pull_run） */
    public Map<String, Object> fetchOne(String dsCode, String recordKey) { ... }
}
```

### 8.1 run 主流程（对齐 §7.1 拉取时序）

```
1. 互斥（G6）：running.putIfAbsent(dsCode, true) 非 null → 抛 7001（正在拉取）
   finally 移除
2. 配置快照：datasourceRepository.findByDsCode → 不存在 3002；enabled=0 → 抛 7003
   fetchConfig = JsonUtil.parseObject(ds.fetchConfigJson)；fetch_mode != "time" → 抛 7004（MVP 仅 time）
   sql = fetchConfig.sql 缺 → 抛 7004；fetchType != "db" → 抛 7004（api/custom 不走拉取）
3. 连接：connectionRepository.findByConnCode(ds.connCode) → 不存在 2003
   DataSource src = connectionPoolManager.getDataSource(ds.connCode)
4. 窗口（G4）：
   lastEnd = pullRunDao.findLastSuccessWindowEnd(dsCode)
   start = startOverride ?? (lastEnd != null ? lastEnd.minusSeconds(overlap) : initialStart(fetchConfig, now))
   end   = endOverride ?? now
   overlap = conn.fetchOverlapSec（null → 300）
   initialStart = fetchConfig.initial_start（String → LocalDateTime；缺省 now.minusDays(1)）
5. runId = pullRunDao.start(dsCode, start, end)
   try:
     TransactionTemplate tt = new TransactionTemplate(txManager);   // 批事务（G5）
     循环（键集分页）：
       batch = fetchBatch(src, sql, timeField, pkField, start, end, lastTime, lastPk)   // §8.2
       batch 空 → break
       BatchResult r = tt.execute(status -> {
           BatchResult br = ledgerService.upsertRows(dsCode, batch, runId, timeField, amountSpec);
           seqWatermarkService.commit(dsCode, br.maxSeq);     // G5：批内原子
           return br;
       });
       累加 rowCount/insert/update；lastTime/lastPk = 批尾 (time, pk)
     health = healthEvaluator.eval(ds, rowCount, lastSuccessRowCount, null)
     pullRunDao.finishSuccess(runId, health.status, health.detailJson, rowCount, insert, update, clockSkew)
     return runId
   catch 异常 e:
     health = healthEvaluator.eval(ds, rowCount, lastSuccessRowCount, e.getMessage())
     pullRunDao.finishFailed(runId, e.getMessage(), health.detailJson)
     throw e  → 上层（Ops/Quartz）记录
```

### 8.2 fetchBatch（键集分页，G3）

```
输入：src DataSource, 窗口 SQL（含 :p_start/:p_end）, timeField, pkField, start, end,
      lastTime（null=首轮）, lastPk（null=首轮）
1. 首轮：bound = SqlParamBinder.bind(sql, {p_start: Timestamp(start), p_end: Timestamp(end)})
         finalSql = dialect.wrapLimit(bound.sql, BATCH_SIZE)             // 窗口 + LIMIT/ROWNUM 2000
   后续：bound = bind(sql, {p_start, p_end})
         finalSql = dialect.wrapKeyset(bound.sql, timeField, pkField, BATCH_SIZE)
         args = [bound.args..., lastTime, lastTime, lastPk]              // 键集条件参数
2. 执行：JdbcTemplate（动态源库）query(finalSql, RowMapper → List<Map<String,Object>>)
   ★ 源库 JdbcTemplate 从 DataSource 构建：new JdbcTemplate(src)（每批内联创建，无状态，廉价）
   ★ RowMapper：column labels → Map（getString 全部转 String？——裁决：保留原始类型，recordData 序列化时统一 toString）
3. 返回批 + 批尾 (time, pk) 供下一轮键集
```

### 8.3 fetchOne 主流程

```
1. 配置快照同 run（3002/7003/7004）
2. fetch_one_sql = fetchConfig.fetch_one_sql；缺 → 抛 7005
3. bound = SqlParamBinder.bind(fetch_one_sql, {record_key: recordKey})
4. rows = 源库 query（无分页）；空 → 返回 {found:false}
5. 取首行 → ledgerService.upsertOne（记录到当前 pullRunId=0？——裁决：无运行上下文，last_pull_run_id 传 0）
6. 返回 {found:true, record_key, update_seq 提升确认}
```

> 注意：fetch_one 的 record_key 需与台账现算键一致（同一表达式）；SQL 内 `:record_key` 由调用方传入的 recordKey 直接绑定，**平台不再现算**（单条重拉语义：外部给键）。

### 8.4 批大小与异常（G12 / G5）

- BATCH_SIZE = 2000（常量）
- 批事务失败（SQL 异常等）→ TransactionTemplate 回滚该批（含水位），异常上抛 → run 收尾 failed
- 行级 error（键拼不出等）→ LedgerDao 捕获记 health_detail_json.error_rows，不中断批；rowCount 不含 error 行

---

## 9. 调度（F108 PullJob + F112 SchedulerManager，G14）

### 9.1 PullJob

```java
@DisallowConcurrentExecution    // 同 ds 并行拉取由 G6 互斥兜底，此处再加 Job 级防重入
public class PullJob extends QuartzJobBean {
    private final PullRunner pullRunner;    // SpringBeanJobFactory 注入（T01 QuartzConfig 已配）
    private String dsCode;                  // JobDataMap 传入

    @Override
    protected void executeInternal(JobExecutionContext context) {
        pullRunner.run(dsCode);
    }
}
```

- 调度开关关闭（mis.recon.scheduler.enabled=false）时 Scheduler 不 auto-startup（application.yml 已配），PullJob 不会触发
- 异常吞掉并 log.error（Quartz Job 抛异常会记 misfire；run 内部已收尾 failed，此处只记日志不重抛）

### 9.2 SchedulerManager

```java
@Component
@RequiredArgsConstructor
public class SchedulerManager {
    private final Scheduler scheduler;

    /** 启动：加载 enabled=1 且 pull_cron 非空的 ds 全量注册（@PostConstruct + scheduler.isStarted 判断） */
    public void init() { ... }

    /** ds 保存/更新后调用：cron 非空 → upsert 注册；cron 空/enabled=0 → 删除（如存在） */
    public void refreshPullJob(String dsCode, String pullCron, boolean enabled) { ... }

    /** 显式删除（ds 删除时调用） */
    public void removePullJob(String dsCode) { ... }
}
```

注册要点：
- JobKey = `pull-{dsCode}`；TriggerKey = `pull-{dsCode}-trg`
- CronTrigger：`CronScheduleBuilder.cronSchedule(pullCron).withMisfireHandlingInstructionDoNothing()`（misfire=skip，技术适配 §2.6）
- 已存在同 JobKey → `scheduler.addJob(job, true)` + rescheduleJob（配置即对账，cron 变更即时生效）
- Quartz cron 与 Spring cron 差异：Quartz 6 位（秒起）`0 */5 * * * ?`——配置文档示例即 Quartz 格式，直接透传
- `init()` 内判 `scheduler.isStarted()`（auto-startup 由开关控制，未启动时注册会抛 SchedulerException → log.warn 降级）

### 9.3 DatasourceService 集成（替换 T03 TODO(T04)）

```java
// DatasourceService 注入 SchedulerManager
// save()：datasourceRepository.save(entity) 后
schedulerManager.refreshPullJob(entity.getDsCode(), entity.getPullCron(), entity.getEnabled() == 1);
// update()：apply 后同 save
// delete()：datasourceRepository.deleteById 前/后
schedulerManager.removePullJob(dsCode);
```

---

## 10. OpsController（F118，手动触发）

```java
@RestController
@RequestMapping("/internal/v1/recon/ops")
@RequiredArgsConstructor
public class OpsController {
    private final PullRunner pullRunner;

    /** 手动拉取（G8：同步执行返回 pull_run 摘要）；body 可选 {start, end} 覆盖窗口 */
    @PostMapping("/pull/{dsCode}")
    public ApiResponse<PullResultResp> pull(@PathVariable String dsCode,
                                            @RequestBody(required = false) PullReq req) { ... }

    /** fetch_one 单条重拉；body {record_key} 必填 */
    @PostMapping("/fetch-one/{dsCode}")
    public ApiResponse<FetchOneResp> fetchOne(@PathVariable String dsCode,
                                              @RequestBody FetchOneReq req) { ... }

    /** 试拉（BR-18，G-试拉）：小窗口取数返回样例，不写台账 */
    @PostMapping("/probe/{dsCode}")
    public ApiResponse<ProbeResp> probe(@PathVariable String dsCode) { ... }
}
```

请求/响应 DTO（`domain/dto/ops` 或 `domain/dto`）：

```java
@Data
public class PullReq { String start; String end; }        // "yyyy-MM-dd HH:mm:ss"，可空

@Data
public class PullResultResp { long pullRunId; String status; String healthStatus; int rowCount; }

@Data
public class FetchOneReq { @NotBlank String recordKey; }

@Data
public class FetchOneResp { boolean found; String recordKey; }

@Data
public class ProbeResp { boolean connected; int fieldCount; Map<String, Object> sampleRow; String message; }
```

**probe（BR-18 试拉，验收扩展）**：
- 触发：小窗口 = `now − 1h ~ now`（或 fetchConfig.initial_start 起 1h）
- 执行 `bind(sql, {p_start, p_end}) + LIMIT 1` → 取 1 行 → 返回样例 + 字段数 + 连接成功
- **不写台账**（测试连接语义，需求说明书 §3.3）
- 失败 → 抛 2004/7004 带原因（复用测试连接错误码语义：连接失败/取数失败）

---

## 11. 修订项（ErrorCode / pom / 验收对齐）

### 11.1 ErrorCode 追加（7xxx 拉取码段）

```java
// ---- 拉取引擎 7xxx ----
PULL_IN_PROGRESS(7001, "该数据源正在拉取中，请勿重复触发"),
PULL_FAILED(7002, "拉取失败"),
PULL_DS_DISABLED(7003, "数据源未启用，无法拉取"),
FETCH_SQL_MISSING(7004, "取数 SQL 未配置或拉取模式暂不支持"),
FETCH_ONE_SQL_MISSING(7005, "fetch_one_sql 未配置，无法单条重拉"),
RECORD_KEY_MISSING(7006, "记录键求值失败（模板字段缺失）"),
WINDOW_PARAM_BIND_FAILED(7007, "窗口参数绑定失败"),
CONN_NOT_READY(7008, "连接不可用或已禁用");
```

### 11.2 pom 追加（recon-service）

```xml
<!-- 源库驱动：Oracle 业务库只读直连（技术适配 §2.7/§2.8；平台库已改 PG，此驱动仅源库用） -->
<dependency>
    <groupId>com.oracle.database.jdbc</groupId>
    <artifactId>ojdbc11</artifactId>
    <scope>runtime</scope>
</dependency>
```

### 11.3 application.yml

- `mis.recon.scheduler.enabled` 已 true（T02 已改），无改动
- 无需新增配置（窗口默认/批大小均为代码常量，MVP 不开放配置化——登记风险）

---

## 12. 验收标准与验证命令

### 12.1 对照任务分解 T04 四条验收（941~950 行）

| # | 验收项 | 本规格覆盖 | 通过标准 |
|---|--------|-----------|----------|
| 1 | 配置好 huadi2_order ds 后手动触发拉取：数据 upsert 进台账、update_seq 单调、amount_cent 正确（元×100）、biz_date=TRUNC(record_time) | §8 + §5.1 | POST /ops/pull/huadi2_order → code=0 且 pull_run status=success；`SELECT count(*), min(update_seq), max(update_seq) FROM recon_source_record WHERE ds_code='huadi2_order'` 行数=源窗口行数、update_seq 单调；amount_cent = amount×100（抽查）；biz_date = CAST(record_time AS date) |
| 2 | 重复拉取同一窗口不产生重复行（(ds_code,record_key) 唯一覆盖）；窗口衔接取上次成功 window_end | §5.1 + §8.1 G4 | 连续触发两次 → 第二次行数不增（ON CONFLICT 覆盖）、uk_source_record 无冲突；第二次 pull_run.window_start = 第一次 window_end − overlap（300s） |
| 3 | pull_run 记录健康度（healthy/empty/degraded）与统计；水位 committed_seq 随批次更新；MySQL 键集分页正常 | §7.4 + §5.2 + §5.3 + §8.2 | pull_run 行含 health_status/row_count/insert_count/update_count/finished_at；recon_seq_watermark.committed_seq = 最近批 maxSeq；源库 >2000 行窗口 → 多次 fetchBatch（键集推进，无 OFFSET），批间无重复无遗漏 |
| 4 | fetch_one(ds_code, record_key) 可单条重拉并抬高 update_seq | §8.3 + §5.1 | POST /ops/fetch-one/huadi2_order {record_key:"xxx"} → found=true；`SELECT update_seq FROM recon_source_record WHERE ds_code=? AND record_key=?` 相比重拉前抬高 |

### 12.2 单测清单（开发期跑 `mvn -pl recon-service test`，mock 依赖）

| 测试类 | 覆盖用例 |
|--------|----------|
| `AmountUtilTest` | toCent("100.00",yuan,as_is)=10000；("1.50",yuan,negate)=-150；("100",point,*)=null；("abc",yuan,*)=null；("1.005",yuan,*)=null（V19 三位小数）；ROUND 边界；abs；toYuan |
| `KeyExprEvaluatorTest` | {order_no} 单键；{a}_{b} 复合键；缺失字段 → null；extractFields 顺序 |
| `SqlParamBinderTest` | :p_start/:p_end → 2 个 ? 2 值；{time_start} 兼容；同一参数 2 次出现；:p_start_x 不误匹配；缺值抛 7007 |
| `DbDialectTest` | wrapKeyset 三方言 SQL 形态（PG/MySQL LIMIT、Oracle FETCH FIRST）；quote；clockProbeSql |
| `HealthEvaluatorTest` | rowCount=0 → empty；波动超阈值 → degraded；正常 → healthy；errorMsg → error |
| `PullRunnerTest` | 窗口衔接（lastEnd−overlap）；首轮 initial_start 默认 now−24h；互斥（第二次 putIfAbsent 抛 7001）；批事务提交水位（mock DAO 验证 commit 调用）；fetch_one 缺 fetch_one_sql 抛 7005 |

### 12.3 本地验证命令（无 PG 环境，先跑）

门禁：**`mvn compile` 必须通过**（JDK17 + Maven 3.9.11，与 T01~T03 门禁一致）；**`mvn test` 不 gate**（mock 单测作为开发期回归，全部通过为佳）。

```powershell
cd D:\work\mis-platform\recon
mvn -q clean compile
# 通过标准：BUILD SUCCESS，exit 0
```

实库验证（用户提供 PG + 源库 MySQL 环境后）：
1. Flyway migrate（V1/V2 已就绪）→ 起服务
2. 配连接 mysql_huadi2 + ds huadi2_order（含 fetch_config_json 窗口 SQL）
3. `POST /internal/v1/recon/ops/pull/huadi2_order` → 验台账/pull_run/水位
4. 重复触发验幂等；`POST /internal/v1/recon/ops/fetch-one/huadi2_order {"record_key":"..."}` 验单条重拉

---

## 13. 风险与待确认

| # | 风险/待确认 | 当前处理 | 责任方 |
|---|-------------|----------|--------|
| 1 | **record_data 字段重命名（fields_json source→target）未实现** | T04 按源 SQL 输出列名原样存储（G9）；record_key/time_field/amount 按源列名匹配；重命名映射 T05 比较层/T09 管理端细化时补 | T05/T09 |
| 2 | **fetch_time_field（拉取窗口）与 time_field（业务时间）分离** | T04 键集时间列 = ds.time_field（与台账 record_time 一致，验收 1 对齐）；fetch_time_field 窗口精细分离（update_time 拉取 / create_time 归属）留 T06 水位精细化——第一批配置文档 §1.3 口径 | T06 |
| 3 | **same_table_type_col 退款形态** | T04 未实现（refund_flag_expr 行级判定），AmountSpec 遇此 → 抛 7002 拒绝启用；第一批 huadi2_refund 为 separate_table（negate），不阻塞 | T04 后端确认 |
| 4 | **逐行 upsert 性能** | 2000 行/批 × 逐行 update（取号+insert 两步）在 MVP 可接受；批量 preparedStatement + 事务内执行留优化 | 后端 |
| 5 | **db_timezone 未解析** | 连接 db_timezone 字段（默认 Asia/Shanghai）T04 不读，时间绑定用 JVM 时区；多时区源库登记待确认 | 后端 |
| 6 | **fetch_mode=pk/full 未实现** | MVP 仅 time（G-fetch_mode）；pk/full 登记 T 后续；V20 校验已允许配置（保存通过），运行期抛 7004 明确提示 | 后端 |
| 7 | **上游 Quartz 与 @DisallowConcurrentExecution** | PullJob 加注解防 Job 级重入 + G6 应用级互斥双保险；Quartz misfire=DoNothing（技术适配 §2.6） | 后端 |
| 8 | **jsonb 写入 Hibernate 实测** | LedgerDao 全部 `CAST(? AS jsonb)` 原生 SQL，不经过 Hibernate（技术适配 §2.2 热路径约定），无 @JdbcTypeCode 风险 | 后端实测 |
| 9 | **update_seq 取号方式** | 裁决改为 Java 先 nextval 再 INSERT（§5.1），发号顺序=批内执行顺序；TransactionTemplate 单事务内，批提交后水位=批内 maxSeq 一致 | 后端 |
| 10 | **fetch_one 的 last_pull_run_id=0** | 单条重拉无运行上下文，last_pull_run_id 传 0（无 FK 约束，仅语义标记）；T06 若需追踪再议 | 知悉 |
| 11 | **健康度 null_rate/deletion_detect 未实现** | G10 MVP 只做 row_count 波动；空值率/删除检测 T06 扩展（health_rules_json 已落库） | T06 |
| 12 | **JsonSupport 与 JsonUtil 并存** | T04 新代码用 util/JsonUtil；T03 service/config/JsonSupport 保持不动，F21 落地时合并迁移 | F21 |
| 13 | **Oracle 键集 SQL 实测** | wrapKeyset Oracle 分支（FETCH FIRST）无实库验证（本机无 Oracle 源库）；语法按 12c 标准，验收不 gate Oracle 实拉 | 后端知悉 |
| 14 | **ojdbc11 引入后 T03 测试连接 oracle 分支** | pom 引入后 Class.forName 成功，T03 testConnection 的 oracle 降级提示分支自然失效（message 不再提示「T04 引入后可用」）——无害，后端可顺手清理文案 | 后端 |

---

## 14. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-14 | 初版：T04 拉取引擎规格锁定（ledger POJO + 4 DAO + 完整连接池 + DbDialect/SqlParamBinder + PullRunner + 调度 + Ops + 7xxx 码段 + ojdbc11） | T04 规格锁定，供后端工程师落地代码 | 全文档 |
| 2026-08-14 | 裁决 G3：键集分页二元组 (time_field, keyset_pk_field)，默认取 record_key 首字段 | 取数 SQL 输出列平台不可控、record_key 为现算表达式，单列键集同秒截断漏数 | §0/§3/§6.2 |
| 2026-08-14 | 裁决 G2：占位符统一 `:p_start`/`:p_end`/`:p_last_pk`，花括号写法兼容归一 | T03 V20 校验与第一批配置文档均用命名参数，双轨并存必出 bug | §0/§3/§6.3 |
| 2026-08-14 | 修订 §5.1：update_seq 改为 Java 先 nextval 再显式传入（原 SQL 内 nextval 无法取回）；insert/update 计数用 RETURNING (xmax=0) | 取号可追踪、maxSeq 可控、计数精确 | §5.1 |
