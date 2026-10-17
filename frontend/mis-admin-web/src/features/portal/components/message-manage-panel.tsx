import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PaginationFooter } from '@/components/common/pagination-footer';
import { listOrgs } from '@/lib/api/orgs';
import { fetchDeptTree } from '@/lib/api/depts';
import { listPostTypeTree } from '@/lib/api/post-types';
import {
  audienceLabel,
  downloadMessageFile,
  fetchSentMessageDetail,
  fetchSentMessages,
  previewMessageAudience,
  resolvePhones,
  sendManagedMessage,
  uploadMessageFile,
  type MessageAudienceInput,
  type AudienceScope,
  type MessageFileItem,
  type SentMessageDetail,
  type SentMessageItem,
} from '@/lib/api/message-manage';
import type { DeptNode, PostTypeTreeNode } from '@/types/api';
import { MessageHtmlView, messageHtmlBody, parseAttachmentList } from './message-html-view';
import { MessageRichEditor, normalizeEditorHtml } from './message-rich-editor';
import { formatDateTimeSec } from '../lib/format-datetime';

const PAGE_SIZE = 20;

function flattenDepts(nodes: DeptNode[] | null | undefined, prefix = ''): { id: string; name: string }[] {
  const rows: { id: string; name: string }[] = [];
  for (const node of nodes ?? []) {
    const name = prefix ? `${prefix} / ${node.name}` : node.name;
    rows.push({ id: node.id, name });
    rows.push(...flattenDepts(node.children, name));
  }
  return rows;
}

function flattenPostTypes(nodes: PostTypeTreeNode[] | undefined, prefix = ''): { id: string; name: string }[] {
  const rows: { id: string; name: string }[] = [];
  for (const node of nodes ?? []) {
    const name = prefix ? `${prefix} / ${node.name}` : node.name;
    rows.push({ id: node.id, name });
    rows.push(...flattenPostTypes(node.children, name));
  }
  return rows;
}

function splitPhones(raw: string): string[] {
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const part of raw.split(/[\s,，;；]+/)) {
    const phone = part.trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return phones;
}

