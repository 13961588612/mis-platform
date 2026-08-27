# T06 两轮确认 + 健康闸门完整版 + 欠账补算 + 僵尸巡检 — 架构规格锁定

> 状态：规格锁定 ｜ 作者：架构师 高见远 ｜ 日期：2026-08-14
> 依据：《对账平台V3-开发任务分解》T06（P0，依赖 T05）+ T05-spec 范围外清单 + 方案 §18.2/§4.2

---

## 0. 全局裁决摘要（先读）

| # | 裁决项 | 结论 |
|---|--------|------|
| G13 | TwoRoundConfirm 触发方式 | **Quartz 固定 cron 巡检**（新增 ConfirmJob，应用配置 `recon.confirm-cron` 默认 `0 */10 * * * ?` 每 10 分钟；SchedulerManager 启动注册）。不做 DB cron 表（T05 未建巡检调度配置列，固定巡检频率即可满足两轮确认语义） |
| G14 | 巡检只处理哪些行 | `status='pending' AND pending_peer_ds_code IS NOT NULL`；field_mismatch/anomaly 首判即 confirmed 不走巡检；matched 出池 resolved 不在池 |
| G15 | 条件① 空拉取也算 | T04 空拉取也写 `pull_run(status=success, health=empty)` → 对端 `MAX(success id)` 前进 → 水位越过判定成立（验收 1 原文） |
| G16 | 条件② 超时来源 | 场景表 `pending_max_wait_hours`（V1 默认 24h），巡检读场景快照实时取；`now - pending_at > hours` 判定 |
| G17 | 升级写什么 | `status='confirmed'` + 诊断 `verdict_phase.upgrade_condition='peer_advanced'/'timeout'`；用 `UPDATE ... WHERE status='pending'` 乐观升级（防巡检与对账并发重复升级） |
| G18 | ReadinessGateEvaluator 范围 | **flag_query + row_count_delta + stability_window 可配置求值**；app_callback 类型：读取配置存在即记 `readiness_log` 降级（真回调留 T09）；`min_wait_min/max_wait_min` 超时降级（软前置）语义实现 |
| G19 | 就绪门接入点 | PullRunner.run() 开头（手动/Job 统一入口）：求值未通过且未超时 → **本轮不拉取**（不写 pull_run，记日志）；超时降级 → 继续拉取 + `readiness_degraded=1`；通过 → `readiness_passed=1` 正常拉取 |
| G20 | backlog 补算 | ReconRunner runCheck 事务内：先扫 `recon_backlog_window WHERE scenario_code=? AND check_name=? AND resolved_at IS NULL` → 未 resolved 的 backlog 窗口**覆盖**该 check time_window ds 的窗口（合并区间，窗口取 min(start)/max(end)）→ 补算成功后 `resolved_at=now()`；incremental ds 不参与 backlog |
| G21 | ZombieWatch 阈值 | pull_run/recon_run `status='running' AND started_at < now()-30min` → 置 failed + `err_msg='zombie timeout (>30min)'`；告警通道留 T07（OpsAlertService），T06 仅日志 |
| G22 | 巡检与对账并发 | 升级语句带 `WHERE status='pending'` 乐观条件；巡检扫描量大时按场景分批（每批 200 行） |
| G23 | matched_index 防单边重拉误报 | T05 已落地（restoreFromIndex 按增量 hash 回查对端值）；**T06 补验证单测**（fetch_one 抬高 update_seq → 下次增量拉取 → 索引回查 → 匹配一致不落 unmatched）+ 实库手动序列 |

**范围外（T07）**：报告（ReportRunner/渠道）、运维告警（OpsAlertService/alert_log）、报告调度（ReportJob）。

---

## 1. 目标与验收

**目标**：补齐 T05 范围外的两轮确认独立巡检、健康闸门完整版（就绪门）、欠账补算、僵尸巡检，使 pending 差异能脱离对账引擎独立收敛，time_window check 被闸门跳过后有兜底补算。

**验收标准**（任务分解 T06，3 条）：

