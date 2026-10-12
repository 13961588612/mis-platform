/**
 * 流程设计器主体（T4.1：从 `designer-page.tsx` 原地抽出，逻辑一行未改）。
 *
 * <p>三栏：左 Palette 拖拽建节点 / 中 @xyflow/react 画布 / 右属性面板（含表单白名单）。
 * 顶部工具条：撤销、重做、自动布局、校验、仅保存、保存并发布。
 *
 * <p>抽出来的唯一目的是让 `DesignerDialog`（T4.2）能把它整块塞进全屏 Dialog，
 * 而 `designer-page.tsx` 退化成路由壳。
 *
 * <p>后端对接：`POST /api/v1/workflow/definitions`（新建草稿）、
 * `PUT /api/v1/workflow/definitions/{id}`（仅草稿可改）、
 * `POST .../deactivate`（已发布须先取消发布才能 PUT）、
 * `POST .../activate`（保存并发布时调用）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { DesignerCanvas } from './designer-canvas';
import { Palette } from './palette';
import { PropertyPanel, type FlowMeta } from './property-panel';
import { applyDagreLayout } from './utils/dagreLayout';
import { validateWorkflow, type ValidationResult } from './utils/validator';
import { useUndoRedo } from './hooks/useUndoRedo';
import { WF_NODE_TYPES, type WfFlowEdge, type WfFlowNode, type WfNodeKind } from './types';
import { fetchDefinition } from '@/lib/api/workflow';
import { friendlySaveError } from './save-error';
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';
import type { WfEdge, WfNode } from '@/lib/api/workflow';

const TENANT_ID = '1';

const DEFAULT_FLOW_META: FlowMeta = {
  code: '',
  name: '',
  categoryId: null,
  description: '',
  supportedFormCodes: '',
};

export interface DesignerBodyProps {
  /** 有 = 编辑模式（加载已有定义，保存走 PUT）；无 = 新建（保存走 POST）。 */
  definitionId?: string;
  /** 预填的流程元数据（新增弹窗收集到的 / 列表行已有的）。 */
  initialFlowMeta?: Partial<FlowMeta>;
  /**
   * 保存成功后回调（调用方负责刷新列表）。
   * {@code close: true}（默认）表示保存并发布，调用方通常关闭 Dialog；
   * {@code close: false} 表示仅保存草稿，Dialog 可继续编辑。
   */
  onSaved?: (defId: string, options?: { close?: boolean }) => void;
  /** 未保存改动状态上报，供外层 Dialog 做「关闭前二次确认」。 */
  onDirtyChange?: (dirty: boolean) => void;
}

function toNodeKind(nodeType: string): WfNodeKind {
  return (nodeType in WF_NODE_TYPES ? nodeType : 'APPROVAL') as WfNodeKind;
}

/** 后端 `config`（JSON 串）→ 会签策略；解析失败回落到默认。 */
function readRoutingStrategy(config: string | null): 'ALL_PASS' | 'ANY_PASS' {
  try {
    const parsed = JSON.parse(config ?? '{}') as { routingStrategy?: string };
    return parsed.routingStrategy === 'ANY_PASS' ? 'ANY_PASS' : 'ALL_PASS';
  } catch {
    return 'ALL_PASS';
  }
}

/** 后端 `WfNode` → 画布节点。id 取 `n_${nodeCode}`，与保存时的序列化对齐。 */
export function toFlowNode(n: WfNode): WfFlowNode {
  const kind = toNodeKind(n.nodeType);
  return {
    id: `n_${n.nodeCode}`,
    type: WF_NODE_TYPES[kind],
    position: { x: n.canvasX ?? 0, y: n.canvasY ?? 0 },
    data: {
      kind,
      nodeCode: n.nodeCode,
      nodeName: n.nodeName,
      assigneeRule: n.assigneeRule,
      conditionExpr: n.conditionExpr ?? undefined,
      timeoutHours: n.timeoutHours ?? null,
      routingStrategy: kind === 'ROUTING' ? readRoutingStrategy(n.config) : undefined,
    },
  };
}

