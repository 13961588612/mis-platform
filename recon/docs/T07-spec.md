# T07 报告与预警 — 架构规格锁定

> 状态：**已锁定**（裁决项回写 §0）｜ 作者：架构师 高见远 ｜ 日期：2026-08-18
> 依据：《对账平台V3-开发任务分解》T07（968~973 行）+ §7.3 报告时序 + §14.4 预警模型 + 技术适配 §2.4（JdbcTemplate 热路径）；T05-spec 范围外清单；T06-spec 范围外清单（OpsAlertService）
> 前置：T01~T06 已交付（V1 表已含 recon_report_run / recon_alert_log / recon_diff_handle / reporter_config / readiness_gate）

---

## 0. 全局裁决摘要（先读）

| # | 裁决点 | 结论 |
|---|--------|------|
| G24 | 报告触发方式 | **场景级 report_cron 动态 Quartz 注册（ReportJob）+ OpsController 手动触发 + 重发**；report_cron 为空则仅手动；misfire=skip |
| G25 | 报告扫描口径 | `scenario_code=? AND status='confirmed' AND reported_at IS NULL AND handle_status='unhandled'`（§7.3 时序 + 任务分解 T07 验收 1 原文）；`min_severity` 过滤在渲染时按 diff 最高 severity 跳过低于阈值的 check |
| G26 | reported_at 防重 | 投递成功后批量回填 `reported_at`（`UPDATE ... WHERE id IN (…) AND reported_at IS NULL`，幂等）；**指纹去重**：fingerprint = SHA-256(`{scenario}|{check}|{sortedDetailIds}|{severity}`)，写 alert_log 前查重，已存在 → 跳过发送（不重复投递） |
| G27 | 报告内容 | 按场景/check 聚合：中文标题 + check 名 + 差异明细（match_key_display + diff_desc + diff_amount_cent 转元）+ 金额合计；无差异且 report_type=diff → 不发送（空报告不投递）；balance 类型 MVP 不实现（T08 种子均 diff） |
| G28 | 渠道 | email / webhook 两渠道；**ReporterConfig 按 (scenario, check_name 支持 '*') 路由**；无配置 → 走应用级默认渠道（`mis.recon.notify.*`，未配置时日志降级 mock）；dev 期发送失败不中断主流程（记 alert_log send_status=failed + 日志） |
| G29 | 告警接入点 | OpsAlertService 供僵尸巡检（T06 ZombieWatchService 改造）调用：`alertOps(severity, title, content)` → 写 alert_log（channel='ops'）+ 应用配置通道发送；**不在 PullRunner/ReconRunner 热路径内嵌告警**（异常已由 run 收尾失败，巡检兜底收敛） |
| G30 | 人工处理端点 | `POST /internal/v1/recon/diffs/{id}/handle`：body `{handle_status, operator, remark}` → 校验 handle_status ∈ handled/ignored/false_positive；写 recon_diff_handle（独立表，重对不丢人工标记）+ 更新 recon_detail.handle_status（引擎不覆盖）；已 handled 的差异从报告扫描排除（unhandled 过滤） |
| G31 | ReadinessGate CRUD | T03 实体+Repository 已有 → T07 补 Service+Controller（场景级 CRUD + 分页列表）；引擎求值逻辑不变（T06 已接 PullRunner） |
| G32 | ReporterConfig CRUD | T03 实体+Repository 已有 → T07 补 Service+Controller（按 scenario 列表 / 新建 / 更新 / 删除） |

**范围外**：balance 零差异报告（任务分解 §11.1.1 预留不实现）、observe 静音（T08 种子 run_mode 语义）、CleanupRunner 数据清理（任务分解 F106，独立任务）、前端 reports/monitor 页（T09 已定占位，T07 后端 API 就绪后前端另接）。

---

## 1. 目标与验收

**目标**：把 confirmed & 未报告 & 未处理差异，按场景/check 聚合渲染 → 渠道（email/webhook，未配置 mock 降级）投递 → alert_log 留痕（指纹去重）→ reported_at 回填防重；运维告警（僵尸）走同表留痕；差异人工处理端点落地。

**验收标准**（任务分解 T07，3 条）：
1. 手动触发报告：聚合 confirmed & 未报告 & 未处理差异 → 渲染 → 发送（email/webhook，开发期 mock）→ 写 alert_log（含 detail_ids_json、fingerprint、severity）→ 仅成功后回填 reported_at；
2. 重复触发不重发（reported_at 防重）；指纹去重生效；
3. 运维告警（僵尸运行）走应用配置通道即时发送并写 alert_log（同表留痕）。