1. **pending 差异双条件升 confirmed**：
   - ① 对端 ds 新增成功 pull_run（id 越过 `pending_peer_pull_run_id`，**空拉取也算**）；
   - ② `pending_at` 超 `pending_max_wait_hours`；
   - diff_type 流转时重置三个 pending 字段（T05 已落地，巡检不涉及流转）；
   - 巡检触发后差异 `status=pending → confirmed`，`diff_diagnosis_json.verdict_phase.upgrade_condition` 标记 `peer_advanced` / `timeout`。

2. **健康闸门**：`on_*=block` 且最近拉取对应 health → 本轮 skip、游标不推进、写 `recon_run(status=skipped)`（T05 已落地）；**time_window 被 skip 时写 `recon_backlog_window`，下轮先补算**（本任务新增补算消费）。

3. **matched_index 回查防单边重拉误报**：fetch_one 重拉已配平行不产生 unmatched 误报（T05 已落地，本任务补验证）。

---

## 2. 依赖与包结构

新增文件（`recon-service/src/main/java/com/mis/recon/`）：

| 编号 | 相对路径 | 职责 |
|------|----------|------|
| F96 | `service/engine/TwoRoundConfirmService.java` | ★ 两轮确认巡检：扫 pending → 双条件 → 乐观升级 |
| F89 | `service/engine/ReadinessGateEvaluator.java` | 就绪门求值（flag_query/row_count_delta/stability_window + 超时降级） |
| F107 | `service/engine/ZombieWatchService.java` | 僵尸运行巡检（running 超 30min → failed） |
| — | `job/ConfirmJob.java` | Quartz Job：调度 TwoRoundConfirmService + ZombieWatchService |
| — | `dao/BacklogWindowDao.java` | 欠账窗口：scanUnresolved / markResolved（T05 只写了 insertBacklog，补查/标记） |
| — | `dao/ReadinessGateDao.java` | 就绪门配置读取（enabled=1 按场景） |
| — | `domain/runtime/BacklogWindow.java` | 欠账窗口 POJO（id/scenarioCode/checkName/windowStart/windowEnd/resolvedAt） |
| — | `domain/runtime/GateConfig.java` | 就绪门 POJO（gateName/gateType/gateSql/configJson/minWaitMin/maxWaitMin） |

修改文件：

| 文件 | 修改内容 |
|------|----------|
| `dao/DetailDao.java` | + scanPending()（pending 巡检行）+ confirmPending(id, upgradeCond)（乐观升级） |
| `dao/PullRunDao.java` | + scanRunningOlderThan(minutes)（僵尸扫描） |
| `dao/ReconRunDao.java` | + scanRunningOlderThan(minutes)（僵尸扫描） |
| `service/pull/PullRunner.java` | + ReadinessGateEvaluator 接入（run 入口求值） |
| `service/pull/ReconRunner.java` | + backlog 补算消费（runCheck 内先补算再正常窗口） |
| `service/pull/SchedulerManager.java` | + init() 注册 ConfirmJob（固定 cron） |
| `common/ErrorCode.java` | 无新增（巡检失败记日志，不抛业务异常） |
| `pom.xml` | 无新增依赖 |

**依赖方向**（门禁）：F96/F89/F107 只依赖 dao + domain/runtime + config 快照；**禁止注入 JPA Repository**（巡检走 JdbcTemplate 热路径）。

---

## 3. TwoRoundConfirmService（F96，★）

### 3.1 触发与并发

- `scan()` 由 ConfirmJob 定时调用；应用配置 `recon.confirm-cron`（默认每 10 分钟）。
- 全场景扫描：`DetailDao.scanPending()` 一次取回所有 pending 行（`status='pending' AND pending_peer_ds_code IS NOT NULL`）。
- 按 `scenarioCode` 分组；每组先读场景快照 `pendingMaxWaitHours`（ConfigSnapshot.load 或 JPA 场景仓库直读，取 `pending_max_wait_hours` 列），再逐行判定。

### 3.2 双条件判定

