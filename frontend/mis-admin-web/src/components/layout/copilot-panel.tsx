import { Sparkles } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AiCopilot } from '@/features/ai/components/ai-copilot';

interface CopilotPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 全局 Copilot 浮窗（由 ai-store.copilotOpen 驱动；内部渲染 SDK 驱动的 <AiCopilot/>） */
export function CopilotPanel({ open, onOpenChange }: CopilotPanelProps) {
  return (
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
  );
}
