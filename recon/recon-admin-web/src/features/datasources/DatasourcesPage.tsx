import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Database, Plus, RefreshCw, PlugZap, Play, Pencil, Trash2, Wand2, RotateCcw } from 'lucide-react';
import { datasourcesApi } from '@/lib/api/datasources';
import { connectionsApi } from '@/lib/api/connections';
import { opsApi } from '@/lib/api/ops';
import { errMsg } from '@/lib/api/client';
import { PermissionGate } from '@/components/auth/permission-gate';
import { P } from '@/lib/permissions';
import { checkCron } from '@/lib/cron';
import { prettyJson, parseJsonField } from '@/lib/utils';
import type { ProbeResp, ReconDatasource, RebuildResp, SqlTestResp } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateTimeInput } from '@/components/ui/datetime-input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ApiFetchEditor } from './ApiFetchEditor';
import { JsonParamEditor, type JsonParamTemplate } from '../scenarios/check-form/JsonParamEditor';

/** 内置示例 CustomFetcher：CsvDirFetcher（目录 CSV 账单拉取，recon-service com.mis.recon.custom.example） */
const CSV_DIR_FETCHER_CLASS = 'com.mis.recon.custom.example.CsvDirFetcher';

const CSV_DIR_TPL: Record<string, unknown> = {
  dir: '/data/inbound/bills',
  file_prefix: 'bill_',
  file_suffix: '.csv',
  window_format: 'yyyyMMdd',
  time_field: 'biz_date',
  charset: 'utf-8',
  delimiter: ',',
};

/** custom 取数参数模板（演示引导；真实参数由 CustomFetcher 实现类自解析） */
const FETCH_TPL: JsonParamTemplate[] = [
  {
    label: '目录 CSV 账单拉取（内置示例 CsvDirFetcher）',
    json: JSON.stringify(CSV_DIR_TPL),
  },
  {
    label: 'HTTP 接口拉取',
    json: '{"endpoint":"http://inner.bill.svc/v1/fetch","auth_token":"${BILL_TOKEN}","page_size":500}',
  },
  {
    label: 'SFTP 账单拉取',
    json: '{"host":"sftp.bank.com","path":"/inbound/bill_%Y%m%d.csv","private_key":"${SFTP_KEY}"}',
  },
];

/* ================= 字段映射表格行（fields_json 元素） ================= */
interface FieldRow {
  source: string; // 源字段名
  name: string; // 台账字段名
  annotation: string; // 注释
  is_sensitive: boolean; // 敏感
}

/* ================= 表单状态（JSON 字符串 + 编辑态辅助） ================= */
interface FormState {
  ds_code: string;
  name: string;
  conn_code: string;
  pull_cron: string;
  record_key_expression: string;
  time_field: string;
  fetch_type: string; // db / api / custom
  grain: string;
  key_case_mode: string;
  delete_mode: string;
  enabled: number;
  // 提交用 JSON 串（api/custom 时直接编辑；db 时由分区字段序列化）
  fetch_config_json: string;
  health_rules_json: string;
  amount_fields_json: string;
  refund_sign_rule: string;
  // ---- 编辑态辅助（submit 时序列化回 JSON）----
  ft_mode: string; // db: fetch_mode (time/pk/full)
  ft_sql: string; // db: 拉取 SQL
  ft_one_sql: string; // db: fetch_one_sql（可选）
  ft_fetch_time_field: string; // db: 增量窗口字段（可选）
  ft_biz_time_field: string; // db: 业务时间字段（可选）
  ft_class: string; // custom: 实现类
  ft_custom_json: string; // custom: 自定义参数
  rows: FieldRow[]; // 字段映射表格行
  rk_sep: string; // record_key 分隔符
  rk_selected: string[]; // record_key 勾选源字段
}

const EMPTY_FORM: FormState = {
  ds_code: '',
  name: '',
  conn_code: '',
  pull_cron: '',
  record_key_expression: '',
  time_field: '',
  fetch_type: 'db',
  grain: 'row',
  key_case_mode: 'upper',
  delete_mode: 'none', // 第一批数据源统一声明为无删除（none），页面不提供配置
  enabled: 1,
  fetch_config_json: '',
  health_rules_json: '',
  amount_fields_json: '',
  refund_sign_rule: 'none',
  ft_mode: 'time',
  ft_sql: '',
  ft_one_sql: '',
  ft_fetch_time_field: '',
  ft_biz_time_field: '',
  ft_class: '',
  ft_custom_json: '',
  rows: [],
  rk_sep: '_',
  rk_selected: [],
};

/* ================= JSON ↔ 编辑态转换 ================= */

/** fields_json [{name,source,annotation,is_sensitive}] → 表格行 */
function rowsFromFields(raw?: string | null): FieldRow[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((it) => ({
      source: String(it?.source ?? it?.name ?? ''),
      name: String(it?.name ?? it?.source ?? ''),
      annotation: String(it?.annotation ?? ''),
      is_sensitive: Boolean(it?.is_sensitive),
    }));
  } catch {
    return [];
  }
}

/** record_key_expression "{a}_{b}" → {selected, sep} */
function rkFromExpr(expr?: string | null): { selected: string[]; sep: string } {
  if (!expr) return { selected: [], sep: '_' };
  const m = expr.match(/\{([^}]+)\}/g);
  if (!m || m.length === 0) return { selected: [], sep: '_' };
  const selected = m.map((s) => s.slice(1, -1).trim()).filter(Boolean);
  const sep = expr.match(/\}\s*(.)\s*\{/) ? expr.match(/\}\s*(.)\s*\{/)![1] : '_';
  return { selected, sep };
}

