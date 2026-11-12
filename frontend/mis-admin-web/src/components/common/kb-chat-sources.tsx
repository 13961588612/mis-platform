import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchDocumentChunkImage } from '@/features/kb/api/kb-api';

export interface KbChatSource {
  source: string;
  score?: number | null;
  chunk?: string;
  page?: number | null;
  offset?: number | null;
  libraryId?: number | null;
  documentId?: number | null;
  imageId?: string | null;
  /** 检索/引用序号（对齐 LLM 正文里的 Fig. N） */
  index?: number | null;
}

const FENCE_OPEN_RE = /```\s*kb-sources\b/gi;
/** 闭合围栏：允许 info 行空白、CRLF、闭合前可选换行（兼容流式拼接毛刺）。 */
const FENCE_CLOSED_RE =
  /^```\s*kb-sources\b[^\n]*\r?\n([\s\S]*?)(?:\r?\n)?[ \t]*```/i;
const LEGACY_RE = /\n+来源：\s*\n((?:\d+\.\s+.+\n?)+)\s*$/;
const LEGACY_LINE_RE = /^\d+\.\s+(.+?)(?:（相关度\s*([\d.]+)）)?\s*$/;

/** 定位最后一次 kb-sources 开围栏（允许 ``` 与语言标记之间有空白）。 */
function findLastKbSourcesOpen(text: string): number {
  FENCE_OPEN_RE.lastIndex = 0;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = FENCE_OPEN_RE.exec(text)) != null) {
    last = m.index;
  }
  return last;
}

/** 从助手 Markdown 中剥出来源围栏 / 旧版「来源：」列表。 */
export function splitKbSources(content: string): { body: string; sources: KbChatSource[] } {
  const text = normalizeFenceText(content ?? '');
  const fences = findAllKbSourcesFences(text);
  if (fences.length > 0) {
    // 多段围栏时优先带 chunk 的（模型瘦身后又被 pending 补全的场景）
    const chosen =
      [...fences].reverse().find((f) => f.sources.some((s) => Boolean(s.chunk?.trim()))) ??
      fences[fences.length - 1]!;
    const body = stripAllKbSourcesFences(text)
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
    return { body, sources: chosen.sources };
  }

  const openIdx = findLastKbSourcesOpen(text);
  if (openIdx >= 0) {
    // 流式未闭合：正文隐藏围栏起至末尾，避免 JSON 闪现
    return { body: text.slice(0, openIdx).trimEnd(), sources: [] };
  }

  // 兜底：模型有时只贴 JSON 数组、无围栏（或用 ```json）
  const bare = matchBareSourcesJson(text);
  if (bare) return bare;

  const legacy = text.match(LEGACY_RE);
  if (legacy && legacy.index != null) {
    return {
      body: text.slice(0, legacy.index).trimEnd(),
      sources: parseLegacyList(legacy[1]),
    };
  }
  return { body: text, sources: [] };
}

/** 找出文中全部已闭合的 kb-sources 围栏。 */
function findAllKbSourcesFences(
  text: string,
): Array<{ start: number; end: number; sources: KbChatSource[] }> {
  const out: Array<{ start: number; end: number; sources: KbChatSource[] }> = [];
  FENCE_OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_OPEN_RE.exec(text)) != null) {
    const after = text.slice(m.index);
    const closed = after.match(FENCE_CLOSED_RE);
    if (!closed) continue;
    out.push({
      start: m.index,
      end: m.index + closed[0].length,
      sources: parseFencePayload(closed[1]),
    });
    FENCE_OPEN_RE.lastIndex = m.index + closed[0].length;
  }
  return out;
}

/** 去掉全部已闭合 kb-sources 围栏（保留正文）。 */
function stripAllKbSourcesFences(text: string): string {
  return text.replace(
    /```\s*kb-sources\b[^\n]*\r?\n[\s\S]*?(?:\r?\n)?[ \t]*```/gi,
    '',
  );
}

