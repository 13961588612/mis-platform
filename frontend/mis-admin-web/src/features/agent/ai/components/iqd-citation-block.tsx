/**
 * iqd-citation-block.tsx — 问数引用来源渲染块（T-W1-02 / B2）。
 *
 * <p>Worker（mis-iqd）编排链会把引用序列化进助手 Markdown 的
 * {@code ```iqd-citations ... ```} 围栏；本组件负责：
 * <ol>
 *   <li>从助手正文中剥出围栏（{@link splitIqdCitations}，与 kb-chat-sources 同款口径）</li>
 *   <li>以折叠列表渲染 citations[]（kind 徽标 + item_key + display_name + snippet）</li>
 * </ol>
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface IqdCitation {
  kind: string;
  item_key: string;
  display_name?: string | null;
  description?: string | null;
  snippet?: string | null;
  source_ref?: string | null;
}

const CITATION_FENCE_RE = /```iqd-citations\s*\n([\s\S]*?)\n```/i;

/** 从助手 Markdown 中剥出引用围栏。 */
export function splitIqdCitations(content: string): { body: string; citations: IqdCitation[] } {
  const text = content ?? '';
  const fence = text.match(CITATION_FENCE_RE);
  if (!fence) {
    return { body: text, citations: [] };
  }
  return {
    body: text.replace(fence[0], '').replace(/\n{3,}/g, '\n\n').trimEnd(),
    citations: parseCitationPayload(fence[1]),
  };
}

function parseCitationPayload(raw: string): IqdCitation[] {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (!Array.isArray(parsed)) return [];
    const citations: IqdCitation[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const itemKey = String(rec.item_key ?? rec.itemKey ?? '').trim();
      const displayName = String(rec.display_name ?? rec.displayName ?? '').trim();
      if (!itemKey && !displayName) continue;
      citations.push({
        kind: String(rec.kind ?? 'table').trim(),
        item_key: itemKey,
        display_name: displayName || itemKey,
        description: typeof rec.description === 'string' && rec.description.trim() ? rec.description : null,
        snippet: typeof rec.snippet === 'string' && rec.snippet.trim() ? rec.snippet : null,
        source_ref: typeof rec.source_ref === 'string' && rec.source_ref.trim() ? rec.source_ref : null,
      });
    }
    return citations;
  } catch {
    return [];
  }
}

const KIND_LABEL: Record<string, string> = {
  table: '表',
  column: '列',
  model: '模型',
  metric: '指标',
  dimension: '维度',
  knowledge: '知识',
};

/**
 * 问数引用来源折叠列表。
 */
export function IqdCitationBlock({ citations }: { citations: IqdCitation[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          if (open) setActive(null);
        }}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="font-medium text-foreground/80">引用 · {citations.length} 项</span>
        <span>{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <ul className="mt-1 space-y-1">
          {citations.map((citation, index) => {
            const selected = active === index;
            const kindLabel = KIND_LABEL[citation.kind] ?? citation.kind;
            return (
              <li key={`${citation.kind}-${citation.item_key}-${index}`}>
                <button
                  type="button"
                  onClick={() => setActive(selected ? null : index)}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                    selected ? 'bg-secondary' : 'hover:bg-secondary/50',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 leading-relaxed">
                      <span className="mr-1 text-muted-foreground">{index + 1}.</span>
                      <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        {kindLabel}
                      </span>
                      <span className="ml-1.5 font-medium text-foreground/90">{citation.display_name}</span>
                      {citation.item_key && citation.item_key !== citation.display_name ? (
                        <code className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                          {citation.item_key}
                        </code>
                      ) : null}
                    </span>
                  </div>
                  {selected ? (
                    <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5 text-muted-foreground">
                      {citation.description ? (
                        <p className="leading-relaxed text-foreground/80">{citation.description}</p>
                      ) : null}
                      {citation.snippet ? (
                        <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground/80">
                          {citation.snippet}
                        </p>
                      ) : null}
                      {citation.source_ref ? (
                        <p className="text-[11px]">{citation.source_ref}</p>
                      ) : null}
                    </div>
                  ) : citation.snippet ? (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{citation.snippet}</p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default IqdCitationBlock;