/** 后端 `WfEdge`（source/target 是 nodeCode）→ 画布连线。 */
export function toFlowEdge(e: WfEdge, idx: number): WfFlowEdge {
  return {
    id: `e_${idx}_${e.source}_${e.target}`,
    source: `n_${e.source}`,
    target: `n_${e.target}`,
    label: e.label ?? undefined,
  };
}

export function DesignerBody({
  definitionId,
  initialFlowMeta,
  onSaved,
  onDirtyChange,
}: DesignerBodyProps) {
  interface GraphState { nodes: WfFlowNode[]; edges: WfFlowEdge[] }
  const graph = useUndoRedo<GraphState>({ nodes: [], edges: [] });
  const nodes = graph.present.nodes;
  const edges = graph.present.edges;
  type Updater<T> = T | ((prev: T) => T);
  const resolve = <T,>(next: Updater<T>, prev: T): T =>
    typeof next === 'function' ? (next as (p: T) => T)(prev) : next;

  const setNodes = useCallback(
    (next: Updater<WfFlowNode[]>) =>
      graph.set({ nodes: resolve(next, graph.present.nodes), edges: graph.present.edges }, 'nodes'),
    [graph],
  );
  const setEdges = useCallback(
    (next: Updater<WfFlowEdge[]>) =>
      graph.set({ nodes: graph.present.nodes, edges: resolve(next, graph.present.edges) }, 'edges'),
    [graph],
  );
  const { undo, redo, canUndo, canRedo } = graph;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [flowMeta, setFlowMeta] = useState<FlowMeta>({ ...DEFAULT_FLOW_META, ...initialFlowMeta });
  const [metaDirty, setMetaDirty] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  /** 区分「仅保存」与「保存并发布」按钮的 loading 文案。 */
  const [savingMode, setSavingMode] = useState<'draft' | 'publish' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * 已落库的定义 ID：新建首次 POST 后写入，后续改走 PUT，避免重复 POST 撞唯一索引。
   * 编辑模式以 prop `definitionId` 为初值。
   */
  const [resolvedDefinitionId, setResolvedDefinitionId] = useState<string | undefined>(definitionId);
  /** 当前定义状态；已发布时保存前需先 deactivate（后端仅草稿可 PUT）。 */
  const [definitionStatus, setDefinitionStatus] = useState<string | null>(null);

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const handleNodeChange = useCallback(
    (id: string, patch: Partial<WfFlowNode['data']>) => {
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [],
  );

  const handleDeleteNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
    setSelectedNodeId(null);
  }, []);

  const handleFlowMetaChange = useCallback((next: FlowMeta) => {
    setFlowMeta(next);
    setMetaDirty(true);
  }, []);

  // 未保存改动 = 动过画布（撤销栈非空）或改过流程元数据
  const dirty = canUndo || metaDirty;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // prop 变化时同步已落库 ID（Dialog 换开另一条定义）。
  useEffect(() => {
    setResolvedDefinitionId(definitionId);
    setDefinitionStatus(null);
  }, [definitionId]);

  // 编辑模式：把已有定义还原成画布
  useEffect(() => {
    if (!definitionId) return;
    let alive = true;
    setMessage(null);
    fetchDefinition(definitionId, TENANT_ID)
      .then((d) => {
        if (!alive) return;
        graph.set(
          {
            nodes: (d.nodes ?? []).map(toFlowNode),
            edges: (d.edges ?? []).map(toFlowEdge),
          },
          'load',
          false,
        );
        setFlowMeta({
          code: d.code,
          name: d.name,
          categoryId: d.categoryId ?? null,
          description: d.description ?? '',
          supportedFormCodes: (d.supportedFormCodes ?? []).join(','),
        });
        setDefinitionStatus(d.status ?? null);
        setMetaDirty(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setMessage(`加载流程定义失败：${e instanceof Error ? e.message : '未知错误'}`);
      });
    return () => {
      alive = false;
    };
    // ⚠️ graph 是每次渲染的新对象，进依赖会无限循环；这里只在 definitionId 变化时加载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionId]);

  // 键盘快捷键：Ctrl+Z 撤销 / Ctrl+Shift+Z 重做 / Delete 删除选中节点
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        handleDeleteNode(selectedNodeId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectedNodeId, handleDeleteNode]);

  const handleAutoLayout = useCallback(() => {
    setNodes((prev) => applyDagreLayout(prev, edges));
  }, [edges]);

  const handleValidate = useCallback(() => {
    const result = validateWorkflow(nodes, edges);
    setValidation(result);
    setMessage(result.valid ? '校验通过，可发布' : `校验未通过：${result.errors.length} 个错误`);
    return result;
  }, [nodes, edges]);

  /**
   * 持久化画布。
   * @param publish true = 保存后 activate；false = 仅落草稿（不发布）。
   *
   * <p>⚠️ 后端 {@code update} 仅允许 DRAFT：已发布定义必须先 {@code deactivate} 再 PUT，
   * 否则会报「仅草稿状态可修改」——表现为「保存并发布无效、再开看不到改动」。
   */
  const handleSave = useCallback(
    async (publish: boolean) => {
      setMessage(null);
      const result = validateWorkflow(nodes, edges);
      setValidation(result);
      if (!result.valid) {
        setMessage(`校验未通过：${result.errors.map((e) => e.message).join('；')}`);
        return;
      }
      if (!flowMeta.code.trim() || !flowMeta.name.trim()) {
        setMessage('请填写流程编码与名称');
        return;
      }

      setSaving(true);
      setSavingMode(publish ? 'publish' : 'draft');
      try {
        const payload = {
          code: flowMeta.code.trim(),
          name: flowMeta.name.trim(),
          categoryId: flowMeta.categoryId,
          description: flowMeta.description,
          supportedFormCodes: flowMeta.supportedFormCodes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          config: '{}',
          nodes: nodes.map((n, idx) => ({
            nodeCode: n.data.nodeCode,
            nodeName: n.data.nodeName,
            nodeType: n.data.kind,
            sortOrder: idx,
            canvasX: n.position.x,
            canvasY: n.position.y,
            conditionExpr: n.data.conditionExpr ?? null,
            assigneeRule: n.data.assigneeRule,
            timeoutHours: n.data.timeoutHours ?? null,
            config:
              n.data.kind === 'ROUTING'
                ? JSON.stringify({ routingStrategy: n.data.routingStrategy ?? 'ALL_PASS' })
                : '{}',
          })),
          // 画布连线 → 后端 wf_edge（支撑条件分支图式流转）
          edges: edges.map((e, idx) => {
            const sourceNode = nodes.find((n) => n.id === e.source);
            const targetNode = nodes.find((n) => n.id === e.target);
            const isConditional = sourceNode?.data.kind === 'CONDITIONAL';
            return {
              source: sourceNode?.data.nodeCode ?? e.source,
              target: targetNode?.data.nodeCode ?? e.target,
              edgeType: isConditional ? (idx % 2 === 0 ? 'CONDITION_YES' : 'CONDITION_NO') : 'DEFAULT',
              label: typeof e.label === 'string' ? e.label : null,
              conditionExpr: sourceNode?.data.conditionExpr ?? null,
              sortOrder: idx,
            };
          }),
        };

        let defId = resolvedDefinitionId ?? '';
        // 已发布：先取消发布，才能通过「仅草稿可改」守卫。
        if (defId && definitionStatus === 'ACTIVE') {
          const deact = await api.post<ApiResult<null>>(
            `/workflow/definitions/${defId}/deactivate`,
            null,
            { params: { tenantId: TENANT_ID } },
          );
          if (deact.data.code !== 0) throw new Error(deact.data.message || '取消发布失败');
          setDefinitionStatus('DRAFT');
        }

        // 编辑模式走 PUT（端点由 V128 的 sys_api 95056 补登记，之前是 403）；新建走 POST。
        if (defId) {
          const put = await api.put<ApiResult<null>>(`/workflow/definitions/${defId}`, payload, {
            params: { tenantId: TENANT_ID },
          });
          if (put.data.code !== 0) throw new Error(put.data.message || '保存失败');
        } else {
          const res = await api.post<ApiResult<number>>('/workflow/definitions', payload, {
            params: { tenantId: TENANT_ID, operatorId: 1 },
          });
          if (res.data.code !== 0 || res.data.data == null) {
            throw new Error(res.data.message || '保存失败');
          }
          defId = String(res.data.data);
          setResolvedDefinitionId(defId);
          setDefinitionStatus('DRAFT');
        }

        if (publish) {
          const act = await api.post<ApiResult<null>>(`/workflow/definitions/${defId}/activate`, null, {
            params: { tenantId: TENANT_ID },
          });
          if (act.data.code !== 0) throw new Error(act.data.message || '发布失败');
          setDefinitionStatus('ACTIVE');
          setMetaDirty(false);
          setMessage(`已保存并发布（定义 ID ${defId}）`);
          onSaved?.(defId, { close: true });
        } else {
          setDefinitionStatus('DRAFT');
          setMetaDirty(false);
          setMessage(`已保存为草稿（定义 ID ${defId}）`);
          onSaved?.(defId, { close: false });
        }
      } catch (e) {
        // ⚠️ 后端把唯一索引冲突兜成 500「系统内部错误」，这里翻成人话（详见 save-error.ts）。
        setMessage(friendlySaveError(e, flowMeta.code));
      } finally {
        setSaving(false);
        setSavingMode(null);
      }
    },
    [nodes, edges, flowMeta, resolvedDefinitionId, definitionStatus, onSaved],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={resolvedDefinitionId ? '编辑流程' : '流程设计器'}
        description="拖拽编排审批流；表单白名单支持一个流程对接多个表单"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={!canUndo} onClick={undo} title="撤销 (Ctrl+Z)">
              撤销
            </Button>
            <Button size="sm" variant="outline" disabled={!canRedo} onClick={redo} title="重做 (Ctrl+Shift+Z)">
              重做
            </Button>
            <Button size="sm" variant="outline" onClick={handleAutoLayout}>
              自动布局
            </Button>
            <Button size="sm" variant="outline" onClick={handleValidate}>
              校验
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => void handleSave(false)}
              title="只保存为草稿，不发布"
            >
              {saving && savingMode === 'draft' ? '保存中…' : '仅保存'}
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void handleSave(true)}>
              {saving && savingMode === 'publish' ? '保存中…' : '保存并发布'}
            </Button>
          </div>
        }
      />

      {message ? (
        <div className="mb-2 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-[12px] text-muted-foreground">
          {message}
        </div>
      ) : null}
      {validation && !validation.valid ? (
        <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-[12px] text-destructive">
          {validation.errors.map((e, i) => (
            <div key={i}>· {e.message}</div>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border">
        <Palette />
        <div className="min-w-0 flex-1">
          <DesignerCanvas
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            onSelectNode={setSelectedNodeId}
          />
        </div>
        <PropertyPanel
          selected={selected}
          flowMeta={flowMeta}
          onFlowMetaChange={handleFlowMetaChange}
          onNodeChange={handleNodeChange}
          onDeleteNode={handleDeleteNode}
        />
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        节点 {nodes.length} · 连线 {edges.length} · {WF_NODE_TYPES ? '支持拖拽 / 连线 / 自动布局' : ''}
      </div>
    </div>
  );
}

export default DesignerBody;
