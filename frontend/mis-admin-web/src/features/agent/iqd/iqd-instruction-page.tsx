/**
 * iqd-instruction-page.tsx — 问数指令下发（闭环补全 P1-2；**T04d 增强 MR-07**，路径 /iqd/instruction）。
 *
 * <p>指令即 `iqd_knowledge` 表中 `kind='instruction'` 的条目（与术语/口径同表，无新表）。
 * 本页以列表为主：新建/编辑、立即下发均走 Dialog（避免表单挤占列表可视高度）。
 *
 * <h2>T04d 三项增强（MR-07）</h2>
 * <ol>
 *   <li><b>content 区 `@` 插入 item_key</b>：输入 `@` 唤起下拉，候选来自 catalog 缓存
 *       （`useCatalogNodes`）→ **下拉即校验**（只能选到当前连接真实存在的 key，杜绝手敲错拼）；</li>
 *   <li><b>「关联对象」多选</b>：把指令绑定到 model / cube，写 `related_item_keys`
 *       （wire = JSON 字符串数组；后端 T04d 会校验其真实性，非法 → 42200）；</li>
 *   <li><b>下发前展示「将推送条数 + 上次下发状态」</b>：条数为**前端估算**（见
 *       {@link estimatePush}：整库下发不带上下文 → 启用中的指令全部携带；其中无关联的恒命中、
 *       有关联的按问数上下文命中）；权威条数以服务端作业回填为准。</li>
 * </ol>
 *
 * <h2>权限码（核实自 seed，非文档猜测）</h2>
 * {@link INSTRUCTION_PERMISSIONS}：view=`iqd:enhance:view`（列表/同步状态/准入）、
 * save=`iqd:enhance:save`（保存/删除）、sync=`iqd:enhance:sync`（立即下发）。
 * 与后端 sys_api ⋈ sys_menu_api 逐条对齐，避免「前端放行、后端 40300」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Pencil, Plus, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import { FilterMultiSelect } from '@/components/common/filter-multi-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePermission } from '@/hooks/use-permission';
import {
  deleteIqdKnowledge,
  getIqdConfig,
  getIqdEnhancementSyncStatus,
  listIqdKnowledge,
  saveIqdKnowledge,
  syncIqdEnhancements,
  type IqdKnowledge,
  type IqdSyncStatus,
} from '@/lib/api/iqd';
import { useCatalogNodes } from './hooks/useCatalogNodes';
import { SyncStatusBar } from './components/SyncStatusBar';
import {
  INSTRUCTION_PERMISSIONS,
  RELATED_KINDS,
  buildItemKeyOptions,
  describeLastPush,
  detectAtToken,
  estimatePush,
  filterItemKeyOptions,
  insertItemKey,
  parseRelatedItemKeys,
  serializeRelatedItemKeys,
} from './components/instruction/instructionUtils';

export const IQD_INSTRUCTION_PAGE_PATH = '/iqd/instruction';

export function IqdInstructionPage() {
  const { hasPermission } = usePermission();
  const canView = hasPermission(INSTRUCTION_PERMISSIONS.view);
  const canSave = hasPermission(INSTRUCTION_PERMISSIONS.save);
  const canSync = hasPermission(INSTRUCTION_PERMISSIONS.sync);

  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [items, setItems] = useState<IqdKnowledge[]>([]);
  const [lastSync, setLastSync] = useState<IqdSyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 新建/编辑 Dialog：null=关闭；`{}`=新建；带 id=编辑。 */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [relatedKeys, setRelatedKeys] = useState<string[]>([]);

  /** 立即下发确认 Dialog。 */
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);

  /** content 光标位置 + `@` 插入下拉（T04d ①）。 */
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);

  const { catalog } = useCatalogNodes(connectionId);

  const itemKeyOptions = useMemo(() => buildItemKeyOptions(catalog), [catalog]);
  const relatedOptions = useMemo(
    () =>
      buildItemKeyOptions(catalog, RELATED_KINDS).map((o) => ({
        value: o.value,
        label: `${o.label}（${o.kind}）`,
      })),
    [catalog],
  );

  const atToken = useMemo(() => detectAtToken(content, caret), [content, caret]);
  const atMatches = useMemo(
    () => (atToken ? filterItemKeyOptions(itemKeyOptions, atToken.query) : []),
    [atToken, itemKeyOptions],
  );
  const showAtMenu = atToken !== null && atMatches.length > 0;

  const estimate = useMemo(() => estimatePush(items), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getIqdConfig();
      const cid = cfg.id ?? null;
      setConnectionId(cid);
      if (cid == null) {
        setItems([]);
        setLastSync(null);
        return;
      }
      setItems(await listIqdKnowledge(cid, 'instruction'));
      try {
        setLastSync(await getIqdEnhancementSyncStatus(cid));
      } catch {
        setLastSync(null);
      }
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
    setRelatedKeys([]);
    setCaret(0);
    setEditingId(null);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setEditorOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((row: IqdKnowledge) => {
    setEditingId(row.id ?? null);
    setTitle(row.title);
    setContent(row.content ?? '');
    setRelatedKeys(parseRelatedItemKeys(row.related_item_keys));
    setCaret(0);
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    resetForm();
  }, [resetForm]);

  const applyItemKey = useCallback(
    (itemKey: string) => {
      const next = insertItemKey(content, caret, itemKey);
      setContent(next.content);
      setCaret(next.caret);
      requestAnimationFrame(() => {
        const el = contentRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(next.caret, next.caret);
        }
      });
    },
    [content, caret],
  );

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
        related_item_keys: serializeRelatedItemKeys(relatedKeys),
        enabled: true,
      });
      closeEditor();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存指令失败');
    } finally {
      setSaving(false);
    }
  }, [connectionId, editingId, title, content, relatedKeys, closeEditor, load]);

  const handleDelete = useCallback(
    async (id: number | undefined) => {
      if (id == null) return;
      setError(null);
      try {
        await deleteIqdKnowledge(id);
        if (editingId === id) closeEditor();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除指令失败');
      }
    },
    [editingId, closeEditor, load],
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
      setSyncDialogOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '触发同步失败');
    } finally {
      setSyncing(false);
    }
  }, [connectionId, load]);

  if (!canView) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-[13px] text-muted-foreground">
        当前账号无 {INSTRUCTION_PERMISSIONS.view} 权限，无法查看指令下发页。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="指令下发"
        description="维护问数指令（kind=instruction）并绑定关联对象（model / cube），保存后自动触发增强同步（context build + 回填 wren_ref_id）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '指令下发' })}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSyncDialogOpen(true)}
              disabled={!canSync || connectionId == null}
              title={!canSync ? `无 ${INSTRUCTION_PERMISSIONS.sync} 权限` : '立即下发'}
            >
              <Send className="h-4 w-4" />
              立即下发
            </Button>
            <Button size="sm" onClick={openCreate} disabled={!canSave || connectionId == null}>
              <Plus className="h-4 w-4" />
              新建指令
            </Button>
          </div>
        }
      />

      <SyncStatusBar connectionId={connectionId} />

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* 列表区占满剩余高度 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
          <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-bold">标题</th>
              <th className="px-3 py-2 font-bold">内容</th>
              <th className="px-3 py-2 font-bold">关联对象</th>
              <th className="px-3 py-2 font-bold">状态</th>
              <th className="px-3 py-2 font-bold">同步</th>
              <th className="w-28 px-3 py-2 font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  暂无指令（点击「新建指令」创建）
                </td>
              </tr>
            ) : (
              items.map((it) => {
                const keys = parseRelatedItemKeys(it.related_item_keys);
                return (
                  <tr
                    key={it.id}
                    className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                  >
                    <td className="px-3 py-2">{it.title}</td>
                    <td
                      className="max-w-[28rem] truncate px-3 py-2 text-xs text-muted-foreground"
                      title={it.content ?? ''}
                    >
                      {it.content || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {keys.length === 0 ? (
                        <span className="text-muted-foreground">全连接通用</span>
                      ) : (
                        <span className="font-mono" title={keys.join('、')}>
                          {keys.length} 项
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {it.enabled ? (
                        <span className="text-success">启用</span>
                      ) : (
                        <span className="text-muted-foreground">停用</span>
                      )}
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
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(it)}
                          disabled={!canSave}
                        >
                          <Pencil className="h-4 w-4" />
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDelete(it.id)}
                          disabled={!canSave}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- 新建 / 编辑指令 Dialog ---------- */}
      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/60 px-4 py-3">
            <DialogTitle className="text-[14px]">
              {editingId != null ? '编辑指令' : '新建指令'}
              {editingId != null ? (
                <Badge variant="secondary" className="ml-2 align-middle">
                  #{editingId}
                </Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              内容将作为 instruction 注入 WrenAI context；输入 @ 可插入清单对象 item_key。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <Input
              placeholder="指令标题（如：仅允许展示脱敏后手机号）"
              value={title}
              readOnly={!canSave}
              onChange={(e) => setTitle(e.target.value)}
            />

            <div className="relative">
              <Textarea
                ref={contentRef}
                placeholder="指令内容（自然语言）。输入 @ 可插入清单对象 item_key。"
                value={content}
                readOnly={!canSave}
                onChange={(e) => {
                  setContent(e.target.value);
                  setCaret(e.target.selectionStart ?? e.target.value.length);
                }}
                onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                rows={10}
                className="min-h-[12rem] resize-y"
              />
              {showAtMenu && canSave ? (
                <div className="absolute left-2 top-full z-20 mt-1 max-h-56 w-[26rem] overflow-auto rounded-md border border-border/60 bg-popover p-1 shadow-md">
                  <p className="px-2 py-1 text-[11px] text-muted-foreground">
                    <AtSign className="mr-1 inline h-3 w-3" />
                    插入清单对象（仅当前连接 catalog 中真实存在的 key）
                  </p>
                  {atMatches.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyItemKey(option.value)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-accent"
                    >
                      <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
                        {option.kind}
                      </Badge>
                      <span className="truncate">{option.label}</span>
                      <code className="ml-auto truncate font-mono text-[11px] text-muted-foreground">
                        {option.value}
                      </code>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex w-full min-w-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                关联对象（绑定到 model / cube；留空 = 全连接通用，问数时恒下发）
              </span>
              <FilterMultiSelect
                options={relatedOptions}
                value={relatedKeys}
                onChange={(v) => setRelatedKeys(Array.isArray(v) ? v.map(String) : [])}
                matchTriggerWidth
              />
              {relatedKeys.length > 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  已关联 {relatedKeys.length} 项：{relatedKeys.join('、')}
                </span>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t border-border/60 px-4 py-3">
            <Button size="sm" variant="outline" onClick={closeEditor} disabled={saving}>
              取消
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !canSave}>
              <Save className="h-4 w-4" />
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- 立即下发确认 Dialog ---------- */}
      <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[14px]">立即下发</DialogTitle>
            <DialogDescription className="text-[12px]">
              将触发整库增强同步（context build + 回填）。启用中的指令全部携带，不按当前编辑态裁剪。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded border border-border/60 bg-muted/20 px-3 py-2 text-[12px]">
            <p>
              将推送 <span className="font-semibold text-foreground">{estimate.total}</span> 条
              <span className="ml-1 text-muted-foreground">
                （通用 {estimate.global} · 按关联对象命中 {estimate.scoped}）
              </span>
            </p>
            <p className="text-muted-foreground">上次下发：{describeLastPush(lastSync)}</p>
            {!canSync ? (
              <p className="text-muted-foreground">无 {INSTRUCTION_PERMISSIONS.sync} 权限，不可下发。</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSyncDialogOpen(false)}
              disabled={syncing}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSync()}
              disabled={syncing || !canSync || connectionId == null}
            >
              <Send className="h-4 w-4" />
              {syncing ? '下发中…' : '确认下发'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default IqdInstructionPage;
