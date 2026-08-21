/**
 * 全局 Copilot：可拖动 FAB + 右侧 Sheet（T06' 重写）。
 *
 * <p>废弃 iframe 嵌入（CopilotH5Frame），改为**原生 A2UI 渲染**：
 * - chat-core + A2UI 渲染层整体包入 `@/components/chat/CopilotPanel`，经 React.lazy
 *   按需加载（Sheet 打开才拉包，01-architecture.md §7.2 策略 1）
 * - modulepreload 预热（P1）：页面空闲时 prefetch 该 chunk，Sheet 打开秒开
 * - 会话状态由 chat-core（zustand chat-store）持有，关闭 Sheet 不销毁
 */

import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  // modulepreload 预热（P1）：页面空闲时提前拉 chunk，Sheet 打开秒开
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('@/components/chat/CopilotPanel');
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
        <SheetContent
          side="right"
          forceMount
          className="flex h-dvh max-h-dvh w-full max-w-xl flex-col overflow-hidden p-0 sm:max-w-xl"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Copilot
            </SheetTitle>
            <SheetDescription>原生对话 · A2UI 动态界面 · 直连 Agent 网关</SheetDescription>
          </SheetHeader>
          <Suspense fallback={<CopilotPanelFallback />}>
            {open ? <CopilotPanelLazy /> : null}
          </Suspense>
        </SheetContent>
      </Sheet>

      {!open && <CopilotFab onOpen={() => onOpenChange(true)} />}
    </>
  );
}
