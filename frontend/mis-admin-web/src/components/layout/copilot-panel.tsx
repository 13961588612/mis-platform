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

/**
 * 全局 Copilot 浮窗（由 ai-store.copilotOpen 驱动；内部渲染 SDK 驱动的 <AiCopilot/>）。
 *
 * 除顶部 header 的 Sparkles 按钮与 Ctrl/Cmd+J 快捷键外，这里额外提供一个
 * 常驻在视口右下角的 FAB（浮动操作按钮），点击即可打开面板，符合用户对
 * “右下角浮窗”入口的预期。为避免遮挡右侧抽屉，面板打开时隐藏该 FAB。
 */
export function CopilotPanel({ open, onOpenChange }: CopilotPanelProps) {
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="max-w-md w-full p-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Copilot
            </SheetTitle>
            <SheetDescription>基于当前页面上下文的常驻 AI 助手（MVP 非流式）</SheetDescription>
          </SheetHeader>
          <AiCopilot open={open} onOpenChange={onOpenChange} />
        </SheetContent>
      </Sheet>

      {/* 常驻右下角浮窗(FAB)：面板打开时隐藏，避免与右侧 Sheet 抽屉重叠遮挡 */}
      {!open && (
        <Button
          type="button"
          variant="default"
          size="icon"
          aria-label="打开 AI 助手"
          title="打开 AI 助手"
          onClick={() => onOpenChange(true)}
          className={cn(
            'fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg',
            'transition-transform duration-150 hover:scale-105 active:scale-95',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          <Sparkles className="h-5 w-5" />
        </Button>
      )}
    </>
  );
}