/** 统一换行；字面 \\n 过多时还原为真换行。 */
function normalizeFenceText(raw: string): string {
  let out = raw.replace(/\r\n/g, '\n');
  const realNl = (out.match(/\n/g) ?? []).length;
  const litNl = (out.match(/\\n/g) ?? []).length;
  if (litNl > 0 && litNl >= realNl) {
    out = out.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  return out;
}

/**
 * 无 kb-sources 围栏时：正文末尾的 JSON 数组（含 source 字段）或 ```json 围栏。
 */
function matchBareSourcesJson(text: string): { body: string; sources: KbChatSource[] } | null {
  const jsonFence = text.match(/\n*```(?:json)?\s*\n(\[[\s\S]*?\])\s*\n```\s*$/i);
  if (jsonFence && jsonFence.index != null) {
    const sources = parseFencePayload(jsonFence[1]);
    if (sources.length > 0) {
      return { body: text.slice(0, jsonFence.index).trimEnd(), sources };
    }
  }
  // 末尾独立 JSON 数组
  const bareIdx = text.lastIndexOf('\n[');
  if (bareIdx >= 0) {
    const candidate = text.slice(bareIdx + 1).trim();
    if (candidate.startsWith('[') && candidate.includes('"source"')) {
      const sources = parseFencePayload(candidate);
      if (sources.length > 0) {
        return { body: text.slice(0, bareIdx).trimEnd(), sources };
      }
    }
  }
  return null;
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
      const imageIdRaw = rec.imageId ?? rec.image_id;
      const imageId =
        typeof imageIdRaw === 'string' && imageIdRaw.trim() ? imageIdRaw.trim() : undefined;
      if (!source && !imageId) continue;
      const chunkRaw = rec.chunk ?? rec.chunkText ?? rec.chunk_text;
      const figIndex = toFiniteNumber(rec.index);
      sources.push({
        source: source || (imageId ? `配图 ${figIndex ?? sources.length + 1}` : '未知来源'),
        score: toFiniteNumber(rec.score),
        chunk: typeof chunkRaw === 'string' && chunkRaw.trim() ? chunkRaw : undefined,
        page: toFiniteNumber(rec.page),
        offset: toFiniteNumber(rec.offset),
        libraryId: toFiniteNumber(rec.libraryId ?? rec.library_id),
        documentId: toFiniteNumber(rec.documentId ?? rec.document_id),
        imageId,
        index: figIndex,
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

/** LLM 常把来源写成静态「条款来源 / 来源文档」文案（无 kb-sources 围栏）。 */
export function isStaticKbSourceStub(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 1200) return false;
  if (/```\s*kb-sources\b/i.test(t)) return false;
  return /(?:条款来源|资料来源|引用源|📚\s*来源|来源文档\s*[:：])/i.test(t);
}

/** 从静态来源文案解析文档名（无 score/chunk 时仍可展开占位）。 */
export function parseStaticKbSourceStub(text: string): KbChatSource[] {
  const sources: KbChatSource[] = [];
  const seen = new Set<string>();
  const push = (name: string): void => {
    const n = name.replace(/^[\s*·\-–—]+/, '').trim();
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    sources.push({ source: n });
  };

  for (const m of text.matchAll(/来源文档\s*[:：]\s*(.+)/gi)) {
    push(m[1].split(/\n/)[0] ?? '');
  }
  if (sources.length > 0) return sources;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /条款来源|资料来源|📚/.test(trimmed)) continue;
    const doc = trimmed.match(/^(?:\d+\.\s*)?(?:📄\s*)?(.+\.(?:docx?|pdf|xlsx?|md|txt))\s*$/i);
    if (doc) push(doc[1]);
    else if (/^来源\s*[:：]/.test(trimmed)) push(trimmed.replace(/^来源\s*[:：]\s*/, ''));
  }
  return sources;
}

/** 合并多路来源；同名合并字段，空 chunk 不得覆盖已有片段。 */
export function mergeKbSources(...lists: KbChatSource[][]): KbChatSource[] {
  const map = new Map<string, KbChatSource>();
  for (const list of lists) {
    for (const s of list) {
      const key = s.source.trim().toLowerCase() || `anon-${map.size}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...s });
        continue;
      }
      map.set(key, {
        source: s.source || prev.source,
        score: s.score ?? prev.score,
        chunk: s.chunk?.trim() ? s.chunk : prev.chunk,
        page: s.page ?? prev.page,
        offset: s.offset ?? prev.offset,
        libraryId: s.libraryId ?? prev.libraryId,
        documentId: s.documentId ?? prev.documentId,
        imageId: s.imageId ?? prev.imageId,
        index: s.index ?? prev.index,
      });
    }
  }
  return [...map.values()];
}

/** 从 A2UI 组件树抽取文本（text 节点的 content/text/label/value）。 */
export function collectA2uiTextContents(
  nodes: Array<{ component?: string; props?: Record<string, unknown>; children?: unknown[] }>,
): string[] {
  const out: string[] = [];
  const walk = (list: typeof nodes): void => {
    for (const node of list) {
      if (!node || typeof node !== 'object') continue;
      if (node.component === 'text' && node.props) {
        const raw =
          node.props.content ?? node.props.text ?? node.props.label ?? node.props.value ?? '';
        if (typeof raw === 'string' && raw.trim()) out.push(raw);
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children as typeof nodes);
      }
    }
  };
  walk(nodes);
  return out;
}

/**
 * 从 A2UI 树提取知识库来源：优先 kb-sources 围栏，其次静态「来源文档」文案。
 */
