/**
 * 人设与配置文件（UI#9，路径 `/agent/agents/:id/config`，V19 菜单 `92044`）。
 *
 * <p>覆盖 §4.3 #22 文件树（后端 T04 未实现 ⇒ **501**）；右栏编辑器见
 * `agent-config-file-editor.tsx`（#23 读 / #24 写，同 pending）。
 *
 * <p>**本组件是详情壳的 Tab 内容**：外层 `agent-detail-route.tsx` 已套 `AgentPageShell`
 * （含页面级 `agent:agent:config`），这里用无页头的 `AgentContentState` 承载三态，
 * 避免出现两个 PageHeader。
 *
 * <p>文件树复用 `components/common/TreeTable`：它要求行是**扁平化 + 带 depth** 的数组，
 * 所以先 `flatten()` 一次。目录节点不可选中（点击只做展开语义上的高亮，无内容可读）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileCode2, FileText, Folder, Info, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TreeTable, type TreeTableColumn } from '@/components/common/tree-table';
import { AgentContentState } from '../components/agent-page-shell';
import { AgentConfigFileEditor } from './agent-config-file-editor';
import { listConfigFiles } from '../api/agent-ops-api';
import { agentErrorMessage, formatTime } from '../types';
import type { ConfigFileNode } from '../types';

export interface AgentConfigPageProps {
  agentId: string;
}

/** TreeTable 行：原节点 + `id`/`depth`（组件的硬性契约）。 */
interface ConfigRow extends ConfigFileNode {
  id: string;
  depth: number;
}

/**
 * 树 → 扁平行数组。
 *
 * <p>用 `path` 作为 `id`：它在同一个 agent 的配置树里天然唯一，
 * 而 `name` 会重复（多个目录下都可能有 `metadata.yaml`）。
 */
function flatten(nodes: ConfigFileNode[], depth = 0): ConfigRow[] {
  const out: ConfigRow[] = [];
  for (const node of nodes) {
    out.push({ ...node, id: node.path, depth });
    if (node.children && node.children.length > 0) {
      out.push(...flatten(node.children, depth + 1));
    }
  }
  return out;
}

/** 字节数 → 人类可读；目录不显示大小。 */
function formatSize(node: ConfigFileNode): string {
  if (node.type === 'dir') return '-';
  if (node.size < 1024) return `${node.size} B`;
  return `${(node.size / 1024).toFixed(1)} KB`;
}

export function AgentConfigPage({ agentId }: AgentConfigPageProps) {
  const [tree, setTree] = useState<ConfigFileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>('');

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      setTree(await listConfigFiles(agentId));
    } catch (e) {
      setTree([]);
      setError(agentErrorMessage(e, '获取配置文件列表失败'));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => flatten(tree), [tree]);

  /** 首次加载后自动选中第一个文件，省掉一次点击。 */
  useEffect(() => {
    if (selectedPath !== '') return;
    const firstFile = rows.find((r) => r.type === 'file');
    if (firstFile) setSelectedPath(firstFile.path);
  }, [rows, selectedPath]);

  const selectedFile = useMemo(
    () => rows.find((r) => r.path === selectedPath && r.type === 'file') ?? null,
    [rows, selectedPath],
  );

  const fileCount = useMemo(() => rows.filter((r) => r.type === 'file').length, [rows]);

  const columns = useMemo<TreeTableColumn<ConfigRow>[]>(
    () => [
      {
        key: 'name',
        header: '文件',
        cell: (row) => (
          <span
            className={cn(
              'truncate',
              row.type === 'dir' ? 'font-medium' : '',
              row.path === selectedPath && row.type === 'file' && 'font-semibold text-primary',
            )}
            title={row.path}
          >
            {row.name}
          </span>
        ),
      },
      {
        key: 'format',
        header: '格式',
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {row.type === 'dir' ? '-' : row.format}
          </span>
        ),
      },
      {
        key: 'size',
        header: '大小',
        align: 'right',
        cell: (row) => <span className="text-xs text-muted-foreground">{formatSize(row)}</span>,
      },
      {
        key: 'updated_at',
        header: '更新时间',
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {row.type === 'dir' ? '-' : formatTime(row.updated_at)}
          </span>
        ),
      },
    ],
    [selectedPath],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
        <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
        <p className="leading-relaxed">
          此处只暴露<span className="font-medium text-foreground">白名单内</span>的配置文件
          （人设 / 提示词 / 记忆事实 / 模型参数等）。保存成功后 ai-platform 会自动热加载，
          无需重启 Agent；含密钥的文件会以脱敏形式只读展示。
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* ---------------- 左：文件树（#22 pending） ---------------- */}
        <div className="flex min-h-0 flex-col rounded-lg border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <span className="text-sm font-medium">配置文件</span>
            <span className="text-xs text-muted-foreground">共 {fileCount} 个文件</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <AgentContentState
              loading={loading && rows.length === 0}
              error={error}
              onRetry={() => void load()}
              empty={!loading && !error && rows.length === 0}
              emptyText="没有可编辑的配置文件"
              emptyHint="该 Agent 的工作目录下未匹配到白名单内的文件。"
            >
              <TreeTable
                rows={rows}
                columns={columns}
                treeColumnKey="name"
                emptyText="没有可编辑的配置文件"
                rowIcon={(row) =>
                  row.type === 'dir' ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : row.format === 'yaml' ? (
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-info" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )
                }
                rowClassName={(row) =>
                  row.path === selectedPath && row.type === 'file' ? 'bg-primary/10' : undefined
                }
                onRowClick={(row) => {
                  // 目录没有内容可读，点击不改变选中项
                  if (row.type === 'file') setSelectedPath(row.path);
                }}
              />
            </AgentContentState>
          </div>
        </div>

        {/* ---------------- 右：编辑器（#23/#24 pending） ---------------- */}
        <AgentConfigFileEditor agentId={agentId} file={selectedFile} />
      </div>
    </div>
  );
}
