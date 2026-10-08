/**
 * 全局 Copilot：可拖动 FAB + 右侧 Sheet（T06' 重写）。
 *
 * <p>废弃 iframe 嵌入（CopilotH5Frame），改为**原生 A2UI 渲染**：
 * - chat-core + A2UI 渲染层整体包入 `@/components/chat/CopilotPanel`，经 React.lazy
 *   按需加载（Sheet 打开才拉包，01-architecture.md §7.2 策略 1）
 * - modulepreload 预热（P1）：页面空闲时 prefetch 该 chunk，Sheet 打开秒开
 * - 会话状态由 chat-core（zustand chat-store）持有，关闭 Sheet 不销毁
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Sparkles } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CopilotPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FAB_SIZE = 48;
const FAB_MARGIN = 16;
const DRAG_THRESHOLD_PX = 5;
const FAB_POS_KEY = 'mis.copilot.fab.pos';
/** 放大模式记忆 key（不阻塞首屏：useState 惰性初始化同步读）。 */
const EXPANDED_KEY = 'mis.copilot.expanded';

function readExpandedFlag(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeExpandedFlag(next: boolean): void {
  try {
    localStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
}

type FabPos = { x: number; y: number };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function defaultFabPos(): FabPos {
  if (typeof window === 'undefined') return { x: FAB_MARGIN, y: FAB_MARGIN };
  return {
    x: window.innerWidth - FAB_MARGIN - FAB_SIZE,
    y: window.innerHeight - FAB_MARGIN - FAB_SIZE,
  };
}

function clampFabPos(pos: FabPos): FabPos {
  if (typeof window === 'undefined') return pos;
  return {
    x: clamp(pos.x, FAB_MARGIN, window.innerWidth - FAB_MARGIN - FAB_SIZE),
    y: clamp(pos.y, FAB_MARGIN, window.innerHeight - FAB_MARGIN - FAB_SIZE),
  };
}

function loadFabPos(): FabPos {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    if (!raw) return defaultFabPos();
    const parsed = JSON.parse(raw) as Partial<FabPos>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return defaultFabPos();
    return clampFabPos({ x: parsed.x, y: parsed.y });
  } catch {
    return defaultFabPos();
  }
}

function saveFabPos(pos: FabPos) {
  try {
    localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

/** 可拖动的全局 Copilot FAB */
function CopilotFab({ onOpen }: { onOpen: () => void }) {
  const [pos, setPos] = useState<FabPos>(defaultFabPos);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    setPos(loadFabPos());
    const onResize = () => setPos((p) => clampFabPos(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setPos(clampFabPos({ x: drag.originX + dx, y: drag.originY + dy }));
  };

  const endPointer = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (drag.moved) {
      setPos((p) => {
        const next = clampFabPos(p);
        saveFabPos(next);
        return next;
      });
      return;
    }
    onOpen();
  };

  return (
    <Button
      type="button"
      variant="default"
      size="icon"
      aria-label="打开 AI Copilot"
      title="AI Copilot（可拖动 · Ctrl/⌘+J）"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onClick={(e) => e.preventDefault()}
      className={cn(
        'fixed z-50 h-12 w-12 touch-none rounded-full shadow-lg',
        'cursor-grab active:cursor-grabbing',
        'transition-shadow duration-150 hover:shadow-xl',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
      style={{ left: pos.x, top: pos.y }}
    >
      <Sparkles className="h-5 w-5 pointer-events-none" />
    </Button>
  );
}

/**
 * 原生 A2UI Copilot 面板（懒加载 chunk）。
 * chat-core + A2UI 渲染层 + 4 组件全部在此 chunk（≤120KB 验收口径）。
 */
const CopilotPanelLazy = lazy(() => import('@/components/chat/CopilotPanel'));

/** Sheet 打开前的加载占位（同步渲染，不触发额外拉包）。 */
function CopilotPanelFallback() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      正在加载 AI Copilot…
    </div>
  );
}

/**
 * 全局 Copilot：可拖动 FAB + 右侧 Sheet。
 * Sheet 打开才加载 CopilotPanel chunk；关闭保留 DOM（会话状态不丢）。
 */
export function CopilotPanel({ open, onOpenChange }: CopilotPanelProps) {
  // 放大模式：仅在「当前会话面板打开」时恢复；刷新后 open 恒为 false，
  // 若仍读 localStorage=1 会出现 expanded&&!open → FAB 与面板双不可见。
  const [expanded, setExpanded] = useState<boolean>(false);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      writeExpandedFlag(next);
      return next;
    });
  }, []);

  // 关闭时同步清掉放大记忆，避免下次刷新藏掉 FAB
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setExpanded(false);
        writeExpandedFlag(false);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // 打开面板时：若上次以放大态关闭前曾写过 flag，恢复放大；否则普通 Sheet
  useEffect(() => {
    if (open) {
      setExpanded(readExpandedFlag());
    }
  }, [open]);

  // modulepreload 预热（P1）：页面空闲时提前拉 chunk，Sheet 打开秒开
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('@/components/chat/CopilotPanel');
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      {/* 普通模式：右侧 Sheet（占满视口高度，内部仅消息区滚动） */}
      {!expanded ? (
        <Sheet open={open} onOpenChange={handleOpenChange} modal={false}>
          <SheetContent
            side="right"
            forceMount
            showCloseButton={false}
            className="flex h-[100dvh] max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden p-0 sm:max-w-xl"
          >
            {/* a11y：标题/描述留给屏幕阅读器；可视标题栏由 CopilotPanel 统一渲染 */}
            <SheetHeader className="sr-only">
              <SheetTitle>AI Copilot</SheetTitle>
              <SheetDescription>原生对话 · A2UI 动态界面 · 直连 Agent 网关</SheetDescription>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col">
              <Suspense fallback={<CopilotPanelFallback />}>
                {open ? (
                  <CopilotPanelLazy
                    expanded={false}
                    onToggleExpanded={toggleExpanded}
                    onRequestClose={() => handleOpenChange(false)}
                  />
                ) : null}
              </Suspense>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {/* 放大模式：全屏覆盖层（左侧会话列表 + 右侧聊天，参考豆包布局） */}
      {expanded && open ? (
        <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-background">
          <Suspense fallback={<CopilotPanelFallback />}>
            <CopilotPanelLazy
              expanded
              onToggleExpanded={toggleExpanded}
              onRequestClose={() => handleOpenChange(false)}
            />
          </Suspense>
        </div>
      ) : null}

      {/* 关闭态始终显示 FAB（与是否曾放大无关） */}
      {!open ? <CopilotFab onOpen={() => onOpenChange(true)} /> : null}
    </>
  );
}