export function extractKbSourcesFromA2uiNodes(
  nodes: Array<{ component?: string; props?: Record<string, unknown>; children?: unknown[] }>,
): KbChatSource[] {
  const lists: KbChatSource[][] = [];
  for (const text of collectA2uiTextContents(nodes)) {
    const { sources } = splitKbSources(text);
    if (sources.length > 0) {
      lists.push(sources);
      continue;
    }
    if (isStaticKbSourceStub(text)) {
      const stub = parseStaticKbSourceStub(text);
      if (stub.length > 0) lists.push(stub);
    }
  }
  return mergeKbSources(...lists);
}

/** 经鉴权 API 拉分片截图（Bearer 不能走裸 img src）。 */
function ChunkImage({
  libraryId,
  documentId,
  imageId,
  label,
}: {
  libraryId: number;
  documentId: number;
  imageId: string;
  label?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    void (async () => {
      try {
        const url = await fetchDocumentChunkImage(libraryId, documentId, imageId);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoked = url;
        setSrc(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [libraryId, documentId, imageId]);

  if (failed) {
    return <p className="text-[11px] text-muted-foreground">分片图片加载失败</p>;
  }
  if (!src) {
    return <p className="text-[11px] text-muted-foreground">图片加载中…</p>;
  }
  return (
    <img
      src={src}
      alt={label ?? '分片截图'}
      className="max-h-64 max-w-full rounded-md border object-contain bg-muted/30"
      onError={() => setFailed(true)}
    />
  );
}

function hasChunkImage(source: KbChatSource): source is KbChatSource & {
  libraryId: number;
  documentId: number;
  imageId: string;
} {
  return (
    source.libraryId != null &&
    source.documentId != null &&
    typeof source.imageId === 'string' &&
    source.imageId.length > 0
  );
}

/**
 * 引用配图区：对齐 RAGFlow 对话，在正文下方直接展示 Fig. N（不必点进「来源」）。
 */
export function KbChatSourceFigures({ sources }: { sources: KbChatSource[] }) {
  const withImages = sources
    .map((source) => ({ source, label: source.index ?? null }))
    .filter(
      (
        item,
      ): item is {
        source: KbChatSource & { libraryId: number; documentId: number; imageId: string };
        label: number | null;
      } => hasChunkImage(item.source),
    );
  if (withImages.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {withImages.map(({ source, label }, i) => {
        const figNo = label ?? i + 1;
        return (
        <figure key={`${source.imageId}-${figNo}`} className="max-w-xs shrink-0">
          <ChunkImage
            libraryId={source.libraryId}
            documentId={source.documentId}
            imageId={source.imageId}
            label={`Fig. ${figNo}`}
          />
          <figcaption className="mt-1 text-center text-[11px] text-muted-foreground">
            Fig. {figNo}
          </figcaption>
        </figure>
        );
      })}
    </div>
  );
}

/**
 * 对话里的知识库来源（对齐 ai-platform/frontend KbSourceDisclosure）：
 * - 默认收起为一行「来源 · N 篇」
 * - 展开后：标题 + 右侧 RAG 相关度%；未点开时一行摘要，点击条目看全文详情
 */
export function KbChatSourceList({ sources }: { sources: KbChatSource[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          if (open) setActive(null);
        }}
        className="flex w-full items-center gap-1.5 bg-muted/60 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="font-medium text-foreground/85">来源 · {sources.length} 篇</span>
        <span className="ml-auto shrink-0">{open ? '收起' : '展开'}</span>
      </button>

      {open ? (
        <ul className="space-y-0.5 bg-background px-1 py-1">
          {sources.map((source, index) => {
            const selected = active === index;
            const score = formatScore(source.score);
            const loc = [
              source.page != null ? `第 ${source.page} 页` : null,
              source.offset != null ? `偏移 ${source.offset}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            const showImage =
              selected &&
              source.libraryId != null &&
              source.documentId != null &&
              source.imageId;
            const snippet = source.chunk?.trim() ?? '';
            return (
              <li key={`${source.source}-${index}`}>
                <button
                  type="button"
                  onClick={() => setActive(selected ? null : index)}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                    selected ? 'bg-secondary' : 'hover:bg-secondary/40',
                  )}
                  title={selected ? '收起详情' : '查看详情'}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 leading-relaxed text-foreground/90">
                      <span className="mr-1 text-muted-foreground">{index + 1}.</span>
                      {source.source}
                    </span>
                    {score ? (
                      <span
                        className="shrink-0 tabular-nums text-muted-foreground"
                        title="RAG 相关度"
                      >
                        {score}
                      </span>
                    ) : null}
                  </div>
                  {selected ? (
                    <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5 text-muted-foreground">
                      {loc ? <p className="text-[11px]">{loc}</p> : null}
                      {showImage ? (
                        <ChunkImage
                          libraryId={source.libraryId!}
                          documentId={source.documentId!}
                          imageId={source.imageId!}
                        />
                      ) : null}
                      <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground/80">
                        {snippet || '（无片段原文）'}
                      </p>
                    </div>
                  ) : snippet ? (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                      {snippet}
                    </p>
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
