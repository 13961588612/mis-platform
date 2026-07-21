import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface CopilotPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CopilotPanel({ open, onOpenChange }: CopilotPanelProps) {
  const [input, setInput] = useState('');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Copilot
          </SheetTitle>
          <SheetDescription>Phase 1 占位：无真实 LLM，仅预留布局与入口</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
            你好，我是 MIS Copilot。后续将接入 agent-gateway 提供问答、表单辅助与操作指引。
            当前为静态欢迎文案。
          </div>
          <div className="mt-auto space-y-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled
              placeholder="输入问题…（Phase 3 启用）"
              className="min-h-[5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm opacity-60"
            />
            <Button type="button" className="w-full" disabled>
              发送（即将上线）
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
