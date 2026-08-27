import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
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
 * JSON 参数友好编辑器（原型 v6.3 / v6.4：键值对表格 + 模板 + 简单/高级双模式）。
 * <p>真值载体 = value（JSON 原文，受控）；键值表为友好层，编辑实时重建 JSON 写入 onChange。
 * 类型语义：string 原样（序列化带引号）/ number 转数值 / boolean 转 true·false / json 按对象解析。</p>
 */
export type JsonParamType = 'string' | 'number' | 'boolean' | 'json';

export interface JsonParamTemplate {
  label: string;
  json: string;
}

interface KvRow {
  key: string;
  type: JsonParamType;
  raw: string;
}

interface JsonParamEditorProps {
  /** JSON 原文真值（不含 class 键，由上层合并） */
  value: string;
  onChange: (json: string) => void;
  /** 模板下拉（可选） */
  templates?: JsonParamTemplate[];
  /** 紧凑模式（Tab C 行内展开面板） */
  compact?: boolean;
}

const TYPE_OPTIONS: { value: JsonParamType; label: string }[] = [
  { value: 'string', label: '字符串 string' },
  { value: 'number', label: '数字 number' },
  { value: 'boolean', label: '布尔 boolean' },
  { value: 'json', label: 'JSON json' },
];

/** 从 JSON 原文解析键值行（类型按值推断）；非法/空 → 1 空行 */
function initRows(value: string): KvRow[] {
  const t = value.trim();
  if (!t) return [{ key: '', type: 'string', raw: '' }];
  try {
    const obj = JSON.parse(t) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [{ key: '', type: 'string', raw: '' }];
    const rows = Object.entries(obj).map(([k, v]) => {
      if (v === null || v === undefined) return { key: k, type: 'string' as const, raw: '' };
      if (typeof v === 'number') return { key: k, type: 'number' as const, raw: String(v) };
      if (typeof v === 'boolean') return { key: k, type: 'boolean' as const, raw: String(v) };
      if (typeof v === 'object') return { key: k, type: 'json' as const, raw: JSON.stringify(v) };
      return { key: k, type: 'string' as const, raw: String(v) };
    });
    return rows.length ? rows : [{ key: '', type: 'string', raw: '' }];
  } catch {
    return [{ key: '', type: 'string', raw: '' }];
  }
}

/** 行值转换；非法返回哨兵 */
const INVALID = Symbol('invalid');
function toValue(r: KvRow): unknown | typeof INVALID {
  switch (r.type) {
    case 'string':
      return r.raw;
    case 'number': {
      const n = Number(r.raw.trim());
      return Number.isNaN(n) || r.raw.trim() === '' ? INVALID : n;
    }
    case 'boolean':
      if (r.raw.trim() === 'true') return true;
      if (r.raw.trim() === 'false') return false;
      return INVALID;
    case 'json': {
      try {
        return JSON.parse(r.raw);
      } catch {
        return INVALID;
      }
    }
  }
}

function typeErr(r: KvRow): string {
  return r.type === 'number'
    ? '数字格式非法'
    : r.type === 'boolean'
      ? '布尔值须填 true 或 false'
      : 'JSON 值格式错误';
}

