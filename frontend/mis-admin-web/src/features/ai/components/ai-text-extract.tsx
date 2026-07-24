import { useMemo, useState, type ChangeEvent } from 'react';
import { Check, FileUp, Loader2, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useFormFillBridge } from '../context/form-fill-bridge';
import { useAI } from '../use-ai';
import { useAiContext } from '../ai-context';
import type { ExtractResponse, FieldSuggestion, FormFieldSchema } from '../types';

interface ExtractRequestBody {
  text?: string;
  docBase64?: string;
  fileName?: string;
  schema: { fields: FormFieldSchema[]; targetForm: string };
  context?: unknown;
}

function normalizeFieldValue(field: FormFieldSchema, value: unknown): unknown {
  if (field.type !== 'select' || !field.options?.length) return value;
  if (field.options.some((o) => String(o.value) === String(value))) return value;
  const byLabel = field.options.find((o) => o.label === String(value));
  return byLabel ? byLabel.value : value;
}

/**
 * UC-3 文本/文档抽取面板（内容区，由 AdminListPage 的 Sheet 承载）。
 * 强调纯文本/批量：粘贴大段文本或上传文档 → extract → 逐字段确认 → 回填当前表单（生成草稿）。
 */
export function AiTextExtract({ onClose }: { onClose: () => void }) {
  const bridge = useFormFillBridge();
  const aiCtx = useAiContext();
  const schema = bridge.getSchema();
  const schemaMap = useMemo(() => Object.fromEntries(schema.map((s) => [s.name, s])), [schema]);

  const [text, setText] = useState('');
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, FieldSuggestion>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [unmapped, setUnmapped] = useState<Array<{ raw: string; hint?: string }>>([]);

  const extract = useAI<ExtractRequestBody, ExtractResponse>({
    capability: 'extract',
    feature: 'text-extract',
    stream: false,
    request: { schema: { fields: [], targetForm: bridge.def.id } },
    onDone: (res) => {
      const r = res as ExtractResponse;
      if (!r || !r.fields) return;
      const conf = r.confidence;
      const threshold = aiCtx.getConfThreshold();
      const nextSugg: Record<string, FieldSuggestion> = {};
      const nextConf: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(r.fields)) {
        const field = schemaMap[k];
        if (!field) continue;
        const value = normalizeFieldValue(field, v);
        const c = typeof conf === 'number' ? conf : (conf[k] ?? 1);
        nextSugg[k] = { value, confidence: c };
        nextConf[k] = c >= threshold;
      }
      setSuggestions(nextSugg);
      setConfirmed(nextConf);
      setUnmapped(r.unmapped ?? []);
    },
    onError: (err) => {
      toast.error(`抽取失败：${err.message}`);
    },
  });

  const handleSend = () => {
    const content = text.trim();
    if (!content && !fileBase64) {
      toast.warning('请粘贴文本或上传文档');
      return;
    }
    setSuggestions({});
    setConfirmed({});
    setUnmapped([]);
    extract.run({
      request: {
        text: content || undefined,
        docBase64: fileBase64 ?? undefined,
        fileName: fileName ?? undefined,
        schema: { fields: schema, targetForm: bridge.def.id },
        context: aiCtx.getContext(),
      },
    });
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setFileBase64(String(reader.result).split(',')[1] ?? '');
      setFileName(file.name);
      toast.success(`已选择：${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const applyConfirmed = () => {
    const partial: Record<string, FieldSuggestion> = {};
    for (const [k, ok] of Object.entries(confirmed)) {
      if (ok && suggestions[k]) partial[k] = suggestions[k];
    }
    if (Object.keys(partial).length === 0) {
      toast.warning('请先确认至少一个字段');
      return;
    }
    bridge.applyFields(partial);
    toast.success(`已生成草稿并回填 ${Object.keys(partial).length} 个字段（保存需你确认）`);
    onClose();
  };

  const allKeys = Object.keys(suggestions);
  const confirmedCount = allKeys.filter((k) => confirmed[k]).length;
  const threshold = aiCtx.getConfThreshold();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <Sparkles className="h-4 w-4 text-primary" />
        <div>
          <div className="text-[1.05rem] font-semibold leading-none">智能录入 · {bridge.def.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            粘贴文本或上传文档，抽取为记录草稿后回填（保存需你确认）
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴大段非结构化文本（如从邮件 / 文档复制的合同、报销说明）…"
          className="min-h-[10rem]"
        />
        <div className="flex items-center gap-2">
          <input
            id="ai-te-file"
            type="file"
            className="hidden"
            onChange={onFile}
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.txt"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('ai-te-file')?.click()}>
            <FileUp className="h-4 w-4" /> 上传文档
          </Button>
          {fileName ? <span className="truncate text-xs text-muted-foreground">{fileName}</span> : null}
          <Button type="button" size="sm" className="ml-auto" onClick={handleSend} disabled={extract.loading}>
            {extract.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            抽取
          </Button>
        </div>

        {extract.loading ? <Skeleton className="h-28 w-full rounded-md" /> : null}
        {extract.error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {extract.error.message}
          </div>
        ) : null}

        {allKeys.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">抽取字段</span>
              <Badge variant="outline">
                {confirmedCount}/{allKeys.length} 已确认
              </Badge>
            </div>
            {allKeys.map((k) => {
              const field = schemaMap[k];
              const s = suggestions[k];
              const high = (s?.confidence ?? 0) >= threshold;
              return (
                <label
                  key={k}
                  className={cn(
                    'flex items-start gap-2 rounded-md border p-2.5 text-sm',
                    confirmed[k] ? 'border-primary/40 bg-primary/5' : high ? 'border-border' : 'border-warning/50 bg-warning/5',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!confirmed[k]}
                    onChange={(e) => setConfirmed((p) => ({ ...p, [k]: e.target.checked }))}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{field?.label ?? k}</span>
                      <Badge variant={high ? 'success' : 'warning'}>{Math.round((s?.confidence ?? 0) * 100)}%</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-muted-foreground">值：{String(s?.value ?? '')}</div>
                  </div>
                </label>
              );
            })}
            {unmapped.length > 0 ? (
              <div className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">未映射项（{unmapped.length}）</div>
                {unmapped.map((u, i) => (
                  <div key={i} className="truncate">
                    · {u.raw}
                    {u.hint ? `（${u.hint}）` : ''}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            抽取结果将在此预览，确认后回填为草稿。
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setConfirmed(Object.fromEntries(allKeys.map((k) => [k, true])))}
          disabled={!allKeys.length}
        >
          全选确认
        </Button>
        <Button type="button" onClick={applyConfirmed} disabled={!allKeys.length}>
          <Check className="h-4 w-4" /> 回填草稿 {confirmedCount > 0 ? `(${confirmedCount})` : ''}
        </Button>
      </div>
    </div>
  );
}
