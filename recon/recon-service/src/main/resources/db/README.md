# recon 平台库说明（database recon / schema public）

> 本目录为 recon-service 平台库（独立 database `recon`）的 Flyway 迁移集与库说明。
> 规格依据：《T02-spec.md》§8（F124 大纲）、《T01-spec.md》§6.1/§8-2。

## 1. 库与账号

| 项 | 值 | 说明 |
|----|----|------|
| database | `recon` | 独立数据库，与 MIS 主库隔离（ADR-001 精神） |
| schema | `public` | Flyway `default-schema=public`；连接 search_path 默认 public |
| 账号 | `recon` | 占位口令 `recon123`（仅 local）；生产口令由 DBA 下发 |
| PG 15+ 权限 | `GRANT ALL ON SCHEMA public TO recon` | PG 15 起普通用户默认无 public schema 的 CREATE 权限，缺省则 Flyway 建表报 `permission denied for schema public` |

## 2. 连接与初始化（建库语句，引自 T01-spec §6.1）

```sql
CREATE DATABASE recon;
CREATE USER recon WITH PASSWORD 'recon123';
ALTER DATABASE recon OWNER TO recon;
-- PG 15+ 的 public schema 默认不再对普通用户授权，Flyway 建表会失败，必须显式授权（见 §8-2）
GRANT ALL ON SCHEMA public TO recon;
```

连接串（application.yml 占位）：`jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:recon}`

## 3. Flyway 迁移集

| 版本 | 文件 | 内容 |
|------|------|------|
| V1 | `db/migration/V1__init.sql` | 20 张业务表 + `recon_update_seq` 序列（PG 方言，含全部 UNIQUE/普通索引/CHECK） |
| V2 | `db/migration/V2__quartz_pg.sql` | QRTZ_* 11 张调度表（Quartz 官方 `tables_postgres.sql` 原样纳入，quartz-2.3.2） |
| V3 | `db/migration/V3__seed_config.sql` | 种子配置（T08 预留，本阶段不创建） |

- 配置：`spring.flyway.locations=classpath:db/migration`、`spring.flyway.default-schema=public`
- `spring.jpa.hibernate.ddl-auto=none`：JPA 不做任何 DDL，改表一律走 Flyway
- Quartz：`spring.quartz.job-store-type=jdbc`、`spring.quartz.jdbc.initialize-schema=never`（QRTZ 表由 V2 管，绝不自动初始化）

## 4. 表清单速览（20 表分组）

### 配置 8

| 表 | 用途 |
|----|------|
| recon_connection | 连接（被对账的业务库） |
| recon_datasource | 数据源（定义一次，到处引用） |
| recon_scenario | 场景 |
| recon_check | 检查（一个场景多个 check） |
| recon_match_rule | 匹配规则（匹配键唯一定义处） |
| recon_compare_rule | 比较规则 |
| recon_readiness_gate | 数据就绪门 |
| recon_reporter_config | 报告渠道（check 级路由） |

### 台账引擎 7

| 表 | 用途 |
|----|------|
| recon_source_record | 源数据台账（V3 核心，(ds_code,record_key) 唯一，拉取 upsert） |
| recon_seq_watermark | 已提交安全水位（发号顺序≠提交顺序的正确性保证） |
| recon_consume_cursor | 消费游标（场景+检查+数据源 → 高水位，per-check 粒度） |
| recon_detail | 差异明细（差异身份唯一，状态就地流转） |
| recon_detail_source_ref | 差异↔台账行锚（池还原与反查依据） |
| recon_matched_index | 已配平索引（防单边重拉误报） |
| recon_backlog_window | 欠账窗口（time_window 检查被 skip 时兜底补算） |

### 运行记录 5

| 表 | 用途 |
|----|------|
| recon_pull_run | 拉取运行记录 |
| recon_run | 对账运行记录 |
| recon_diff_handle | 人工处理记录（独立表，重对不丢人工标记） |
| recon_report_run | 报告运行记录（报告线独立调度） |
| recon_alert_log | 告警发送留痕（去重/限流/复盘依据） |

### 序列

| 序列 | 用途 |
|------|------|
| recon_update_seq | 台账 update_seq 与全库单调发号共用；发号 `SELECT nextval('recon_update_seq')` |

### QRTZ_* 11 张调度表（V2__quartz_pg.sql，Quartz 官方脚本）

QRTZ_JOB_DETAILS / QRTZ_TRIGGERS / QRTZ_SIMPLE_TRIGGERS / QRTZ_CRON_TRIGGERS / QRTZ_SIMPROP_TRIGGERS / QRTZ_BLOB_TRIGGERS / QRTZ_CALENDARS / QRTZ_PAUSED_TRIGGER_GRPS / QRTZ_FIRED_TRIGGERS / QRTZ_SCHEDULER_STATE / QRTZ_LOCKS

> 口径说明：任务分解/技术适配曾表述 "QRTZ 12 表"，经核对 quartz-2.3.2 官方 `tables_postgres.sql` 实际创建 **11 张**（Quartz 2.x JDBCJobStore 即 11 张表），以官方脚本为准（T02-spec §6.1）。

## 5. 金额三态律说明

| 态 | 列/存储 | 说明 |
|----|---------|------|
| 原始态 | `recon_source_record.amount_raw VARCHAR(64)` | 源库原始金额字符串，只读展示；`record_data` JSONB 内金额字符串可回溯 |
| 计算态 | `*_cent` 结尾列一律 `BIGINT` 整数分 | `recon_source_record.amount_cent`、`recon_detail.diff_amount_cent`（P-2） |
| 展示态 | 计算态 ÷100 | 转元展示 |

白名单列（命名含 amount 但非金额数值）：`amount_raw`（原始态字符串）、`amount_direction`（方向枚举 in/out/none，非金额值）。

### 主 SQL（违规扫描，验收用，期望 0 行）

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
        (column_name LIKE '%\_cent' AND data_type <> 'bigint')
     OR (column_name LIKE '%amount%'
         AND column_name NOT LIKE '%\_cent'
         AND column_name NOT IN ('amount_raw', 'amount_direction'))
  )
ORDER BY table_name, column_name;
-- 期望输出：0 行（无违规）
```

### 辅助 SQL（全量金额列盘点，人工核对用，期望恰好 4 行）

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (column_name LIKE '%amount%' OR column_name LIKE '%\_cent')
ORDER BY table_name, column_name;
-- 期望输出恰好 4 行：
--   recon_detail.diff_amount_cent   bigint                （计算态金额，合法）
--   recon_source_record.amount_cent bigint                （计算态金额，合法）
--   recon_source_record.amount_raw  character varying     （原始态白名单，合法）
--   recon_source_record.amount_direction character varying（方向枚举白名单，非金额值，合法）
```

### 序列发号验证

```sql
SELECT nextval('recon_update_seq');
-- 期望：1（首次）或递增正整数；连续调用严格 +1（CACHE 100 为会话预取，退出会话允许空洞，正常）
```

## 6. 维护约定

- **禁止手工 DDL**：建表/加列/加索引/改约束一律走 Flyway 迁移，禁止直接对 recon 库执行 DDL。
- **新增迁移**：`V{n}__desc.sql`（V 递增、`__` 双下划线、描述式命名，如 `V3__seed_config.sql`），迁移文件纳入版本控制。
- **迁移不可改**：迁移一旦发布（进入 `flyway_schema_history`）不得修改——Flyway checksum 校验，改动已发布脚本会导致 `validate` 失败。
