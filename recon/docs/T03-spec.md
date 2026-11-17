# T03 配置模型 CRUD 规格锁定 — recon-service（common 包 + 枚举 + 配置实体 + DTO + Repository + 服务校验 + Controller）

| 项 | 值 |
|----|----|
| 文档状态 | 已锁定（T03 执行依据；T03 只产出规格与类设计，正式 Java 代码由后端工程师按本规格落地） |
| 负责人 | 架构师 高见远 |
| 日期 | 2026-08-14 |
| 适用阶段 | T03 配置模型 CRUD（连接/数据源/场景/check，含 REST 与校验） |
| 物理位置 | `D:\work\mis-platform\recon\`（独立工程，独立 database `recon`） |

执行依据（唯一口径，本规格不得偏离）：
- 《对账平台V3-开发任务分解.md》：F25~F35（枚举+实体）、F48~F51（DTO）、F57~F64（Repository）、F77~F81（服务+校验）、F113~F116（Controller）、T03 章节（931~939 行）
- 《对账平台V3-接入MIS技术适配.md》§2.2（JSONB 读写约定）/ §2.7（ConnectionPoolManager）/ §3.1（/internal/v1/** 契约）/ §四 T03 修订段
- 《V3瘦身版-修订草案-架构-补丁02-异构源与规模化.md》§6.1（V17~V35 校验全集，机械执行点）
- 《后台原型需求说明书-第一批-线上订单.md》§2/§3/§4/§5（配置页行为、测试连接行为、校验提示语）
- T01/T02 已落位：`docs/T01-spec.md`（§4 config 风格、common 预留）、`docs/T02-spec.md`（§3 逐表转换、§4 JSONB 归类）、`V1__init.sql`（8 张配置表 DDL，第 28~185 行）

产出文件对应关系（后端工程师落代码时的目标文件）：

| 编号 | 目标文件 | 内容 | 本规格章节 |
|------|----------|------|-----------|
| 补建 | `com.mis.recon.common.ApiResponse / PageResult / ErrorCode / BizException / GlobalExceptionHandler` | common 包 | §1 |
| F25 | `domain/enums/ConfigEnums.java` | 配置枚举 | §2 |
| F26 | `domain/enums/ResultEnums.java` | 结果枚举 | §2 |
| F27 | `domain/enums/AmountEnums.java` | 金额枚举 | §2 |
| F28~F35 | `domain/config/ReconConnection.java … ReconReporterConfig.java` | 8 张配置表实体 | §3 |
| F48~F51 | `domain/dto/ConnectionSaveReq / DatasourceSaveReq / ScenarioSaveReq / CheckSaveReq` | 保存请求 DTO | §4 |
| F57~F64 | `repository/ConnectionRepository … ReporterConfigRepository` | 8 个 JPA Repository | §5 |
| F77~F80 | `service/config/ConnectionService / DatasourceService / ScenarioService / CheckService` | 配置服务 | §6 |
| F81 | `service/config/ConfigValidationService.java` | 保存校验（V17~V35 子集） | §6 |
| F82(基础版) | `service/support/ConnectionPoolManager.java` | 测试连接（连通性） | §6 |
| F113~F116 | `controller/ConnectionController … CheckController` | REST 端点 | §7 |

---

## 0. 全局裁决摘要（先读）

| # | 裁决项 | 结论 | 理由（一句） |
|---|--------|------|--------------|
| G1 | 全局异常响应状态码 | **HTTP 200 + code≠0**（与 MIS `Result<T>` 风格一致） | BFF 透传与前端统一按 `code` 判断，RESTful 4xx/5xx 制造网关/日志噪音且与 MIS mis-common-web 对齐 |
| G2 | 错误码载体 | **枚举 `ErrorCode`**（code+message 内聚） | 类型安全、BizException 引用无魔法数，与 MIS 风格一致 |
| G3 | JSON 契约命名 | **全局 snake_case**（`spring.jackson.property-naming-strategy=SNAKE_CASE`） | 库字段名/需求说明书字段名/JSON 契约三层一致，BFF 透传零映射 |
| G4 | JSONB 列 Java 侧方案 | **String + `@JdbcTypeCode(SqlTypes.JSON)`，全工程统一** | Hibernate 6 标准类型码，读写绑定明确（PG 对 json→jsonb 有赋值转换）；`columnDefinition` 在 ddl-auto=none 下不参与建表，写了误导且双源漂移 |
| G5 | created_at / updated_at 维护 | **created_at 由 DB（`DEFAULT now()`）；updated_at 由应用层 `@PreUpdate`** | DDL 默认值只覆盖 INSERT、PG 无 UPDATE 触发器；`updatable=false` 会让更新时间永远停留创建时刻，破坏列表按 updated_at 排序语义 |
| G6 | @DynamicUpdate | **8 个配置实体统一加** | 配置表 JSONB 大字段多，只更新脏字段减少 JSONB 重写与 WAL 体积 |
| G7 | JPA 审计字段 | **不使用 `@CreatedDate/@LastModifiedDate`** | DB now() + @PreUpdate 已覆盖，避免双写冲突；@EnableJpaAuditing 保留为 T04+ 预留 |
| G8 | CheckSaveReq 结构 | **嵌套对象**（check 本体 + matchRule + compareRule） | 三表聚合语义与实体一致，@Valid 级联、拆表边界清晰；平铺会抹平三表边界 |
| G9 | update 语义 | **按唯一业务键定位，DTO 不带 id**：connection/datasource/scenario 按 code；check 按 (scenario_code, check_name) 复合键 | REST 路径与 uk 唯一索引一致，check_name/conn_code/ds_code/scenario_code 创建后禁改由路径锁定 |
| G10 | 跨表计数（连接被引用） | **放 Service：`DatasourceRepository.countByConnCode/ findByConnCode`** | Repository 只管本表（单一职责）；跨表 join 不引入实体关联，避免加载级联 |
| G11 | 分页+过滤查询 | **@Query JPQL 单方法（可选参数）**；方法名派生仅用于唯一键/存在性/简单列表 | 派生方法在 keyword+enabled 组合下数量爆炸；@Query 一方法覆盖全组合、SQL 可审查，MVP 不引 Specification |
| G12 | uses_json 回写 | **T03 落地最小实现**（CheckService 保存/删除后回写 ds+alias，use_fields 留空数组） | F80 职责明确「保存后自动汇总回写场景 uses_json」，任务分解 575 行/1001 行均为 F80/T03 语义；use_fields 精确并集留 T09 |
| G13 | consume_json 落库扩展 | **行结构增加可选 `ds_code` 字段**（`{alias:{ds_code, mode, time_field?, start?, end?}}`） | alias→ds_code 映射必须落库才能支撑 uses_json 汇总/alias 唯一性/time_field 校验；T04 引擎只消费 alias+mode+窗口，JSON 忽略未知字段 |
| G14 | 数据源测试连接 | **T03 只做连通性测试**，试拉样例（BR-18）留 T04 | 试拉需 SqlParamBinder/取数 SQL 解析/样例窗口，属 T04 拉取引擎；T03 验收只要求测试连接可用 |
| G15 | 测试连接实现 | **DriverManager 直连 + `getConnection(url, props, timeout)` + `isValid(3)` + finally close**，不建 HikariCP 池 | 低频一次性操作，建池开销大且需管理生命周期；完整池 T04 |
| G16 | 连接密码序列化 | **实体 `password` 加 `@JsonProperty(access = WRITE_ONLY)`** | 只反序列化不序列化，列表/详情天然脱敏，保存请求正常接收 |
| G17 | 分页 page 语义 | **page 从 1 开始**（前端惯例），Controller 统一 `PageRequest.of(page-1, size)` | MIS 前端分页组件（PageHelper 时代 pageNum 从 1 起）惯例；Spring 0-based 是内部实现，对外契约 1 起全局一致 |
| G18 | 枚举 JSON 序列化 | **用 `name()`（code 与 name 同值，对齐 DDL 落库值）** | DDL 落库即这些 snake_case 字符串，Jackson 默认 name() 零自定义序列化器；V29 展示派生律已由 DDL ck_* 锁取值集合 |
| G19 | 实体包名 vs T01 @EntityScan | **实体落 `com.mis.recon.domain.config`；T01 JpaConfig 的 `@EntityScan("com.mis.recon.entity")` 改为 `@EntityScan("com.mis.recon.domain")`** | 任务分解 F28~F35 权威包名 domain/config；T01 预留的 com.mis.recon.entity 不存在，不改则实体漏扫 |
| G20 | 全局异常处理类位置 | **`com.mis.recon.common.GlobalExceptionHandler`** | 响应协议是 common 横切职责，与 ApiResponse 强内聚；config 包只装配（T01 约定），不塞行为类 |

---

## 1. common 包设计（T01 预留未建，T03 补建）

包：`com.mis.recon.common`。T01 只建了 config 包，common 与 util 均未建；本任务只补建 common。util 计划（F15~F24）属后续任务，T03 所需的 SQL 串匹配内联在 ConfigValidationService（见 §6.4，签名对齐 F21 `SqlTextValidator` 计划，F21 落地时抽出）。

### 1.1 ApiResponse\<T\>

```java
package com.mis.recon.common;

import lombok.Data;

@Data
public class ApiResponse<T> {
    private int code;        // 0=成功，非 0=错误码（ErrorCode）
    private T data;          // 成功时业务数据；失败时 null
    private String message;  // 失败时人类可读描述；成功时可为 null 或 "ok"