```
for row in scanPending():
    if row.pendingPeerPullRunId != null:
        peerMaxId = pullRunDao.findMaxSuccessId(row.pendingPeerDsCode)   // 对端最新成功 id（空拉取也算）
        if peerMaxId > row.pendingPeerPullRunId:
            confirm(row.id, "peer_advanced"); continue
    if row.pendingAt != null and now - row.pendingAt > pendingMaxWaitHours(scenario):
        confirm(row.id, "timeout")
```

- 条件① 对端无成功拉取记录（`findMaxSuccessId` 返回 0）→ 不升级（`peerMaxId > pendingPeerPullRunId` 不成立；`pendingPeerPullRunId` 首次写入为 null 时条件① 跳过）。
- 条件② 兜底保证 pending 最终收敛（无论对端是否再拉）。

### 3.3 乐观升级

```sql
UPDATE recon_detail
   SET status = 'confirmed',
       diff_diagnosis_json = jsonb_set(diff_diagnosis_json, '{verdict_phase,upgrade_condition}', '"' || ? || '"')
 WHERE id = ? AND status = 'pending'
```

- 影响行数 = 0 → 已被并发流转（对账引擎判定过），忽略。
- 不重置 pending 三字段（diff_type 未流转，保留证据供追溯）。
- 诊断 JSON 若为 NULL → 先 `'{}'::jsonb` 再 set（`COALESCE`）。

### 3.4 统计

- `scan()` 返回 `ConfirmStats{scanned, upgradedPeer, upgradedTimeout}`，ConfirmJob 记日志。

---

## 4. ReadinessGateEvaluator（F89）

### 4.1 配置读取

`ReadinessGateDao.findEnabled(scenarioCode)`：`SELECT ... FROM recon_readiness_gate WHERE scenario_code = ? AND enabled = 1`。按 `gate_name` 升序。

### 4.2 求值语义（G18）

| gate_type | 求值逻辑 | 通过条件 |
|-----------|----------|----------|
| `flag_query` | 执行 `gate_sql`（只读 SELECT），取第一行第一列 | 值 = 1 |
| `row_count_delta` | 执行 `gate_sql` 取行数，与 `gate_config_json.max_delta` 比较（缺省 0） | `|count - expected| <= max_delta`（expected 取 configJson.expected，缺省 0） |
| `stability_window` | 执行 `gate_sql` 取行数，连续 `stability_window_min` 分钟两次求值相等（巡检间缓存上次值） | 两次相等（内存 Map<gateName, (count, ts)>） |
| `app_callback` | 读取配置存在即视为**未实现** | 记 `readiness_log.degraded_reason='app_callback not supported'`，按超时降级处理 |

- `gate_sql` 执行走 `reconJdbcTemplate`（平台库只读）；SQL 为空 → 直接记降级。
- `min_wait_min`：就绪后需稳定等待；`max_wait_min`：等待超时 → **降级 proceed**（软前置，记 readiness_log）。

### 4.3 接入 PullRunner（G19）

`run()`/`run(startOverride,endOverride)` 开头（running map 互斥之后、窗口计算之前）：

```
gateResult = gateEvaluator.evaluate(scenarioCode)
if gateResult == PASS:        readinessPassed=1，继续拉取
if gateResult == DEGRADED:    超时降级，readiness_degraded=1，继续拉取（日志）
if gateResult == NOT_READY:   min_wait 未到 且 未超 max_wait → 本轮不拉取（return，不写 pull_run）
```

- **注意**：PullRunner 当前按 dsCode 拉取，就绪门按 scenario 关联（`readiness_gate.scenario_code`）。**裁决**：就绪门求值键 = 数据源所属场景；PullRunner 通过 ds 的 `scenario_code` 引用反查（datasource 表有 `scenario_code` 列？——**若无，取该 ds 被引用的任意场景，见 §7 风险**）。`readiness_passed/readiness_degraded/readiness_log` 三字段在 finishSuccess 写入（pull_run 已有列）。

### 4.4 错误处理

- gate_sql 执行异常 → 记 `readiness_log.error`，按 **NOT_READY** 处理（保守不拉取）但**不抛异常中断**（记日志继续判定下一 gate）。

---

## 5. backlog 补算（F95 集成改造，G20）

