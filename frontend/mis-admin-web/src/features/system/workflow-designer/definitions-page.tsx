import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus2, GitBranch, Layers, RefreshCw, Workflow } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { activateDefinition, fetchDefinitions, type WfDefinition } from '@/lib/api/workflow';
import { cn } from '@/lib/utils';

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
  const navigate = useNavigate();
  const tenantId = '1';

  const [items, setItems] = useState<WfDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const size = 20;

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
            <Button size="sm" onClick={() => navigate('/system/workflow/designer')}>
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
            <Button size="sm" variant="outline" onClick={() => navigate('/system/workflow/designer')}>
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate('/system/workflow/designer')}
                        >
                          编排
                        </Button>
                        {def.status !== 'ACTIVE' ? (
                          <Button size="sm" disabled={acting === def.id} onClick={() => void onActivate(def)}>
                            {acting === def.id ? '发布中…' : '发布'}
                          </Button>
                        ) : null}
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
    </div>
  );
}

export default WorkflowDefinitionPage;