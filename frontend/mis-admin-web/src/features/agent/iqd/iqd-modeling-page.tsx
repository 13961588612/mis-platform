/**
 * iqd-modeling-page.tsx — 可视化建模台主页（MR-S1，路径 `/iqd/modeling`）。
 *
 * <h2>本批（T02b-1）交付范围</h2>
 * 三栏壳（可拖拽调宽 + 可折叠，A-15）+ **中间真画布**（`ModelCanvas` → `useCatalogNodes` 派生）；
 * 左 `ModelTree` / 右 `PropertyPanel` 本批只有**最小占位**（T02b-2 实现，见文件内 `TODO(T02b-2)`）。
 *
 * <h2>连接上下文（A-12 / A-14）</h2>
 * <ul>
 *   <li>挂载即拉 `GET /connections`；**一条都没有** → 空态引导去连接向导（A-12）；</li>
 *   <li>有连接但 store 未选中 → 自动选第一条（先到先用，避免空白页）；</li>
 *   <li>切换连接 → `store.setConnectionId` 会清空选中/抽屉/草稿/wizard（A-14 不串扰），
 *       画布再按 `key=connId` 重挂载（见 `ModelCanvas`）。</li>
 * </ul>
 *
 * <h2>为什么连接 id 在 store 里是 string</h2>
 * T01 定稿的 `ModelingStore.connectionId` 是 `string | null`（对齐 §5 类图）；wire/REST 用数字。
 * 边界处用 {@link toConnectionId} 统一转换，**不散落 `Number()`**（`NaN` 会一路传到 axios 变成
 * `?connectionId=NaN`，静默查空）。
 *
 * <h2>注册链路（「四处同改」）</h2>
 * ① `lib/nav/iqd-nav.ts`（leaf，icon Workflow）② `components/layout/keep-alive-outlet.tsx`
 * (`PAGE_MAP`) ⑤ `V87__iqd_modeling_seed.sql`（sys_menu 92600）+ `lib/nav/icons.ts`（ICON_MAP）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { IQD_MODELING_PERMISSIONS, useIqdModelingPermission } from './components/shared/usePermission';
import { PermissionGate } from '@/components/auth/permission-gate';
import type { IqdCatalogItem } from '@/lib/api/iqd';
import { ModelCanvas } from './components/modeling/ModelCanvas';
import { CubeEditor } from './components/modeling/CubeEditor';
import { AutoLayoutButton } from './components/modeling/AutoLayoutButton';
import { PublishPipelineBar } from './components/modeling/PublishPipelineBar';
import { DriftDetailPanel } from './components/modeling/DriftDetailPanel';
import { ModelTree } from './components/modeling/ModelTree';
import { PropertyPanel } from './components/modeling/PropertyPanel';
import { ConnectionWizard } from './components/wizard/ConnectionWizard';
import { TableImportWizard } from './components/wizard/TableImportWizard';
import { iqdKeys } from './queries/iqd-keys';
import { listConnections } from './api/iqd-modeling';
import { useModelingStore } from './store/modeling-store';

/** 建模台主页路径（导航 / PAGE_MAP / 页面组件共用常量，避免字符串漂移）。 */
export const IQD_MODELING_PAGE_PATH = '/iqd/modeling';

/** 三栏宽度默认值（百分比）：左树 20% / 右栏 22%，中间自适应。 */
const DEFAULT_LEFT_PCT = 20;
const DEFAULT_RIGHT_PCT = 22;
/** 拖拽限幅（百分比）：太窄不可读，太宽吃掉画布。 */
const MIN_PANE_PCT = 12;
const MAX_PANE_PCT = 40;