/** fetch_config_json → db 分区字段（非 db 结构返回 null） */
function dbFetchFromJson(raw?: string | null): Partial<FormState> | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    return {
      ft_mode: String(o.fetch_mode ?? 'time'),
      ft_sql: String(o.sql ?? ''),
      ft_one_sql: String(o.fetch_one_sql ?? ''),
      ft_fetch_time_field: String(o.fetch_time_field ?? ''),
      ft_biz_time_field: String(o.biz_time_field ?? ''),
    };
  } catch {
    return null;
  }
}

/** fetch_config_json → custom 分区字段（取数层需求规格 §4.4：class + config_json） */
function customFetchFromJson(raw?: string | null): { ft_class: string; ft_custom_json: string } {
  if (!raw) return { ft_class: '', ft_custom_json: '' };
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return { ft_class: '', ft_custom_json: '' };
    const cfg = o.config_json;
    return {
      ft_class: String(o.class ?? ''),
      ft_custom_json: cfg ? JSON.stringify(cfg, null, 2) : '',
    };
  } catch {
    return { ft_class: '', ft_custom_json: '' };
  }
}

function toForm(row?: ReconDatasource): FormState {
  if (!row) return EMPTY_FORM;
  const db = dbFetchFromJson(row.fetch_config_json);
  const custom = customFetchFromJson(row.fetch_config_json);
  const rk = rkFromExpr(row.record_key_expression);
  return {
    ds_code: row.ds_code,
    name: row.name ?? '',
    conn_code: row.conn_code ?? '',
    pull_cron: row.pull_cron ?? '',
    record_key_expression: row.record_key_expression,
    time_field: row.time_field ?? '',
    fetch_type: row.fetch_type ?? 'db',
    grain: row.grain ?? 'row',
    key_case_mode: row.key_case_mode ?? 'upper',
    delete_mode: row.delete_mode ?? 'none', // 首批统一 none；编辑旧数据保留原值
    enabled: row.enabled ?? 1,
    fetch_config_json: prettyJson(row.fetch_config_json),
    health_rules_json: prettyJson(row.health_rules_json),
    amount_fields_json: prettyJson(row.amount_fields_json),
    refund_sign_rule: row.refund_sign_rule ?? 'none',
    ft_mode: db?.ft_mode ?? 'time',
    ft_sql: db?.ft_sql ?? '',
    ft_one_sql: db?.ft_one_sql ?? '',
    ft_fetch_time_field: db?.ft_fetch_time_field ?? '',
    ft_biz_time_field: db?.ft_biz_time_field ?? '',
    ft_class: custom.ft_class,
    ft_custom_json: custom.ft_custom_json,
    rows: rowsFromFields(row.fields_json),
    rk_sep: rk.sep,
    rk_selected: rk.selected,
  };
}

