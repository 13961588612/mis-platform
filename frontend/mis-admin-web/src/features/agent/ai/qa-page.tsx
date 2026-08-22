/**
 * qa-page.tsx — 知识库问答页（T09，从 旧版独立前端 ChatPage + ChatPanel + kb-sources 迁移）。
 *
 * <p>逻辑迁移而非新写：useChat 对话 + kb-sources 折叠引用 + 消息反馈；
 * 消费 A2UI entity-select / data-table（经 SurfaceRenderer 渲染）。
 * 路由激活才建立连接（与 AiChatPanel active 门控联动，避免 keep-alive 双订阅）。
 */

import { useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { AiChatPanel } from './ai-chat-panel';

/** 知识库问答页路由（keep-alive-outlet PAGE_MAP 精确匹配）。 */
export const QA_PAGE_PATH = '/ai/qa';

export function QaPage() {
  const location = useLocation();
  const active = location.pathname === QA_PAGE_PATH;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="知识库问答"
        description="基于知识库检索的智能问答，回答附带可追溯的引用来源。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '知识库问答' })}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <AiChatPanel
          title="知识库问答"
          emptyHint="我是知识库问答助手。可以问我制度、流程、资料相关的问题，回答会附上引用来源；需要表格 / 表单 / 实体选择时，我会直接渲染可交互界面。"
          active={active}
        />
      </div>
    </div>
  );
}

export default QaPage;
