import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Eye, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchDocumentChunkImage, listDocumentChunks } from '../api/kb-api';
import type { KbDocument, KbDocumentChunks } from '../types';
import { chunkMethodLabel } from '../types';

/** 搜索防抖（ms）：用户停顿后才会触发服务端查询。 */
const SEARCH_DEBOUNCE_MS = 300;
/** 每页条数（与后端默认一致；UI 上限 100）。 */
const PAGE_SIZE = 50;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryId: number;
  /** 目标文档；null = 关闭态（不渲染内容）。 */
  doc: KbDocument | null;
}

/**
 * 分片配图：经鉴权 API 拉 JPEG，再挂到 Object URL（裸 img src 带不上 Bearer）。
 */
function ChunkImage({
  libraryId,
  docId,
  imageId,
}: {
  libraryId: number;
  docId: number;
  imageId: string;
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
        const url = await fetchDocumentChunkImage(libraryId, docId, imageId);
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
  }, [libraryId, docId, imageId]);

  if (failed) {
    return <p className="mt-2 text-xs text-muted-foreground">分片图片加载失败</p>;
  }
  if (!src) {
    return <p className="mt-2 text-xs text-muted-foreground">图片加载中…</p>;
  }
  return (
    <img
      src={src}
      alt="分片截图"
      className="mt-2 max-h-80 max-w-full rounded-md border object-contain bg-muted/30"
    />
  );
}

/**
 * 本地关键字高亮：只高亮本次查询关键字，绝不渲染引擎 HTML（杜绝 XSS）。
 *
 * <p>后端返回的正文已是清洗后纯文本（引擎 `<em>`/`<table>` 等已剥离）；
 * 此处仅按关键字做纯文本切分 + `<mark>` 包装，匹配大小写不敏感。
 */
function highlight(text: string, keyword: string): ReactNode {
  const kw = keyword.trim();
  if (!kw) return text;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lower = kw.toLowerCase();
  return text.split(new RegExp(`(${escaped})`, 'gi')).map((part, i) =>
    part.toLowerCase() === lower ? (
      <mark key={i} className="rounded bg-warning/25 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** 空态响应（前端网络/解析异常时兜底，保留 hint 语义供展示）。 */
function emptyChunks(hint: string, page: number): KbDocumentChunks {
  return {
    stats: {
      totalChunks: 0,
      totalCharacterCount: 0,
      chunkMethod: null,
      chunkTokenNum: null,
      separator: null,
      source: null,
      chunkCount: null,
      tokenCount: null,
      pageIndex: null,
      imageTableContextWindow: null,
      autoKeywords: null,
      autoQuestions: null,
    },
    chunks: [],
    total: 0,
    page,
    pageSize: PAGE_SIZE,
    hint,
  };
}

/**
 * 「查看切分」右侧大抽屉（文档管理页查看文档切分效果）。
 *
 * <p>打开即拉第一页；统计条 + 关键字搜索（300ms 防抖，服务端过滤）+ 卡片分页列表
 * （全局连续序号 / 页码徽标 / 字符数 / 本地关键字高亮）。空态（解析中、失败、
 * 未同步到引擎、引擎暂不可达）由后端 `hint` 承载。
 */
export function KbDocChunkViewDrawer({ open, onOpenChange, libraryId, doc }: Props) {
  const [data, setData] = useState<KbDocumentChunks | null>(null);
  const [loading, setLoading] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  // 打开 / 切换文档时重置状态（回到无关键字第一页，清空旧文档残留数据）
  useEffect(() => {
    if (!open || doc == null) return;
    setData(null);
    setKeywordInput('');
    setKeyword('');
    setPage(1);
  }, [open, doc]);

  // 搜索防抖：停顿 300ms 后应用关键字并回到第一页
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setKeyword(keywordInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, keywordInput]);

  // 关键字 / 页码变化 → 重新加载
  useEffect(() => {
    if (!open || doc == null) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await listDocumentChunks(libraryId, doc.id, keyword, page, PAGE_SIZE);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          setData(emptyChunks(e instanceof Error ? e.message : '获取文档切分失败', page));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, doc, libraryId, keyword, page]);

  const stats = data?.stats ?? null;
  const total = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const chunks = data?.chunks ?? [];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onOpenChange(false)}>
      <SheetContent className="flex w-full flex-col sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            查看切分{doc ? ` · ${doc.title}` : ''}
          </SheetTitle>
        </SheetHeader>

        {/* 统计条（双口径：全量 chunk 数 + 命中数 + 总 token；本页字符） */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-3 text-xs text-muted-foreground">
          <span>共 {stats?.chunkCount ?? '-'} 块 · 命中 {stats?.totalChunks ?? 0} 块</span>
          <span>总 token {stats?.tokenCount ?? '-'}</span>
          <span>本页字符 {(stats?.totalCharacterCount ?? 0).toLocaleString('zh-CN')}</span>
          <span>方法 {chunkMethodLabel(stats?.chunkMethod ?? null)}</span>
          {stats?.chunkTokenNum != null ? <span>Token {stats.chunkTokenNum}</span> : null}
          {stats?.separator != null && stats.separator !== '' ? (
            <span className="max-w-[10rem] truncate" title={`分隔符：${stats.separator}`}>
              分隔符 {stats.separator}
            </span>
          ) : null}
          {stats?.source === 'FILE_OVERRIDE' ? (
            <Badge variant="info" className="px-1.5 py-0 text-[0.6875rem]">
              文件指定
            </Badge>
          ) : stats?.source === 'LIBRARY' ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[0.6875rem]">
              继承库级
            </Badge>
          ) : null}
        </div>

        {/* 关键字搜索（服务端过滤） */}
        <div className="border-b px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              placeholder="按正文关键字过滤切片（服务端搜索）"
              className="pl-8"
            />
          </div>
        </div>

        {/* 切片卡片列表 */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {loading && data == null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          ) : data?.hint ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {data.hint}
            </div>
          ) : chunks.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无切片
            </div>
          ) : (
            <div className="space-y-3">
              {chunks.map((chunk) => (
                <div key={chunk.seq} className="rounded-lg border bg-card p-3">
                  <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono tabular-nums text-primary">#{chunk.seq}</span>
                    {chunk.pageNo != null ? (
                      <Badge variant="outline" className="px-1.5 py-0 text-[0.6875rem]">
                        第 {chunk.pageNo} 页
                      </Badge>
                    ) : null}
                    {chunk.importantKeywords != null && chunk.importantKeywords.length > 0 ? (
                      <span className="flex min-w-0 items-center gap-1">
                        {chunk.importantKeywords.slice(0, 4).map((kw) => (
                          <Badge key={kw} variant="secondary" className="px-1.5 py-0 text-[0.6875rem]">
                            {kw}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <span>—</span>
                    )}
                    <span className="ml-auto tabular-nums">{chunk.characterCount} 字符</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                    {highlight(chunk.content, keyword)}
                  </p>
                  {chunk.imageId && doc ? (
                    <ChunkImage libraryId={libraryId} docId={doc.id} imageId={chunk.imageId} />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 分页（手写，仓库无独立 Pagination 组件） */}
        <div className="flex shrink-0 items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
          <span>
            共 {total} 条 · 第 {page} / {maxPage} 页
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={loading || page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || page >= maxPage}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