    public static <T> ApiResponse<T> ok()          { return ok(null); }
    public static <T> ApiResponse<T> ok(T data)    { ApiResponse<T> r = new ApiResponse<>(); r.code = 0; r.data = data; return r; }
    public static <T> ApiResponse<T> fail(int code, String message) {
        ApiResponse<T> r = new ApiResponse<>(); r.code = code; r.message = message; return r;
    }
    public static <T> ApiResponse<T> fail(ErrorCode ec) { return fail(ec.getCode(), ec.getMessage()); }
}
```

裁决（G1）：**HTTP 200 + code≠0**。理由：与 MIS `Result<T>`（code==0 成功）风格一致（技术适配附录第 4 条），BFF 透传 `/api/v1/recon/**` 无需状态码映射；前端统一拦截 `code≠0` 弹错误；RESTful 4xx/5xx 会给网关/日志监控制造噪音且业务错误与传输错误混在一起。`code` 为 `int`，不受 JacksonConfig 全局 Long→String 影响。

### 1.2 PageResult\<T\>

```java
package com.mis.recon.common;

@Data
public class PageResult<T> {
    private List<T> list;
    private long total;
    private int page;     // 1-based（对外契约，G17）
    private int size;
    private int pages;    // 总页数 = ceil(total/size)

    public static <T> PageResult<T> from(Page<T> springPage) {
        PageResult<T> r = new PageResult<>();
        r.list = springPage.getContent();
        r.total = springPage.getTotalElements();
        r.page = springPage.getNumber() + 1;   // Spring 0-based → 对外 1-based
        r.size = springPage.getSize();
        r.pages = springPage.getTotalPages();
        return r;
    }
}
```

裁决：`pages` 必含（前端分页组件需要总页数）；`page` 对外 1-based（G17）。

### 1.3 ErrorCode

裁决（G2）：**枚举**。码段规划按任务指令：1xxx=通用 / 2xxx=连接 / 3xxx=数据源 / 4xxx=场景 / 5xxx=check / 6xxx=校验 V 规则。V20/V21/V22/V33/V34/V35 各给固定码（前端据此识别校验类型、定位表单 Tab）。

```java
package com.mis.recon.common;

public enum ErrorCode {
    // ---- 通用 1xxx ----
    SUCCESS(0, "成功"),
    PARAM_ERROR(1001, "参数校验失败"),
    RESOURCE_NOT_FOUND(1002, "资源不存在"),
    REQUEST_BODY_INVALID(1003, "请求体格式错误"),
    SYSTEM_ERROR(1999, "系统内部错误"),

    // ---- 连接 2xxx ----
    CONN_CODE_EXISTS(2001, "连接编码已存在"),
    CONN_REFERENCED(2002, "连接已被数据源引用，无法删除"),
    CONN_NOT_FOUND(2003, "连接不存在"),
    CONN_TEST_FAILED(2004, "测试连接失败"),

    // ---- 数据源 3xxx ----
    DS_CODE_EXISTS(3001, "数据源编码已存在"),
    DS_NOT_FOUND(3002, "数据源不存在"),
    DS_TEST_FAILED(3003, "数据源测试失败"),
    DS_REFERENCED(3004, "数据源已被 check 引用，无法删除"),   // 预留（T03 不实现删除引用拦截，见 §9）
    DS_RECORD_KEY_INVALID(3005, "记录键表达式非法"),

    // ---- 场景 4xxx ----
    SCENARIO_CODE_EXISTS(4001, "场景编码已存在"),
    SCENARIO_NOT_FOUND(4002, "场景不存在"),

    // ---- check 5xxx ----
    CHECK_NOT_FOUND(5001, "检查不存在"),
    CHECK_NAME_FROZEN(5002, "check_name 创建后不可修改"),
    ALIAS_CONFLICT(5003, "数据源别名场景内冲突"),
    CHECK_NAME_EXISTS(5004, "场景内检查名已存在"),

    // ---- 校验 V 规则 6xxx ----
    V20_WINDOW_PARAM_MISSING(6201, "取数 SQL 必须包含窗口参数"),
    V21_TOLERANCE_FRACTION(6202, "金额容差必须为整数（单位=分），填小数拒绝"),
    V22_AGG_SQL_HAS_WINDOW(6203, "聚合 SQL 禁止包含窗口参数 :p_start/:p_end"),
    V33_NON_MONETARY_PRIMARY(6204, "积分数/非货币计量字段不能作 primary"),
    V34_UNION_COLUMN_ALIGN(6205, "UNION 多表取数禁止 SELECT *，两侧必须显式列名并按名对齐"),
    V35_UNION_AMOUNT_TYPE(6206, "UNION 两侧金额字段类型必须一致"),
    CONSUME_MODE_MIXED(6207, "同一 check 内所有数据源消费模式必须一致（A-R2-04）"),
    RECORD_KEY_BLANK(6208, "record_key_expression 不能为空或空白"),
    TIME_FIELD_MISMATCH(6209, "consume_json 显式 time_field 与数据源声明不一致"),
    WINDOW_RANGE_INVALID(6210, "存在 time_window 数据源时汇总窗口必填且 end > start"),
    INVALID_ENUM_VALUE(6211, "枚举值非法");

    private final int code;
    private final String message;
    ErrorCode(int code, String message) { this.code = code; this.message = message; }
    public int getCode() { return code; }
    public String getMessage() { return message; }
}
```

码段使用约定：6xxx 段只放「配置保存校验」类错误，前端对 6201~6210 可直接映射到表单校验提示；1001 由 DTO `@Valid` 违约统一抛出（GlobalExceptionHandler 拼接第一条字段错误）。

### 1.4 BizException

```java
package com.mis.recon.common;

public class BizException extends RuntimeException {
    private final int code;
    public BizException(ErrorCode ec)                    { super(ec.getMessage()); this.code = ec.getCode(); }
    public BizException(ErrorCode ec, String message)    { super(message); this.code = ec.getCode(); }
    public int getCode() { return code; }
}
```

### 1.5 GlobalExceptionHandler（裁决 G20：位置 `com.mis.recon.common`）

```java
package com.mis.recon.common;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ApiResponse<Void> handleBiz(BizException e) {
        return ApiResponse.fail(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<Void> handleValid(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .findFirst().map(f -> f.getField() + ": " + f.getDefaultMessage())
                .orElse(ErrorCode.PARAM_ERROR.getMessage());
        return ApiResponse.fail(ErrorCode.PARAM_ERROR.getCode(), msg);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ApiResponse<Void> handleConstraint(ConstraintViolationException e) {
        return ApiResponse.fail(ErrorCode.PARAM_ERROR.getCode(), e.getMessage());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ApiResponse<Void> handleUnreadable(HttpMessageNotReadableException e) {
        return ApiResponse.fail(ErrorCode.REQUEST_BODY_INVALID.getCode(), ErrorCode.REQUEST_BODY_INVALID.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ApiResponse<Void> handleOther(Exception e) {
        log.error("unhandled exception", e);
        return ApiResponse.fail(ErrorCode.SYSTEM_ERROR.getCode(), ErrorCode.SYSTEM_ERROR.getMessage());
    }
}
```

裁决（G1 补充）：所有异常统一 `HTTP 200 + code`；`SYSTEM_ERROR` 兜底时打 error 日志（不把内部堆栈透出给前端）。

---

## 2. 枚举类（F25~F27，包 `com.mis.recon.domain.enums`）

通用形态（三个枚举文件一致）：

```java
public enum ConnectionType {
    mysql, oracle, postgresql;

    public static ConnectionType from(String value) {
        if (value == null) throw new BizException(ErrorCode.INVALID_ENUM_VALUE, "ConnectionType 不能为空");
        try { return valueOf(value.trim()); }
        catch (IllegalArgumentException e) {
            throw new BizException(ErrorCode.INVALID_ENUM_VALUE, "ConnectionType 非法: " + value + "，合法值: mysql/oracle/postgresql");
        }
    }
}
```

裁决（G18）：**枚举常量名即 DDL 落库值（code=name）**，JSON 序列化用 Jackson 默认 `name()`，反序列化统一走 `@JsonCreator from(String)`（DTO 层 String 接收，Service 层 `from()` 解析——见 §4），非法值抛 `BizException(6211)` 且 message 带合法值列表（前端可直接展示）。

### 2.1 ConfigEnums（F25）

| 枚举 | 全值集合（name=落库值） | 依据 |
|------|------------------------|------|
| `FetchType` | `db` / `api` / `custom` | V1 DDL `fetch_type` 注释（MVP 只实现 db） |
| `ConnectionType` | `mysql` / `oracle` / `postgresql` | V1 DDL `type` 注释；技术适配 §2.7 三方言 |
| `MatchStrategy` | `exact_key` / `composite_key` / `sum_check` / `fuzzy` / `chain` / `custom` / `custom_check` | 补丁文档 §1015 行明确「strategy 落库枚举值不变（…fuzzy… 全量保留，仅界面收敛可选项）」；V1 DDL 注释漏列 fuzzy，match_rule 无 ck_* 约束，含 fuzzy 无冲突 |
| `MultiRowPolicy` | `aggregate` / `latest` / `reject` | V1 DDL `multi_row_json` 注释 |
| `ConsumeMode` | `incremental` / `time_window` | V1 DDL `consume_json` 注释 |
| `GateType` | `flag_query` / `row_count_delta` / `app_callback` / `stability_window` | V1 DDL `ck_gate_type` CHECK |
| `RefundSignRule` | `same_table_negative` / `same_table_type_col` / `separate_table` / `none` | V1 DDL `refund_sign_rule` 注释 |
| `Grain` | `row` / `aggregated` | V1 DDL `grain` 注释 |
| `DeleteMode` | `unknown` / `none` / `soft` / `physical` | V1 DDL `ck_ds_del_mode` CHECK |

### 2.2 ResultEnums（F26）

| 枚举 | 全值集合 | 依据 |
|------|---------|------|
| `DiffType` | `field_mismatch` / `unmatched_left` / `unmatched_right` / `anomaly` | 需求说明书 §1.2 |
| `DiffStatus` | `pending` / `confirmed` / `resolved` / `deferred` | V1 DDL `ck_detail_status` CHECK |
| `HandleStatus` | `unhandled` / `handled` / `ignored` / `false_positive` | V1 DDL `ck_detail_handle` CHECK |
| `HealthStatus` | `healthy` / `degraded` / `empty` / `error` | V1 DDL `health_status` 注释 + 需求说明书 §1.2 |
| `RunStatus` | `running` / `success` / `partial_success` / `failed` / `skipped` | 需求说明书 §1.2（四值）+ T05 验收 3 引入 `partial_success`（recon_run.status 无 CHECK，T03 预置无冲突） |
| `SendStatus` | `success` / `failed` / `partial` | 需求说明书 §1.2 补充枚举 |
| `Severity` | `info` / `warn` / `critical` | V1 DDL `min_severity` 注释 |
| `ReportType` | `diff` / `balance` / `both` | V1 DDL `report_type` 注释 |

### 2.3 AmountEnums（F27）

| 枚举 | 全值集合 | 依据 |
|------|---------|------|
| `AmountUnit` | `yuan` / `point` / `non_monetary` | 任务指令（V33 规则 point/non_monetary 均为 unit 值）；V1 DDL 注释仅写 yuan/point，non_monetary 由补丁 §2.8 V33 引入 |
| `UnitRole` | `primary` / `aux` | V1 DDL `amount_fields_json` 注释 |
| `AmountDirection` | `in` / `out` / `none` | V1 DDL `amount_direction` 注释 |

---

## 3. 实体类（F28~F35，包 `com.mis.recon.domain.config`）

### 3.1 实体通用约定（8 个实体统一）

```java
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "recon_xxx")
@DynamicUpdate                 // 裁决 G6
public class ReconXxx {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)   // BIGSERIAL → IDENTITY，裁决见下
    private Long id;

    @Column(insertable = false, updatable = false)
    private LocalDateTime createdAt;   // DB DEFAULT now() 维护（G5）
    @Column(insertable = false)
    private LocalDateTime updatedAt;   // DB 首次 now()，应用层 @PreUpdate 刷新（G5）

    @PreUpdate
    public void preUpdate() { this.updatedAt = LocalDateTime.now(); }
}
```

逐项裁决：

| 项 | 结论 | 理由 |
|----|------|------|
| id | `Long` + `@GeneratedValue(strategy = GenerationType.IDENTITY)` | V1 DDL `BIGSERIAL`，与 JPA IDENTITY 兼容（技术适配 §2.1 #12 / T02 §2.3） |
| created_at | `LocalDateTime` + `@Column(insertable=false, updatable=false)` | DB `DEFAULT now()` 单点维护（G5）；insertable=false 避免 JPA 显式写 null 覆盖默认值 |
| updated_at | `LocalDateTime` + `@Column(insertable=false)` + `@PreUpdate` | DDL 无 UPDATE 触发器，`updatable=false` 会让更新时间永远停留创建时刻；@PreUpdate 在 flush 时统一刷新（G5） |
| @DynamicUpdate | 8 个实体统一加 | 只更新脏字段，避免整行重写 JSONB 大字段（G6） |
| @EnableJpaAuditing | 不用于配置表；不加 @CreatedDate/@LastModifiedDate | DB now() + @PreUpdate 已覆盖，避免双写冲突（G7）；@EnableJpaAuditing 保留为 T04+ 预留 |
| @EntityScan | T01 的 `@EntityScan("com.mis.recon.entity")` 改为 `@EntityScan("com.mis.recon.domain")` | 实体实际包 domain.config（F28~F35），T01 预留包名不存在，不改则实体漏扫（G19）。此为本规格对 T01 的唯一修订项 |
| enabled / mixed_direction（SMALLINT） | Java `Integer`（0/1） | T02 §2.2 锁定「SMALLINT → JPA Integer 映射最简单」；DTO 层 Boolean ↔ 实体 Integer 由 Service 转换 |
| password（连接） | `@JsonProperty(access = JsonProperty.Access.WRITE_ONLY)` | 只反序列化不序列化，列表/详情天然脱敏（G16） |
| 枚举字段（type/strategy/fetchType 等） | Java `String` 持有 | DDL 落库即字符串；枚举解析在 Service 层 `Enum.from()`（G18），实体不绑定枚举避免 JPA 转换器 |
| JSONB 列 | Java `String` + `@JdbcTypeCode(SqlTypes.JSON)` | 见 3.2 |

### 3.2 JSONB 列方案（裁决 G4）

**裁决：`String` 字段 + `@JdbcTypeCode(SqlTypes.JSON)`，8 张表全部 JSONB 列统一，不用 `columnDefinition="jsonb"`。**

理由：
1. Hibernate 6.4（Boot 3.2.5）的 `@JdbcTypeCode(SqlTypes.JSON)` 会以 JSON JDBC 类型绑定参数，PG 侧存在 `json → jsonb` 的**赋值转换**（assignment cast），写入 jsonb 列成功；读取时 Hibernate 转回 String，无需自定义。
2. `columnDefinition="jsonb"` 只在 hbm2ddl 建表时生效，本工程 `ddl-auto=none`（T01 锁定），写它不参与建表且给人「Hibernate 管表结构」的误导，与 Flyway 双源漂移风险。
3. 风险预案：若 Hibernate 6.4.4 + PG 42.7.3 实测对 `SqlTypes.JSON` 绑定异常，**统一替换为 `@JdbcTypeCode(SqlTypes.JSONB)`**（Hibernate 6.2+ 提供 PG jsonb 专用类型码），一处全局替换，不影响实体其余部分（见 §9）。

8 张表 JSONB 列清单（对齐 T02 §4.1/§4.2 归类）：

| 实体 | JSONB 列（String + @JdbcTypeCode(SqlTypes.JSON)） |
|------|--------------------------------------------------|
| ReconConnection | `propsJson` |
| ReconDatasource | `fetchConfigJson`、`fieldsJson`、`healthRulesJson`、`amountFieldsJson` |
| ReconScenario | `usesJson`、`hooksJson`、`reporterJson` |
| ReconCheck | `consumeJson` |
| ReconMatchRule | `datasetsJson`、`keyFieldsJson`、`fieldTransformJson`、`multiRowJson`、`configJson` |
| ReconCompareRule | `rulesJson` |
| ReconReadinessGate | `gateConfigJson` |
| ReconReporterConfig | `configJson` |

TEXT 列（`keyScanSql`/`aggSql`/`gateSql`）为普通 `String`，无注解。

### 3.3 逐表字段清单（与 V1 DDL 第 28~185 行一一对应）

#### ReconConnection（表 recon_connection，V1 29~47 行）

| 列 | Java 类型 | 注解/说明 |
|----|-----------|----------|
| id | Long | @Id @GeneratedValue(IDENTITY) |
| connCode | String | @Column(name="conn_code", length=64, nullable=false)，@JsonProperty WRITE_ONLY 不适用（code 需展示） |
| name | String | length=128 |
| type | String | length=32，nullable=false；Service 层 ConnectionType.from() 校验 |
| jdbcUrl | String | length=512 |
| username | String | length=128 |
| password | String | length=256；**@JsonProperty(access=WRITE_ONLY)**（G16 脱敏） |
| propsJson | String | JSONB，@JdbcTypeCode(SqlTypes.JSON) |
| dbTimezone | String | length=64，DDL DEFAULT 'Asia/Shanghai' |
| fetchOverlapSec | Integer | DDL DEFAULT 300 |
| clockProbeSql | String | length=200 |
| jdbcPropsLocked | String | length=500 |
| enabled | Integer | SMALLINT 0/1，DDL DEFAULT 1 |
| createdAt / updatedAt | LocalDateTime | G5 约定 |

#### ReconDatasource（表 recon_datasource，V1 50~89 行，27 业务字段）

| 列 | Java 类型 | 说明 |
|----|-----------|------|
| id | Long | @Id |
| dsCode | String(64) | @Column(name="ds_code", nullable=false) |
| name | String(128) | |
| connCode | String(64) | api 类型可空 |
| pullCron | String(64) | |
| recordKeyExpression | String(256) | nullable=false（三层键·存储层） |
| timeField | String(64) | |
| fetchType | String(16) | DDL DEFAULT 'db'；Service 层 FetchType.from() |
| fetchConfigJson | String | JSONB |
| fieldsJson | String | JSONB |
| healthRulesJson | String | JSONB |
| amountFieldsJson | String | JSONB |
| refundSignRule | String(16) | RefundSignRule.from() |
| refundFlagExpr | String(200) | |
| grain | String(16) | DDL DEFAULT 'row'；Grain.from() |
| groupByFields | String(256) | ck_ds_grain 联动 |
| memberKeyField | String(64) | |
| keyScanSql | String | TEXT（非 JSONB） |
| aggSql | String | TEXT（非 JSONB） |
| aggKeyBatchSize | Integer | DDL DEFAULT 500；ck_ds_batch 1~1000 |
| aggJoinMode | String(16) | DDL DEFAULT 'in_list' |
| aggFullRecomputeCron | String(64) | |
| mixedDirection | Integer | SMALLINT 0/1，DDL DEFAULT 0 |
| directionKeyField | String(64) | ck_ds_mixed_key 联动 |
| keyCaseMode | String(8) | DDL DEFAULT 'upper'；ck_ds_case |
| deleteMode | String(16) | DDL DEFAULT 'unknown'；DeleteMode.from() |
| softDeleteExpr | String(200) | ck_ds_del_expr 联动 |
| deleteModeEvidence | String(200) | |
| enabled | Integer | DDL DEFAULT 1 |
| createdAt / updatedAt | LocalDateTime | |

#### ReconScenario（表 recon_scenario，V1 92~111 行）

| 列 | Java 类型 | 说明 |
|----|-----------|------|
| id | Long | |
| scenarioCode | String(64) | nullable=false |
| name | String(128) | |
| cronExpr | String(64) | |
| usesJson | String | JSONB（派生汇总，T03 由 CheckService 回写，见 §6.3） |
| hooksJson | String | JSONB |
| reporterJson | String | JSONB |
| reportCron | String(64) | |
| reportType | String(16) | DDL DEFAULT 'diff'；ReportType.from() |
| poolMaxAgeDays | Integer | DDL DEFAULT 30 |
| pendingMaxWaitHours | Integer | DDL DEFAULT 24 |
| onDegraded / onEmpty / onError | String(16) | DDL DEFAULT 'proceed'（proceed/block，无 CHECK，String） |
| enabled | Integer | DDL DEFAULT 1 |
| createdAt / updatedAt | LocalDateTime | |

#### ReconCheck（表 recon_check，V1 114~125 行）

| 列 | Java 类型 | 说明 |
|----|-----------|------|
| id | Long | |
| scenarioCode | String(64) | nullable=false；uk_check 复合键之一 |
| checkName | String(128) | nullable=false；创建后禁改（5002） |
| seqNo | Integer | DDL DEFAULT 0 |
| consumeJson | String | JSONB（G13：行结构含 ds_code，见 §4.3） |
| runMode | String(8) | DDL DEFAULT 'formal'（formal/observe） |
| enabled | Integer | DDL DEFAULT 1 |
| createdAt / updatedAt | LocalDateTime | |

#### ReconMatchRule（表 recon_match_rule，V1 128~142 行）

| 列 | Java 类型 | 说明 |
|----|-----------|------|
| id | Long | |
| scenarioCode | String(64) | uk_match_rule 复合键之一 |
| checkName | String(128) | uk_match_rule 复合键之一 |
| strategy | String(32) | nullable=false；MatchStrategy.from() |
| datasetsJson | String | JSONB（参与匹配 alias 列表） |
| keyFieldsJson | String | JSONB（模板表达式，对象形式权威，见需求说明书 §4.4） |
| fieldTransformJson | String | JSONB |
| multiRowJson | String | JSONB |
| customClass | String(256) | MVP 预留 |
| configJson | String | JSONB |
| createdAt / updatedAt | LocalDateTime | |

#### ReconCompareRule（表 recon_compare_rule，V1 145~153 行）

| 列 | Java 类型 | 说明 |
|----|-----------|------|
| id | Long | |
| scenarioCode | String(64) | uk_compare_rule 复合键之一 |
| checkName | String(128) | uk_compare_rule 复合键之一 |
| rulesJson | String | JSONB（fields:[{name,left_field,right_field,compare_mode,tolerance,is_amount,value_transform}]，tolerance 单位=分） |
| createdAt / updatedAt | LocalDateTime | |

#### ReconReadinessGate（表 recon_readiness_gate，V1 156~170 行）

| 列 | Java 类型 | 说明 |
|----|-----------|------|
| id | Long | |
| scenarioCode | String(64) | nullable=false；idx_gate_scenario |
| gateName | String(128) | nullable=false |
| gateType | String(16) | nullable=false；GateType.from()（ck_gate_type） |
| gateSql | String | TEXT（非 JSONB） |
| gateConfigJson | String | JSONB |
| minWaitMin | Integer | DDL DEFAULT 0 |
| maxWaitMin | Integer | DDL DEFAULT 120 |
| enabled | Integer | DDL DEFAULT 1 |
| createdAt / updatedAt | LocalDateTime | |

#### ReconReporterConfig（表 recon_reporter_config，V1 173~184 行）

| 列 | Java 类型 | 说明 |
|----|-----------|------|
| id | Long | |
| scenarioCode | String(64) | nullable=false |
| checkName | String(128) | DDL DEFAULT '*'（'*' = 该场景全部 check） |
| channel | String(64) | nullable=false（email/webhook/custom） |
| configJson | String | JSONB |
| minSeverity | String(16) | DDL DEFAULT 'info'；Severity.from() |
| enabled | Integer | DDL DEFAULT 1 |
| createdAt / updatedAt | LocalDateTime | |

> 注：ReadinessGate / ReporterConfig 两张表在 T03 只建实体 + Repository（服务/端点不暴露——T03 验收不含这两类 CRUD，F63/F64 职责在 T07 报告/就绪门任务落地）。实体提前建，供 T07 复用，避免重复劳动。T03 规格含其字段映射，但**不**为其写 Service/Controller。

---

## 4. DTO（F48~F51，包 `com.mis.recon.domain.dto`）

### 4.1 通用约定

- **JSON 契约 snake_case**（G3）：DTO 字段 `connCode` 在 JSON 中为 `conn_code`，全局 SNAKE_CASE 由 `application.yml` 配置 `spring.jackson.property-naming-strategy: SNAKE_CASE` 生效（不影响 JacksonConfig customizer 的 Long→String/时间格式）。
- **枚举字段用 String 接收**，Service 层 `Enum.from()` 解析（G18）：非法值抛 `6211` 且 message 带合法值列表，比 Jackson 反序列化 400 更可控（前端可直接展示）。
- **DTO 不带 id，update 按唯一业务键定位**（G9）：POST 时 Service 校验唯一性（existsByXxx），PUT 时按路径 code（或 scenario_code+check_name）定位；DTO 中 code 与路径 code 不一致 → 拒绝（禁改语义）。
- 校验注解用 `jakarta.validation`（spring-boot-starter-validation 已含）。
- `enabled` 用 `Boolean`（REST 布尔语义清晰），实体 `Integer` 0/1，Service 层转换：`Boolean.TRUE.equals(enabled) ? 1 : 0`；DTO 不传时默认 `true`。

snake_case 正则（conn_code/ds_code/scenario_code/check_name 统一）：`^[a-z][a-z0-9_]{0,63}$`（≤64）。

### 4.2 ConnectionSaveReq（F48）

```java
@Data
public class ConnectionSaveReq {
    @NotBlank(message = "连接编码必填")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "连接编码须为 snake_case，≤64 字符")
    private String connCode;

    @NotBlank(message = "名称必填") @Size(max = 128)
    private String name;

    @NotBlank(message = "类型必填")
    private String type;                 // mysql/oracle/postgresql，Service 层 ConnectionType.from()

    @Size(max = 512)
    private String jdbcUrl;              // 界面按 host/port/database|service_name 拼装后提交（拼装在前端/表单层）

    @Size(max = 128)
    private String username;
    @Size(max = 256)
    private String password;             // 明文存库决策（内网），只读账号

    private String propsJson;            // JSON 字符串（连接池/超时高级配置）

    @Size(max = 64)
    private String dbTimezone;           // 默认 Asia/Shanghai
    private Integer fetchOverlapSec;     // 默认 300；@Min(0)
    @Size(max = 200)
    private String clockProbeSql;
    @Size(max = 500)
    private String jdbcPropsLocked;

    private Boolean enabled;             // 默认 true
}
```

### 4.3 DatasourceSaveReq（F49）

字段与实体 ReconDatasource 一一对应（见 §3.3），关键校验：

| 字段 | 校验 | 说明 |
|------|------|------|
| dsCode | @NotBlank + @Pattern(snake_case) | 唯一，保存后不可改 |
| name | @NotBlank @Size(128) | |
| recordKeyExpression | @NotBlank @Size(256) | 必填（DDL NOT NULL），服务层再 trim 非空白（6208） |
| timeField | @Size(64) | 需求说明书：必选（下拉来自字段映射）；T03 不强制字段存在性（字段映射解析 T04） |
| connCode | @Size(64) | db 类型必填；api/custom 可空（Service 层按 fetchType 校验） |
| fetchType | String | FetchType.from() |
| grain / deleteMode / keyCaseMode / refundSignRule / aggJoinMode | String | 各自 Enum.from() |
| aggKeyBatchSize | Integer @Min(1) @Max(1000) | ck_ds_batch |
| mixedDirection | Boolean | 实体 Integer 0/1 |
| enabled | Boolean | 默认 true |
| fetchConfigJson / fieldsJson / healthRulesJson / amountFieldsJson | String | JSON 字符串；T03 不校验 JSON 结构合法性（JsonUtil 可解析即可，建议 Service 层 `JsonUtil.isValid` 兜底 → 1003） |
| keyScanSql / aggSql | String | TEXT；V20/V22/V34 校验输入（见 §6.4） |

### 4.4 ScenarioSaveReq（F50）

| 字段 | 校验 | 说明 |
|------|------|------|
| scenarioCode | @NotBlank + @Pattern(snake_case) | 唯一 |
| name | @NotBlank @Size(128) | |
| cronExpr / reportCron | @Size(64) | T03 不校验 cron 语法（Quartz 解析 T04 SchedulerManager） |
| usesJson | **不接收（忽略）** | 派生汇总，由 CheckService 回写（G12）；DTO 里不提供该字段，前端只读展示区对应 GET 返回 |
| hooksJson / reporterJson | String | JSON 字符串 |
| reportType | String | ReportType.from()，默认 diff |
| poolMaxAgeDays / pendingMaxWaitHours | Integer @Min(0) | 默认 30/24 |
| onDegraded / onEmpty / onError | String | 默认 proceed（proceed/block） |
| enabled | Boolean | 默认 true |

### 4.5 CheckSaveReq（F51，★ 核心）

裁决（G8）：**嵌套对象**。理由：check+match_rule+compare_rule 是三个独立表的配置聚合，内嵌对象与实体聚合语义一致、@Valid 级联、拆表边界清晰；平铺字段会把三表边界抹平，CheckService 拆表时反而要二次分组；前端表单三 Tab（A 消费模式 / B 匹配规则 / C 比较规则）天然对应嵌套结构。

```java
@Data
public class CheckSaveReq {
    // ---- check 本体（recon_check）----
    @NotBlank @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "场景编码须为 snake_case")
    private String scenarioCode;

    @NotBlank @Size(max = 128)
    private String checkName;            // 创建后禁改（5002）

    private Integer seqNo;               // 默认 0
    private String consumeJson;          // JSON 字符串；行结构 {alias:{ds_code, mode, time_field?, start?, end?}}（G13）
    private String runMode;              // formal/observe，默认 formal
    private Boolean enabled;             // 默认 true

    // ---- 匹配规则（recon_match_rule）----
    @Valid
    private MatchRuleReq matchRule;

    // ---- 比较规则（recon_compare_rule）----
    @Valid
    private CompareRuleReq compareRule;

    @Data
    public static class MatchRuleReq {
        @NotBlank(message = "匹配策略必填")
        private String strategy;              // MatchStrategy.from()
        private String datasetsJson;          // 参与匹配 alias 列表（第一批 = consume_json 自动复制，管理端只配一份）
        private String keyFieldsJson;         // 模板表达式，对象形式权威
        private String fieldTransformJson;
        private String multiRowJson;
        @Size(max = 256)
        private String customClass;
        private String configJson;
    }

    @Data
    public static class CompareRuleReq {
        private String rulesJson;             // fields:[{name,left_field,right_field,compare_mode,tolerance,is_amount,value_transform}]
    }
}
```

**consume_json 行结构（G13 扩展，落库格式兼容）**：

```json
{
  "orders":  { "ds_code": "huadi2_order",  "mode": "incremental" },
  "wechat_pay": { "ds_code": "huadi2_wechat_pay", "mode": "time_window",
                  "time_field": "pay_time", "start": "2026-07-30 00:00:00", "end": "2026-07-31 23:59:59" }
}
```

- `alias`（key）场景级唯一、创建后不可改（5003）；`ds_code` 为 T03 新增可选字段，T04 引擎解析忽略（JSON 未知字段不报错）。
- `mode` 一致性（6207）：同一 check 内所有行 mode 必须一致（A-R2-04 保留）。
- `time_field` 可省略（省略 → 引擎取数据源声明）；显式配置时校验与数据源声明一致（6209）。
- `start/end` 可省略：存在 mode=time_window 的行时，CheckSaveReq 顶层提供汇总窗口（windowStart/windowEnd），Service 保存时回写行内（任务分解 939 行「保存时自动回写本 check 所有 time_window 数据源行」）；校验基于最终行内值（6210）。
- `datasets_json` 第一批 = consume_json 自动复制（需求说明书收敛口径 2.0：管理端只配一份）；T03 Service 保存时若 `matchRule.datasetsJson` 为空则自动复制自 consume_json 的 alias 列表。

**create/update 区分（G9）**：POST `/checks`（create）→ 校验 `existsByScenarioCodeAndCheckName`（5004 拒绝重复）；PUT `/checks/{scenarioCode}/{checkName}`（update）→ 按复合键定位（5001 不存在则拒绝）→ body 中 scenarioCode/checkName 与路径不一致 → 5002 拒绝（禁改）。

---

## 5. Repository（F57~F64，包 `com.mis.recon.repository`）

8 个 `JpaRepository` 接口。裁决（G11）：**分页+过滤用 @Query JPQL 单方法（可选参数），方法名派生仅用于唯一键/存在性/简单列表**。

```java
public interface ConnectionRepository extends JpaRepository<ReconConnection, Long> {

    Optional<ReconConnection> findByConnCode(String connCode);
    boolean existsByConnCode(String connCode);

    @Query("""
        SELECT c FROM ReconConnection c
        WHERE (:kw IS NULL OR c.connCode LIKE CONCAT('%', :kw, '%')
                          OR c.name   LIKE CONCAT('%', :kw, '%'))
          AND (:enabled IS NULL OR c.enabled = :enabled)
        """)
    Page<ReconConnection> search(@Param("kw") String kw, @Param("enabled") Integer enabled, Pageable pageable);
}
```

| Repository | 方法签名（全部） | 说明 |
|------------|------------------|------|
| ConnectionRepository | `Optional<ReconConnection> findByConnCode(String)`；`boolean existsByConnCode(String)`；`Page<ReconConnection> search(String kw, Integer enabled, Pageable)` | 跨表被引用计数**不在本接口**（G10：放 Service 用 DatasourceRepository） |
| DatasourceRepository | `Optional<ReconDatasource> findByDsCode(String)`；`boolean existsByDsCode(String)`；`long countByConnCode(String)`；`List<ReconDatasource> findByConnCode(String)`；`Page<ReconDatasource> search(String kw, Integer enabled, Pageable)` | countByConnCode=被引用计数；findByConnCode=被引用 ds_code 列表（提示语用） |
| ScenarioRepository | `Optional<ReconScenario> findByScenarioCode(String)`；`boolean existsByScenarioCode(String)`；`Page<ReconScenario> search(String kw, Integer enabled, Pageable)` | |
| CheckRepository | `Optional<ReconCheck> findByScenarioCodeAndCheckName(String, String)`；`boolean existsByScenarioCodeAndCheckName(String, String)`；`List<ReconCheck> findByScenarioCodeOrderBySeqNo(String)`；`@Query List<ReconCheck> findByScenarioCodeAndEnabled(String scenarioCode, Integer enabled)`；`Page<ReconCheck> search(String scenarioCode, String kw, Integer enabled, Pageable)` | 分页 search 含 scenario_code 必选过滤 + keyword（checkName 模糊）+ enabled 可选 |
| MatchRuleRepository | `Optional<ReconMatchRule> findByScenarioCodeAndCheckName(String, String)`；`boolean existsByScenarioCodeAndCheckName(String, String)`；`void deleteByScenarioCodeAndCheckName(String, String)` | 级联删除用 |
| CompareRuleRepository | 同 MatchRuleRepository | |
| ReadinessGateRepository | `List<ReconReadinessGate> findByScenarioCode(String)`；`Page<ReconReadinessGate> search(...)`（可选） | T03 只建接口（无 Service/Controller） |
| ReporterConfigRepository | `List<ReconReporterConfig> findByScenarioCode(String)`；`Optional<ReconReporterConfig> findByScenarioCodeAndCheckName(String, String)` | T03 只建接口 |

需要 @Query 的查询：4 个分页 search（keyword+enabled/scenarioCode 过滤组合）；其余全方法名派生。`deleteByScenarioCodeAndCheckName` 为派生删除（非 @Modifying，Spring Data 生成 DELETE JPQL，无需 @Modifying 注解——派生删除方法不需要 @Modifying）。

---

## 6. 服务层（F77~F81 + F82 基础版）

包：`com.mis.recon.service.config`（Connection/Datasource/Scenario/Check/ConfigValidation）、`com.mis.recon.service.support`（ConnectionPoolManager）。

### 6.1 ConnectionService（F77）

| 方法 | 实现要点 |
|------|----------|
| `ApiResponse<PageResult<ReconConnection>> page(int page, int size, String keyword, Integer enabled)` | search @Query + PageResult.from |
| `ReconConnection get(String connCode)` | findByConnCode → 不存在抛 2003 |
| `ReconConnection save(ConnectionSaveReq req)` | **唯一预检**：existsByConnCode → 抛 2001（DB uk_conn_code 兜底）；entity 转换（enabled Boolean→Integer） |
| `ReconConnection update(String connCode, ConnectionSaveReq req)` | findByConnCode → 不存在 2003；**req.connCode ≠ connCode → 抛 2003（禁改语义，路径为准）**；更新并保存 |
| `void delete(String connCode)` | **引用校验（G10）**：`datasourceRepository.findByConnCode(connCode)` 非空 → 拼接提示「连接已被数据源 ds_code=xxx 引用，无法删除」（2002，列出全部 ds_code，需求说明书 §2.1 文案）；否则 deleteById |
| `void testConnection(String connCode)` | findByConnCode → 2003 兜底；委托 `connectionPoolManager.testConnection(entity)`（G15） |

### 6.2 DatasourceService（F78）

| 方法 | 实现要点 |
|------|----------|
| page / get / save / update / delete | 同构 ConnectionService；唯一键 dsCode（3001/3002）；delete 的 check 引用拦截（3004）**T03 预留不实现**（见 §9，验收不含） |
| `void save(..., 调度注册)` | **T03 留空**：方法尾部 `// TODO(T04): SchedulerManager.registerPullJob(dsCode, pullCron)` 注释位，不实际调用（Quartz 调度开关默认 false） |
| `void testConnection(String dsCode)` | findByDsCode → 3002；`fetchType != 'db'` → 抛 3003（api/custom 不走连接测试，需求说明书 §2.1「api/custom 取数不经过连接层」）；按 connCode 取 connection → `connectionPoolManager.testConnection(conn)`。**试拉样例（BR-18）留 T04**（G14） |

### 6.3 ScenarioService（F79）与 CheckService 的 uses_json 回写（G12 裁决）

- ScenarioService：CRUD + 唯一校验（4001/4002）；**uses_json 不手动维护**（DTO 不接收，GET 详情返回现状）。
- **uses_json 回写落在 CheckService**（F80 职责，任务分解 575/1001 行）：

```java
// CheckService 内部（保存/删除 check 后调用）
private void refreshScenarioUsesJson(String scenarioCode) {
    // 1) 汇总该场景所有 check 的 consume_json → [{ds_code, alias}]（去重）
    //    alias 场景级唯一：同 ds_code 必须同 alias（否则 5003）
    // 2) 写入 recon_scenario.uses_json = [{ds, alias, use_fields: []}]
    //    use_fields 精确并集留 T09（T03 置空数组）
}
```

- **alias 登记与唯一性（5003）**：保存 check 时，对 consume_json 每个 `{alias, ds_code}` 行：
  - 若场景已有其他 check 引用同一 ds_code 且 alias 不同 → 5003；
  - 若场景已有其他 check 使用同一 alias 指向不同 ds_code → 5003；
  - 首次引用该 ds_code → 登记（alias 默认=ds_code，可改短，登记后锁定）。
- 删除 check 后同样重算 uses_json（移除不再被任何 check 引用的 ds）。
- T03 边界（见 §9）：use_fields 置空数组；reporter_config 不参与回写。

### 6.4 ConfigValidationService（F81，★ 校验）

裁决：**输入 = 对应 SaveReq + 必要上下文（场景现存 check 列表/数据源声明），输出 = 校验失败抛 BizException（固定码）**。方法签名：

```java
@Service
public class ConfigValidationService {

    // DatasourceSaveReq 相关（V20/V22/V34/V35 + 基础）
    void validateDatasource(DatasourceSaveReq req);

    // CheckSaveReq 相关（V21/V33 + consume mode 一致 + time_field + 汇总窗口 + alias 唯一 + check_name 禁改）
    void validateCheck(CheckSaveReq req, String oldCheckName /* update 时旧名，create 为 null */,
                       List<ReconCheck> existingChecks /* 同场景其他 check，alias 校验用 */,
                       Map<String, ReconDatasource> dsByCode /* alias→ds_code→ds，time_field 校验用 */);

    // 供 ConnectionService/DatasourceService/ScenarioService 复用
    boolean existsConnCode(String connCode);   // 2001
    boolean existsDsCode(String dsCode);       // 3001
    boolean existsScenarioCode(String code);   // 4001
}
```

**SQL 串匹配内联实现（对齐 F21 `SqlTextValidator` 计划，T03 不建 util）**：

```java
// ConfigValidationService 私有方法；F21 落地时抽出到 util/SqlTextValidator
private static boolean containsRequiredParams(String sql, String... params) {
    if (sql == null || sql.isBlank()) return false;
    for (String p : params) {
        if (!sql.contains(p)) return false;   // 大小写敏感（占位符 :p_start 等为固定拼写）
    }
    return true;
}
```

**校验规则逐条（引用补丁文档 V 编号）**：

| # | 规则（补丁 §6.1 原文引用） | 输入来源 | 实现要点 | 错误码 |
|---|---------------------------|----------|----------|--------|
| V20 | `fetch_mode='time'` 但取数 SQL（fetch_config_json 内 sql/key_scan_sql）缺 `:p_start`/`:p_end`；`='pk'` 但缺 `:p_last_pk` | DatasourceSaveReq.fetchConfigJson（JSON 解析取 fetch_mode/sql/key_scan_sql）+ 顶层 keyScanSql | fetch_mode=time → 取数 SQL 与 key_scan_sql 均须含 :p_start 且 :p_end（V1 DDL 注释「阶段一必须含 :p_start/:p_end」）；fetch_mode=pk → 均须含 :p_last_pk；其余模式（full 等）跳过。补丁 V20 与 V22 作用字段不同不矛盾：V20 管阶段一（增量必须用窗口），V22 管阶段二（聚合禁止用窗口），grain=row 时只有 V20（补丁 §6.1 末元注释） | 6201 |
| V21 | `compare_rule` 金额容差填了小数 | CheckSaveReq.compareRule.rulesJson（tolerance 数值） | 解析 rules_json 每行 tolerance（{type:absolute/percentage, value} 或裸数值），value 为数值时用 `BigDecimal.valueOf(value).stripTrailingZeros().scale() > 0` 判非整数 → 拒绝。tolerance=0 合法（必须完全相等）。提示「金额容差单位=分，必须整数」 | 6202 |
| V22 | `grain='aggregated'` 时 agg_sql 出现 `:p_start`/`:p_end` | DatasourceSaveReq.grain + aggSql | grain=aggregated 且 aggSql 含任一窗口参数 → 拒绝；提示语解释原因「聚合阶段禁止使用窗口参数，窗口已由阶段一限定」（补丁 V22 要求解释原因） | 6203 |
| V33 | `amount_fields_json` 中 unit=point 或 non_monetary 的字段 role 不得为 primary | DatasourceSaveReq.amountFieldsJson | 解析 amount_fields_json 每字段 {unit, role}；unit∈{point,non_monetary} 且 role=primary → 拒绝。提示语照补丁原文：「积分数/非货币计量字段不能作 primary。primary 必须指向抵扣金额列。若该表只有积分数没有抵扣金额列 → 禁止配 amount primary」 | 6204 |
| V34 | 取数 SQL 含 UNION 时两侧子查询列数相等且按列名对齐（禁 SELECT * + 纯位置对齐） | DatasourceSaveReq.fetchConfigJson 内 sql / keyScanSql | **裁决：文本级校验（不引 SQL 解析库）**。实现：大小写不敏感定位顶层 `UNION`（正则切分，忽略括号内/字符串内 UNION 的精确处理为 T04 增强项）；两侧取 SELECT 后至 FROM/JOIN 前列清单（逗号切分）；校验：任一侧含 `*` → 拒绝；两侧列数不等 → 拒绝；两侧列名序列不按名对齐（去除 AS 别名/表前缀后逐一比对）→ 拒绝。提示语照补丁原文 | 6205 |
| V35 | UNION 两侧金额字段类型一致（同为 DECIMAL 或同为整数） | — | **裁决：T03 留断言位**：`validateUnionAmountType(sql)` 方法签名 + `// TODO(T04): 连接源库 information_schema 校验类型`，当前恒通过。理由：类型一致性需源库元数据查询（补丁执行点「S + 试拉取 information_schema」），T03 无源库元数据访问能力（ConnectionPoolManager 仅连通性测试）；文本级推断金额类型不可靠，V34 已拦结构错误 | 6206（预留） |
| consume mode 一致 | 同一 check 内所有数据源行 mode 必须一致（A-R2-04 保留） | CheckSaveReq.consumeJson | 解析行 mode 集合，去重后 >1 个 → 拒绝 | 6207 |
| record_key 非空 | record_key_expression 必填（DDL NOT NULL） | DatasourceSaveReq.recordKeyExpression | @NotBlank 之外，Service/校验层 `StringUtils.hasText` 兜底（防 DTO 校验绕过） | 6208 |
| time_field 一致 | consume_json 显式配置 time_field 时须与数据源声明一致 | CheckSaveReq.consumeJson + dsByCode（alias→ds_code→ds） | 行内显式 time_field 时，`dsByCode.get(dsCode).getTimeField()` 不一致 → 拒绝；行内省略 → 跳过（T04 引擎回退取数据源声明，见任务分解 938 行）；alias→ds_code 解析不到（首次登记且未提供 ds_code）→ 跳过（T04 兜底） | 6209 |
| 汇总窗口 | 存在 time_window 数据源时 start/end 必填、end > start | CheckSaveReq.consumeJson + windowStart/windowEnd | 对每 mode=time_window 行：start/end = 行内值 ?? 顶层窗口值；任一为空 → 拒绝；`end <= start`（字符串比较不可靠，用 LocalDateTime.parse("yyyy-MM-dd HH:mm:ss")）→ 拒绝 | 6210 |
| 唯一性 | conn_code/ds_code/scenario_code 唯一 | Service 层预检 | existsByXxx → 2001/3001/4001；DB uk 兜底（uk 冲突抛 DataIntegrityViolation → 全局 1999 或转业务码，见 §9） | 2001/3001/4001 |
| check_name 禁改 | 创建后禁改（差异身份组成部分） | CheckService.update 新旧对比 | req.checkName ≠ oldCheckName → 拒绝（5002） | 5002 |
| alias 唯一 | alias 场景内唯一、同 ds 复用 alias | CheckService + ConfigValidationService | 见 §6.3 | 5003 |

