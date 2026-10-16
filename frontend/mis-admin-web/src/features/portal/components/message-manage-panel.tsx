import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listOrgs } from '@/lib/api/orgs';
import { fetchDeptTree } from '@/lib/api/depts';
import { listPostTypeTree } from '@/lib/api/post-types';
import { pageUsers } from '@/lib/api/users';
import {
  audienceLabel,
  downloadMessageFile,
  fetchSentMessageDetail,
  fetchSentMessages,
  previewMessageAudience,
  sendManagedMessage,
  uploadMessageFile,
  type MessageAudienceInput,
  type MessageFileItem,
  type SentMessageDetail,
  type SentMessageItem,
} from '@/lib/api/message-manage';
import type { DeptNode, PostTypeTreeNode } from '@/types/api';
import { MessageHtmlView, messageHtmlBody, parseAttachmentList } from './message-html-view';
import { formatDateTimeSec } from '../lib/format-datetime';

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

function exportHtml(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img').forEach((img) => {
    const fileId = img.getAttribute('data-file-id');
    if (fileId) img.setAttribute('src', `/api/v1/messages/files/${fileId}`);
  });
  return clone.innerHTML;
}

export function MessageManagePanel({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [all, setAll] = useState(false);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [postTypeIds, setPostTypeIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [userLabels, setUserLabels] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState('');
  const [userHits, setUserHits] = useState<{ id: string; label: string }[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [postTypes, setPostTypes] = useState<{ id: string; name: string }[]>([]);
  const [files, setFiles] = useState<MessageFileItem[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [records, setRecords] = useState<SentMessageItem[]>([]);
  const [detail, setDetail] = useState<SentMessageDetail | null>(null);
  const editorId = 'message-manage-editor';

  const audience: MessageAudienceInput = useMemo(
    () => ({ all, userIds, deptIds, postTypeIds }),
    [all, userIds, deptIds, postTypeIds],
  );

  useEffect(() => {
    void (async () => {
      try {
        const orgs = await listOrgs();
        const trees = await Promise.all(orgs.map((org) => fetchDeptTree(org.id)));
        setDepts(trees.flatMap((tree) => flattenDepts(tree)));
        setPostTypes(flattenPostTypes(await listPostTypeTree(1)));
        const sent = await fetchSentMessages(1, 20);
        setRecords(sent.list ?? []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '加载组织数据失败');
      }
    })();
  }, []);

  async function searchUsers() {
    const page = await pageUsers({ realName: keyword.trim() || undefined, status: 1, page: 1, size: 20 });
    setUserHits(
      (page.list ?? []).map((user) => ({
        id: user.id,
        label: user.realName || user.username,
      })),
    );
  }

  function toggle(list: string[], id: string, setList: (next: string[]) => void) {
    setList(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
    setCount(null);
  }

  async function onUpload(fileList: FileList | null, kind: 'file' | 'image') {
    const file = fileList?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadMessageFile(file, kind);
      if (kind === 'file') {
        setFiles((prev) => [...prev, uploaded]);
        return;
      }
      const editor = document.getElementById(editorId);
      if (!editor) return;
      const blob = await downloadMessageFile(uploaded.fileId);
      const url = URL.createObjectURL(blob);
      editor.focus();
      document.execCommand(
        'insertHTML',
        false,
        `<img src="${url}" data-file-id="${uploaded.fileId}" alt="${uploaded.name}">`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    }
  }

  async function preview() {
    try {
      setCount(await previewMessageAudience(audience));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '预览失败');
    }
  }

  async function send() {
    const editor = document.getElementById(editorId);
    const contentHtml = editor ? exportHtml(editor) : '';
    setSending(true);
    try {
      await sendManagedMessage({
        ...audience,
        title: title.trim(),
        summary: summary.trim() || undefined,
        contentHtml,
        attachmentFileIds: files.map((file) => file.fileId),
      });
      toast.success('已发送');
      setTitle('');
      setSummary('');
      if (editor) editor.innerHTML = '';
      setFiles([]);
      setCount(null);
      const sent = await fetchSentMessages(1, 20);
      setRecords(sent.list ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  const detailHtml = detail ? messageHtmlBody(detail.content) : null;
  const detailFiles = detail ? parseAttachmentList(detail.attachments) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">消息管理</h2>
        <Button size="sm" variant="outline" onClick={onClose}>
          返回收件箱
        </Button>
      </div>

      <div className="grid gap-3 rounded-md border bg-card p-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" aria-label="消息标题" />
        <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="摘要（可空，将从正文截取）" aria-label="消息摘要" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => document.execCommand('bold')}>加粗</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => document.execCommand('insertUnorderedList')}>列表</Button>
          <label className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-[13px]">
            插入图片
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => void onUpload(e.target.files, 'image')} />
          </label>
        </div>
        <div
          id={editorId}
          contentEditable
          role="textbox"
          aria-label="消息正文"
          className="min-h-28 rounded-md border bg-background px-3 py-2 text-[13px] outline-none"
        />
        <label className="inline-flex w-fit cursor-pointer items-center text-[13px] text-muted-foreground">
          添加附件
          <input type="file" className="hidden" onChange={(e) => void onUpload(e.target.files, 'file')} />
        </label>
        {files.length > 0 ? (
          <ul className="text-[13px]">
            {files.map((file) => (
              <li key={file.fileId}>{file.name}</li>
            ))}
          </ul>
        ) : null}

        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); setCount(null); }} />
          全员（当前应用启用用户）
        </label>
        <fieldset className="grid max-h-36 gap-1 overflow-auto text-[13px]">
          <legend className="text-muted-foreground">部门（含子部门，可多选）</legend>
          {depts.map((dept) => (
            <label key={dept.id} className="flex items-center gap-2">
              <input type="checkbox" checked={deptIds.includes(dept.id)} onChange={() => toggle(deptIds, dept.id, setDeptIds)} />
              {dept.name}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid max-h-36 gap-1 overflow-auto text-[13px]">
          <legend className="text-muted-foreground">岗位类型（含下级与兼职，可多选）</legend>
          {postTypes.map((type) => (
            <label key={type.id} className="flex items-center gap-2">
              <input type="checkbox" checked={postTypeIds.includes(type.id)} onChange={() => toggle(postTypeIds, type.id, setPostTypeIds)} />
              {type.name}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-2">
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="按姓名找用户" aria-label="用户姓名" className="h-8" />
          <Button type="button" size="sm" variant="outline" onClick={() => void searchUsers()}>查找</Button>
        </div>
        <div className="flex flex-wrap gap-2 text-[13px]">
          {userHits.map((user) => (
            <button
              key={user.id}
              type="button"
              className="rounded border px-2 py-0.5"
              onClick={() => {
                if (!userIds.includes(user.id)) {
                  setUserIds([...userIds, user.id]);
                  setUserLabels({ ...userLabels, [user.id]: user.label });
                  setCount(null);
                }
              }}
            >
              {user.label}
            </button>
          ))}
        </div>
        {userIds.length > 0 ? (
          <p className="text-[13px] text-muted-foreground">
            已指定：{userIds.map((id) => userLabels[id] || id).join('、')}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void preview()}>预计人数</Button>
          <span className="text-[13px] text-muted-foreground">{count == null ? '范围可同时多选，按并集去重' : `预计 ${count} 人`}</span>
          <Button type="button" size="sm" disabled={sending || !title.trim()} onClick={() => void send()}>
            {sending ? '发送中' : '发送'}
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <h3 className="border-b px-3 py-2 text-[13px] font-semibold">发送记录</h3>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2">标题</th>
              <th className="px-3 py-2">范围</th>
              <th className="px-3 py-2">已读</th>
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
                <td className="px-3 py-2">{formatDateTimeSec(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail ? (
        <div className="rounded-md border p-3 text-[13px]">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">{detail.title}</h3>
            <Button size="sm" variant="ghost" onClick={() => setDetail(null)}>关闭</Button>
          </div>
          <p className="mb-2 text-muted-foreground">
            {audienceLabel(detail.audience)} · 已读 {detail.readCount}/{detail.totalCount}
            {detail.receiversTruncated ? '（仅列出前 200 人）' : ''}
          </p>
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
          <ul className="mt-2 max-h-40 overflow-auto text-muted-foreground">
            {detail.receivers.map((row) => (
              <li key={row.userId}>{row.name || row.userId} · {row.read ? '已读' : '未读'}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