export function JsonParamEditor({ value, onChange, templates, compact }: JsonParamEditorProps) {
  const [mode, setMode] = useState<'kv' | 'json'>('kv');
  const [rows, setRows] = useState<KvRow[]>(() => initRows(value));
  const [rowErrs, setRowErrs] = useState<Record<number, string>>({});
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  /* 外部 value 变化（模板/回显/切行）→ 重建键值表；自身编辑发出值不回建（防输入抖动） */
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setRows(initRows(value));
      setRowErrs({});
      lastEmitted.current = value;
    }
  }, [value]);

  /** KV 表 → 重建 JSON 写入真值（行错误拦截，非法不写入） */
  function emit() {
    const errs: Record<number, string> = {};
    const obj: Record<string, unknown> = {};
    let hasKey = false;
    rows.forEach((r, i) => {
      if (!r.key.trim()) return;
      hasKey = true;
      const v = toValue(r);
      if (v === INVALID) {
        errs[i] = typeErr(r);
        return;
      }
      obj[r.key.trim()] = v;
    });
    setRowErrs(errs);
    if (Object.keys(errs).length) return;
    // 无有效参数行保持现值（不误覆盖既有写入，原型 R58-4）
    if (!hasKey) return;
    const json = JSON.stringify(obj);
    lastEmitted.current = json;
    onChange(json);
  }

  function patchRow(i: number, p: Partial<KvRow>) {
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, { key: '', type: 'string', raw: '' }]);
  }

  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, k) => k !== i));
    setRowErrs((m) => {
      const n = { ...m };
      delete n[i];
      return n;
    });
  }

  /** 高级模式：格式化 */
  function format() {
    const t = value.trim();
    if (!t) return;
    try {
      onChange(JSON.stringify(JSON.parse(t), null, 2));
      setJsonErr(null);
    } catch {
      setJsonErr('非法 JSON，无法格式化');
    }
  }

  /** 高级模式：输入实时语法校验 */
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

  /** 切回简单模式：解析 textarea 回填表格 */
  function backToKv() {
    const next = initRows(value);
    setRows(next);
    setRowErrs({});
    if (value.trim() && next.length === 1 && next[0].key === '') {
      try {
        JSON.parse(value);
        setJsonErr(null);
      } catch {
        setJsonErr('非法 JSON，无法回填键值表');
        return;
      }
    }
    setJsonErr(null);
    setMode('kv');
  }

  function applyTemplate(json: string) {
    lastEmitted.current = json;
    setRows(initRows(json));
    setRowErrs({});
    onChange(json);
  }

  const inputCls = compact ? 'min-h-14 text-[12px]' : 'min-h-20 text-[13px]';

  return (
    <div className="space-y-2">
      {/* 工具条：模板 + 模式切换 */}
      <div className="flex flex-wrap items-center gap-2">
        {templates && templates.length > 0 && (
          <Select value="" onValueChange={(json) => applyTemplate(json)}>
            <SelectTrigger className="h-7 w-48 text-[12px]">
              <SelectValue placeholder="模板填充…" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.label} value={t.json}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {mode === 'kv' ? (
          <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setMode('json')}>
            高级（原始 JSON）
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={backToKv}>
              简单（键值对）
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={format}>
              格式化
            </Button>
          </>
        )}
      </div>

      {mode === 'kv' ? (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  className="w-40 font-mono text-[12px]"
                  placeholder="参数名"
                  value={r.key}
                  onChange={(e) => {
                    patchRow(i, { key: e.target.value });
                    emit();
                  }}
                />
                <Select
                  value={r.type}
                  onValueChange={(v) => {
                    patchRow(i, { type: v as JsonParamType });
                    emit();
                  }}
                >
                  <SelectTrigger className="w-40 text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="flex-1 font-mono text-[12px]"
                  placeholder={r.type === 'boolean' ? 'true / false' : r.type === 'json' ? '{"k":"v"}' : '参数值'}
                  value={r.raw}
                  onChange={(e) => {
                    patchRow(i, { raw: e.target.value });
                    emit();
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {rowErrs[i] && (
                <p className="text-[11px] text-destructive">✘ 参数行 {i + 1}（{r.key || '未命名'}）：{rowErrs[i]}</p>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={addRow}>
            <Plus className="mr-1 h-3.5 w-3.5" /> 添加参数
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          <textarea
            className={`w-full rounded-md border bg-card px-3 py-2 font-mono ${jsonErr ? 'border-destructive' : 'border-input'} ${inputCls}`}
            placeholder={'{\n  "参数键": "值"\n}'}
            value={value}
            onChange={(e) => onJsonInput(e.target.value)}
          />
          {jsonErr && <p className="text-[11px] text-destructive">✘ {jsonErr}</p>}
        </div>
      )}
    </div>
  );
}