---

## 2. 依赖与包结构

**新增文件**（`recon-service/src/main/java/com/mis/recon/`）：

| 编号 | 相对路径 | 职责 |
|------|----------|------|
| F99 | `service/report/ReportRenderer.java` | 报告内容渲染（按场景/check 聚合、明细、金额合计、severity） |
| F100 | `service/report/EmailReporter.java` | 邮件渠道（spring-boot-starter-mail 已在 pom；未配置 host → 日志降级） |
| F101 | `service/report/WebhookReporter.java` | Webhook 渠道（RestTemplate POST；未配置 url → 日志降级） |
| F102 | `service/report/ReporterFactory.java` | 渠道分发（channel: email/webhook） |
| F103 | `service/report/ReportRunner.java` | ★ 报告引擎：扫差异→聚合→发送→alert_log→回填 reported_at |
| F104 | `service/alert/OpsAlertService.java` | 运维告警（僵尸）→ alert_log + 应用配置通道 |
| F105 | `service/alert/AlertLogService.java` | alert_log 写入、指纹查重、detail_ids_json 序列化 |
| — | `dao/ReportDao.java` | 报告扫描（JdbcTemplate）+ reported_at 批量回填 + report_run 记录 |
| — | `dao/AlertLogDao.java` | alert_log 插入 + 指纹查重（JdbcTemplate） |
| F110 | `job/ReportJob.java` | Quartz Job → ReportRunner.run(scenarioCode) |
| — | `service/report/ReporterService.java` | ReporterConfig CRUD（场景级） |
| — | `service/config/ReadinessGateService.java` | ReadinessGate CRUD（场景级） |
| — | `controller/ReporterController.java` | 报告渠道 CRUD 端点 |
| — | `controller/ReadinessGateController.java` | 就绪门 CRUD 端点 |
| — | `controller/DiffHandleController.java` | 差异人工处理端点（或并入 DiffController——**裁决：独立控制器**，职责单一） |
| — | `domain/dto/ReporterSaveReq.java` / `ReadinessGateSaveReq.java` / `DiffHandleReq.java` / `ReportTriggerResp.java` | DTO |

**修改文件**：

| 文件 | 修改内容 |
|------|----------|
| `service/engine/ZombieWatchService.java` | 注入 OpsAlertService，僵尸判定后告警（G29） |
| `service/pull/SchedulerManager.java` | + registerReportJob/removeReportJob（scenario.report_cron 动态注册） |
| `service/config/ScenarioService.java` | save/update/delete 同步刷新 ReportJob（report_cron） |
| `controller/OpsController.java` | + POST `/ops/report/{scenarioCode}`（手动触发报告）+ POST `/ops/report/{scenarioCode}/resend`（重发：仅扫未报告——与正常触发同语义，重发即重新跑扫描，已 reported_at 的差异天然跳过） |
| `pom.xml` | **无新增依赖**（mail 已在；webhook 用 spring RestTemplate——**裁决：T07 用 RestClient 不引 spring-webflux**） |

**依赖方向**（门禁）：report/alert 只依赖 dao + repository（ReporterConfig/ReadinessGate 读配置）+ domain；**引擎热路径禁注入**（ReportRunner 不注入 JPA Repository，配置快照经 ReporterConfigRepository 一次读）；单文件 ≤300 行。

---

## 3. 报告扫描与聚合（F103 ReportRunner + F99 ReportRenderer + F102 ReporterFactory）

### 3.1 ReportRunner.run(scenarioCode)

```
1. 快照：场景配置（JPA ScenarioRepository 一次读）+ 该场景 ReporterConfig 列表（JPA 一次读）
2. reportRunId = ReportDao.insertReportRun(scenarioCode, report_type=场景.reportType 缺省 diff)
3. 扫描：ReportDao.scanForReport(scenarioCode)
   → List<ReportDetail{id, checkName, matchKeyDisplay, diffDesc, diffAmountCent, firstSeenAt}>
   （confirmed & reported_at IS NULL & handle_status='unhandled'，ORDER BY check_name, id）
4. 按 checkName 分组 → 每组 RenderResult{checkName, rows, totalAmountCent, severity}
   severity = 行数 > 50 ? critical : 行数 > 10 ? warn : info（MVP 阈值常量，G25）
5. 空组跳过（diff 报告无差异不投递，G27）
6. 每组：route = ReporterService.resolve(scenario, checkName)（check 精确 → '*' → 默认）
   minSeverity 过滤：severity 低于 route.min_severity → 该组跳过发送但仍在 report_run diff_count 统计
7. 发送：ReporterFactory.get(channel).send(content)
   → 成功：AlertLogService.record(success, ...) + ReportDao.markReported(ids)
   → 失败：AlertLogService.record(failed, ...) + 记 errMsg（不中断其他组）
8. 收尾：ReportDao.finishReportRun(reportRunId, send_status, diff_count, errMsg)
   send_status = 全部成功 ? success : 部分失败 ? partial : failed
```