### 5.1 补算触发时机

`ReconRunner.runCheck()` 事务内、合流之前：

```
backlogs = backlogWindowDao.scanUnresolved(scenarioCode, checkName)
if not empty:
    for ds in check.consumes where mode='time_window':
        window = merge(backlogs, ds)   // min(backlog.window_start) ~ max(backlog.window_end)
        rows = ledgerDao.queryByTime(ds.dsCode, window.start, window.end)
        merge(dataset, toRows(rows, "incr"))
    for backlog in backlogs:
        backlogWindowDao.markResolved(backlog.id)
```

- 补算窗口与配置窗口**合并**（取并集区间），保证被 skip 的欠账窗口数据不丢。
- backlog 无 time_window ds 的 check：仅标记 resolved（防御性，正常不出现）。
- 补算行来源标记 `incr`（与正常增量一致，走同一合流/匹配链路）。

### 5.2 BacklogWindowDao

```java
public List<BacklogWindow> scanUnresolved(String scenarioCode, String checkName)
// SELECT id, scenario_code, check_name, window_start, window_end, resolved_at
//   FROM recon_backlog_window
//  WHERE scenario_code=? AND check_name=? AND resolved_at IS NULL
public void markResolved(long id)   // UPDATE ... SET resolved_at=now() WHERE id=? AND resolved_at IS NULL
```

---

## 6. ZombieWatchService（F107）

```java
public ZombieStats scan() {
    pullRuns = pullRunDao.scanRunningOlderThan(30);    // running AND started_at < now()-30min
    for r : pullRuns -> pullRunDao.finishFailed(r.id, "zombie timeout (>30min)", null);
    reconRuns = reconRunDao.scanRunningOlderThan(30);
    for r : reconRuns -> reconRunDao.finishRun(r.id, "failed", 0,0,0, Map.of(), "zombie timeout (>30min)");
    return stats;
}
```

- DAO 查询：`SELECT id FROM ... WHERE status='running' AND started_at < now() - ? * interval '1 minute'`。
- 告警通道留 T07（OpsAlertService）；T06 仅 `log.warn`。
- ConfirmJob 内 `zombieWatch.scan()` 在 `twoRoundConfirm.scan()` 之后执行。

---

## 7. DAO 契约

### 7.1 DetailDao 扩展

```java
/** pending 巡检行（两轮确认独立巡检用）；无 → 空列表 */
public List<PendingRow> scanPending()
// SELECT id, scenario_code, check_name, pending_peer_ds_code, pending_peer_pull_run_id, pending_at
//   FROM recon_detail
//  WHERE status='pending' AND pending_peer_ds_code IS NOT NULL
//  ORDER BY id

public static class PendingRow {
    public final long id; public final String scenarioCode; public final String checkName;
    public final String pendingPeerDsCode; public final Long pendingPeerPullRunId;
    public final LocalDateTime pendingAt;
}

/** 乐观升级 pending→confirmed（诊断补 upgrade_condition）；返回影响行数 */
public int confirmPending(long id, String upgradeCondition)
```

### 7.2 PullRunDao 扩展

```java
public List<Long> scanRunningOlderThan(int minutes)
// SELECT id FROM recon_pull_run WHERE status='running'
//   AND started_at < now() - ? * interval '1 minute'
```

### 7.3 ReconRunDao 扩展

```java
public List<Long> scanRunningOlderThan(int minutes)
// SELECT id FROM recon_run WHERE status='running'
//   AND started_at < now() - ? * interval '1 minute'
```

### 7.4 ReadinessGateDao（新建）

```java
public List<GateConfig> findEnabled(String scenarioCode)
// SELECT gate_name, gate_type, gate_sql, gate_config_json, min_wait_min, max_wait_min
//   FROM recon_readiness_gate
//  WHERE scenario_code=? AND enabled=1 ORDER BY gate_name
```

---

## 8. 调度（ConfirmJob + SchedulerManager）