> V17/V18/V19/V23/V24/V25/V26/V27/V28/V29/V30/V31/V32 不在 T03 范围：V17~V19/V26/V28 需试拉样本或数据字典（T04 试拉样例时落地）；V23/V24/V25/V27/V31/V32 为运行期断言/启用前探针（T04~T06）；V29/V30 由 DDL ck_* 与建库自检承担（T02 已落地）。本规格只落「S 保存接口」类且 T03 能力可及的子集（任务分解 F81 口径）。

### 6.5 CheckService（F80，★ 三表事务）

```java
@Service
public class CheckService {

    @Transactional                              // 裁决：三表一次保存同一事务（验收标准 1）
    public ReconCheck saveCheck(CheckSaveReq req) {
        ConfigValidationService.validateCheck(req, null, existingChecks(req), dsIndex(req));
        // create：existsByScenarioCodeAndCheckName → 5004；禁改无旧名
        ReconCheck check = toEntity(req);                        // consume_json 行内回写窗口（6210 后）
        checkRepository.save(check);
        matchRuleRepository.save(toMatchRule(req, check));       // datasets_json 空则复制 consume alias
        compareRuleRepository.save(toCompareRule(req, check));
        refreshScenarioUsesJson(req.getScenarioCode());          // G12 回写
        return check;
    }

    @Transactional
    public ReconCheck updateCheck(String scenarioCode, String checkName, CheckSaveReq req) {
        // 定位 5001；req.checkName != checkName → 5002 禁改
        ConfigValidationService.validateCheck(req, checkName, existingChecks(scenarioCode), dsIndex(req));
        // 覆盖更新三表（match/compare 先查后改或先删后插，uk 约束兜底）
        refreshScenarioUsesJson(scenarioCode);
        return check;
    }

    @Transactional
    public void deleteCheck(String scenarioCode, String checkName) {
        matchRuleRepository.deleteByScenarioCodeAndCheckName(scenarioCode, checkName);   // 级联
        compareRuleRepository.deleteByScenarioCodeAndCheckName(scenarioCode, checkName);  // 级联
        checkRepository.delete(checkRepository.findByScenarioCodeAndCheckName(...).orElseThrow(() -> new BizException(5001)));
        refreshScenarioUsesJson(scenarioCode);
    }

    public PageResult<ReconCheck> page(String scenarioCode, int page, int size, String keyword, Integer enabled) { ... }
    public ReconCheck get(String scenarioCode, String checkName) { ... }   // 5001
}
```

