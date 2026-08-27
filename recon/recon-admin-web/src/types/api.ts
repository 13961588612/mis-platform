/** 后端统一响应（code=0 成功；非 0 业务错误，message 可直接展示） */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 分页结果（page 1-based，pages 总页数） */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface PageParams {
  page?: number;
  size?: number;
}

/* ---------------- 连接管理 ---------------- */

export type ConnectionType = 'mysql' | 'oracle' | 'postgresql';

export interface ReconConnection {
  id?: number;
  conn_code: string;
  name: string;
  type: ConnectionType;
  jdbc_url: string;
  username: string;
  /** 新建必填；编辑时空串=不改密码 */
  password?: string;
  enabled: number;
  db_timezone?: string;
  fetch_overlap_sec?: number;
  created_at?: string;
  updated_at?: string;
}

/* ---------------- 数据源管理 ---------------- */

export interface ReconDatasource {
  id?: number;
  ds_code: string;
  name?: string;
  conn_code?: string;
  pull_cron?: string;
  record_key_expression: string;
  time_field?: string;
  fetch_type?: string;
  fetch_config_json?: string;
  fields_json?: string;
  health_rules_json?: string;
  amount_fields_json?: string;
  refund_sign_rule?: string;
  refund_flag_expr?: string;
  grain?: string;
  group_by_fields?: string;
  member_key_field?: string;
  key_scan_sql?: string;
  agg_sql?: string;
  agg_key_batch_size?: number;
  agg_join_mode?: string;
  agg_full_recompute_cron?: string;
  mixed_direction?: number;
  direction_key_field?: string;
  key_case_mode?: string;
  delete_mode?: string;
  soft_delete_expr?: string;
  delete_mode_evidence?: string;
  enabled: number;
  created_at?: string;
  updated_at?: string;
}

/** 试拉探针结果 */
export interface ProbeResp {
  connected: boolean;
  field_count: number;
  sample_row: Record<string, unknown>;
  message: string;
}

/* ---------------- 场景 ---------------- */

export interface ReconScenario {
  id?: number;
  scenario_code: string;
  name: string;
  cron_expr?: string;
  report_cron?: string;
  pending_max_wait_hours?: number;
  pool_max_age_hours?: number;
  hooks_json?: string;
  uses_json?: string;
  enabled: number;
  created_at?: string;
  updated_at?: string;
}

/* ---------------- 检查 ---------------- */

export interface MatchRule {
  strategy: 'exact_key' | 'composite_key' | 'sum_check' | 'custom' | 'custom_check';
  datasets_json: string;
  /** sum_check 无匹配键，可不传（后端落库 NULL）；两两策略为对象形式模板表达式 */
  key_fields_json?: string;
  field_transform_json?: string;
  multi_row_json?: string;
  /** 自定义匹配/整检查：全限定类名（strategy=custom / custom_check 必填，实现 CustomMatcher / CustomCheckExecutor） */
  custom_class?: string;
  /** 匹配规则扩展配置，如 {"empty_key_skip": ["alias"]}；custom 家族含 {"class": "...", ...参数} */
  config_json?: string;
}

export interface CompareRule {
  rules_json: string;
}

export interface ReconCheck {
  id?: number;
  scenario_code: string;
  check_name: string;
  seq_no: number;
  consume_json: string;
  /** 汇总窗口（存在 time_window 数据源时必填；保存时后端自动回写行内 start/end） */
  windowStart?: string;
  windowEnd?: string;
  runMode?: string;
  match_rule?: MatchRule;
  compare_rule?: CompareRule;
  enabled: number;
  created_at?: string;
  updated_at?: string;
}

/** 检查详情聚合（GET /checks/{scenarioCode}/{checkName}）：列表不含 match/compare 规则，编辑需拉详情 */
export interface CheckDetail {
  check: ReconCheck;
  match_rule?: MatchRule;
  compare_rule?: CompareRule;
}

/* ---------------- 运维触发 ---------------- */

export interface PullReq {
  /** yyyy-MM-dd HH:mm:ss */
  start?: string;
  end?: string;
}

export interface PullResultResp {
  run_id: number;
  status: string;
  message?: string;
  row_count: number;
}

export interface FetchOneReq {
  record_key: string;
}

export interface FetchOneResp {
  found: boolean;
  record?: Record<string, unknown>;
  message?: string;
}

