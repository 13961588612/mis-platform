import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';

/**
 * api 取数配置友好编辑器（fetch_type=api，取数层需求规格 §3.1）。
 * <p>结构化表单默认展示，实时重建 JSON 写入真值；高级模式可切回原始 JSON（语法校验 + 格式化），
 * 两模式内容互通、互不丢失。</p>
 * 生成结构（取数层需求规格 §3.1 权威口径）：
 * <pre>{@code
 * {
 *   "url": "https://gw.example.com/bills?start={time_start}&end={time_end}",
 *   "method": "GET",
 *   "headers": { "Authorization": "Bearer ${BANK_API_TOKEN}" },   // ${ENV} 环境变量占位，不落库明文
 *   "page": { "mode": "cursor", "cursor_param": "cursor", "cursor_path": "$.data.next_cursor", "size_param": "limit", "size": 500 },
 *   "data_path": "$.data.list",
 *   "retry": { "max": 3, "backoff_ms": 2000 },
 *   "rate_limit_qps": 5,
 *   "fetch_one_url": "...", "fetch_one_params": { "key": "{record_key}" }   // 可选
 * }
 * }</pre>
 */
interface Row {
  name: string;
  value: string;
}

interface ApiState {
  url: string;
  method: string; // GET / POST
  headers: Row[];
  pageMode: string; // cursor / page_no
  cursorParam: string;
  cursorPath: string;
  sizeParam: string;
  size: string;
  dataPath: string;
  retryMax: string;
  retryBackoffMs: string;
  rateLimitQps: string;
  fetchOneUrl: string;
  fetchOneParams: Row[];
}

const EMPTY_STATE: ApiState = {
  url: '',
  method: 'GET',
  headers: [],
  pageMode: 'cursor',
  cursorParam: 'cursor',
  cursorPath: '$.data.next_cursor',
  sizeParam: 'limit',
  size: '500',
  dataPath: '$.data.list',
  retryMax: '3',
  retryBackoffMs: '2000',
  rateLimitQps: '',
  fetchOneUrl: '',
  fetchOneParams: [],
};

function rowsFrom(o: Record<string, unknown> | undefined): Row[] {
  if (!o) return [];
  return Object.entries(o).map(([name, v]) => ({ name, value: String(v ?? '') }));
}