裁决说明：
- **事务边界**：`@Transactional` 注解在 CheckService 方法上（三表写 + uses_json 回写同事务）。任务分解序列图（900~910 行）语义一致。不引 TransactionTemplate（那是 T05 per-check 引擎事务的口径，配置 CRUD 用声明式即可）。
- **级联删除范围**：只删 match_rule / compare_rule（check 从表）；reporter_config 的 `check_name='*'` 为场景级不删、指名 check 的行留 T07（报告任务）统一处理——T03 验收不含 reporter CRUD（见 §9）。
- 唯一性/禁改/alias 校验由 ConfigValidationService 承担（§6.4），CheckService 只编排。

### 6.6 ConnectionPoolManager（F82 基础版，`com.mis.recon.service.support`）

裁决（G15）：**T03 只实现 testConnection（DriverManager 直连 + isValid + close），不建 HikariCP 池；ConcurrentHashMap 缓存字段预留（T04 完整池）**。

```java
@Service
public class ConnectionPoolManager {

    // T04 扩展完整池：ConcurrentHashMap<String, DataSource> pool = new ConcurrentHashMap<>();
    // T03 仅声明预留，不写入/不 evict（测试连接走直连，不污染池）

    private static final Map<String, String> DRIVER_CLASS = Map.of(
            "mysql", "com.mysql.cj.jdbc.Driver",
            "postgresql", "org.postgresql.Driver",
            "oracle", "oracle.jdbc.OracleDriver"   // ojdbc11 未引入，见下
    );

    /** 连通性测试：成功静默返回；失败抛 BizException(2004, 原因) */
    public void testConnection(ReconConnection conn) {
        String driver = DRIVER_CLASS.get(conn.getType());
        if (driver == null) throw new BizException(ErrorCode.CONN_TEST_FAILED, "不支持的连接类型: " + conn.getType());
        try {
            Class.forName(driver);
        } catch (ClassNotFoundException e) {
            throw new BizException(ErrorCode.CONN_TEST_FAILED,
                "驱动未部署: " + conn.getType() + (conn.getType().equals("oracle")
                    ? "（ojdbc11 未引入，Oracle 测试连接暂不可用，T04 引入后可用）" : ""));
        }
        Properties props = new Properties();
        props.setProperty("user", conn.getUsername() == null ? "" : conn.getUsername());
        props.setProperty("password", conn.getPassword() == null ? "" : conn.getPassword());
        applyConnectTimeout(props, conn.getType());   // 驱动属性级连接超时（见下）
        try (Connection c = DriverManager.getConnection(conn.getJdbcUrl(), props)) {
            if (!c.isValid(3)) throw new SQLException("connection not valid");
        } catch (SQLException e) {
            throw new BizException(ErrorCode.CONN_TEST_FAILED, "连接失败: " + e.getMessage());
        }
    }
}
```

