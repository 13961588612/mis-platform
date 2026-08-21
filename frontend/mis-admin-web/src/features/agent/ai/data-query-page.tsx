/**
 * data-query-page.tsx — 问数页（T09，从 /chat data-query 技能分发迁移）。
 *
 * <p>技能分发（skill-dispatch.ts：mis-rag / mis-summary / mis-extract / crm-assistant）
 * 迁入服务层；A2UI 结果渲染（data-table 等）经 SurfaceRenderer 渲染。
 * 页面对话由 Coordinator 统一调度，Worker 不暴露用户选择器（fail-closed）。
 */

import { useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { AiChatPanel } from './ai-chat-panel';
import { DATA_QUERY_SUGGESTIONS } from './services/skill-dispatch';

/** 问数页路由（keep-alive-outlet PAGE_MAP 精确匹配）。 */
export const DATA_QUERY_PAGE_PATH = '/ai/data-query';

export function DataQueryPage() {
  const location = useLocation();
  const active = location.pathname === DATA_QUERY_PAGE_PATH;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="问数"
        description="用自然语言查询、汇总、抽取业务数据，结果以表格形式呈现。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '问数' })}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <AiChatPanel
          title="问数"
          emptyHint="我是问数助手。支持数据汇总、信息抽取、知识库检索与 CRM 查询，结果以表格呈现（可点示例直接提问）。"
          suggestions={DATA_QUERY_SUGGESTIONS}
          active={active}
        />
      </div>
    </div>
  );
}

export default DataQueryPage;
