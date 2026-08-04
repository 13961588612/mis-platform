import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KbQaRecordTab } from './kb-qa-record-tab';
import { KbTicketTab } from './kb-ticket-tab';
import { KbDashboardTab } from './kb-dashboard-tab';

/**
 * 知识库问答运营页。
 *
 * <p>三个页签对应 P1 增量的三块运营能力：
 * - **问答记录**（A-02b 分页检索 + A-02a 详情 + A-02e CSV 导出）
 * - **反馈工单**（A-02c 建单流转闭环）
 * - **评价看板**（A-02b/d 指标汇总与趋势）
 *
 * <p>页签内容各自独立取数、独立分页。Radix Tabs 默认**卸载非激活页签**，
 * 因此切走再切回会重新挂载并重新拉数（筛选条件随之重置）——这是有意保留的行为：
 * 运营数据实时性优先于表单记忆；若后续需要保留筛选态，应把 filter 提升到本页
 * 或加 `forceMount`，而不是在子组件里做 localStorage 缓存。
 *
 * <p>P0 的「全量会话 + 全量反馈」只读视图已被 A-02b 的服务端分页列表取代；
 * 对应接口迁至 `/operations/qa/sessions-all`，仍保留但不再有页面入口。
 */
export function KbOperationsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title="问答运营"
        description="问答记录检索与回放、反馈工单闭环、评价指标看板；数据不做用户归属过滤，需运营权限访问。"
      />

      <Tabs defaultValue="records" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="shrink-0">
          <TabsTrigger value="records">问答记录</TabsTrigger>
          <TabsTrigger value="tickets">反馈工单</TabsTrigger>
          <TabsTrigger value="dashboard">评价看板</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="flex min-h-0 flex-1 flex-col">
          <KbQaRecordTab />
        </TabsContent>
        <TabsContent value="tickets" className="flex min-h-0 flex-1 flex-col">
          <KbTicketTab />
        </TabsContent>
        <TabsContent value="dashboard" className="flex min-h-0 flex-1 flex-col">
          <KbDashboardTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