裁决要点：
- **DriverManager 而非 HikariCP 建池**（G15）：测试连接低频一次性，建池需管理生命周期（关闭/泄漏），直连 + try-with-resources 最简。
- **单次连接超时（修订，§10 变更 2026-08-14）**：`getConnection(url, props, timeout)` **三参重载在 JDK 8 起已移除**（仅保留 (String)/(String,Properties)/(String,String,String)）。为保持 G15「不污染 `DriverManager.setLoginTimeout` 全局状态」意图，改用**驱动属性级连接超时**：mysql `connectTimeout=5000`(ms)、postgresql `connectTimeout=5`(s)、oracle `oracle.net.CONNECT_TIMEOUT=5000`(ms)，经私有 `applyConnectTimeout(props, type)` 设置后双参 `getConnection(url, props)`。
- **oracle 类型处理（裁决，见 §9）**：驱动未引入（T01 pom 未含 ojdbc11），`Class.forName` 捕获 `ClassNotFoundException` 抛 2004，message 明示「T04 引入 ojdbc11 后可用」；mysql（mysql-connector-j runtime 已含）与 postgresql（平台驱动）正常。
- props_json 池参数（超时/池大小）T04 完整池解析，T03 不读。

---

## 7. Controller（F113~F116，包 `com.mis.recon.controller`）