/** store 的 `connectionId`（string）→ REST 用的数字 id；非法一律 null（不产生 NaN 查询）。 */
function toConnectionId(value: string | null): number | null {
  if (value == null || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 纵向拖拽手柄（A-15：三栏可拖拽调宽）。
 *
 * <p>用 pointer capture + `window` 级 move/up 监听（拖到画布/iframe 上也不丢事件，
 * 这是浏览器内拖拽最容易出的「松手仍在拖」问题的标准解法）。位移按容器宽度换算成百分比，
 * 保证窗口缩放时比例语义稳定。
 */
function ResizeHandle({
  side,
  onResize,
  containerRef,
}: {
  side: 'left' | 'right';
  onResize: (deltaPct: number) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const width = containerRef.current?.clientWidth ?? 0;
      if (width <= 0) {
        return;
      }
      let last = event.clientX;
      const move = (ev: PointerEvent) => {
        const delta = ev.clientX - last;
        last = ev.clientX;
        onResize((delta / width) * 100);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [containerRef, onResize],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度'}
      onPointerDown={onPointerDown}
      className="w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40"
    />
  );
}

/** 建模台主页。 */
export function IqdModelingPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { canView, canEdit } = useIqdModelingPermission();
  const connectionId = useModelingStore((state) => state.connectionId);
  const setConnectionId = useModelingStore((state) => state.setConnectionId);

  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT_PCT);
  const [rightPct, setRightPct] = useState(DEFAULT_RIGHT_PCT);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  /** 向导开关（向导组件自持步骤状态，页面只持 open）——T02b-3 打通入口。 */
  const [connectionWizardOpen, setConnectionWizardOpen] = useState(false);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  /**
   * Cube 编辑器开关（T03c）。
   *
   * <p>编辑器状态归**页面**而不是树/画布：与两个向导同一模式（树只发意图），
   * 且 `CubeEditor` 里用的是 Radix Dialog（portal 到 body），放哪层渲染视觉一致。
   * `cube=null` → 新建；`defaultModelKey` 来自树里选中的模型。
   */
  const [cubeEditor, setCubeEditor] = useState<{
    cube: IqdCatalogItem | null;
    defaultModelKey: string | null;
  } | null>(null);
  const panesRef = useRef<HTMLDivElement | null>(null);

  /**
   * Keep-alive 切到其它 Tab（如「连接配置」）时本页仍挂载，但用 `invisible` 藏。
   * ReactFlow 节点/面板 z-index 可达上千，会穿透到前台页或 Dialog 上 ——
   * 非激活路由时不挂载画布；有 Dialog 打开时用 `invisible` 压住图层。
   */
  const isActiveRoute = location.pathname === IQD_MODELING_PAGE_PATH;
  const overlayOpen =
    connectionWizardOpen || importWizardOpen || cubeEditor != null;

  /** 连接清单（与连接向导共用同一 queryKey → 向导保存后失效一次即可全站同步）。 */
  const connectionsQuery = useQuery({
    queryKey: iqdKeys.connections(),
    queryFn: listConnections,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const activeId = toConnectionId(connectionId);
  const activeConnection = useMemo(
    () => connections.find((item) => item.id === activeId) ?? null,
    [connections, activeId],
  );

  // 有连接但未选中 → 自动选第一条（A-12：别让用户进来看空白）
  useEffect(() => {
    if (connectionId == null && connections.length > 0 && connections[0].id != null) {
      setConnectionId(String(connections[0].id));
    }
  }, [connectionId, connections, setConnectionId]);

  // store 指向的连接已被删除/不可见 → 回落第一条（避免画布拿着悬空 id 反复 404）
  useEffect(() => {
    if (connectionId != null && connections.length > 0 && activeConnection == null) {
      const first = connections.find((item) => item.id != null);
      setConnectionId(first?.id != null ? String(first.id) : null);
    }
  }, [connectionId, connections, activeConnection, setConnectionId]);

  /**
   * 切换连接（A-14）：改 store.connectionId 会清空选中/抽屉/草稿/wizard，避免跨连接串扰；
   * 画布按 key=connId 重挂载。此前该能力只写在注释里、**没有 UI 入口**，导致用户
   * 建了新连接却只能看默认第一条（表发现也只有它的表）。
   */
  const onConnectionChange = useCallback(
    (value: string) => {
      setConnectionId(value);
    },
    [setConnectionId],
  );

  const clampLeft = useCallback((deltaPct: number) => {
    setLeftPct((prev) => Math.min(MAX_PANE_PCT, Math.max(MIN_PANE_PCT, prev + deltaPct)));
  }, []);
  const clampRight = useCallback((deltaPct: number) => {
    setRightPct((prev) => Math.min(MAX_PANE_PCT, Math.max(MIN_PANE_PCT, prev - deltaPct)));
  }, []);

  // ---------------------------------------------------------------- 空态（A-12）

  const noConnection = !connectionsQuery.isLoading && connections.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        title="可视化建模台"
        description="拖拽式语义建模：连接 → 表发现导入 → 模型/关系/Cube → 发布流水线。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '可视化建模台' })}
        actions={
          <div className="flex items-center gap-2">
            {/* 连接切换器（A-14）：建模台一切以「连接」为上下文，必须能切。
                此前只有只读 Badge + 自动选第一条 → 新建连接后无法切过去看它的表。 */}
            {connections.length > 0 && (
              <Select
                value={connectionId != null ? String(connectionId) : undefined}
                onValueChange={onConnectionChange}
                disabled={connectionsQuery.isLoading}
              >
                <SelectTrigger className="h-8 w-[13rem]">
                  <SelectValue placeholder="选择连接" />
                </SelectTrigger>
                <SelectContent>
                  {connections
                    .filter((c) => c.id != null)
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                        {c.mcp_status ? ` · ${c.mcp_status}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            {activeConnection && activeConnection.status && (
              <Badge variant="outline" className="text-[12px]">
                {activeConnection.status}
              </Badge>
            )}
            {/* 一键整理画布（T03d）：dagre 在浏览器算，落库复用 PUT layout */}
            <AutoLayoutButton connectionId={activeId} canEdit={canEdit} />
            <PermissionGate permission={IQD_MODELING_PERMISSIONS.edit}>
              <Button size="sm" variant="outline" onClick={() => setConnectionWizardOpen(true)}>
                <Plus className="h-4 w-4" />
                新建连接
              </Button>
            </PermissionGate>
          </div>
        }
      />

      {!canView && (
        <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-muted-foreground">
          当前账号无 iqd:modeling:view 权限，无法查看建模台。
        </div>
      )}

      {canView && noConnection && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded border border-dashed border-border/60 text-center">
          <p className="text-[13px] font-medium">尚未创建问数连接</p>
          <p className="max-w-md text-[12px] text-muted-foreground">
            建模台的一切都以「连接」为上下文（表发现、模型、发布流水线都挂在连接下）。
            请先创建一个连接，再由 DBA 完成 profile 注入。
          </p>
          <Button size="sm" onClick={() => setConnectionWizardOpen(true)}>
            <Plus className="h-4 w-4" />
            去创建连接
          </Button>
        </div>
      )}

      {canView && !noConnection && (
        <>
          {/* 发布流水线（T03d）：编辑落库 → MDL build → memory index → MCP 就绪 */}
          <PublishPipelineBar connectionId={activeId} />
          {/* 外部漂移详情面板（T04b / MR-11）：非漂移时自身返回 null（不产生空壳） */}
          <DriftDetailPanel connectionId={activeId} />
          <div ref={panesRef} className="flex min-h-0 flex-1">
          {/* ---------- 左：模型树（T02b-2 实现） ---------- */}
          {!leftCollapsed && (
            <aside
              style={{ width: `${leftPct}%` }}
              className="flex min-h-0 shrink-0 flex-col border-r border-border/60"
              aria-label="模型树"
            >
              <div className="flex items-center justify-between border-b border-border/60 px-2 py-1.5">
                <span className="text-[13px] font-medium">模型</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  title="折叠左栏"
                  onClick={() => setLeftCollapsed(true)}
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </div>
              {/* ModelTree：连接 → 模型/物理表/指标/关系 分组 + 搜索 + 表发现导入 + 新建 Cube（T03c） */}
              <ModelTree
                connectionId={activeId}
                onOpenImport={() => setImportWizardOpen(true)}
                onOpenCube={(cube, defaultModelKey) => setCubeEditor({ cube, defaultModelKey })}
              />
            </aside>
          )}
          {leftCollapsed ? (
            <button
              type="button"
              title="展开左栏"
              onClick={() => setLeftCollapsed(false)}
              className="flex w-6 shrink-0 items-center justify-center border-r border-border/60 hover:bg-accent/60"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          ) : (
            <ResizeHandle side="left" onResize={clampLeft} containerRef={panesRef} />
          )}

          {/* ---------- 中：ER 画布 ---------- */}
          {/*
            isolate + z-0：把 ReactFlow 内部超高 z-index 关进本层，避免盖住 Dialog。
            切走本路由时不挂载画布（Keep-alive 后台页用 hidden，双保险防透到连接配置）。
            本层必须是 flex 容器，否则子级 ModelCanvas 的 flex-1 高度塌成 0 → 节点全看不到。
          */}
          <div
            className={cn(
              'relative z-0 isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background',
              overlayOpen && 'invisible pointer-events-none',
            )}
          >
            {isActiveRoute ? <ModelCanvas connectionId={activeId} /> : null}
          </div>

          {/* ---------- 右：属性面板（T02b-2 实现） ---------- */}
          {rightCollapsed ? (
            <button
              type="button"
              title="展开右栏"
              onClick={() => setRightCollapsed(false)}
              className="flex w-6 shrink-0 items-center justify-center border-l border-border/60 hover:bg-accent/60"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          ) : (
            <ResizeHandle side="right" onResize={clampRight} containerRef={panesRef} />
          )}
          {!rightCollapsed && (
            <aside
              style={{ width: `${rightPct}%` }}
              className="flex min-h-0 shrink-0 flex-col border-l border-border/60"
              aria-label="属性面板"
            >
              <div className="flex items-center justify-between border-b border-border/60 px-2 py-1.5">
                <span className="text-[13px] font-medium">属性</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  title="折叠右栏"
                  onClick={() => setRightCollapsed(true)}
                >
                  <PanelRightClose className="h-4 w-4" />
                </Button>
              </div>
              {/* PropertyPanel：复用 catalog 缓存 + store.selectedItemKey（不再发请求） */}
              <PropertyPanel connectionId={activeId} />
            </aside>
          )}
          </div>
        </>
      )}

      {/* ---------------- 向导（Dialog 式，T02b-3 打通入口） ---------------- */}
      <ConnectionWizard
        open={connectionWizardOpen}
        onOpenChange={setConnectionWizardOpen}
        onConnectionReady={(id) => {
          // A-14：切连接会清空选中/抽屉/草稿/wizard，故必须走 store 而不是本地态
          setConnectionId(String(id));
        }}
      />
      <TableImportWizard
        open={importWizardOpen}
        onOpenChange={setImportWizardOpen}
        connectionId={activeId}
        onOpenConnectionWizard={() => setConnectionWizardOpen(true)}
        onImported={() => {
          // Q5 单源：失效 catalog 缓存 → 画布/左树/右栏同时刷新
          void queryClient.invalidateQueries({ queryKey: iqdKeys.catalogs(activeId) });
        }}
      />
      {/* Cube 编辑器（T03c 新建全功能 / T04b 既有编辑走 PUT /catalog/cube） */}
      <CubeEditor
        open={cubeEditor != null}
        onOpenChange={(next) => {
          if (!next) {
            setCubeEditor(null);
          }
        }}
        connectionId={activeId}
        cube={cubeEditor?.cube ?? null}
        defaultModelKey={cubeEditor?.defaultModelKey ?? null}
      />
    </div>
  );
}

export default IqdModelingPage;
