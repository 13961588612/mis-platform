import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KbChatSource {
  source: string;
  score?: number | null;
  chunk?: string;
  page?: number | null;
  offset?: number | null;
}

const FENCE_RE = /```kb-sources\s*\n([\s\S]*?)\n```/i;
const LEGACY_RE = /\n+来源：\s*\n((?:\d+\.\s+.+\n?)+)\s*$/;
const LEGACY_LINE_RE = /^\d+\.\s+(.+?)(?:（相关度\s*([\d.]+)）)?\s*$/;

/** 从助手 Markdown 中剥出来源围栏 / 旧版「来源：」列表。 */
export function splitKbSources(content: string): { body: string; sources: KbChatSource[] } {
  const text = content ?? '';
  const fenceStart = text.lastIndexOf('```kb-sources');
  const fence = text.match(FENCE_RE);
  if (fenceStart >= 0 && !fence) {
    return { body: text.slice(0, fenceStart).trimEnd(), sources: [] };
  }
  if (fence) {
    return {
      body: text.replace(fence[0], '').replace(/\n{3,}/g, '\n\n').trimEnd(),
      sources: parseFencePayload(fence[1]),
    };
  }
  const legacy = text.match(LEGACY_RE);
  if (legacy && legacy.index != null) {
    return {
      body: text.slice(0, legacy.index).trimEnd(),
      sources: parseLegacyList(legacy[1]),
    };
  }
  return { body: text, sources: [] };
}

function parseFencePayload(raw: string): KbChatSource[] {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (!Array.isArray(parsed)) return [];
    const sources: KbChatSource[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const source = String(rec.source ?? rec.title ?? '').trim();
      if (!source) continue;
      const chunkRaw = rec.chunk ?? rec.chunkText ?? rec.chunk_text;
      sources.push({
        source,
        score: toFiniteNumber(rec.score),
        chunk: typeof chunkRaw === 'string' && chunkRaw.trim() ? chunkRaw : undefined,
        page: toFiniteNumber(rec.page),
        offset: toFiniteNumber(rec.offset),
      });
    }
    return sources;
  } catch {
    return [];
  }
}

function parseLegacyList(block: string): KbChatSource[] {
  const sources: KbChatSource[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(LEGACY_LINE_RE);
    if (!m) continue;
    sources.push({ source: m[1].trim(), score: m[2] != null ? toFiniteNumber(m[2]) : null });
  }
  return sources;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatScore(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  const pct = score > 1 ? score : score * 100;
  return `${pct.toFixed(1)}%`;
}

/**
 * 对话里的知识库来源：默认收成一行，展开后点条目看片段。
 */
export function KbChatSourceList({ sources }: { sources: KbChatSource[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  if (sources.length === 0) return null;

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
        <span className="font-medium text-foreground/80">来源 · {sources.length} 篇</span>
        <span>{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <ul className="mt-1 space-y-1">
          {sources.map((source, index) => {
            const selected = active === index;
            const score = formatScore(source.score);
            const loc = [
              source.page != null ? `第 ${source.page} 页` : null,
              source.offset != null ? `偏移 ${source.offset}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={`${source.source}-${index}`}>
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
                      {source.source}
                    </span>
                    {score ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground">{score}</span>
                    ) : null}
                  </div>
                  {selected ? (
                    <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5 text-muted-foreground">
                      {loc ? <p className="text-[11px]">{loc}</p> : null}
                      <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground/80">
                        {source.chunk?.trim() || '（无片段原文）'}
                      </p>
                    </div>
                  ) : source.chunk ? (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{source.chunk}</p>
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