裁决：Controller 放 `com.mis.recon.controller`（任务分解 F113 权威），类注解 `@RequestMapping("/internal/v1/recon")` 体现 internal 语义（技术适配 §3.1）；不另建 internal 子包（T03 仅 4 个配置 Controller，统一 controller 包）。全部端点返回 `ApiResponse<...>`（G1）。

### 7.1 端点总表

**ConnectionController（F113）**

| Method | Path | 请求 | 响应 data | 校验/说明 |
|--------|------|------|-----------|-----------|
| GET | `/internal/v1/recon/connections` | `page, size, keyword, enabled` | `PageResult<ReconConnection>` | page 1 起、size 默认 20 上限 100（G17）；默认排序 updated_at DESC |
| GET | `/internal/v1/recon/connections/{code}` | path `code` | `ReconConnection` | 2003 |
| POST | `/internal/v1/recon/connections` | body `ConnectionSaveReq` | `ReconConnection` | @Valid；2001 |
| PUT | `/internal/v1/recon/connections/{code}` | path `code` + body `ConnectionSaveReq` | `ReconConnection` | @Valid；2003；body.connCode≠code → 2003 禁改 |
| DELETE | `/internal/v1/recon/connections/{code}` | path `code` | `null` | 2002 被引用拦截；2003 |
| POST | `/internal/v1/recon/connections/{code}/test` | path `code` | `null` | 2004 失败带原因；2003 |

