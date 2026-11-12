/**
 * iqd-config-page.tsx — 问数配置（路径 /iqd/config，2026-09-29 分层改版）。
 *
 * <h2>两个 Tab（用户拍板）</h2>
 * <ol>
 *   <li><b>数据库连接配置</b>（{@link DbProfilePanel}）：业务库连接 = wren profile，
 *       保存即新建/修改 profile（name / datasource / host / port / database / user / password），
 *       可测试数据库连通性；<b>密码入 vault、不回显</b>。</li>
 *   <li><b>项目配置</b>（{@link ProjectPanel}）：项目 = wren context（语义工程），
 *       name / 选择数据库连接 / 启停 / 启停 MCP。</li>
 * </ol>
 * 「可视化工作台」只按 **项目** 切换。
 *
 * <h2>为什么这样分</h2>
 * 原先把「业务库在哪（profile）」与「语义工程是什么（context）」混在 iqd_connection 一行，
 * 菜单与心智混乱；且 profile 与 project 被 1:1 硬绑。分层后 profile : project = 1 : N。
 *
 * <h2>权限</h2>
 * 数据库连接配置：{@code iqd:config:view/save/test}；项目：{@code iqd:modeling:edit} + {@code iqd:mcp:manage}。
 */
import { useState } from 'react';
import { Database, FolderCog } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DbProfilePanel } from './components/config/DbProfilePanel';
import { ProjectPanel } from './components/config/ProjectPanel';
import { ConnectionWizard } from './components/wizard/ConnectionWizard';
import type { Connection } from './types/modeling';

export const IQD_CONFIG_PAGE_PATH = '/iqd/config';

export function IqdConfigPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Connection | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setWizardOpen(true);
  };
  const openEdit = (connection: Connection) => {
    setEditTarget(connection);
    setWizardOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        title="问数配置"
        description="数据库连接（wren profile）与项目（wren context）分开配置：连接管「业务库在哪」，项目管「语义工程」。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '问数配置' })}
      />

      <div className="min-h-0 flex-1 overflow-auto px-1">
        <Tabs defaultValue="db-profiles" className="flex min-h-0 flex-col">
          <TabsList className="w-fit">
            <TabsTrigger value="db-profiles" className="gap-1.5">
              <Database className="h-4 w-4" />
              数据库连接配置
            </TabsTrigger>
            <TabsTrigger value="projects" className="gap-1.5">
              <FolderCog className="h-4 w-4" />
              项目配置
            </TabsTrigger>
          </TabsList>

          <TabsContent value="db-profiles" className="mt-3">
            <DbProfilePanel />
          </TabsContent>

          <TabsContent value="projects" className="mt-3">
            <ProjectPanel onOpenCreate={openCreate} onOpenEdit={openEdit} />
          </TabsContent>
        </Tabs>
      </div>

      <ConnectionWizard
        open={wizardOpen}
        onOpenChange={(next) => {
          setWizardOpen(next);
          if (!next) setEditTarget(null);
        }}
        editTarget={editTarget}
        onConnectionReady={() => {
          setWizardOpen(false);
          setEditTarget(null);
        }}
      />
    </div>
  );
}

export default IqdConfigPage;
