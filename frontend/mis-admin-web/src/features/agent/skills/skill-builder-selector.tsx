/**
 * 内嵌多选技能选择器（T04）。
 *
 * <p>数据源走 `listSkillsForBuilder`（GET /skills，前端过滤搜索），支持展开预览
 * body（GET /skills/{id}）、多选；确认后回传 `{skill_id,name,body}[]`，不离开创建流。
 */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  agentErrorMessage,
  type SkillBuilderSelection,
  type SkillSummary,
} from '../types';
import { getSkill } from '../api/agent-ops-api';
import { listSkillsForBuilder } from '../api/agent-chat-api';

export interface SkillBuilderSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 确认选择，回传已选技能的 id+name+body。 */
  onConfirm: (skills: SkillBuilderSelection[]) => void;
}

export function SkillBuilderSelector({
  open,
  onOpenChange,
  onConfirm,
}: SkillBuilderSelectorProps) {
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, SkillSummary>>({});
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // 打开时拉取列表并重置选择态
  useEffect(() => {
    if (!open) return;
    setKeyword('');
    setError(null);
    setChecked({});
    setPreviewId(null);
    setPreviewBody(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const list = await listSkillsForBuilder();
      setItems(list);
    } catch (e) {
      setError(agentErrorMessage(e, '加载技能列表失败'));
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter(
      (s) =>
        s.skill_id.toLowerCase().includes(kw) ||
        s.name.toLowerCase().includes(kw) ||
        (s.description ?? '').toLowerCase().includes(kw),
    );
  }, [items, keyword]);

  async function togglePreview(id: string): Promise<void> {
    if (previewId === id) {
      setPreviewId(null);
      setPreviewBody(null);
      return;
    }
    setPreviewing(true);
    setPreviewId(id);
    setPreviewBody(null);
    try {
      const detail = await getSkill(id);
      setPreviewBody((detail as { body?: string }).body ?? '（无正文）');
    } catch {
      setPreviewBody('（正文加载失败）');
    } finally {
      setPreviewing(false);
    }
  }

  function toggleCheck(s: SkillSummary): void {
    setChecked((prev) => {
      const next = { ...prev };
      if (next[s.skill_id]) delete next[s.skill_id];
      else next[s.skill_id] = s;
      return next;
    });
  }

  const selectedList = Object.values(checked);

  async function handleConfirm(): Promise<void> {
    // 逐个补取正文（未展开预览的也确保带上 body），供后续注入用户消息
    const payload: SkillBuilderSelection[] = await Promise.all(
      selectedList.map(async (s) => {
        let body = previewId === s.skill_id && previewBody ? previewBody : '';
        if (!body) {
          try {
            const detail = await getSkill(s.skill_id);
            body = (detail as { body?: string }).body ?? '';
          } catch {
            body = '';
          }
        }
        return { skill_id: s.skill_id, name: s.name, body };
      }),
    );
    onConfirm(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl">
        <DialogHeader>
          <DialogTitle>选择现有技能（参考 / 合并生成）</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            placeholder="搜索技能 ID / 名称 / 描述"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            刷新
          </Button>
        </div>

        {error ? (
          <p
            className={cn(
              'rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive',
            )}
          >
            {error}
          </p>
        ) : null}

        <div
          className="flex-1 overflow-auto rounded-md border bg-muted/20 p-2"
          style={{ maxHeight: '48vh' }}
        >
          {loading ? (
            <p className="p-3 text-sm text-muted-foreground">加载中…</p>
          ) : filtered.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">未找到技能。</p>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((s) => (
                <li key={s.skill_id} className="rounded border bg-card p-2">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-primary"
                      checked={Boolean(checked[s.skill_id])}
                      onChange={() => toggleCheck(s)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{s.name}</span>
                        <button
                          type="button"
                          className="shrink-0 text-xs text-primary hover:underline"
                          onClick={() => void togglePreview(s.skill_id)}
                        >
                          {previewId === s.skill_id ? '收起' : '预览'}
                        </button>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{s.skill_id}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {s.description}
                      </p>
                      {previewId === s.skill_id ? (
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-xs">
                          {previewing ? '加载中…' : previewBody ?? ''}
                        </pre>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="justify-between">
          <span className="text-xs text-muted-foreground">已选 {selectedList.length} 个</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={() => void handleConfirm()} disabled={selectedList.length === 0}>
              确认选择
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