/** 数据源重建结果（ops/datasource/{dsCode}/rebuild） */
export interface RebuildResp {
  pull_run_id: number;
  deleted_source_records: number;
  deleted_pull_runs: number;
  affected_check_count: number;
  affected_scenarios: string[];
}

/* ---------------- 取数 SQL 检测 ---------------- */

export interface SqlTestReq {
  conn_code: string;
  /** 待测拉取 SQL（表单未保存） */
  sql: string;
  /** yyyy-MM-dd HH:mm:ss，可选，缺省近 1 天窗口 */
  start?: string;
  end?: string;
  /** 样例行数上限，默认 10，上限 100 */
  limit?: number;
}

export interface SqlTestResp {
  ok: boolean;
  columns?: string[];
  rows?: Record<string, unknown>[];
  row_count?: number;
  cost_ms?: number;
  message?: string;
}

/* ---------------- 差异查询 ---------------- */

export type DiffStatus = 'pending' | 'confirmed' | 'resolved' | 'deferred';
export type DiffType = 'field_mismatch' | 'unmatched_left' | 'unmatched_right' | 'anomaly' | 'custom_check';
export type HandleStatus = 'unhandled' | 'handled' | 'ignored' | 'false_positive';

export interface ReconDetail {
  id: number;
  scenario_code: string;
  check_name: string;
  pair_segment: string;
  match_key_hash: string;
  match_key_display?: string;
  raw_key?: string;
  left_value_json?: string;
  right_value_json?: string;
  diff_type: DiffType;
  status: DiffStatus;
  handle_status: HandleStatus;
  diff_amount_cent?: number;
  diff_point?: number;
  diff_desc?: string;
  diff_diagnosis_json?: string;
  first_seen_at?: string;
  updated_at?: string;
}

export interface DiffQueryParams extends PageParams {
  scenarioCode?: string;
  checkName?: string;
  status?: DiffStatus;
  diffType?: DiffType;
  handleStatus?: HandleStatus;
  matchKey?: string;
  dateFrom?: string;
  dateTo?: string;
  /** 金额差异下限（分） */
  diffAmountCentFrom?: number;
  /** 金额差异上限（分） */
  diffAmountCentTo?: number;
}

export interface DiffStatsResp {
  total_unhandled: number;
  total_confirmed_unhandled: number;
  amount_cent_total: number;
  diff_type_ratio: Record<string, number>;
}

/* ---------------- 报告与预警（T07） ---------------- */

export interface ReconReporterConfig {
  id?: number;
  scenario_code: string;
  /** '*' = 该场景全部 check */
  check_name?: string;
  channel: 'email' | 'webhook';
  config_json?: string;
  min_severity?: string;
  enabled: number;
  created_at?: string;
  updated_at?: string;
}

export interface ReporterSaveReq {
  scenario_code: string;
  check_name?: string;
  channel: 'email' | 'webhook';
  config_json?: string;
  min_severity?: string;
  enabled?: boolean;
}

export interface ReportRunRow {
  id: number;
  scenario_code: string;
  report_type: string;
  diff_count: number;
  send_status: string;
  err_msg?: string | null;
  started_at?: string;
  finished_at?: string | null;
}

export interface AlertLogRow {
  id: number;
  scenario_code?: string | null;
  check_name?: string | null;
  detail_ids_json?: string | null;
  severity: string;
  channel?: string | null;
  fingerprint?: string | null;
  content?: string | null;
  send_status?: string | null;
  retry_count: number;
  sent_at?: string;
}

export interface ReconRunRow {
  id: number;
  scenario_code: string;
  status: string;
  matched_count: number;
  diff_count: number;
  resolved_count: number;
  err_msg?: string | null;
  started_at?: string;
  finished_at?: string | null;
}

export interface PullRunRow {
  id: number;
  ds_code: string;
  window_start?: string | null;
  window_end?: string | null;
  status: string;
  health_status?: string | null;
  row_count: number;
  insert_count: number;
  update_count: number;
  err_msg?: string | null;
  started_at?: string;
  finished_at?: string | null;
}

export interface ReportTriggerResp {
  report_run_id: number;
  diff_count: number;
  send_status: string;
}

/** 报告详情：运行记录 + 该次运行发送的报告正文 + 按检查分组差异汇总 */
export interface ReportDetailResp {
  run: ReportRunRow;
  alerts: AlertLogRow[];
  check_summaries: ReportCheckSummary[];
}

/** 报告详情按检查分组汇总（金额单位分；积分差额原值，V5） */
export interface ReportCheckSummary {
  check_name: string;
  diff_count: number;
  diff_amount_cent: number;
  diff_point: number;
}

