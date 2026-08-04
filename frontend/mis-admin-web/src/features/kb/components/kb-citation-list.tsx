import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, FileText, Hash } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SecrecyBadge } from './kb-badges';
import { getLibrary, listCategories } from '../api/kb-api';
import type { KbCategory, KbLibrary, KbQaCitation } from '../types';

/**
 * 问答引用列表（仅展示 MIS 业务 ID 与片段，不暴露引擎原生 id）。
 *
 * <p>来源标签优先展示 `source`（人类可读文档标题）；缺失时回退「知识库 X · 文档 Y」的 ID 展示。
 * F-04 起额外展示定位信息：`page`（页码，1 起）与 `offset`（原文字符偏移）。
 * 这两个字段来自引擎，非 PDF 文档通常没有页码、老数据没有 offset，
 * **给不出就不渲染**——不要用 0 兜底，0 是合法偏移量，会误导用户以为定位在开头。
 *
 * <p>每行可点击展开抽屉（{@link KbCitationDrawer}）：展示完整片段 + 分类 + 密级 + 来源文档；
 * 抽屉按需拉取库元信息（密级 / 分类），**不新增任何后端字段**——
 * 密级与分类来自既有 `GET /kb/libraries/{id}` 与 `GET /kb/categories`。
 */
export function KbCitationList({ citations }: { citations: KbQaCitation[] | null | undefined }) {
  const [selected, setSelected] = useState<KbQaCitation | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!citations || citations.length === 0) {
    return <p className="text-xs text-muted-foreground">（无引用）</p>;
  }
  return (
    <>
      <ul className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
        {citations.map((c, i) => (
          <li key={c.id ?? i}>
            <button
              type="button"
              onClick={() => {
                setSelectedIndex(i + 1);
                setSelected(c);
              }}
              className="w-full rounded-md bg-secondary/40 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-secondary"
            >
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="shrink-0">引用 #{i + 1}</span>
                  {c.source ? (
                    <span className="max-w-[22rem] truncate text-foreground/70" title={c.source}>
                      {` · ${c.source}`}
                    </span>
                  ) : (
                    <span className="shrink-0">
                      {c.libraryId != null ? ` · 知识库 ${c.libraryId}` : ''}
                      {c.documentId != null ? ` · 文档 ${c.documentId}` : ''}
                    </span>
                  )}
                </span>
                <span className="inline-flex shrink-0 items-center gap-2">
                  <KbCitationLocator page={c.page} offset={c.offset} />
                  {c.score != null ? (
                    <span className="tabular-nums">{(c.score * 100).toFixed(1)}%</span>
                  ) : null}
                </span>
              </div>
              {c.chunkText ? (
                <p className="mt-1 line-clamp-3 leading-relaxed text-foreground/80">{c.chunkText}</p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <KbCitationDrawer
        open={selected != null}
        citation={selected}
        index={selectedIndex}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      />
    </>
  );
}

/** 库元信息（密级 + 分类 id），按 libraryId 缓存避免重复请求。 */
interface LibMeta {
  secrecy: string | null;
  categoryId: number | null;
}

const libMetaCache = new Map<number, LibMeta>();
let categoryCache: KbCategory[] | null = null;
let categoryPromise: Promise<KbCategory[]> | null = null;

/** 分类列表全局只拉一次（模块级缓存 + 单飞）。 */
function loadCategoriesOnce(): Promise<KbCategory[]> {
  if (categoryCache) return Promise.resolve(categoryCache);
  if (!categoryPromise) {
    categoryPromise = listCategories()
      .then((cs) => {
        categoryCache = cs;
        return cs;
      })
      .catch(() => []);
  }
  return categoryPromise;
}

/**
 * 引用原文定位抽屉（F-04）。
 *
 * <p>展示：完整片段全文 + 定位信息（页码/偏移）+ 密级 + 分类 + 来源文档 + 评分。
 * 密级与分类按需从既有接口拉取（非实时问答场景数据可能缺失，加载中显「加载中…」），
 * 拉取失败静默回落「—」，不让抽屉崩溃。
 */
function KbCitationDrawer({
  open,
  citation,
  index,
  onOpenChange,
}: {
  open: boolean;
  citation: KbQaCitation | null;
  index: number;
  onOpenChange: (open: boolean) => void;
}) {
  const [meta, setMeta] = useState<LibMeta | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);

  useEffect(() => {
    if (!open || !citation?.libraryId) {
      setMeta(null);
      setCategoryName(null);
      setMetaLoading(false);
      return;
    }
    const libId = citation.libraryId;
    let cancelled = false;
    setMetaLoading(true);
    (async () => {
      try {
        let m = libMetaCache.get(libId);
        if (!m) {
          const lib: KbLibrary = await getLibrary(libId);
          m = { secrecy: lib.secrecy ?? null, categoryId: lib.categoryId ?? null };
          libMetaCache.set(libId, m);
        }
        if (cancelled) return;
        setMeta(m);
        if (m.categoryId != null) {
          const cats = await loadCategoriesOnce();
          if (cancelled) return;
          setCategoryName(cats.find((c) => c.id === m?.categoryId)?.name ?? null);
        } else {
          setCategoryName(null);
        }
      } catch {
        if (!cancelled) {
          setMeta(null);
          setCategoryName(null);
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, citation]);

  const sourceLabel =
    citation?.source ??
    (citation?.libraryId != null || citation?.documentId != null
      ? `知识库 ${citation?.libraryId ?? '?'} · 文档 ${citation?.documentId ?? '?'}`
      : '未知来源');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {citation ? (
          <>
            <SheetHeader className="border-b p-4">
              <SheetTitle>引用 #{index} · 原文定位</SheetTitle>
              <SheetDescription className="truncate" title={sourceLabel}>
                来源：{sourceLabel}
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
              {/* 定位信息 */}
              <section>
                <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">定位信息</h4>
                <div className="flex flex-wrap items-center gap-2">
                  <KbCitationLocator page={citation.page} offset={citation.offset} />
                  {citation.page == null && citation.offset == null ? (
                    <span className="text-xs text-muted-foreground">
                      引擎未返回页码/偏移，以下为引用片段全文
                    </span>
                  ) : null}
                </div>
              </section>

              {/* 完整片段 */}
              <section>
                <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">引用片段（全文）</h4>
                <p className="whitespace-pre-wrap break-words rounded-md bg-secondary/40 p-3 text-sm leading-relaxed text-foreground/90">
                  {citation.chunkText ?? '（无片段文本）'}
                </p>
              </section>

              {/* 元信息：密级 / 分类 / 评分 / 来源 id */}
              <section className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border bg-card p-3 text-sm">
                <MetaCell label="密级">
                  {metaLoading ? (
                    <span className="text-muted-foreground">加载中…</span>
                  ) : (
                    <SecrecyBadge secrecy={meta?.secrecy} />
                  )}
                </MetaCell>
                <MetaCell label="分类">
                  {metaLoading ? (
                    <span className="text-muted-foreground">加载中…</span>
                  ) : categoryName ? (
                    categoryName
                  ) : meta?.categoryId != null ? (
                    `分类 #${meta.categoryId}`
                  ) : (
                    '—'
                  )}
                </MetaCell>
                <MetaCell label="评分">
                  {citation.score != null ? `${(citation.score * 100).toFixed(1)}%` : '—'}
                </MetaCell>
                <MetaCell label="知识库 / 文档">
                  {citation.libraryId != null ? `库 ${citation.libraryId}` : '库 -'}
                  {' · '}
                  {citation.documentId != null ? `文档 ${citation.documentId}` : '文档 -'}
                </MetaCell>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** 抽屉元信息单元格。 */
function MetaCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/**
 * 引用定位信息小标（F-04）。
 *
 * <p>页码与偏移各自独立可空，任一存在就渲染对应徽标；两者都没有则整体不渲染，
 * 不占位、不显示「-」，避免在密集的引用列表里制造视觉噪声。
 */
export function KbCitationLocator({
  page,
  offset,
}: {
  page: number | null | undefined;
  offset: number | null | undefined;
}) {
  const hasPage = page != null && Number.isFinite(page);
  const hasOffset = offset != null && Number.isFinite(offset);
  if (!hasPage && !hasOffset) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {hasPage ? (
        <span
          className="inline-flex items-center gap-0.5 rounded bg-background/70 px-1 py-0.5 tabular-nums"
          title="片段所在页码"
        >
          <FileText className="h-2.5 w-2.5" />P{page}
        </span>
      ) : null}
      {hasOffset ? (
        <span
          className="inline-flex items-center gap-0.5 rounded bg-background/70 px-1 py-0.5 tabular-nums"
          title="片段在原文中的字符偏移"
        >
          <Hash className="h-2.5 w-2.5" />
          {offset}
        </span>
      ) : null}
    </span>
  );
}
