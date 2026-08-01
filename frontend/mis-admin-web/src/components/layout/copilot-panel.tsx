import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
import { AiCopilot } from '@/features/ai/components/ai-copilot';

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
    /* ignore quota / private mode */
  }
}

/** 可拖动的全局 Copilot FAB；短按打开，拖动仅改位置并持久化。 */
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
      // 点击由 pointer 短按打开；阻止默认 click 以免拖动后误触
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
 * 全局 Copilot 浮窗（由 ai-store.copilotOpen 驱动；内部渲染 <AiCopilot/>）。
 *
 * 唯一主入口：可拖动全局 FAB（与页内「智能录入」无关）。
 * 另支持 Ctrl/Cmd+J。面板打开时隐藏 FAB，避免与右侧抽屉重叠。
 */
export function CopilotPanel({ open, onOpenChange }: CopilotPanelProps) {
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex h-dvh max-h-dvh w-full max-w-md flex-col overflow-hidden p-0 sm:max-w-md"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Copilot
            </SheetTitle>
            <SheetDescription>基于当前页面上下文的常驻 AI 助手</SheetDescription>
          </SheetHeader>
          <AiCopilot open={open} onOpenChange={onOpenChange} />
        </SheetContent>
      </Sheet>

      {!open && <CopilotFab onOpen={() => onOpenChange(true)} />}
    </>
  );
}
