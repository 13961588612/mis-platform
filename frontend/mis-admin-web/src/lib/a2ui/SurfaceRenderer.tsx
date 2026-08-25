/**
 * SurfaceRenderer — A2UI Surface 渲染器（T06'）。
 *
 * <p>02 文档 §6.2：`@a2ui/react@0.9.1` P1 评估替换自研骨架（A2uiSurface + Generic Binder）；
 * 业务 catalog（4 组件）与权限门控与骨架解耦，换不换不影响组件与权限。
 * 本轮以自研骨架落地（P1 验证结论：@a2ui/react@0.9.1 peer 兼容 React 18 + zod ^3.23.8，
 * 可后续切换）。职责：
 * - 订阅 surface-store，渲染指定 surface（缺省取 activeSurfaceId）
 * - 组件级权限门控（A2uiPermissionGate，UX 层；Gateway 权威过滤兜底）
 * - 未知组件安全回退（绝不 dangerouslySetInnerHTML）
 * - 递归渲染 children（容器组件）
 */

import { type ReactNode } from 'react';
import { useSurfaceStore } from './surface-store';
import { getA2uiRegistryEntry, isKnownA2uiComponent } from '@/components/a2ui/registry';
import { A2uiPermissionGate } from '@/components/a2ui/A2uiPermissionGate';
import { useA2ui, A2uiNodeContext } from '@/components/a2ui/a2ui-context';
import type { A2uiComponentName, A2uiComponentNode } from './types';

export interface SurfaceRendererProps {
  /** 指定 surfaceId；缺省渲染 activeSurfaceId。 */
  surfaceId?: string;
  /** 空态占位（无 surface 时）。 */
  empty?: ReactNode;
  className?: string;
}

/** 是否为空 data-table（仅有列、无行）——渲染层会藏掉，避免对话里大块空白。 */
function isEmptyDataTable(node: A2uiComponentNode): boolean {
  if (node.component !== 'data-table') return false;
  const rows = node.props?.rows;
  return !Array.isArray(rows) || rows.length === 0;
}

/** 取 text 节点可见文案。 */
function textNodeContent(node: A2uiComponentNode): string {
  if (node.component !== 'text') return '';
  const raw =
    node.props?.content ?? node.props?.text ?? node.props?.label ?? node.props?.value ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * 空表前方的短标题（如「📌 设置完成确认清单」）一并隐藏，避免表被藏后标题孤零零残留。
 */
function isOrphanTableCaption(node: A2uiComponentNode, next: A2uiComponentNode | undefined): boolean {
  if (!next || !isEmptyDataTable(next)) return false;
  if (node.component !== 'text') return false;
  const text = textNodeContent(node);
  if (!text || text.length > 40) return false;
  return /清单|确认|checklist|📌|✓|✔/i.test(text) || !text.includes('\n');
}

/** 过滤空表及其标题 caption；递归处理 children。 */
function filterSurfaceNodes(nodes: A2uiComponentNode[]): A2uiComponentNode[] {
  const out: A2uiComponentNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const next = nodes[i + 1];
    if (isEmptyDataTable(node)) continue;
    if (isOrphanTableCaption(node, next)) continue;
    const children = node.children?.length ? filterSurfaceNodes(node.children) : node.children;
    out.push(children !== node.children ? { ...node, children } : node);
  }
  return out;
}

/** 渲染单个 A2UI Surface。 */
export function SurfaceRenderer({ surfaceId, empty, className }: SurfaceRendererProps) {
  const { activeSurfaceId } = useA2ui();
  const surfaces = useSurfaceStore((s) => s.surfaces);
  const targetId = surfaceId ?? activeSurfaceId;
  const surface = targetId ? surfaces[targetId] : undefined;

  if (!surface) {
    return empty != null ? <>{empty}</> : null;
  }

  const nodes = filterSurfaceNodes(surface.components);
  if (nodes.length === 0) {
    return empty != null ? <>{empty}</> : null;
  }

  return (
    <div className={className}>
      {nodes.map((node) => (
        <SurfaceNode key={node.id} surfaceId={surface.surfaceId} node={node} />
      ))}
    </div>
  );
}

/** 渲染单个组件节点（含权限门控 + 节点定位注入 + children 递归）。 */
function SurfaceNode({ node, surfaceId }: { node: A2uiComponentNode; surfaceId: string }) {
  const entry = getA2uiRegistryEntry(node.component);

  if (!entry || !isKnownA2uiComponent(node.component)) {
    return (
      <div className="my-2 rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
        <div className="font-medium">未知 A2UI 组件：{node.component}</div>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">
          {JSON.stringify(node.props ?? {}, null, 2)}
        </pre>
      </div>
    );
  }

  const Comp = entry.component;
  const filteredChildren = node.children?.length ? filterSurfaceNodes(node.children) : [];

  const childNodes =
    filteredChildren.length > 0 ? (
      <div className="space-y-2">
        {filteredChildren.map((child) => (
          <SurfaceNode key={child.id} surfaceId={surfaceId} node={child} />
        ))}
      </div>
    ) : null;

  // 容器类组件（container）将子节点包裹在内层；其余组件保持原行为（子节点作为兄弟块渲染），
  // 避免容器同时内外重复渲染导致布局错乱。
  const isContainer = node.component === 'container';

  return (
    <A2uiNodeContext.Provider key={node.id} value={{ surfaceId, componentId: node.id }}>
      <A2uiPermissionGate requiredPermission={entry.requiredPermission} deniedText={entry.deniedText}>
        <Comp
          component={node.component as A2uiComponentName}
          props={node.props}
          {...(isContainer ? { children: childNodes } : {})}
        />
      </A2uiPermissionGate>
      {!isContainer ? childNodes : null}
    </A2uiNodeContext.Provider>
  );
}

export default SurfaceRenderer;
