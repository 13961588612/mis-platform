/**
 * 流程设计器主页面（P7）—— 三栏布局。
 *
 * <p>左：Palette 拖拽节点；中：@xyflow/react 画布；右：属性面板（含表单白名单）。
 * 底部：Dagre 自动布局 / 校验 / 保存并发布。
 *
 * <p>后端对接：`POST /api/v1/workflow/definitions`（保存草稿后激活），
 * `supportedFormCodes` 即设计文档中的表单白名单。
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
import { WF_NODE_TYPES, type WfFlowEdge, type WfFlowNode } from './types';
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

const TENANT_ID = '1';

export function WorkflowDesignerPage() {
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
  const [flowMeta, setFlowMeta] = useState<FlowMeta>({
    code: '',
    name: '',
    category: 'APPROVAL',
    description: '',
    supportedFormCodes: '',
  });
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  const handleSave = useCallback(async () => {
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
    try {
      const payload = {
        code: flowMeta.code.trim(),
        name: flowMeta.name.trim(),
        category: flowMeta.category.trim() || 'APPROVAL',
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
      const res = await api.post<ApiResult<number>>('/workflow/definitions', payload, {
        params: { tenantId: TENANT_ID, operatorId: 1 },
      });
      if (res.data.code !== 0 || res.data.data == null) {
        throw new Error(res.data.message || '保存失败');
      }
      const defId = res.data.data;
      const act = await api.post<ApiResult<null>>(`/workflow/definitions/${defId}/activate`, null, {
        params: { tenantId: TENANT_ID },
      });
      if (act.data.code !== 0) throw new Error(act.data.message || '发布失败');
      setMessage(`已保存并发布（定义 ID ${defId}）`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, flowMeta]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="流程设计器"
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
            <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
              {saving ? '保存中…' : '保存并发布'}
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
          onFlowMetaChange={setFlowMeta}
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

export default WorkflowDesignerPage;