export function MessageManagePanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'list' | 'compose'>('list');
  const [composeOpened, setComposeOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [records, setRecords] = useState<SentMessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [detail, setDetail] = useState<SentMessageDetail | null>(null);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [scopes, setScopes] = useState<AudienceScope[]>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [pickDeptId, setPickDeptId] = useState('');
  const [pickPostId, setPickPostId] = useState('');
  const [phonesText, setPhonesText] = useState('');
  const [matchedPhones, setMatchedPhones] = useState<{ userId: string; name: string; phone: string }[]>([]);
  const [missingPhones, setMissingPhones] = useState<string[]>([]);
  const [deptFilter, setDeptFilter] = useState('');
  const [postFilter, setPostFilter] = useState('');
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [postTypes, setPostTypes] = useState<{ id: string; name: string }[]>([]);
  const [treesReady, setTreesReady] = useState(false);
  const [files, setFiles] = useState<MessageFileItem[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const editorRef = useRef<Editor | null>(null);

  const audience: MessageAudienceInput = useMemo(
    () => ({
      all: false,
      userIds: matchedPhones.map((row) => row.userId),
      deptIds: [],
      postTypeIds: [],
      scopes,
    }),
    [matchedPhones, scopes],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchSentMessages(page, PAGE_SIZE, keyword)
      .then((sent) => {
        if (cancelled) return;
        setRecords(sent.list ?? []);
        setTotal(sent.total ?? 0);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : '加载发送记录失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, keyword, listVersion]);

  useEffect(() => {
    if (mode !== 'compose' || treesReady) return;
    void (async () => {
      try {
        const orgs = await listOrgs();
        const trees = await Promise.all(orgs.map((org) => fetchDeptTree(org.id)));
        setDepts(trees.flatMap((tree) => flattenDepts(tree)));
        setPostTypes(flattenPostTypes(await listPostTypeTree(1)));
        setTreesReady(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '加载组织数据失败');
      }
    })();
  }, [mode, treesReady]);

  function search() {
    setPage(1);
    setKeyword(query.trim());
  }

  function resetQuery() {
    setQuery('');
    setKeyword('');
    setPage(1);
  }

  function confirmScope() {
    const dept = depts.find((item) => item.id === pickDeptId);
    const post = postTypes.find((item) => item.id === pickPostId);
    if (!dept || !post) {
      toast.error('请同时选择部门和岗位类型');
      return;
    }
    setScopes((prev) => {
      if (prev.some((item) => item.deptId === dept.id && item.postTypeId === post.id)) return prev;
      return [...prev, { deptId: dept.id, postTypeId: post.id, deptName: dept.name, postTypeName: post.name }];
    });
    setCount(null);
    setScopeOpen(false);
    setPickDeptId('');
    setPickPostId('');
    setDeptFilter('');
    setPostFilter('');
  }

  async function recognizePhones(raw: string) {
    const phones = splitPhones(raw);
    if (phones.length === 0) {
      setMatchedPhones([]);
      setMissingPhones([]);
      setCount(null);
      return [];
    }
    const result = await resolvePhones(phones);
    const matched = result.matched.map((row) => ({
      userId: row.userId,
      name: row.name || row.phone,
      phone: row.phone,
    }));
    setMatchedPhones(matched);
    setMissingPhones(result.missing);
    setCount(null);
    return { matched, missing: result.missing };
  }

  async function onUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadMessageFile(file, 'file');
      setFiles((prev) => [...prev, uploaded]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    }
  }

  async function preview() {
    try {
      const recognized = await recognizePhones(phonesText);
      setCount(await previewMessageAudience({ ...audience, userIds: recognized.matched.map((row) => row.userId) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '预览失败');
    }
  }

  function resetCompose() {
    setTitle('');
    setSummary('');
    setScopes([]);
    setPhonesText('');
    setMatchedPhones([]);
    setMissingPhones([]);
    setFiles([]);
    setCount(null);
    setEditorKey((key) => key + 1);
  }

  async function send() {
    const contentHtml = normalizeEditorHtml(editorRef.current?.getHTML() ?? '');
    setSending(true);
    try {
      const recognized = await recognizePhones(phonesText);
      if (scopes.length === 0 && recognized.matched.length === 0) {
        toast.error(recognized.missing.length > 0 ? '手机号都未匹配到启用用户' : '请添加部门岗位条件或粘贴手机号');
        return;
      }
      if (recognized.missing.length > 0) {
        toast.warning(`有 ${recognized.missing.length} 个手机号未匹配，将不发送给这些人`);
      }
      await sendManagedMessage({
        all: false,
        userIds: recognized.matched.map((row) => row.userId),
        deptIds: [],
        postTypeIds: [],
        scopes,
        title: title.trim(),
        summary: summary.trim() || undefined,
        contentHtml,
        attachmentFileIds: files.map((file) => file.fileId),
      });
      toast.success('已发送');
      resetCompose();
      setMode('list');
      setPage(1);
      setKeyword('');
      setQuery('');
      setListVersion((version) => version + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  const visibleDepts = depts.filter((dept) => !deptFilter.trim() || dept.name.includes(deptFilter.trim()));
  const visiblePosts = postTypes.filter((type) => !postFilter.trim() || type.name.includes(postFilter.trim()));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const detailHtml = detail ? messageHtmlBody(detail.content) : null;
  const detailFiles = detail ? parseAttachmentList(detail.attachments) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">消息管理</h2>
        <Button size="sm" variant="outline" onClick={onClose}>返回收件箱</Button>
      </div>

      <div className={mode === 'list' ? 'flex flex-col gap-3' : 'hidden'}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search();
            }}
            placeholder="按标题或摘要查询"
            aria-label="发送记录查询"
            className="h-8 max-w-xs"
          />
          <Button size="sm" variant="outline" onClick={search}>查询</Button>
          <Button size="sm" variant="ghost" onClick={resetQuery}>重置</Button>
          <Button size="sm" className="ml-auto" onClick={() => { setComposeOpened(true); setMode('compose'); }}>添加</Button>
        </div>
        <div className="rounded-md border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2">标题</th>
                <th className="px-3 py-2">范围</th>
                <th className="px-3 py-2">已读</th>
                <th className="px-3 py-2">发送人</th>
                <th className="px-3 py-2">时间</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t"
                  onClick={() => void fetchSentMessageDetail(row.id).then(setDetail).catch((err: unknown) => {
                    toast.error(err instanceof Error ? err.message : '加载详情失败');
                  })}
                >
                  <td className="px-3 py-2">{row.title}</td>
                  <td className="px-3 py-2">{audienceLabel(row.audience)}</td>
                  <td className="px-3 py-2">{row.readCount}/{row.totalCount}</td>
                  <td className="px-3 py-2">{row.senderName || '—'}</td>
                  <td className="px-3 py-2">{formatDateTimeSec(row.createdAt)}</td>
                </tr>
              ))}
              {!loading && records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">暂无发送记录</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <PaginationFooter total={total} page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>

      {composeOpened ? <div className={mode === 'compose' ? 'grid gap-3 rounded-md border bg-card p-3' : 'hidden'}>
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold">发送消息</h3>
          <Button size="sm" variant="outline" onClick={() => setMode('list')}>返回记录</Button>
        </div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" aria-label="消息标题" />
        <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="摘要（可空，将从正文截取）" aria-label="消息摘要" />
        <MessageRichEditor key={editorKey} editorRef={editorRef} />
        <label className="inline-flex w-fit cursor-pointer items-center text-[13px] text-muted-foreground">
          添加附件
          <input type="file" className="hidden" onChange={(e) => { void onUpload(e.target.files); e.target.value = ''; }} />
        </label>
        {files.length > 0 ? (
          <ul className="text-[13px]">
            {files.map((file) => (
              <li key={file.fileId} className="flex items-center gap-2">
                <span>{file.name}</span>
                <button
                  type="button"
                  className="text-muted-foreground"
                  onClick={() => setFiles((prev) => prev.filter((item) => item.fileId !== file.fileId))}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium">部门 + 岗位类型</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setScopeOpen(true)}>添加部门/岗位条件</Button>
          </div>
          <p className="text-[12px] text-muted-foreground">每条条件是「该部门（含子部门）且该岗位类型」。多条条件之间取并集，再与手机号清单合并。</p>
          {scopes.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">尚未添加条件</p>
          ) : (
            <ul className="grid gap-1 text-[13px]">
              {scopes.map((scope) => (
                <li key={`${scope.deptId}-${scope.postTypeId}`} className="flex items-center justify-between rounded border px-2 py-1">
                  <span>{scope.deptName} · {scope.postTypeName}</span>
                  <button
                    type="button"
                    className="text-muted-foreground"
                    onClick={() => {
                      setScopes((prev) => prev.filter((item) => item.deptId !== scope.deptId || item.postTypeId !== scope.postTypeId));
                      setCount(null);
                    }}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">手机号码清单</span>
          <Textarea
            value={phonesText}
            onChange={(e) => setPhonesText(e.target.value)}
            onBlur={() => {
              void recognizePhones(phonesText).catch((err: unknown) => {
                toast.error(err instanceof Error ? err.message : '识别手机号失败');
              });
            }}
            placeholder="直接粘贴手机号，可用逗号、空格或换行分隔，一次最多 200 个"
            aria-label="手机号码清单"
            className="min-h-24"
          />
          {matchedPhones.length > 0 ? (
            <p className="text-[13px] text-muted-foreground">
              已识别 {matchedPhones.length} 人：{matchedPhones.map((row) => `${row.name} ${row.phone}`).join('、')}
            </p>
          ) : null}
          {missingPhones.length > 0 ? (
            <p className="text-[13px] text-destructive">未匹配：{missingPhones.join('、')}</p>
          ) : null}
        </div>

        <Dialog open={scopeOpen} onOpenChange={setScopeOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>选择部门与岗位类型</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Input value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} placeholder="筛选部门" aria-label="筛选部门" className="h-8" />
                <div className="grid max-h-64 gap-1 overflow-auto text-[13px]">
                  {visibleDepts.map((dept) => (
                    <label key={dept.id} className="flex items-center gap-2">
                      <input type="radio" name="message-scope-dept" checked={pickDeptId === dept.id} onChange={() => setPickDeptId(dept.id)} />
                      {dept.name}
                    </label>
                  ))}
                  {treesReady && visibleDepts.length === 0 ? <p className="text-muted-foreground">没有匹配的部门</p> : null}
                </div>
              </div>
              <div className="grid gap-2">
                <Input value={postFilter} onChange={(e) => setPostFilter(e.target.value)} placeholder="筛选岗位类型" aria-label="筛选岗位类型" className="h-8" />
                <div className="grid max-h-64 gap-1 overflow-auto text-[13px]">
                  {visiblePosts.map((type) => (
                    <label key={type.id} className="flex items-center gap-2">
                      <input type="radio" name="message-scope-post" checked={pickPostId === type.id} onChange={() => setPickPostId(type.id)} />
                      {type.name}
                    </label>
                  ))}
                  {treesReady && visiblePosts.length === 0 ? <p className="text-muted-foreground">没有匹配的岗位类型</p> : null}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setScopeOpen(false)}>取消</Button>
              <Button type="button" onClick={confirmScope}>确定</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void preview()}>预计人数</Button>
          <span className="text-[13px] text-muted-foreground">{count == null ? '发送前可先看接收人数' : `预计 ${count} 人`}</span>
          <Button type="button" size="sm" disabled={sending || !title.trim()} onClick={() => void send()}>
            {sending ? '发送中' : '发送'}
          </Button>
        </div>
      </div> : null}

      <Sheet open={detail != null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{detail?.title || '发送详情'}</SheetTitle>
            <SheetDescription>
              {detail ? `${audienceLabel(detail.audience)} · 已读 ${detail.readCount}/${detail.totalCount}${detail.receiversTruncated ? '（仅列出前 200 人）' : ''}` : ''}
            </SheetDescription>
          </SheetHeader>
          {detail ? (
            <div className="flex-1 overflow-auto px-4 pb-4 text-[13px]">
              {detailHtml ? <MessageHtmlView html={detailHtml} /> : <p>{detail.summary || '（无正文）'}</p>}
              {detailFiles.length > 0 ? (
                <ul className="mt-2">
                  {detailFiles.map((file) => (
                    <li key={file.fileId}>
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() => void downloadMessageFile(file.fileId).then((blob) => {
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = file.name;
                          a.click();
                          URL.revokeObjectURL(url);
                        })}
                      >
                        {file.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="mt-3 max-h-48 overflow-auto text-muted-foreground">
                {detail.receivers.map((row) => (
                  <li key={row.userId}>{row.name || row.userId} · {row.read ? '已读' : '未读'}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