### 3.2 ReportRenderer（F99）

```
render(scenarioCode, scenarioName, checkName, rows) → ReportContent{title, body, severity}
- 标题：`【对账报告】{场景名}({scenarioCode}) - {checkName}`
- 正文（纯文本，换行分隔）：
  差异数：N ｜ 金额合计：¥X.XX
  - {match_key_display} [{diff_type 中文}] {diff_desc} 金额 ¥X.XX (first_seen_at)
  （≤200 条，超出截断加 "… 共 N 条，详见管理端"）
- 金额：diff_amount_cent → AmountUtil.toYuan → 两位小数
```

### 3.3 渠道（F100/F101/F102）

```java
public interface Reporter { SendResult send(ReportContent content); }

EmailReporter（spring.mail.host 未配置 → log.info 降级模拟成功）
  - 收件人：ReporterConfig.configJson.to（无 → mis.recon.notify.mail.to；无 → 降级）
WebhookReporter（RestClient POST JSON：{title, body, severity, scenario_code}）
  - url：ReporterConfig.configJson.url（无 → mis.recon.notify.webhook.url；无 → 降级）
ReporterFactory.get(String channel) → email/webhook；非法 channel → 日志降级 mock
```

---

## 4. alert_log 留痕（F105 AlertLogService + dao/AlertLogDao，G26）

```
record(scenarioCode, checkName, detailIds, severity, channel, content, fingerprint, sendStatus)
→ AlertLogDao.insert(...)   // detail_ids_json = CAST(? AS jsonb)
指纹：SHA-256("{scenario}|{check}|{sortedIds}|{severity}")
去重：AlertLogDao.existsByFingerprint(fingerprint) → true → 返回 false（调用方跳过发送）
```

- alert_log 写入与 reported_at 回填**同事务**（TransactionTemplate REQUIRES_NEW：报告发送是独立动作，与对账无关；发送失败也要留痕 → alert_log 先落，reported_at 仅在成功时回填，两者在 ReportRunner 内同一事务提交，失败时整段回滚？——**裁决：分两段**——① 发送成功后先写 alert_log(success) + 回填 reported_at（同一 TT 事务）；② 发送失败写 alert_log(failed)（独立 TT 事务，保证留痕不丢）。）

---

## 5. 运维告警（F104 OpsAlertService，G29）

```java
@Service
public class OpsAlertService {
    private final AlertLogService alertLogService;
    public void alertOps(String title, String content, String severity) {
        // channel='ops'；指纹 = SHA-256(title+content)，防巡检重复告警
        // 发送：应用配置通道（mis.recon.notify.mail.to / webhook.url 未配置 → 日志降级）
        // 写 alert_log
    }
}
```

**接入**：ZombieWatchService.scan() 每条僵尸判定后 `opsAlertService.alertOps("对账引擎僵尸运行", ...)`（severity=critical；pull/recon 各一条汇总）。

---

## 6. 差异人工处理（G30，F72 语义）

**端点**：`POST /internal/v1/recon/diffs/{id}/handle`

```json
{ "handle_status": "handled|ignored|false_positive", "operator": "zhang3", "remark": "人工核对无误" }
```

流程：
1. 校验 handle_status ∈ 三值（unhandled 拒绝——处理只能产生语义值）；
2. `DiffHandleDao.insert(detail_id, handle_status, operator, remark)`；
3. `DiffHandleDao.updateDetailHandle(detail_id, handle_status)`（`UPDATE recon_detail SET handle_status=?, updated_at=now() WHERE id=?`）；
4. 返回处理记录 id。重对（引擎 upsert）不覆盖 handle_status（DetailDao.upsertDetail 未写 handle_status，天然保留）。

---

## 7. ReporterConfig / ReadinessGate CRUD（G31/G32）