function rowsTo(o: Row[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const r of o) {
    if (r.name.trim()) out[r.name.trim()] = r.value;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseApi(value: string): ApiState {
  if (!value.trim()) return EMPTY_STATE;
  try {
    const o = JSON.parse(value) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return EMPTY_STATE;
    const page = (o.page ?? {}) as Record<string, unknown>;
    const retry = (o.retry ?? {}) as Record<string, unknown>;
    const size = Number(page.size);
    return {
      url: String(o.url ?? ''),
      method: String(o.method ?? 'GET').toUpperCase(),
      headers: rowsFrom(o.headers as Record<string, unknown> | undefined),
      pageMode: String(page.mode ?? 'cursor'),
      cursorParam: String(page.cursor_param ?? 'cursor'),
      cursorPath: String(page.cursor_path ?? ''),
      sizeParam: String(page.size_param ?? 'limit'),
      size: Number.isNaN(size) ? '' : String(size),
      dataPath: String(o.data_path ?? ''),
      retryMax: retry.max != null ? String(retry.max) : '',
      retryBackoffMs: retry.backoff_ms != null ? String(retry.backoff_ms) : '',
      rateLimitQps: o.rate_limit_qps != null ? String(o.rate_limit_qps) : '',
      fetchOneUrl: String(o.fetch_one_url ?? ''),
      fetchOneParams: rowsFrom(o.fetch_one_params as Record<string, unknown> | undefined),
    };
  } catch {
    return EMPTY_STATE;
  }
}

function buildApiJson(s: ApiState): string {
  const o: Record<string, unknown> = { url: s.url.trim(), method: s.method || 'GET' };
  const headers = rowsTo(s.headers);
  if (headers) o.headers = headers;
  const page: Record<string, unknown> = { mode: s.pageMode };
  if (s.pageMode === 'cursor') {
    page.cursor_param = s.cursorParam.trim() || 'cursor';
    if (s.cursorPath.trim()) page.cursor_path = s.cursorPath.trim();
  }
  if (s.sizeParam.trim()) page.size_param = s.sizeParam.trim();
  const size = Number(s.size);
  if (s.size.trim() && !Number.isNaN(size)) page.size = size;
  o.page = page;
  if (s.dataPath.trim()) o.data_path = s.dataPath.trim();
  const rm = Number(s.retryMax);
  if (s.retryMax.trim() && !Number.isNaN(rm)) {
    const retry: Record<string, unknown> = { max: rm };
    const rb = Number(s.retryBackoffMs);
    if (s.retryBackoffMs.trim() && !Number.isNaN(rb)) retry.backoff_ms = rb;
    o.retry = retry;
  }
  const qps = Number(s.rateLimitQps);
  if (s.rateLimitQps.trim() && !Number.isNaN(qps)) o.rate_limit_qps = qps;
  if (s.fetchOneUrl.trim()) {
    o.fetch_one_url = s.fetchOneUrl.trim();
    const p = rowsTo(s.fetchOneParams);
    if (p) o.fetch_one_params = p;
  }
  return JSON.stringify(o);
}

export function ApiFetchEditor({ value, onChange }: { value: string; onChange: (json: string) => void }) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [s, setS] = useState<ApiState>(() => parseApi(value));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [urlErr, setUrlErr] = useState(false);
  const [windowErr, setWindowErr] = useState(false);
  const lastEmitted = useRef(value);

  /* 外部 value 变化（回显/切行/高级模式写入）→ 重建表单；自身编辑不回建（防输入抖动） */
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setS(parseApi(value));
      setJsonErr(null);
      lastEmitted.current = value;
    }
  }, [value]);

  function emit(next: ApiState) {
    setS(next);
    const u = next.url.trim();
    setUrlErr(!u);
    setWindowErr(!u.includes('{time_start}') || !u.includes('{time_end}'));
    const json = buildApiJson(next);
    lastEmitted.current = json;
    onChange(json);
  }

  function patch(p: Partial<ApiState>) {
    emit({ ...s, ...p });
  }

  /* 高级模式：格式化 / 实时语法校验 */
  function format() {
    if (!value.trim()) return;
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
      setJsonErr(null);
    } catch {
      setJsonErr('非法 JSON，无法格式化');
    }
  }
  function onJsonInput(j: string) {
    onChange(j);
    if (!j.trim()) {
      setJsonErr(null);
      return;
    }
    try {
      JSON.parse(j);
      setJsonErr(null);
    } catch {
      setJsonErr('非法 JSON');
    }
  }
  function backToForm() {
    const next = parseApi(value);
    setS(next);
    setJsonErr(null);
    setMode('form');
  }

  /* 演示模板：通用 HTTP + cursor 分页（对齐取数层需求规格 §3.1），一键填入 */
  function fillDemo() {
    emit({
      url: 'https://gw.example.com/bills?start={time_start}&end={time_end}',
      method: 'GET',
      headers: [{ name: 'Authorization', value: 'Bearer ${BANK_API_TOKEN}' }],
      pageMode: 'cursor',
      cursorParam: 'cursor',
      cursorPath: '$.data.next_cursor',
      sizeParam: 'limit',
      size: '500',
      dataPath: '$.data.list',
      retryMax: '3',
      retryBackoffMs: '2000',
      rateLimitQps: '5',
      fetchOneUrl: '',
      fetchOneParams: [],
    });
  }

  const compactCls = 'h-8 text-[12px]';

  return (
    <div className="space-y-3">
      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'form' ? (
          <>
            <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={fillDemo}>
              演示模板
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setMode('json')}>
              高级（原始 JSON）
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={backToForm}>
              简单（表单）
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={format}>
              格式化
            </Button>
          </>
        )}
      </div>

      {mode === 'form' ? (
        <>
          {/* 基础：url + method */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-[12px]">
                接口地址 url <span className="text-destructive">*</span>
              </Label>
              <Input
                className={`h-8 font-mono text-[12px] ${urlErr || windowErr ? 'border-destructive' : ''}`}
                placeholder="https://gw.example.com/bills?start={time_start}&end={time_end}"
                value={s.url}
                onChange={(e) => patch({ url: e.target.value })}
              />
              {urlErr && <p className="text-[11px] text-destructive">✘ 接口地址必填</p>}
              {!urlErr && windowErr && (
                <p className="text-[11px] text-destructive">
                  ✘ url 必须含 {`{time_start}`}/{`{time_end}`} 窗口占位符（防静默全量拉取）
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">请求方法 method</Label>
              <Select value={s.method} onValueChange={(v) => patch({ method: v })}>
                <SelectTrigger className={compactCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 请求头 headers（${ENV} 环境变量占位） */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">请求头 headers（鉴权走 {'${ENV}'} 环境变量占位，不落库明文）</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[12px]"
                onClick={() => patch({ headers: [...s.headers, { name: '', value: '' }] })}
              >
                <Plus className="mr-1 h-3 w-3" /> 添加
              </Button>
            </div>
            {s.headers.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                无自定义请求头；鉴权示例：Authorization = Bearer {'${BANK_API_TOKEN}'}
              </p>
            ) : (
              <div className="space-y-1.5">
                {s.headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="h-7 w-48 font-mono text-[12px]"
                      placeholder="Header 名（如 Authorization）"
                      value={h.name}
                      onChange={(e) =>
                        patch({ headers: s.headers.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })
                      }
                    />
                    <Input
                      className="h-7 flex-1 font-mono text-[12px]"
                      placeholder="值（如 Bearer ${BANK_API_TOKEN}）"
                      value={h.value}
                      onChange={(e) =>
                        patch({ headers: s.headers.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => patch({ headers: s.headers.filter((_, k) => k !== i) })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 分页 page */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">分页 page</Label>
            <div className="rounded-md border border-dashed bg-card/60 p-2 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[12px]">模式 mode</Label>
                  <Select value={s.pageMode} onValueChange={(v) => patch({ pageMode: v })}>
                    <SelectTrigger className={compactCls}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cursor">游标（cursor）</SelectItem>
                      <SelectItem value="page_no">页码（page_no）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">每页参数名 size_param</Label>
                  <Input
                    className="h-8 font-mono text-[12px]"
                    placeholder="limit"
                    value={s.sizeParam}
                    onChange={(e) => patch({ sizeParam: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">每页大小 size</Label>
                  <Input
                    className="h-8 font-mono text-[12px]"
                    value={s.size}
                    onChange={(e) => patch({ size: e.target.value })}
                  />
                </div>
              </div>
              {s.pageMode === 'cursor' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[12px]">游标参数名 cursor_param *</Label>
                    <Input
                      className="h-8 font-mono text-[12px]"
                      placeholder="cursor"
                      value={s.cursorParam}
                      onChange={(e) => patch({ cursorParam: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[12px]">下一页游标路径 cursor_path *</Label>
                    <Input
                      className="h-8 font-mono text-[12px]"
                      placeholder="$.data.next_cursor"
                      value={s.cursorPath}
                      onChange={(e) => patch({ cursorPath: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* data_path */}
          <div className="space-y-1">
            <Label className="text-[12px]">响应数组定位 data_path</Label>
            <Input
              className="h-8 font-mono text-[12px]"
              placeholder="$.data.list（留空按响应体整体为数组）"
              value={s.dataPath}
              onChange={(e) => patch({ dataPath: e.target.value })}
            />
          </div>

          {/* 重试 / 限速 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-[12px]">重试次数 retry.max</Label>
              <Input
                className="h-8 font-mono text-[12px]"
                value={s.retryMax}
                onChange={(e) => patch({ retryMax: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">退避基数 retry.backoff_ms</Label>
              <Input
                className="h-8 font-mono text-[12px]"
                value={s.retryBackoffMs}
                onChange={(e) => patch({ retryBackoffMs: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">限速 rate_limit_qps</Label>
              <Input
                className="h-8 font-mono text-[12px]"
                placeholder="留空不限制"
                value={s.rateLimitQps}
                onChange={(e) => patch({ rateLimitQps: e.target.value })}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">重试指数退避（backoff_ms × 2ⁿ，仅网络异常与 429/5xx）；限速防触发源端风控</p>

          {/* fetch_one（可选） */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">单条重拉 fetch_one（可选）</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[12px]"
                onClick={() => patch({ fetchOneParams: [...s.fetchOneParams, { name: '', value: '' }] })}
              >
                <Plus className="mr-1 h-3 w-3" /> 添加参数
              </Button>
            </div>
            <div className="space-y-1">
              <Input
                className="h-8 font-mono text-[12px]"
                placeholder="fetch_one_url：.../bills?key={record_key}（{record_key} 占位）"
                value={s.fetchOneUrl}
                onChange={(e) => patch({ fetchOneUrl: e.target.value })}
              />
            </div>
            {s.fetchOneParams.length > 0 && (
              <div className="space-y-1.5">
                {s.fetchOneParams.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="h-7 w-48 font-mono text-[12px]"
                      placeholder="参数名"
                      value={p.name}
                      onChange={(e) =>
                        patch({ fetchOneParams: s.fetchOneParams.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })
                      }
                    />
                    <Input
                      className="h-7 flex-1 font-mono text-[12px]"
                      placeholder="参数值"
                      value={p.value}
                      onChange={(e) =>
                        patch({ fetchOneParams: s.fetchOneParams.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => patch({ fetchOneParams: s.fetchOneParams.filter((_, k) => k !== i) })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              未配置时单条重拉走 backfill（与 db 未配 fetch_one_sql 行为一致）
            </p>
          </div>
        </>
      ) : (
        <div className="space-y-1">
          <textarea
            className={`min-h-32 w-full rounded-md border bg-card px-3 py-2 font-mono text-[12px] ${jsonErr ? 'border-destructive' : 'border-input'}`}
            placeholder={'{\n  "url": "https://gw.example.com/bills?start={time_start}&end={time_end}"\n}'}
            value={value}
            onChange={(e) => onJsonInput(e.target.value)}
          />
          {jsonErr && <p className="text-[11px] text-destructive">✘ {jsonErr}</p>}
        </div>
      )}
    </div>
  );
}