/* ================= 从 SQL 解析列（「从 SQL 解析」按钮） ================= */
function parseSelectColumns(sql: string): string[] {
  if (!sql) return [];
  const m = sql.match(/select\s+([\s\S]*?)\s+from\s+/i);
  if (!m) return [];
  const cols = m[1].split(',').map((c) => c.trim()).filter(Boolean);
  if (cols.length === 0 || cols.some((c) => c.replace(/^distinct\s+/i, '') === '*')) return [];
  return cols.map((c) => {
    const clean = c.replace(/^distinct\s+/i, '');
    const asM = clean.match(/\s+as\s+([a-zA-Z_][\w]*)\s*$/i);
    if (asM) return asM[1];
    const trail = clean.match(/\s+([a-zA-Z_][\w]*)\s*$/);
    if (trail && !clean.includes('(')) return trail[1];
    return clean.replace(/^[\w.]+\./, '').replace(/[`"\[\]]/g, '').trim();
  }).filter(Boolean);
}

/* ================= 序列化（submit 时） ================= */
function serializeFetchConfig(f: FormState): string {
  if (f.fetch_type === 'db') {
    const o: Record<string, unknown> = { fetch_mode: f.ft_mode || 'time', sql: f.ft_sql };
    if (f.ft_one_sql.trim()) o.fetch_one_sql = f.ft_one_sql.trim();
    if (f.ft_fetch_time_field.trim()) o.fetch_time_field = f.ft_fetch_time_field.trim();
    if (f.ft_biz_time_field.trim()) o.biz_time_field = f.ft_biz_time_field.trim();
    return JSON.stringify(o);
  }
  if (f.fetch_type === 'custom') {
    const cfg = parseJsonField(f.ft_custom_json);
    const o: Record<string, unknown> = { class: f.ft_class.trim() };
    if (cfg.value !== null) o.config_json = cfg.value;
    return JSON.stringify(o);
  }
  // api：ApiFetchEditor 结构化配置（取数层需求规格 §3.1）
  return f.fetch_config_json.trim();
}

function serializeRecordKey(f: FormState): string {
  if (f.rk_selected.length === 0) return f.record_key_expression.trim();
  return f.rk_selected.map((s) => `{${s}}`).join(f.rk_sep || '');
}

/* ================= 校验 ================= */

/** 提取 SQL 中的占位符 token（:name 或 {name}，与后端 SqlParamBinder 口径一致） */
function extractPlaceholders(sql: string): string[] {
  const out: string[] = [];
  const re = /(?<![A-Za-z0-9_]):([A-Za-z0-9_]+)|{([A-Za-z0-9_]+)}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.push(m[1] ?? m[2]);
  }
  return out;
}

function validate(f: FormState): string | null {
  if (!f.ds_code.trim()) return '数据源编码必填';
  if (!f.ds_code.trim().match(/^[a-z][a-z0-9_]{0,63}$/)) {
    return '数据源编码须为小写 snake_case（字母开头，含字母/数字/下划线，≤64 字符）';
  }
  if (!f.name.trim()) return '名称必填';
  if (f.fetch_type === 'db') {
    if (!f.conn_code.trim()) return '请选择连接';
    if (!f.ft_sql.trim()) return '拉取 SQL 必填';
    const sqlTokens = extractPlaceholders(f.ft_sql);
    if (!sqlTokens.includes('p_start') || !sqlTokens.includes('p_end')) {
      return '拉取 SQL 必须同时含 :p_start 与 :p_end 窗口参数';
    }
    const badSqlTokens = sqlTokens.filter((t) => t !== 'p_start' && t !== 'p_end');
    if (badSqlTokens.length > 0) {
      return `拉取 SQL 只能含窗口参数 :p_start/:p_end，发现非法占位符 ${badSqlTokens.map((t) => `{${t}}`).join(', ')}`;
    }
    if (f.ft_one_sql.trim()) {
      const oneTokens = extractPlaceholders(f.ft_one_sql);
      const badOneTokens = oneTokens.filter((t) => t !== 'record_key');
      if (badOneTokens.length > 0) {
        return `fetch_one_sql 只能含 {record_key} 占位符，发现非法占位符 ${badOneTokens.map((t) => `{${t}}`).join(', ')}（record_key 请写 {record_key}）`;
      }
    }
    if (f.rk_selected.length === 0 && !f.record_key_expression.trim()) return 'record_key 表达式必填（勾选字段生成）';
    if (f.rows.length === 0) return '字段映射至少配置一行（或点「从 SQL 解析」）';
    const seen = new Set<string>();
    for (const r of f.rows) {
      if (!r.source.trim()) return '字段映射存在空源字段名';
      if (!r.name.trim()) return '字段映射存在空台账字段名';
      if (seen.has(r.source.trim())) return `源字段重复：${r.source.trim()}`;
      seen.add(r.source.trim());
    }
  } else if (f.fetch_type === 'custom') {
    if (!f.ft_class.trim()) return '自定义拉取实现类 class 必填';
    if (f.ft_custom_json.trim()) {
      const r = parseJsonField(f.ft_custom_json);
      if (r.error) return `自定义参数 config_json 非法：${r.error}`;
    }
    if (f.rk_selected.length === 0 && !f.record_key_expression.trim()) return 'record_key 表达式必填';
  } else {
    // api（取数层需求规格 §3.8 主要校验项，与后端同口径）
    if (!f.fetch_config_json.trim()) return 'api 取数配置 fetch_config_json 必填';
    const r = parseJsonField(f.fetch_config_json);
    if (r.error) return `api 取数配置 JSON 非法：${r.error}`;
    const cfg = r.value as Record<string, unknown> | null;
    const url = String(cfg?.url ?? '').trim();
    if (!url) return 'api 取数配置 url 必填';
    if (!url.includes('{time_start}') || !url.includes('{time_end}')) {
      return 'api 取数 url 必须含 {time_start}/{time_end} 窗口占位符（防静默全量拉取）';
    }
    const method = String(cfg?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') return 'api 取数 method 仅支持 GET/POST';
    const page = (cfg?.page ?? {}) as Record<string, unknown>;
    const mode = String(page.mode ?? 'cursor');
    if (mode !== 'cursor' && mode !== 'page_no') return 'api 取数 page.mode 仅支持 cursor/page_no';
    if (mode === 'cursor') {
      if (!String(page.cursor_param ?? '').trim()) return 'cursor 模式必填 page.cursor_param';
      if (!String(page.cursor_path ?? '').trim()) return 'cursor 模式必填 page.cursor_path';
    }
    if (f.rk_selected.length === 0 && !f.record_key_expression.trim()) return 'record_key 表达式必填';
  }
  const cronErr = checkCron(f.pull_cron, '拉取 cron');
  if (cronErr) return cronErr;
  if (f.health_rules_json.trim()) {
    const r = parseJsonField(f.health_rules_json);
    if (r.error) return `健康规则 JSON 非法：${r.error}`;
  }
  if (f.amount_fields_json.trim()) {
    const r = parseJsonField(f.amount_fields_json);
    if (r.error) return `金额声明 JSON 非法：${r.error}`;
  }
  return null;
}

/* ================= 健康规则/金额声明的固定结构（表单化） ================= */
interface HealthRules {
  row_count_delta_pct: string;
  null_rate_threshold: string;
  allow_empty: string; // "00:00-06:00" 或空
  deletion_detect: string; // none/soft_delete_field/window_absent
}

const EMPTY_HEALTH: HealthRules = {
  row_count_delta_pct: '50',
  null_rate_threshold: '0.05',
  allow_empty: '',
  deletion_detect: 'none',
};

function healthFromJson(raw?: string | null): HealthRules {
  if (!raw) return EMPTY_HEALTH;
  try {
    const o = JSON.parse(raw);
    return {
      row_count_delta_pct: String(o?.row_count_delta_pct ?? '50'),
      null_rate_threshold: String(o?.null_rate_threshold ?? '0.05'),
      allow_empty: String(o?.allow_empty ?? ''),
      deletion_detect: String(o?.deletion_detect ?? 'none'),
    };
  } catch {
    return EMPTY_HEALTH;
  }
}

function serializeHealth(h: HealthRules): string {
  const o: Record<string, unknown> = {
    row_count_delta_pct: Number(h.row_count_delta_pct) || 50,
    null_rate_threshold: Number(h.null_rate_threshold) || 0.05,
    deletion_detect: h.deletion_detect || 'none',
  };
  if (h.allow_empty.trim()) o.allow_empty = h.allow_empty.trim();
  return JSON.stringify(o);
}

/* ================= 金额声明 {field:{unit,role}} ================= */
interface AmountRow {
  field: string;
  unit: string; // yuan/point/non_monetary
  role: string; // primary/aux
}

function amountFromJson(raw?: string | null): AmountRow[] {
  if (!raw) return [];
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return [];
    return Object.entries(o).map(([field, v]) => ({
      field,
      unit: String((v as { unit?: string })?.unit ?? 'yuan'),
      role: String((v as { role?: string })?.role ?? 'aux'),
    }));
  } catch {
    return [];
  }
}

function serializeAmount(rows: AmountRow[]): string {
  const o: Record<string, unknown> = {};
  for (const r of rows) {
    if (!r.field.trim()) continue;
    o[r.field.trim()] = { unit: r.unit || 'yuan', role: r.role || 'aux' };
  }
  return Object.keys(o).length ? JSON.stringify(o) : '';
}

export function DatasourcesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReconDatasource | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthRules>(EMPTY_HEALTH);
  const [amountRows, setAmountRows] = useState<AmountRow[]>([]);

  const [pullOpen, setPullOpen] = useState(false);
  const [pullDs, setPullDs] = useState('');
  const [pullStart, setPullStart] = useState('');
  const [pullEnd, setPullEnd] = useState('');

  // 全部删除重拉（破坏性）确认弹窗
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [rebuildDs, setRebuildDs] = useState('');
  const [rebuildStart, setRebuildStart] = useState('');
  const [rebuildEnd, setRebuildEnd] = useState('');
  // key_case_mode / delete_mode 为自动推断或首批固定值，页面不再提供手动配置控件

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['datasources', page],
    queryFn: () => datasourcesApi.list({ page, size: 20 }),
  });

  const { data: conns } = useQuery({
    queryKey: ['connections-mini'],
    queryFn: () => connectionsApi.list({ page: 1, size: 100 }),
  });

  const testMutation = useMutation<ProbeResp | null, Error, ReconDatasource>({
    mutationFn: async (row) => {
      // db：连接层测试；api/custom：取数探针（probe，小窗口拉取返回样例）
      if (row.fetch_type === 'db') {
        await datasourcesApi.test(row.ds_code);
        return null;
      }
      return opsApi.probe(row.ds_code);
    },
    onSuccess: (data) => {
      if (data === null) {
        toast.success('测试通过：数据源连接可用');
        return;
      }
      if (data.connected) {
        toast.success(`试拉成功：${data.field_count} 个字段，样例 ${JSON.stringify(data.sample_row)}`);
      } else {
        toast.error(data.message || '试拉失败');
      }
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  // 取数 SQL 检测（表单未保存 SQL 试跑，不入库）
  const [sqlTestResult, setSqlTestResult] = useState<SqlTestResp | null>(null);
  const sqlTestMutation = useMutation({
    mutationFn: () => opsApi.sqlTest({ conn_code: form.conn_code, sql: form.ft_sql }),
    onSuccess: (r) => setSqlTestResult(r),
    onError: (e) => setSqlTestResult({ ok: false, message: errMsg(e) }),
  });

  const pullMutation = useMutation({
    mutationFn: ({ code, start, end }: { code: string; start?: string; end?: string }) =>
      opsApi.pull(code, { start: start || undefined, end: end || undefined }),
    onSuccess: (r) => {
      toast.success(`拉取任务已接受：run_id=${r.run_id} status=${r.status}`);
      setPullOpen(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const rebuildMutation = useMutation({
    mutationFn: ({ code, start, end }: { code: string; start?: string; end?: string }) =>
      opsApi.rebuild(code, { start: start || undefined, end: end || undefined }),
    onSuccess: (r: RebuildResp) => {
      const scenarios = (r.affected_scenarios ?? []).join(', ');
      toast.success(
        `重建完成：删除台账 ${r.deleted_source_records} 行、水位 ${r.deleted_pull_runs} 条，影响 ${r.affected_check_count} 个 check` +
          (scenarios ? `；请手动重跑对账场景：${scenarios}` : ''),
        { duration: 8000 },
      );
      setRebuildOpen(false);
      qc.invalidateQueries({ queryKey: ['datasources'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (code: string) => datasourcesApi.remove(code),
    onSuccess: () => {
      toast.success('数据源已删除');
      qc.invalidateQueries({ queryKey: ['datasources'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const saveMutation = useMutation({
    mutationFn: (body: ReconDatasource) =>
      editing ? datasourcesApi.update(editing.ds_code, body) : datasourcesApi.create(body),
    onSuccess: () => {
      toast.success(editing ? '数据源已更新' : '数据源已创建');
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['datasources'] });
    },
    onError: (e) => setFormError(errMsg(e)),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setHealth(EMPTY_HEALTH);
    setAmountRows([]);
    setFormError(null);
    setOpen(true);
  }

  function openEdit(row: ReconDatasource) {
    setEditing(row);
    const f = toForm(row);
    setForm(f);
    setHealth(healthFromJson(row.health_rules_json));
    setAmountRows(amountFromJson(row.amount_fields_json));
    setFormError(null);
    setOpen(true);
  }

  function openPull(row: ReconDatasource) {
    setPullDs(row.ds_code);
    setPullStart('');
    setPullEnd('');
    setPullOpen(true);
  }

  function openRebuild(row: ReconDatasource) {
    setRebuildDs(row.ds_code);
    setRebuildStart('');
    setRebuildEnd('');
    setRebuildOpen(true);
  }

  /* 字段映射表格操作 */
  function addRow() {
    setForm((f) => ({ ...f, rows: [...f.rows, { source: '', name: '', annotation: '', is_sensitive: false }] }));
  }
  function updateRow(i: number, patch: Partial<FieldRow>) {
    setForm((f) => ({ ...f, rows: f.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  }
  function removeRow(i: number) {
    setForm((f) => ({ ...f, rows: f.rows.filter((_, idx) => idx !== i) }));
  }
  /** 从 SQL 解析：重建字段映射（SELECT * 或解析失败时提示且不清空） */
  function parseFromSql() {
    const cols = parseSelectColumns(form.ft_sql);
    const cols2 = parseSelectColumns(form.ft_one_sql);
    const all = [...cols, ...cols2];
    const uniq = [...new Set(all)];
    if (uniq.length === 0) {
      toast.warning('无法从 SQL 解析列（SELECT * 或不支持的结构），字段映射保持不变');
      return;
    }
    const rows: FieldRow[] = uniq.map((c) => ({ source: c, name: c, annotation: '', is_sensitive: false }));
    setForm((f) => ({ ...f, rows }));
    toast.success(`已从 SQL 解析 ${rows.length} 列，请在表格中补充注释/敏感标记`);
  }

  /** record_key 勾选 */
  function toggleRk(s: string) {
    setForm((f) => {
      const sel = f.rk_selected.includes(s) ? f.rk_selected.filter((x) => x !== s) : [...f.rk_selected, s];
      return { ...f, rk_selected: sel, record_key_expression: sel.map((x) => `{${x}}`).join(f.rk_sep || '') };
    });
  }

  function submit() {
    const err = validate(form);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    saveMutation.mutate({
      ds_code: form.ds_code.trim(),
      name: form.name.trim() || undefined,
      conn_code: form.fetch_type === 'db' ? form.conn_code : undefined,
      pull_cron: form.pull_cron.trim() || undefined,
      record_key_expression: serializeRecordKey(form),
      time_field: form.time_field.trim() || undefined,
      fetch_type: form.fetch_type,
      grain: form.grain,
      key_case_mode: form.key_case_mode,
      delete_mode: form.delete_mode,
      enabled: form.enabled,
      fetch_config_json: serializeFetchConfig(form),
      fields_json: JSON.stringify(form.rows),
      health_rules_json: serializeHealth(health),
      amount_fields_json: serializeAmount(amountRows),
      refund_sign_rule: form.refund_sign_rule,
    });
  }

  const fieldSourceOptions = [...new Set(form.rows.map((r) => r.source).filter(Boolean))];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              数据源管理
            </CardTitle>
            <CardDescription>源表数据源（引用连接拉取），record_key 表达式 + 取数 SQL 定义拉取语义</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> 刷新
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-3.5 w-3.5" /> 新建数据源
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编码</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>连接</TableHead>
                <TableHead>record_key</TableHead>
                <TableHead>时间字段</TableHead>
                <TableHead>拉取 cron</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && (data?.list.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    暂无数据源，点击「新建数据源」创建
                  </TableCell>
                </TableRow>
              )}
              {data?.list.map((row) => (
                <TableRow key={row.ds_code}>
                  <TableCell className="font-medium">{row.ds_code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.fetch_type ?? 'db'}</Badge>
                  </TableCell>
                  <TableCell>{row.conn_code || '—'}</TableCell>
                  <TableCell className="max-w-[160px] truncate font-mono text-xs" title={row.record_key_expression}>
                    {row.record_key_expression}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.time_field ?? '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{row.pull_cron ?? '-'}</TableCell>
                  <TableCell>
                    {row.enabled === 1 ? (
                      <Badge variant="success">启用</Badge>
                    ) : (
                      <Badge variant="outline">停用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <PermissionGate permission={P.DATASOURCE.PULL}>
                        <Button variant="ghost" size="icon" title="测试连接 / 试拉" onClick={() => testMutation.mutate(row)}>
                          <PlugZap className="h-4 w-4 text-success" />
                        </Button>
                        <Button variant="ghost" size="icon" title="手动拉取" onClick={() => openPull(row)}>
                          <Play className="h-4 w-4 text-primary" />
                        </Button>
                      </PermissionGate>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="全部删除重拉（重建数据源，清空台账/水位/差异后全量重拉）"
                        onClick={() => openRebuild(row)}
                      >
                        <RotateCcw className="h-4 w-4 text-warning" />
                      </Button>
                      <Button variant="ghost" size="icon" title="编辑" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <PermissionGate permission={P.DATASOURCE.DELETE}>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="删除"
                          onClick={() => {
                            if (confirm(`确认删除数据源 ${row.ds_code}？`)) deleteMutation.mutate(row.ds_code);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </PermissionGate>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(data?.pages ?? 1) > 1 && (
            <div className="mt-3 flex items-center justify-between text-[13px] text-muted-foreground">
              <span>
                共 {data?.total ?? 0} 条 · 第 {page}/{data?.pages ?? 1} 页
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= (data?.pages ?? 1)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新建/编辑 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-4xl"
          // 配置项多、表单复杂：点击遮罩/Esc 误关会丢失已填内容，仅保留右上角 X 与「取消」显式关闭
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{editing ? `编辑数据源 ${editing.ds_code}` : '新建数据源'}</DialogTitle>
            <DialogDescription>
              配置流程：先选拉取类型 → 填取数 SQL → 字段映射表格勾选 → record_key 生成器 → 业务时间字段
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <Tabs defaultValue="basic">
              <TabsList>
                <TabsTrigger value="basic">基本信息</TabsTrigger>
                <TabsTrigger value="fetch">取数配置</TabsTrigger>
                <TabsTrigger value="fields">字段映射</TabsTrigger>
                <TabsTrigger value="health">健康规则</TabsTrigger>
              </TabsList>

              {/* ---------- 基本信息 ---------- */}
              <TabsContent value="basic" className="grid grid-cols-2 gap-4 pt-3">
                <div className="space-y-1.5">
                  <Label>数据源编码 *</Label>
                  <Input
                    value={form.ds_code}
                    disabled={!!editing}
                    placeholder="snake_case 小写，唯一，保存后不可改"
                    onChange={(e) => setForm({ ...form, ds_code: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>名称</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>拉取类型 fetch_type *</Label>
                  <div className="flex gap-4 rounded-md border border-input bg-card px-3 py-2">
                    {(['db', 'api', 'custom'] as const).map((t) => (
                      <label key={t} className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <input
                          type="radio"
                          name="ft"
                          checked={form.fetch_type === t}
                          onChange={() => setForm((f) => ({ ...f, fetch_type: t }))}
                        />
                        {t === 'db' ? '数据库 db' : t === 'api' ? '接口 api' : '自定义 custom'}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {form.fetch_type === 'db' && '数据库取数：引用连接 + 拉取 SQL（MVP 已实现）'}
                    {form.fetch_type === 'api' && '接口取数：不经过连接层，在取数配置页填 URL/方法/鉴权/分页'}
                    {form.fetch_type === 'custom' && '自定义取数：实现 CustomFetcher 接口的类 + 参数'}
                  </p>
                </div>
                {form.fetch_type === 'db' && (
                  <div className="space-y-1.5">
                    <Label>连接 *</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                      value={form.conn_code}
                      onChange={(e) => {
                        const code = e.target.value;
                        const conn = conns?.list.find((c) => c.conn_code === code);
                        // 键大小写按连接类型自动推断（MySQL *_ci → upper；Oracle/PG → none），无需手动配置
                        setForm({
                          ...form,
                          conn_code: code,
                          key_case_mode: conn ? (conn.type === 'mysql' ? 'upper' : 'none') : form.key_case_mode,
                        });
                      }}
                    >
                      <option value="">选择连接…</option>
                      {conns?.list.map((c) => (
                        <option key={c.conn_code} value={c.conn_code}>
                          {c.conn_code}（{c.name}）
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">下拉来自连接管理页；如无可用连接，先到连接管理页新建</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>拉取 cron</Label>
                  <Input
                    value={form.pull_cron}
                    placeholder="留空=仅手动拉取，如 0 */5 * * * ?"
                    onChange={(e) => setForm({ ...form, pull_cron: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>状态</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                    value={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: Number(e.target.value) })}
                  >
                    <option value={1}>启用</option>
                    <option value={0}>停用</option>
                  </select>
                </div>
              </TabsContent>

              {/* ---------- 取数配置（fetch_type 联动） ---------- */}
              <TabsContent value="fetch" className="space-y-4 pt-3">
                {form.fetch_type === 'db' && (
                  <>
                    <div className="space-y-1.5">
                      <Label>拉取模式 fetch_mode *</Label>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                        value={form.ft_mode}
                        onChange={(e) => setForm({ ...form, ft_mode: e.target.value })}
                      >
                        <option value="time">时间窗口增量（time）</option>
                      </select>
                      <p className="text-xs text-muted-foreground">
                        主键增量 pk / 全量 full 为后续形态，暂不开放（引擎当前仅支持 time）
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label>拉取 SQL *（窗口参数 :p_start / :p_end）</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={sqlTestMutation.isPending || !form.conn_code || !form.ft_sql.trim()}
                          onClick={() => sqlTestMutation.mutate()}
                        >
                          {sqlTestMutation.isPending ? '检测中…' : 'SQL 检测'}
                        </Button>
                      </div>
                      <Textarea
                        rows={6}
                        className="font-mono text-xs"
                        value={form.ft_sql}
                        placeholder="SELECT ... WHERE update_time >= :p_start AND update_time < :p_end"
                        onChange={(e) => {
                          setForm({ ...form, ft_sql: e.target.value });
                          setSqlTestResult(null);
                        }}
                      />
                      {sqlTestResult && (
                        <div
                          className={`rounded-md border p-3 text-xs ${
                            sqlTestResult.ok
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : 'border-red-300 bg-red-50 text-red-800'
                          }`}
                        >
                          {sqlTestResult.ok ? (
                            <div className="space-y-2">
                              <p className="font-medium">
                                检测通过：返回 {sqlTestResult.row_count} 行样例 · 耗时 {sqlTestResult.cost_ms} ms
                              </p>
                              {sqlTestResult.rows && sqlTestResult.rows.length > 0 ? (
                                <div className="overflow-x-auto rounded border border-emerald-200 bg-white">
                                  <table className="w-full border-collapse">
                                    <thead>
                                      <tr className="border-b border-emerald-200 bg-emerald-50/60">
                                        {(sqlTestResult.columns ?? []).map((c) => (
                                          <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                                            {c}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sqlTestResult.rows.map((r, i) => (
                                        <tr key={i} className="border-b border-emerald-100 last:border-0">
                                          {(sqlTestResult.columns ?? []).map((c) => (
                                            <td key={c} className="whitespace-nowrap px-2 py-1 font-mono">
                                              {String(r[c] ?? '')}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p>窗口内无数据（仅验证 SQL 语法与列解析）</p>
                              )}
                              <p className="text-emerald-600">
                                注：引擎实际运行时还会自动追加键集分页与批量限制，此处为裸 SQL 试跑
                              </p>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-all">{sqlTestResult.message}</p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label>fetch_one_sql（{'{record_key}'} 占位，可选）</Label>
                      <Textarea
                        rows={2}
                        className="font-mono text-xs"
                        value={form.ft_one_sql}
                        placeholder="SELECT * FROM t WHERE order_no = {record_key}"
                        onChange={(e) => setForm({ ...form, ft_one_sql: e.target.value })}
                      />
                    </div>
                    {/* 预留字段 fetch_time_field / biz_time_field 暂不配置：
                        增量窗口与 keyset 分页当前取表级 time_field，业务日 biz_date MVP 可空，
                        等报表按业务日归属功能上线后再开放 */}
                  </>
                )}
                {form.fetch_type === 'api' && (
                  <div className="space-y-1.5">
                    <Label>api 取数配置 fetch_config_json *（不经过连接层）</Label>
                    <ApiFetchEditor
                      value={form.fetch_config_json}
                      onChange={(j) => setForm({ ...form, fetch_config_json: j })}
                    />
                    <p className="text-xs text-muted-foreground">
                      URL / 方法 / 鉴权 / 分页 / 请求头结构化配置，与原始 JSON 实时互通；连接引用列显示 "—"
                    </p>
                  </div>
                )}
                {form.fetch_type === 'custom' && (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label>自定义拉取实现类 class *（全限定类名）</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 text-[12px]"
                          onClick={() =>
                            setForm({
                              ...form,
                              ft_class: CSV_DIR_FETCHER_CLASS,
                              ft_custom_json: JSON.stringify(CSV_DIR_TPL, null, 2),
                            })
                          }
                        >
                          内置示例：目录 CSV 账单拉取
                        </Button>
                      </div>
                      <Input
                        className="font-mono text-xs"
                        value={form.ft_class}
                        placeholder="com.mis.recon.custom.example.CsvDirFetcher"
                        onChange={(e) => setForm({ ...form, ft_class: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        保存时校验类可加载且实现 CustomFetcher 接口；窗口 / 分页 / 重试由实现类自理，不经过连接层
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>自定义参数 config_json（除 class 外键值原样传入）</Label>
                      <JsonParamEditor
                        value={form.ft_custom_json}
                        onChange={(j) => setForm({ ...form, ft_custom_json: j })}
                        templates={FETCH_TPL}
                      />
                    </div>
                  </>
                )}
              </TabsContent>

              {/* ---------- 字段映射（表格编辑器 + 生成器） ---------- */}
              <TabsContent value="fields" className="space-y-4 pt-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>字段映射 fields_json（表格编辑器）</Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={parseFromSql}>
                        <Wand2 className="mr-1 h-3.5 w-3.5" /> 从 SQL 解析
                      </Button>
                      <Button variant="outline" size="sm" onClick={addRow}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> 添加字段
                      </Button>
                    </div>
                  </div>
                  {form.rows.length === 0 ? (
                    <div className="rounded-md border border-dashed px-3 py-4 text-center text-[13px] text-muted-foreground">
                      尚未配置字段映射 —— 可先在「取数配置」页填拉取 SQL，再点「从 SQL 解析」自动生成
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-left text-[13px]">
                        <thead className="border-b bg-muted/50">
                          <tr>
                            <th className="px-2 py-1.5 font-medium">源字段名</th>
                            <th className="px-2 py-1.5 font-medium">台账字段名</th>
                            <th className="px-2 py-1.5 font-medium">注释</th>
                            <th className="w-16 px-2 py-1.5 font-medium">敏感</th>
                            <th className="w-10 px-2 py-1.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {form.rows.map((r, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="px-2 py-1">
                                <Input
                                  className="h-7 font-mono text-xs"
                                  value={r.source}
                                  placeholder="order_no"
                                  onChange={(e) => updateRow(i, { source: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Input
                                  className="h-7 font-mono text-xs"
                                  value={r.name}
                                  placeholder="order_no"
                                  onChange={(e) => updateRow(i, { name: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Input
                                  className="h-7 text-xs"
                                  value={r.annotation}
                                  placeholder="订单号"
                                  onChange={(e) => updateRow(i, { annotation: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1 text-center">
                                <Switch checked={r.is_sensitive} onCheckedChange={(v) => updateRow(i, { is_sensitive: v })} />
                              </td>
                              <td className="px-2 py-1 text-center">
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeRow(i)}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">敏感字段默认不落台账或只落哈希</p>
                </div>

                {/* record_key 勾选生成器 */}
                <div className="space-y-1.5 rounded-md border border-input bg-card px-3 py-2">
                  <Label>record_key 表达式 *（勾选源字段生成）</Label>
                  {fieldSourceOptions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">请先配置字段映射</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                        {fieldSourceOptions.map((s) => (
                          <label key={s} className="flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-xs">
                            <input
                              type="checkbox"
                              checked={form.rk_selected.includes(s)}
                              onChange={() => toggleRk(s)}
                            />
                            <span className="font-mono">{s}</span>
                          </label>
                        ))}
                      </div>
                      <select
                        className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                        value={form.rk_sep}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            rk_sep: e.target.value,
                            record_key_expression: f.rk_selected.map((x) => `{${x}}`).join(e.target.value),
                          }))
                        }
                      >
                        <option value="_">下划线（_）</option>
                        <option value="-">中划线（-）</option>
                        <option value="">无分隔</option>
                      </select>
                      <span className="font-mono text-xs text-primary">
                        {form.rk_selected.map((x) => `{${x}}`).join(form.rk_sep || '') || '—'}
                      </span>
                    </div>
                  )}
                </div>

                {/* time_field 动态下拉 */}
                <div className="space-y-1.5">
                  <Label>业务时间字段 time_field（写台账 record_time）</Label>
                  {fieldSourceOptions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">请先配置字段映射</p>
                  ) : (
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                      value={form.time_field}
                      onChange={(e) => setForm({ ...form, time_field: e.target.value })}
                    >
                      <option value="">未选择</option>
                      {fieldSourceOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </TabsContent>

              {/* ---------- 健康规则 / 金额 ---------- */}
              <TabsContent value="health" className="space-y-4 pt-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>行数同比波动 %</Label>
                    <Input
                      value={health.row_count_delta_pct}
                      onChange={(e) => setHealth({ ...health, row_count_delta_pct: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">低于阈值判质量降级（health_rules_json.row_count_delta_pct）</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>关键字段空值率</Label>
                    <Input
                      value={health.null_rate_threshold}
                      onChange={(e) => setHealth({ ...health, null_rate_threshold: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">如 0.05 = 5%（null_rate_threshold）</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>allow_empty 时段</Label>
                    <Input
                      className="font-mono text-xs"
                      value={health.allow_empty}
                      placeholder="00:00-06:00，留空=不启用"
                      onChange={(e) => setHealth({ ...health, allow_empty: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">命中时段内空窗口判健康</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>删除检测 deletion_detect</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                      value={health.deletion_detect}
                      onChange={(e) => setHealth({ ...health, deletion_detect: e.target.value })}
                    >
                      <option value="none">无（none）</option>
                      <option value="soft_delete_field">软删字段（soft_delete_field）</option>
                      <option value="window_absent">窗口缺失（window_absent）</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>金额声明 amount_fields_json（{'{field}: {unit, role}'}）</Label>
                  {amountRows.length === 0 && (
                    <Button variant="outline" size="sm" onClick={() => setAmountRows([{ field: '', unit: 'yuan', role: 'primary' }])}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> 添加金额字段
                    </Button>
                  )}
                  {amountRows.length > 0 && (
                    <div className="space-y-2">
                      {amountRows.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            className="h-8 font-mono text-xs"
                            placeholder="字段名，如 pay_amount"
                            value={r.field}
                            onChange={(e) =>
                              setAmountRows((arr) => arr.map((x, idx) => (idx === i ? { ...x, field: e.target.value } : x)))
                            }
                          />
                          <select
                            className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                            value={r.unit}
                            onChange={(e) =>
                              setAmountRows((arr) => arr.map((x, idx) => (idx === i ? { ...x, unit: e.target.value } : x)))
                            }
                          >
                            <option value="yuan">元（yuan）</option>
                            <option value="point">积分（point）</option>
                            <option value="non_monetary">非货币（non_monetary）</option>
                          </select>
                          <select
                            className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                            value={r.role}
                            onChange={(e) =>
                              setAmountRows((arr) => arr.map((x, idx) => (idx === i ? { ...x, role: e.target.value } : x)))
                            }
                          >
                            <option value="primary">主金额（primary）</option>
                            <option value="aux">辅助（aux）</option>
                          </select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setAmountRows((arr) => arr.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => setAmountRows((arr) => [...arr, { field: '', unit: 'yuan', role: 'aux' }])}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> 添加金额字段
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    primary 必须指向抵扣金额列；unit=point/non_monetary 不能作 primary（V33）
                  </p>
                </div>
              </TabsContent>
            </Tabs>
            {formError && <div className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{formError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <PermissionGate permission={P.DATASOURCE.WRITE}>
              <Button onClick={submit} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? '保存中…' : '保存'}
              </Button>
            </PermissionGate>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 手动拉取（可选窗口覆盖） */}
      <Dialog open={pullOpen} onOpenChange={setPullOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手动拉取 {pullDs}</DialogTitle>
            <DialogDescription>窗口留空=增量续拉（自动衔接上次成功窗口）；可指定 yyyy-MM-dd HH:mm:ss 覆盖</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <DateTimeInput
              label="开始时间"
              en="window_start"
              value={pullStart}
              onChange={setPullStart}
              note="留空=自动衔接上次成功窗口"
            />
            <DateTimeInput
              label="结束时间"
              en="window_end"
              value={pullEnd}
              onChange={setPullEnd}
              note="留空=当前时刻"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPullOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => pullMutation.mutate({ code: pullDs, start: pullStart, end: pullEnd })}
              disabled={pullMutation.isPending}
            >
              {pullMutation.isPending ? '提交中…' : '开始拉取'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 全部删除重拉（破坏性，确认弹窗） */}
      <Dialog open={rebuildOpen} onOpenChange={setRebuildOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">重建数据源 {rebuildDs}？</DialogTitle>
            <DialogDescription>
              将清空该数据源的台账、拉取水位，以及引用它的 check 的消费游标 / 配对索引 / 差异（含已处理记录），随后按窗口全量重拉。
              <br />
              <strong>破坏性操作，不可恢复</strong>。完成后需手动重跑受影响的对账场景。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <DateTimeInput
              label="开始时间"
              en="window_start"
              value={rebuildStart}
              onChange={setRebuildStart}
              note="留空=自动衔接（水位已清，回退初始窗口）"
            />
            <DateTimeInput
              label="结束时间"
              en="window_end"
              value={rebuildEnd}
              onChange={setRebuildEnd}
              note="留空=当前时刻"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRebuildOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => rebuildMutation.mutate({ code: rebuildDs, start: rebuildStart, end: rebuildEnd })}
              disabled={rebuildMutation.isPending}
            >
              {rebuildMutation.isPending ? '重建中…' : '确认删除并重拉'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