**DatasourceController（F114）**：同构 ConnectionController，`/datasources`，唯一键 dsCode，错误 3001/3002/3003；`POST /datasources/{code}/test` 走 DatasourceService.testConnection（G14 只连通性）。

**ScenarioController（F115）**：`GET/POST/PUT/DELETE /scenarios[/{code}]`；错误 4001/4002；无 test 端点。

**CheckController（F116）**

| Method | Path | 请求 | 响应 data | 校验/说明 |
|--------|------|------|-----------|-----------|
| GET | `/internal/v1/recon/checks` | `scenario_code`(必填), `page, size, keyword, enabled` | `PageResult<ReconCheck>` | 按场景过滤（验收：GET /checks 按 scenario_code 过滤） |
| GET | `/internal/v1/recon/checks/{scenarioCode}/{checkName}` | path 复合键 | `CheckDetailResp` | 5001；含 check + matchRule + compareRule 聚合详情 |
| POST | `/internal/v1/recon/checks` | body `CheckSaveReq` | `ReconCheck` | @Valid；三表事务；5004/6201~6210/5003 |
| PUT | `/internal/v1/recon/checks/{scenarioCode}/{checkName}` | path 复合键 + body `CheckSaveReq` | `ReconCheck` | @Valid；5001/5002 禁改；三表事务 |
| DELETE | `/internal/v1/recon/checks/{scenarioCode}/{checkName}` | path 复合键 | `null` | 5001；级联删 match/compare + uses_json 回写 |

裁决（复合键路径）：check 用 `{scenarioCode}/{checkName}` 复合键定位（与 uk_check、GET/PUT/DELETE 统一），与单键 `{id}` 相比更贴近业务身份且与「check_name 禁改」语义一致（G9）。

**CheckDetailResp（GET /checks/{scenarioCode}/{checkName} 响应）**：check 详情 = check 本体 + matchRule + compareRule 三表聚合，前端编辑表单回填用。

```java
@Data
public class CheckDetailResp {
    private ReconCheck check;
    private ReconMatchRule matchRule;
    private ReconCompareRule compareRule;
}
```

（三表分别 findBy...AndCheckName 组装；实体 password 类脱敏仅连接实体涉及，check 无敏感字段。）

### 7.2 Controller 方法签名示例（CheckController）

```java
@RestController
@RequestMapping("/internal/v1/recon/checks")
@RequiredArgsConstructor
public class CheckController {

    private final CheckService checkService;

    @GetMapping
    public ApiResponse<PageResult<ReconCheck>> page(
            @RequestParam String scenarioCode,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer enabled) {
        return ApiResponse.ok(checkService.page(scenarioCode, normalize(page, size), keyword, enabled));
    }

    @PostMapping
    public ApiResponse<ReconCheck> create(@Valid @RequestBody CheckSaveReq req) {
        return ApiResponse.ok(checkService.saveCheck(req));
    }

    @PutMapping("/{scenarioCode}/{checkName}")
    public ApiResponse<ReconCheck> update(@PathVariable String scenarioCode,
                                          @PathVariable String checkName,
                                          @Valid @RequestBody CheckSaveReq req) {
        return ApiResponse.ok(checkService.updateCheck(scenarioCode, checkName, req));
    }

    @DeleteMapping("/{scenarioCode}/{checkName}")
    public ApiResponse<Void> delete(@PathVariable String scenarioCode, @PathVariable String checkName) {
        checkService.deleteCheck(scenarioCode, checkName);
        return ApiResponse.ok();
    }

    private PageRequest normalize(int page, int size) {
        // G17：page 1 起 → Spring 0-based；size 上限 100
        return PageRequest.of(Math.max(page, 1) - 1, Math.min(Math.max(size, 1), 100), Sort.by(Sort.Direction.DESC, "updatedAt"));
    }
}
```

**分页参数规范（G17，全局一致）**：`page` 从 1 开始（前端惯例），Controller 层统一 `PageRequest.of(page-1, size)` 转换；`size` 默认 20、超 100 截断为 100（防恶意大分页）；列表默认排序 `updated_at DESC`（管理端「更新时间」列默认排序，需求说明书 §1.1），`sort` 参数扩展预留（T03 不做）。4 个 Controller 共用 `normalize` 辅助（可抽 `controller/PageSupport` 或各 Controller 私有，规格不强制）。

---

## 8. 验收标准与验证命令

### 8.1 对照任务分解 T03 三条验收（931~939 行）

| # | 验收项 | 本规格覆盖 | 通过标准 |
|---|--------|-----------|----------|
| 1 | 连接/数据源/场景/check 四类 REST CRUD + 分页列表全部通过（含 check 一次保存 check+match_rule+compare_rule 事务） | §4/§5/§6.5/§7 | `@Transactional` 三表同写（§6.5）；POST /checks 后 recon_check/match_rule/compare_rule 三表各 1 行且 uk 约束通过；四类端点 CRUD+分页返回 code=0 |
| 2 | 保存校验生效：conn_code/ds_code/scenario_code 唯一、check_name 创建后禁改、同 check 内 consume mode 必须一致、金额容差填小数拒绝（V21）、unit=point 禁 primary（V33）、agg_sql 禁窗口参数（V22，预留字段校验） | §6.4 | 每条规则构造反例请求 → 返回对应错误码（2001/3001/4001/5002/6207/6202/6204/6203），且 DB 无脏数据 |
| 3 | 测试连接接口可用（对 mysql_huadi2 真实连通或配置 mock）；删除被引用的连接被拦截并提示引用 ds_code | §6.1/§6.6 | POST /connections/{code}/test 返回 code=0（真实库连通）或 2004 带原因；DELETE 被 datasource 引用的连接 → 2002 且 message 含 ds_code |

### 8.2 本地验证命令（无 PG 环境，先跑）

门禁：**`mvn compile` 必须通过**（JDK17 + Maven 3.9.11，与 T01/T02 门禁一致）；**`mvn test` 不 gate**（部分单测依赖 Mockito/无 DB 环境，作为开发期回归）。

```powershell
cd D:\work\mis-platform\recon
mvn -q clean compile
# 通过标准：BUILD SUCCESS，exit 0
```

**JUnit 单测清单（开发期跑 `mvn -pl recon-service test`，mock Repository 层）**：

| 测试类 | 覆盖用例 |
|--------|----------|
| `ConfigValidationServiceTest` | V20（time 缺 :p_start / 缺 :p_end / pk 缺 :p_last_pk / 完整通过）；V21（tolerance=1.5 拒绝 / =1 通过 / =1.0 通过）；V22（grain=aggregated + agg_sql 含 :p_start 拒绝 / grain=row 跳过）；V33（unit=point+role=primary 拒绝 / role=aux 通过 / unit=yuan 通过）；V34（UNION 含 SELECT * 拒绝 / 列数不等拒绝 / 列名不对齐拒绝 / 对齐通过）；V35（断言位方法可调用，当前恒通过）；consume mode 混合（incremental+time_window）拒绝；唯一性（exists 预检）；check_name 禁改（新旧对比）；time_field 与数据源声明不一致；汇总窗口缺失 / end<=start |
| `CheckServiceTest` | 三表事务（mock 三个 Repository，验证 save 三次调用在同一事务方法内）；级联删除（delete 后 match/compare 均调用 deleteBy...）；uses_json 回写（保存/删除后 ScenarioRepository.save 收到重算的 usesJson） |
| `ConnectionPoolManagerTest` | 连通 mock 库返回通过；错误 url/口令抛 2004；oracle 类型抛 2004（驱动缺失 message） |
| `PageSupportTest`（可选） | page=1→PageRequest.of(0,...)；size>100 截断 |