/* ---------------- 运行监控（T07 接入补充） ---------------- */

/** 数据源健康总览卡片 */
export interface DatasourceHealthRow {
  ds_code: string;
  ds_name?: string | null;
  health_status: string; // healthy/degraded/empty/error/unknown
  last_err_msg?: string | null;
  today_success_count: number;
  last_pull_at?: string | null;
}

/** 对账成功率趋势（按天状态计数） */
export interface ReconTrendRow {
  day: string;
  status: string;
  cnt: number;
}

/** 差异池账龄分布（0-1 / 1-7 / 7-30 / 30+） */
export interface DiffAgingRow {
  bucket: string;
  cnt: number;
}

/** 对账运行详情（含 consumed_seq_json 消费进度原文） */
export interface ReconRunDetailRow {
  id: number;
  scenario_code: string;
  status: string;
  matched_count: number;
  diff_count: number;
  resolved_count: number;
  err_msg?: string | null;
  consumed_seq_json?: string | null;
  started_at?: string;
  finished_at?: string | null;
}

/** 平衡表（零差异证明） */
export interface BalanceResp {
  scenario_code: string;
  window_start: string;
  window_end: string;
  covered_rounds: number;
  total_rounds: number;
  conclusion: 'balanced' | 'unbalanced' | 'no_run';
  conclusion_text: string;
  datasource_health: DatasourceHealthRow[];
  matched_count: number;
  field_mismatch: number;
  unmatched_left: number;
  unmatched_right: number;
  anomaly: number;
  resolved_count: number;
  new_diff: number;
  resolved_diff: number;
  end_pool_count: number;
  skipped_rounds: number;
  failed_rounds: number;
}

export interface DiffHandleReq {
  handle_status: 'handled' | 'ignored' | 'false_positive';
  operator?: string;
  remark?: string;
}

/* ---------------- 差异详情页（V4） ---------------- */

/** 单条差异全字段（DetailRow，V1+V3+V4 列） */
export interface DiffDetailRow {
  id: number;
  scenario_code: string;
  check_name: string;
  pair_segment: string;
  match_key_hash: string;
  match_key_display?: string;
  diff_type: DiffType;
  status: DiffStatus;
  defer_until?: string;
  pending_peer_pull_run_id?: number;
  pending_peer_ds_code?: string;
  pending_at?: string;
  left_data_json?: string;
  right_data_json?: string;
  diff_desc?: string;
  diff_amount_cent: number;
  diff_point: number;
  diff_diagnosis_json?: string;
  handle_status: HandleStatus;
  reported_at?: string;
  reopen_seq: number;
  resolved_at?: string;
  first_seen_at?: string;
  confirmed_at?: string;
  created_at?: string;
  updated_at?: string;
}

/** 锚表行 */
export interface DiffAnchorRow {
  side: 'left' | 'right';
  ds_code: string;
  record_key: string;
}

/** 比较规则元信息（前端识别金额字段用） */
export interface CompareRuleMeta {
  name?: string;
  left_field: string;
  right_field: string;
  compare_mode: string;
  is_amount: boolean;
  value_transform?: string;
}

/** 状态流转历史行 */
export interface StatusHistoryRow {
  id: number;
  detail_id: number;
  field: 'status' | 'handle_status';
  from_value?: string;
  to_value: string;
  reason?: string;
  operator?: string;
  created_at: string;
}

/** 人工处理历史行 */
export interface HandleHistoryRow {
  id: number;
  detail_id: number;
  handle_status: HandleStatus;
  operator?: string;
  remark?: string;
  handled_at: string;
}

/** 差异详情聚合响应 */
export interface DiffDetailResp {
  detail: DiffDetailRow;
  anchors: DiffAnchorRow[];
  handle_history: HandleHistoryRow[];
  status_history: StatusHistoryRow[];
  check_compare_rules: CompareRuleMeta[];
}

/** 回退为未处理请求 */
export interface DiffRevertReq {
  operator?: string;
  remark?: string;
}

/** 单条重拉请求（side 缺省两侧都拉） */
export interface DiffFetchOneReq {
  side?: 'left' | 'right';
}

/** 单条重拉结果（按锚表行一条） */
export interface FetchOneResult {
  side: 'left' | 'right';
  ds_code: string;
  record_key: string;
  found: boolean;
  insert: number;
  update: number;
  error?: string;
}
