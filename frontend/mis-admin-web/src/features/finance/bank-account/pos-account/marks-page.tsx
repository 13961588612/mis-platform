import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SktMarkPanel } from './components/skt-mark-panel';
import { TerminalLogPanel } from './components/terminal-log-panel';
import { TerminalMarkPanel } from './components/terminal-mark-panel';

export function MarksPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
      <PageHeader
        className="shrink-0"
        title="标记与记录"
        description="操作记录、款台标记、终端标记（财务辅助 · 银行账目 · POS对账）"
      />

      <Tabs defaultValue="logs" className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <TabsList className="mb-0 w-fit shrink-0">
          <TabsTrigger value="logs">操作记录</TabsTrigger>
          <TabsTrigger value="skt">款台标记</TabsTrigger>
          <TabsTrigger value="terminal">终端标记</TabsTrigger>
        </TabsList>

        <TabsContent
          value="logs"
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <TerminalLogPanel />
        </TabsContent>
        <TabsContent
          value="skt"
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <SktMarkPanel />
        </TabsContent>
        <TabsContent
          value="terminal"
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <TerminalMarkPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
