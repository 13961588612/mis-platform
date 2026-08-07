/**
 * 人设与配置文件（UI#9，路径 `/agent/agents/:id/config`，V19 菜单 `92044`）。
 *
 * <p>覆盖 §4.3 #22 文件列表（T04 已就绪）+ #23 读 / #24 写（右栏编辑器）。
 *
 * <p>**本组件是详情壳的 Tab 内容**：外层 `agent-detail-route.tsx` 已套 `AgentPageShell`
 * （含页面级 `agent:agent:config`），这里用无页头的 `AgentContentState` 承载三态，
 * 避免出现两个 PageHeader。
 *
 * <p>**T04 收口：真实 wire 是扁平数组** `[{path, type, read_only, size_bytes}]`，
 * 不是树。本页按 `/` 拆段把扁平项**现场构建**成目录树（`buildTree`），
 * 再 `flattenRows` 成 TreeTable 需要的「扁平 + depth」数组。
 * 目录节点不可选中（点击只做展开语义上的高亮，无内容可读）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileCode2, FileText, Folder, Info, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TreeTable, type TreeTableColumn } from '@/components/common/tree-table';
import { AgentContentState } from '../components/agent-page-shell';
import { AgentConfigFileEditor } from './agent-config-file-editor';
import { listConfigFiles } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { ConfigFileNode, ConfigFileTreeRow } from '../types';

export interface AgentConfigPageProps {
  agentId: string;
}

/**
 * 扁平 wire 项 → 目录树（纯前端派生）。
 *
 * <p>把 `a/b/c.yaml` 拆成 `a` → `a/b` → `a/b/c.yaml` 三层；同一前缀的目录节点
 * 只建一次。目录的 `read_only` / `size_bytes` 无意义，恒为 false / 0。
 */
function buildTree(files: ConfigFileNode[]): ConfigFileTreeRow[] {
  const root: ConfigFileTreeRow[] = [];
  const index = new Map<string, ConfigFileTreeRow>();

  const depthOf = (path: string): number => path.split('/').length - 1;

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split('/');
    let prefix = '';
    let siblings = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const segment = parts[i];
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let dir = index.get(prefix);
      if (!dir) {
        dir = {
          path: prefix,
          name: segment,
          kind: 'dir',
          type: '',
          read_only: false,
          size_bytes: 0,
          id: prefix,
          depth: depthOf(prefix),
          children: [],
        };
        index.set(prefix, dir);
        siblings.push(dir);
      }
      siblings = dir.children ?? [];
    }
    const leaf: ConfigFileTreeRow = {
      path: file.path,
      name: parts[parts.length - 1] ?? file.path,
      kind: 'file',
      type: file.type,
      read_only: file.read_only,
      size_bytes: file.size_bytes,
      id: file.path,
      depth: depthOf(file.path),
    };
    index.set(file.path, leaf);
    siblings.push(leaf);
  }

  /** 目录优先 + 名字升序，保证「先看到目录、再看到文件」的直觉顺序。 */
  const sortChildren = (nodes: ConfigFileTreeRow[]): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children && node.children.length > 0) sortChildren(node.children);
    }
  };
  sortChildren(root);
  return root;
}

/** 树 → TreeTable 扁平行（用 flatten 的 depth 覆盖构建时的 depth）。 */
function flattenRows(nodes: ConfigFileTreeRow[], depth = 0): ConfigFileTreeRow[] {
  const out: ConfigFileTreeRow[] = [];
  for (const node of nodes) {
    out.push({ ...node, depth });
    if (node.children && node.children.length > 0) {
      out.push(...flattenRows(node.children, depth + 1));
    }
  }
  return out;
}

/** 字节数 → 人类可读；目录不显示大小。 */
function formatSize(row: ConfigFileTreeRow): string {
  if (row.kind === 'dir') return '-';
  if (row.size_bytes < 1024) return `${row.size_bytes} B`;
  return `${(row.size_bytes / 1024).toFixed(1)} KB`;
}

export function AgentConfigPage({ agentId }: AgentConfigPageProps) {
  const [files, setFiles] = useState<ConfigFileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>('');

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      setFiles(await listConfigFiles(agentId));
    } catch (e) {
      setFiles([]);
      setError(agentErrorMessage(e, '获取配置文件列表失败'));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => flattenRows(buildTree(files)), [files]);

  /** 首次加载后自动选中第一个文件，省掉一次点击。 */
  useEffect(() => {
    if (selectedPath !== '') return;
    const firstFile = rows.find((r) => r.kind === 'file');
    if (firstFile) setSelectedPath(firstFile.path);
  }, [rows, selectedPath]);

  const selectedFile = useMemo(
    () => rows.find((r) => r.path === selectedPath && r.kind === 'file') ?? null,
    [rows, selectedPath],
  );

  const fileCount = files.length;

  const columns = useMemo<TreeTableColumn<ConfigFileTreeRow>[]>(
    () => [
      {
        key: 'name',
        header: '文件',
        cell: (row) => (
          <span
            className={cn(
              'truncate',
              row.kind === 'dir' ? 'font-medium' : '',
              row.path === selectedPath && row.kind === 'file' && 'font-semibold text-primary',
            )}
            title={row.path}
          >
            {row.name}
          </span>
        ),
      },
      {
        key: 'type',
        header: '格式',
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {row.kind === 'dir' ? '-' : (row.type || 'text').toUpperCase()}
          </span>
        ),
      },
      {
        key: 'size_bytes',
        header: '大小',
        align: 'right',
        cell: (row) => <span className="text-xs text-muted-foreground">{formatSize(row)}</span>,
      },
      {
        key: 'read_only',
        header: '只读',
        cell: (row) =>
          row.kind === 'dir' ? (
            <span className="text-xs text-muted-foreground">-</span>
          ) : row.read_only ? (
            <span className="text-xs text-warning">只读</span>
          ) : (
            <span className="text-xs text-success">可编辑</span>
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
        {/* ---------------- 左：文件树（#22 已就绪，扁平 → 现场建树） ---------------- */}
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
                  row.kind === 'dir' ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : row.type === 'yaml' || row.type === 'yml' ? (
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-info" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )
                }
                rowClassName={(row) =>
                  row.path === selectedPath && row.kind === 'file' ? 'bg-primary/10' : undefined
                }
                onRowClick={(row) => {
                  // 目录没有内容可读，点击不改变选中项
                  if (row.kind === 'file') setSelectedPath(row.path);
                }}
              />
            </AgentContentState>
          </div>
        </div>

        {/* ---------------- 右：编辑器（#23/#24 已就绪） ---------------- */}
        <AgentConfigFileEditor agentId={agentId} file={selectedFile} />
      </div>
    </div>
  );
}
