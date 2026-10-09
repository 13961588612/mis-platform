import { useCallback, useEffect, useState } from 'react';
import { Undo2, FilePlus2, GitBranch, Layers, RefreshCw, Workflow } from 'lucide-react';
import { PermissionGate } from '@/components/auth/permission-gate';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import {
  activateDefinition,
  deactivateDefinition,
  fetchDefinitions,
  type WfDefinition,
} from '@/lib/api/workflow';
import { DesignerDialog } from './designer-dialog';
import { DefinitionDialog, type DefinitionDraft } from './definition-dialog';
import type { FlowMeta } from './property-panel';
import { cn } from '@/lib/utils';

/** 流程编排 / 定义编辑的权限码（V123:44 菜单 95007 `workflow-designer`）。 */
const PERM_EDIT = 'workflow:definition:edit';

/** 编排 Dialog 的打开态：全程由本页 state 持有，**不碰路由**。 */
interface DesignerState {
  open: boolean;
  definitionId?: string;
  initialFlowMeta?: Partial<FlowMeta>;
}

const CLOSED: DesignerState = { open: false };

const STATUS: Record<string, { text: string; cls: string }> = {
  DRAFT: { text: '草稿', cls: 'bg-muted text-muted-foreground' },
  ACTIVE: { text: '已发布', cls: 'bg-success/10 text-success' },
  ARCHIVED: { text: '已归档', cls: 'bg-warning/10 text-warning' },
};

/**
 * 系统管理 · 流程中心：流程定义列表。
 *
 * <p>列出自租户已建立的流程定义（含表单白名单与节点数），支持发布与进入编排。
 */
export function WorkflowDefinitionPage() {
  const tenantId = '1';

  const [items, setItems] = useState<WfDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const size = 20;
  const [createOpen, setCreateOpen] = useState(false);
  const [designer, setDesigner] = useState<DesignerState>(CLOSED);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchDefinitions(tenantId, page, size);
      setItems(r.list);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onActivate(def: WfDefinition) {
    setActing(def.id);
    try {
      await activateDefinition(def.id, tenantId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '发布失败');
    } finally {
      setActing(null);
    }
  }

  async function onDeactivate(def: WfDefinition) {
    setActing(def.id);
    try {
      await deactivateDefinition(def.id, tenantId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '取消发布失败');
    } finally {
      setActing(null);
    }
  }

  /**
   * 保存成功后：先刷新列表再关 Dialog，顺序不能反（方案 §4.5）。
   *
   * ⚠️ 全程只动 `useState`，**不 navigate**：`navigate(-1)` 会在浏览器历史里留下
   * 「编排」记录，用户按后退会再进一次（方案 §4.3）。
   */
  const onDesignerSaved = useCallback(async () => {
    await load();
    setDesigner(CLOSED);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="流程中心"
        description="流程定义、画布编排与表单白名单配置"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              刷新
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <FilePlus2 className="mr-1 h-3.5 w-3.5" />
              新建流程
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-destructive">
            {error}
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Workflow className="h-6 w-6 opacity-40" />
            暂无流程定义
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              去创建一个
            </Button>
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">流程名称</th>
                <th className="px-3 py-2 font-medium">编码</th>
                <th className="px-3 py-2 font-medium">分类</th>
                <th className="px-3 py-2 font-medium">版本</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">节点 / 表单</th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((def) => {
                const st = STATUS[def.status] ?? STATUS.DRAFT;
                return (
                  <tr key={def.id} className="border-t transition hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <div className="text-[13px] font-medium">{def.name}</div>
                      {def.description ? (
                        <div className="truncate text-[11px] text-muted-foreground" title={def.description}>
                          {def.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{def.code}</td>
                    <td className="px-3 py-2 text-[12px]">{def.category}</td>
                    <td className="px-3 py-2 tabular-nums text-[12px]">v{def.version}</td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded px-1.5 py-0.5 text-[11px]', st.cls)}>{st.text}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-0.5">
                          <Layers className="h-3 w-3" /> {def.nodes?.length ?? 0}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          <GitBranch className="h-3 w-3" />
                          {(def.supportedFormCodes ?? []).length > 0
                            ? def.supportedFormCodes.join(', ')
                            : '未配置表单'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {/*
                          ⚠️ 传 `definitionId`：改版前点哪一行都是空白画布（现存 bug）。
                          `ACTIVE` 不可编辑（后端 `update` 会拒）⇒ 直接禁用并给出原因。
                        */}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={def.status === 'ACTIVE'}
                          title={def.status === 'ACTIVE' ? '已发布流程不可编辑，请先取消发布' : undefined}
                          onClick={() =>
                            setDesigner({
                              open: true,
                              definitionId: def.id,
                              initialFlowMeta: {
                                code: def.code,
                                name: def.name,
                                category: def.category,
                                description: def.description ?? '',
                                supportedFormCodes: (def.supportedFormCodes ?? []).join(','),
                              },
                            })
                          }
                        >
                          编排
                        </Button>
                        {/*
                          ⚠️ 无 `workflow:definition:edit` 时**隐藏**而不是禁用：
                          发布/取消发布是纯管理工作，让无权限者看到一排永远点不动的按钮
                          只会制造「系统坏了」的错觉；隐藏也省掉了为每个按钮写 tooltip 的成本。
                        */}
                        <PermissionGate permission={PERM_EDIT}>
                          {def.status !== 'ACTIVE' ? (
                            <Button size="sm" disabled={acting === def.id} onClick={() => void onActivate(def)}>
                              {acting === def.id ? '发布中…' : '发布'}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={acting === def.id}
                              onClick={() => void onDeactivate(def)}
                              title="取消发布后回到草稿，可再次编排"
                            >
                              <Undo2 className="mr-1 h-3.5 w-3.5" />
                              {acting === def.id ? '取消中…' : '取消发布'}
                            </Button>
                          )}
                        </PermissionGate>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          共 <b className="text-foreground">{total}</b> 条 · 第 {page}/{totalPages} 页
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      </div>

      {/*
        两个 Dialog 都用 `useState` 开关，**不产生任何浏览器历史条目**：
        打开→编排→关闭，历史条数恒定，用户按后退不会「再进一次编排」。
      */}
      {/*
        ⚠️ 条件挂载而不是 `open={createOpen}`：DefinitionDialog 一挂载就会拉表单候选清单，
        常驻挂载会让每个打开流程定义页的用户都多发一次（无 `biz:form:list` 的人还是 403）。
      */}
      {createOpen ? (
        <DefinitionDialog
          open
          onOpenChange={setCreateOpen}
          onSubmit={(draft: DefinitionDraft) =>
            setDesigner({
              open: true,
              initialFlowMeta: { ...draft, supportedFormCodes: draft.supportedFormCodes.join(',') },
            })
          }
        />
      ) : null}
      <DesignerDialog
        open={designer.open}
        definitionId={designer.definitionId}
        initialFlowMeta={designer.initialFlowMeta}
        onOpenChange={(open) => setDesigner((s) => ({ ...s, open }))}
        onSaved={() => void onDesignerSaved()}
      />
    </div>
  );
}

export default WorkflowDefinitionPage;