### 8.3 手动验证序列（有本地 PG：起服务 + curl CRUD）

前置：PG `recon` 库已建（T02 验收过 Flyway migrate，V1/V2 已落）。

```powershell
# 1) 启动（不连 Nacos）
$env:MIS_REMOTE = "false"
mvn -pl recon-service spring-boot:run
# 通过标准：HikariPool-1 Start completed；Flyway up to date；Tomcat started on 8110

# 2) 连接 CRUD + 测试连接
curl.exe -X POST http://localhost:8110/internal/v1/recon/connections -H "Content-Type: application/json" -d '{"conn_code":"mysql_huadi2","name":"华迪2库","type":"mysql","jdbc_url":"jdbc:mysql://10.254.16.6:3306/huadi2","username":"ro_recon","password":"***","enabled":true}'
#    → code=0
curl.exe "http://localhost:8110/internal/v1/recon/connections?page=1&size=20"
#    → code=0, data.list 含 mysql_huadi2
curl.exe -X POST http://localhost:8110/internal/v1/recon/connections/mysql_huadi2/test
#    → 真实库连通 code=0；连不通 code=2004 + 原因
curl.exe -X POST http://localhost:8110/internal/v1/recon/connections -H "Content-Type: application/json" -d '{"conn_code":"mysql_huadi2",...}'
#    → code=2001（唯一）

# 3) 数据源 CRUD（依赖连接存在）
curl.exe -X POST http://localhost:8110/internal/v1/recon/datasources -H "Content-Type: application/json" -d '{"ds_code":"huadi2_order","name":"线上订单表","conn_code":"mysql_huadi2","fetch_type":"db","record_key_expression":"{order_no}_{pay_channel}","time_field":"update_time","grain":"row","enabled":true}'
#    → code=0；重复 ds_code → 3001

# 4) 场景 CRUD
curl.exe -X POST http://localhost:8110/internal/v1/recon/scenarios -H "Content-Type: application/json" -d '{"scenario_code":"online_order","name":"线上订单","cron_expr":"0 */5 * * * ?","report_cron":"0 0 1 * * ?","enabled":true}'

# 5) check 三表事务保存 + 校验反例
curl.exe -X POST http://localhost:8110/internal/v1/recon/checks -H "Content-Type: application/json" -d '{
  "scenario_code":"online_order","check_name":"online_order_wechat_t2","seq_no":1,
  "consume_json":"{\"orders\":{\"ds_code\":\"huadi2_order\",\"mode\":\"incremental\"},\"wechat_pay\":{\"ds_code\":\"huadi2_wechat_pay\",\"mode\":\"incremental\"}}",
  "match_rule":{"strategy":"exact_key","datasets_json":"[\"orders\",\"wechat_pay\"]","key_fields_json":"{\"orders\":\"{order_no}\",\"wechat_pay\":\"{order_no}\"}"},
  "compare_rule":{"rules_json":"[{\"name\":\"微信支付金额\",\"left_field\":\"orders.wx_pay_amount\",\"right_field\":\"wechat_pay.amount\",\"compare_mode\":\"equal\",\"tolerance\":1,\"is_amount\":true}]"}
}'
#    → code=0；SQL 验证 recon_check/match_rule/compare_rule 各 1 行
curl.exe -X PUT http://localhost:8110/internal/v1/recon/checks/online_order/online_order_wechat_t2 -H "Content-Type: application/json" -d '{...check_name 改成别的...}'
#    → code=5002（禁改）
#    V21 反例：tolerance 填 1.5 → code=6202
#    V33 反例：datasource 的 amount_fields_json 配 unit=point role=primary → code=6204
#    V22 反例：datasource grain=aggregated + agg_sql 含 :p_start → code=6203
#    V20 反例：datasource fetch_config_json fetch_mode=time 且 sql 缺 :p_start → code=6201
#    consume mode 混合 → code=6207

# 6) 删除被引用连接被拦截
curl.exe -X DELETE http://localhost:8110/internal/v1/recon/connections/mysql_huadi2
#    → code=2002，message 含 ds_code=huadi2_order
```

---

## 9. 风险与待确认

| # | 风险/待确认 | 当前处理 | 责任方 |
|---|-------------|----------|--------|
| 1 | **ojdbc11 源库驱动未引入对测试连接 oracle 类型的影响** | T03 测试连接对 type=oracle 抛 2004（「ojdbc11 未引入，Oracle 测试连接暂不可用，T04 引入后可用」），mysql/postgresql 正常（驱动已含）；pom 不改（T01 锁定），T04 引入 ojdbc11 时同步放开 | 知悉/后端 |
| 2 | **uses_json 回写的 T03 边界** | T03 落地最小回写（CheckService 保存/删除后重算 ds+alias，use_fields 置空数组）；use_fields 由比较字段并集精确生成留 T09（管理端联动时）。consume_json 行内新增可选 ds_code（G13）为落库扩展，T04 引擎忽略 | 后端/T09 |
| 3 | **consume_json time_field 回退** | T03 校验位置：行内显式配置时校验与数据源声明一致（6209）；行内省略时跳过（T04 运行期回退取数据源声明，任务分解 938/949 行）。alias→ds_code 解析不到时该校验跳过 | 后端/T04 |
| 4 | **BFF 透传与权限码** | T03 不涉及：BFF `/api/v1/recon/**` 透传、`recon:*` 权限码登记、mis-iam 菜单均属 T09 管理端任务（技术适配 §3.2/§3.3）；T03 只暴露 `/internal/v1/**` 内部端点 | T09 |
| 5 | **@JdbcTypeCode(SqlTypes.JSON) 在 Hibernate 6.4.4 + PG 42.7.3 实测** | 规格锁定 SqlTypes.JSON（G4）；若实测绑定异常，统一替换为 `@JdbcTypeCode(SqlTypes.JSONB)`（Hibernate 6.2+ PG 专用类型码），一处全局替换。后端落地时先以 1 张表（如 recon_connection.props_json）做读写冒烟 | 后端实测 |
| 6 | **updated_at 无触发器** | DDL `DEFAULT now()` 只覆盖 INSERT；本规格以 `@PreUpdate` 应用层维护（G5）。若坚持 DB 层维护需新增 Flyway V4 触发器（本规格不采用，理由见 G5） | 知悉 |
| 7 | **DB uk 冲突兜底** | Service 层 existsByXxx 预检为主；并发下 uk 冲突抛 DataIntegrityViolationException → 全局 1999。可接受（配置操作低频，冲突概率极低）；如要更友好可 GlobalExceptionHandler 加 DataIntegrityViolationException 分支转 2001/3001/4001（可选增强） | 可选 |
| 8 | **T01 JpaConfig @EntityScan 修订** | T01 的 `@EntityScan("com.mis.recon.entity")` → `@EntityScan("com.mis.recon.domain")`（G19），T03 落地时同步修改；@EnableJpaRepositories("com.mis.recon.repository") 不变 | 后端 |
| 9 | **V34 文本级 UNION 切分边界** | 顶层 UNION 正则切分，括号内/字符串内 UNION 可能误判；MVP 取数 SQL 为受控模板（`{time_start}` 占位），文本级覆盖验收场景。复杂 SQL 解析（JSqlParser 引入）留 T04 试拉样例时评估 | T04 |
| 10 | **ReadinessGate/ReporterConfig 无 CRUD** | T03 只建实体+Repository（§3/§5），无 Service/Controller——F63/F64 的 CRUD 端点随 T07（报告/就绪门）落地；T03 验收不含这两类 | T07 |
| 11 | **删除 check 时 reporter_config 不级联** | 只级联 match/compare（§6.5）；reporter_config 指名 check 的行留 T07 统一处理（check_name='*' 场景级行绝不能随单 check 删除） | T07 |
| 12 | **consume_json ds_code 字段兼容** | G13 为 T03 落库格式扩展；T04 引擎解析 JSON 忽略未知字段；T08 种子脚本（V3__seed_config.sql）若按旧结构落库（无 ds_code），T03 校验 alias→ds_code 解析不到时跳过（见风险 3）——**需 T08 脚本同步加 ds_code** | T08 联动 |

---

## 10. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-14 | 初版：T03 配置模型 CRUD 规格锁定（common 包 + 枚举 + 8 实体 + DTO + Repository + 服务校验 + Controller + 验收命令） | T03 规格锁定，供后端工程师落地代码 | 全文档 |
| 2026-08-14 | 修订 §6.6：`getConnection(url, props, timeout)` 三参重载在 JDK 8+ 已移除，改驱动属性级连接超时（mysql connectTimeout / pg connectTimeout / oracle CONNECT_TIMEOUT）+ 双参 getConnection | 后端实测规格代码示例无法编译；保持 G15「不污染 DriverManager 全局状态」意图 | §6.6 |
| 2026-08-14 | 主理人裁决（4 项，全部采纳）：① uses_json 回写 T03 落地最小实现（ds+alias，use_fields 空数组，精确并集留 T09）；② consume_json 行内可选 ds_code（G13，T08 种子脚本联动补 ds_code）；③ V35 只留断言位（T03 无源库元数据，T04 接入 information_schema）；④ 全局 snake_case（G3，T09 前端联调同步） | 规格 advisory 裁决 | §6.3/§4.5/§6.4/§0 |
| 2026-08-14 | 主理人门禁重构：ConfigValidationService 329 行超 300 行门禁，拆出 `JsonSupport`（JSON 解析辅助）+ `AliasValidator`（5003 alias 唯一性）两子功能，降为 264 行；对应单测构造参数同步修正，33 例复跑全过 | 门禁「单文件 ≤ 300 行」强制 | §6.4 相关类 |