**ReporterController** `/internal/v1/recon/reporters`：
```
GET   /reporters?scenarioCode&page&size        列表（含通配行）
POST  /reporters                                新建 {scenario_code, check_name, channel, config_json, min_severity, enabled}
PUT   /reporters/{id}                           更新（id 路径；scenario_code 禁改）
DELETE /reporters/{id}                          删除
```

**ReadinessGateController** `/internal/v1/recon/readiness-gates`：
```
GET   /readiness-gates?scenarioCode&page&size   列表
POST  /readiness-gates                          新建 {scenario_code, gate_name, gate_type, gate_sql, gate_config_json, min_wait_min, max_wait_min, enabled}
PUT   /readiness-gates/{id}                     更新
DELETE /readiness-gates/{id}                    删除
```

- gate_type 校验：flag_query/row_count_delta/app_callback/stability_window（ResultEnums.GateType 新增或常量校验——**裁决：常量 Set 校验**，避免枚举膨胀）
- min_severity 校验：info/warn/critical（ResultEnums.Severity.from）

---

## 8. 调度（F110 ReportJob + SchedulerManager 扩展）

- SchedulerManager 新增 `refreshReportJob(scenarioCode, reportCron, enabled)` / `removeReportJob(scenarioCode)`（模式同 refreshReconJob，JobKey=`report-{scenarioCode}`）；ScenarioService.save/update/delete 后调用。
- init() 启动加载场景 report_cron 非空且 enabled=1 → 注册。
- ReportJob：JobDataMap `scenarioCode` → reportRunner.run(scenarioCode)；misfire=skip；异常吞掉记日志。

---

## 9. OpsController 扩展

```
POST /ops/report/{scenarioCode}             手动触发报告（同步）→ ReportTriggerResp{reportRunId, diffCount, sendStatus}
POST /ops/report/{scenarioCode}/resend      重发（同一 run：扫描口径已过滤 reported_at，天然不重发；仅语义区分）
```

---

## 10. 验收标准与验证命令

**自动**：
1. `mvn clean compile` BUILD SUCCESS（JDK17：`$env:JAVA_HOME='D:\Program Files\Java\jdk-17.0.18'`）
2. 新增单测全绿：ReportRunnerTest（扫描→渲染→发送→回填 + 防重 + 指纹去重）、ReportRendererTest（聚合/金额/截断）、AlertLogServiceTest（指纹查重）、OpsAlertServiceTest（降级通道）、DiffHandleServiceTest（三值校验）；全量回归无新增失败
3. 门禁：单文件 ≤300 行、依赖只向下（report/alert 零 JPA Repository 注入——除 ReportRunner 读配置快照）

**实库手动序列**（用户环境，recon 库已迁移）：
1. 配 ReporterConfig（email/webhook 任选，未配置走 mock 日志）→ 造 confirmed 差异（T05/T06 序列）→ `POST /ops/report/sc_online_order`
2. 复核：recon_report_run 行（send_status/diff_count）、alert_log 行（fingerprint/detail_ids_json）、差异 reported_at 非空
3. 重复触发 → 无新 alert_log（指纹去重）+ reported_at 不变（防重）
4. `POST /ops/recon/...` 造僵尸 → 等 ConfirmJob 巡检 → alert_log 出现 ops 通道 critical 告警
5. 差异人工处理：`POST /diffs/{id}/handle {handle_status:"handled"}` → 复核 recon_diff_handle + handle_status 变化 → 重跑对账 handle_status 保留

---

## 11. 风险与待确认

| # | 风险/待确认 | 处理 |
|---|-------------|------|
| 1 | email/webhook 无真实服务器 | dev 期日志降级模拟成功（验收可过）；生产参数由用户提供（任务分解 §十 5） |
| 2 | 报告内容长文本 | 明细 ≤200 条截断；diff_desc 本身 ≤2000（T05） |
| 3 | 报告扫描与对账并发 | reported_at 回填幂等（WHERE reported_at IS NULL）；同一差异双线程扫描最多各发一次，指纹去重兜底 |
| 4 | balance 报告 | MVP 不实现（任务分解 §11.1.1 预留），ReportType.balance 配置 → 走 diff 渲染（报告类型语义后置） |
| 5 | 前端 reports/monitor 页 | T09 已定占位（"T07 后接入"）；本任务后端 API 就绪，前端接入单独排期 |

---

## 12. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-18 | 初版：T07 报告与预警规格锁定（G24~G32 + 报告引擎/渠道/告警/人工处理/CRUD/调度 + 验收） | T07 规格锁定，供后端工程师落地 | 全文档 |