- 新增 `job/ConfirmJob.java`：Quartz Job，`execute()` 内依次 `twoRoundConfirmService.scan()` → `zombieWatchService.scan()`。
- `SchedulerManager.init()` 注册固定 ConfirmJob：
  ```
  JobKey("confirm-inspect") + TriggerKey("confirm-inspect-trg")
  cron = application config recon.confirm-cron 默认 "0 */10 * * * ?"
  ```
- 不依赖 DB（无 recon_confirm_schedule 表），启动即注册，`@DisallowConcurrentExecution` 防重入。

---

## 9. 验收标准与验证命令

**自动**：
1. `mvn clean compile` BUILD SUCCESS
2. 新增单测全绿：TwoRoundConfirmServiceTest（peer_advanced/timeout 双分支 + 乐观升级）+ ReadinessGateEvaluatorTest（flag_query/row_count_delta/stability_window/降级）+ ZombieWatchServiceTest（30min 判定）+ MatchEngineTest 补 matched_index 语义验证；全量回归无新增失败
3. 门禁：emoji/紫粉扫描、单文件 ≤300 行、依赖只向下（巡检类零 JPA Repository 注入）

**实库手动序列**（用户环境，recon 库已迁移）：
1. 造 pending 差异（跑一轮 T05 序列产生 unmatched → pending）
2. 对端 ds 手动拉取一次（含空拉取）→ 触发 ConfirmJob（或手动调 scan）→ 复核 `status=confirmed` + `verdict_phase.upgrade_condition=peer_advanced`
3. 不拉对端、等超时（或临时改小 pending_max_wait_hours）→ 复核 timeout 分支
4. time_window check + on_*=block：健康闸门 skip → 查 recon_backlog_window 有记录 → 下轮补算后 resolved_at 非空
5. fetch_one 重拉已配平行 → 重跑对账 → 无 unmatched 误报

---

## 10. 风险与待确认

| # | 风险/待确认 | 处理 |
|---|-------------|------|
| 1 | 就绪门按场景关联，PullRunner 按 dsCode 拉取，**ds→场景映射来源待确认**（datasource 表可能无 scenario_code 列） | 实现期确认 V1 DDL datasource 列；若无映射，就绪门求值改为「该 ds 被引用的任一 enabled 场景 gate 全过」（readiness_gate 表按场景存，ds 引用关系从 check.datasets_json/consume_json 反查）；最坏情况 T06 就绪门按「全局 enabled gate」求值（不区分场景），登记为降级项 |
| 2 | 巡检扫描 pending 全表（量大时） | scanPending 分批（LIMIT 500 循环）+ 升级乐观条件防并发；规模优化留 T09 |
| 3 | stability_window 两次求值缓存 | 内存 Map 缓存（gateName→(count,ts)），应用重启失效可接受（MVP） |
| 4 | ConfirmJob 与 ReconJob 并发跑同一 pending | 乐观 UPDATE WHERE status='pending' 保证幂等，双写同值 |
| 5 | 时间窗口 backlog 与正常窗口重叠 | 合并区间补算（union），updater 按身份 upsert 幂等，重复窗口不产生重复差异 |

---

## 11. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-14 | 初版：T06 规格锁定（G13~G23 + 巡检/就绪门/补算/僵尸四组件 + DAO 契约 + 验收） | T06 规格锁定，供后端工程师落地 | 全文档 |
| 2026-08-14 | 交付完成：F96 TwoRoundConfirmService + F89 ReadinessGateEvaluator + F107 ZombieWatchService + ConfirmJob + BacklogWindowDao/ReadinessGateDao + BacklogWindow/GateConfig POJO；DetailDao/PullRunDao/ReconRunDao/PullRunner/ReconRunner/SchedulerManager 扩展；单测 19 例（TwoRoundConfirm 7 / ReadinessGate 10 / ZombieWatch 2）全绿；全量 122 测试 BUILD SUCCESS；实现细化：就绪门 ds→场景反查降级（datasource 无 scenario_code 列）、evaluate 传播 DEGRADED、PullRunner 先 loadCtx 后求值（保业务异常语义）；`mvn clean compile` + 全部门禁通过 | T06 后端实现交付 | §2 文件清单 + §4/§5/§6/§8 落地 |
