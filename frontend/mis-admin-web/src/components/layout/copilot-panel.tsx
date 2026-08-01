import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { ExternalLink, Sparkles } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import {
  buildAiH5ChatUrl,
  deriveModuleFromPath,
  getAiH5Origin,
  type AiH5ChildMessage,
  type AiH5ParentMessage,
} from '@/lib/ai-h5';

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

/** 向 H5 iframe 推送 MIS JWT + 页面上下文（DEP-7 M1） */
function CopilotH5Frame({ open }: { open: boolean }) {
  const location = useLocation();
  const accessToken = useAuthStore((s) => s.accessToken);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const h5ReadyRef = useRef(false);
  const [frameError, setFrameError] = useState(false);
  /** 首次打开后再挂载 iframe；关闭 Sheet 不销毁，以保留最近会话 */
  const [everOpened, setEverOpened] = useState(open);

  const h5Origin = getAiH5Origin();
  const chatUrl = buildAiH5ChatUrl(h5Origin);

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  const postToH5 = (msg: AiH5ParentMessage) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(msg, h5Origin);
  };

  const pushAuthAndContext = () => {
    if (!accessToken) return;
    postToH5({ type: 'AUTH_TOKEN', token: accessToken });
    postToH5({
      type: 'PAGE_CONTEXT',
      context: {
        route: location.pathname,
        module: deriveModuleFromPath(location.pathname),
      },
    });
  };

  // 监听 H5 AUTH_READY（iframe 常驻后仍需持续监听）
  useEffect(() => {
    if (!everOpened) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== h5Origin) return;
      const data = event.data as AiH5ChildMessage | null;
      if (data?.type !== 'AUTH_READY') return;
      h5ReadyRef.current = true;
      pushAuthAndContext();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅绑定 origin
  }, [everOpened, h5Origin, accessToken, location.pathname]);

  // 令牌或路由变化时，若 H5 已就绪则重推（打开时也推一次）
  useEffect(() => {
    if (!open || !h5ReadyRef.current) return;
    pushAuthAndContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, location.pathname, open]);

  if (!everOpened) return null;

  return (
    <div className={cn('relative min-h-0 flex-1 bg-muted/20', !open && 'hidden')}>
      {frameError ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>无法加载 AI 助手页面。</p>
          <p className="text-xs">
            请确认 Agent H5 已启动（默认 {h5Origin}），且已配置父域白名单。
          </p>
          <a
            href={chatUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            新窗口打开
          </a>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          title="AI Copilot"
          src={chatUrl}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write"
          onError={() => setFrameError(true)}
        />
      )}
    </div>
  );
}

/**
 * 全局 Copilot：可拖动 FAB + 右侧 Sheet。
 * 对话 UI 复用 Agent H5（通路 B），经 postMessage 推送 MIS JWT，避免与 H5 双份实现。
 */
export function CopilotPanel({ open, onOpenChange }: CopilotPanelProps) {
  const h5Origin = getAiH5Origin();

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
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
            <SheetDescription>
              复用 Agent 对话能力（{h5Origin}）· 与页内辅助录入相互独立
            </SheetDescription>
          </SheetHeader>
          <CopilotH5Frame open={open} />
        </SheetContent>
      </Sheet>

      {!open && <CopilotFab onOpen={() => onOpenChange(true)} />}
    </>
  );
}
