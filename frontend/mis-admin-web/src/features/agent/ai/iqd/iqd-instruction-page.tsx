/**
 * iqd-instruction-page.tsx — 问数指令下发（闭环补全 P1-2，路径 /iqd/instruction）。
 *
 * <p>指令即 `iqd_knowledge` 表中 `kind='instruction'` 的条目（与术语/口径同表，无新表）。
 * 本页提供指令 CRUD + 「立即下发」按钮（POST /iqd/enhance/sync）+ 同步状态条
 * （SyncStatusBar）。权限码复用 iqd:enhance:view|save|sync。
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import {
  deleteIqdKnowledge,
  getIqdConfig,
  listIqdKnowledge,
  saveIqdKnowledge,
  syncIqdEnhancements,
  type IqdKnowledge,
} from '@/lib/api/iqd';
import { SyncStatusBar } from './components/SyncStatusBar';

export const IQD_INSTRUCTION_PAGE_PATH = '/iqd/instruction';

export function IqdInstructionPage() {
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [items, setItems] = useState<IqdKnowledge[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getIqdConfig();
      const cid = cfg.id ?? null;
      setConnectionId(cid);
      if (cid == null) {
        setItems([]);
        return;
      }
      setItems(await listIqdKnowledge(cid, 'instruction'));
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : '加载指令失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = useCallback(() => {
    setTitle('');
    setContent('');
    setEditingId(null);
  }, []);

  const startEdit = useCallback((row: IqdKnowledge) => {
    setEditingId(row.id ?? null);
    setTitle(row.title);
    setContent(row.content ?? '');
  }, []);

  const handleSave = useCallback(async () => {
    if (connectionId == null) {
      setError('尚未配置问数连接');
      return;
    }
    if (!title.trim()) {
      setError('指令标题不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveIqdKnowledge({
        id: editingId ?? undefined,
        connection_id: connectionId,
        kind: 'instruction',
        title: title.trim(),
        content: content.trim() || null,
        enabled: true,
      });
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存指令失败');
    } finally {
      setSaving(false);
    }
  }, [connectionId, editingId, title, content, resetForm, load]);

  const handleDelete = useCallback(
    async (id: number | undefined) => {
      if (id == null) return;
      setError(null);
      try {
        await deleteIqdKnowledge(id);
        if (editingId === id) resetForm();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除指令失败');
      }
    },
    [editingId, resetForm, load],
  );

  const handleSync = useCallback(async () => {
    if (connectionId == null) {
      setError('尚未配置问数连接');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      await syncIqdEnhancements(connectionId, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '触发同步失败');
    } finally {
      setSyncing(false);
    }
  }, [connectionId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="指令下发"
        description="维护问数指令（kind=instruction），保存后自动触发增强同步（context build + 回填 wren_ref_id）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '指令下发' })}
        actions={
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <SyncStatusBar connectionId={connectionId} />

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* 指令编辑区 */}
      <div className="mb-3 rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-semibold">{editingId != null ? '编辑指令' : '新增指令'}</span>
          {editingId != null ? (
            <Badge variant="secondary">#{editingId}</Badge>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Input
            placeholder="指令标题（如：仅允许展示脱敏后手机号）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder="指令内容（自然语言，将作为 instruction 注入 WrenAI context）"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void handleSave()} disabled={saving}>
              <Save className="h-4 w-4" />
              保存
            </Button>
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing || connectionId == null}>
              <Send className="h-4 w-4" />
              立即下发
            </Button>
            {editingId != null ? (
              <Button size="sm" variant="ghost" onClick={resetForm}>
                取消
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* 指令列表 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
          <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-bold">标题</th>
              <th className="px-3 py-2 font-bold">内容</th>
              <th className="px-3 py-2 font-bold">状态</th>
              <th className="px-3 py-2 font-bold">同步</th>
              <th className="w-28 px-3 py-2 font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  暂无指令（保存后自动下发至 WrenAI）
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr
                  key={it.id}
                  className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="px-3 py-2">{it.title}</td>
                  <td className="max-w-[32rem] truncate px-3 py-2 text-xs text-muted-foreground" title={it.content ?? ''}>
                    {it.content || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {it.enabled ? <span className="text-success">启用</span> : <span className="text-muted-foreground">停用</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {it.sync_status === 'synced' ? (
                      <span className="text-success">已同步</span>
                    ) : it.sync_status === 'failed' ? (
                      <span className="text-destructive">失败</span>
                    ) : (
                      <span className="text-muted-foreground">{it.sync_status ?? '—'}</span>
                    )}
                    {it.wren_ref_id ? (
                      <span className="ml-1 font-mono text-muted-foreground" title={it.wren_ref_id}>
                        {String(it.wren_ref_id).slice(0, 10)}…
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(it)}>
                        <Plus className="h-4 w-4" />
                        编辑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void handleDelete(it.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default IqdInstructionPage;
