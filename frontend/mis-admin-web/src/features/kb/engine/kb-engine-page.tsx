import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/page-header';
import { CapabilityBadge, EngineHealthBadge } from '../components/kb-badges';
import { useKbStore } from '../stores/use-kb-store';

/** 引擎类型说明（S-04 Port/Adapter，切换由 Nacos `mis.kb.engine.type` 决定）。 */
const ENGINE_DESC: Record<string, string> = {
  ragflow: 'RAGFlow 引擎：完整解析 / 切片 / 向量检索能力，需外部 Compose 栈就绪。',
  noop: '空实现引擎：所有检索返回空结果，用于关闭 RAG 能力时的安全降级。',
  mock: '模拟引擎：返回固定桩数据，用于本地开发与联调，不依赖外部服务。',
};

/**
 * 引擎配置页（只读展示）。
 *
 * <p>引擎类型由 Nacos 配置项 `mis.kb.engine.type` 决定，不允许运行时从前端切换
 * （避免与索引数据状态不一致）；本页仅呈现当前生效引擎、连通性与能力清单。
 */
export function KbEnginePage() {
  const health = useKbStore((s) => s.health);
  const capabilities = useKbStore((s) => s.capabilities);
  const loading = useKbStore((s) => s.loading);
  const refreshEngine = useKbStore((s) => s.refreshEngine);

  useEffect(() => {
    void refreshEngine();
  }, [refreshEngine]);

  const engineType = health?.engineType ?? capabilities?.engineType ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title="检索引擎"
        description="当前生效的知识库检索引擎与其能力清单（只读）。"
        actions={
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void refreshEngine()}>
            <RefreshCw className="h-4 w-4" />
            重新探测
          </Button>
        }
      />

      <Alert className="mb-3">
        <AlertTitle>引擎切换方式</AlertTitle>
        <AlertDescription>
          引擎类型由配置中心的 <code className="font-mono text-xs">mis.kb.engine.type</code>{' '}
          决定（可选 ragflow / noop / mock），修改后需重启或刷新 mis-kb 配置。为避免索引状态错乱，
          不提供前端在线切换。
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">连通性</p>
            <EngineHealthBadge healthy={health?.healthy} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">引擎类型</dt>
              <dd className="font-mono text-xs">{engineType ?? '未知'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">状态</dt>
              <dd className="font-mono text-xs">{health?.status ?? '未知'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">诊断</dt>
              <dd className="min-w-0 break-words text-right text-xs text-muted-foreground">
                {health?.detail ?? '（无）'}
              </dd>
            </div>
          </dl>
          {engineType && ENGINE_DESC[engineType] ? (
            <p className="mt-3 rounded-md bg-secondary/40 px-2.5 py-2 text-xs text-muted-foreground">
              {ENGINE_DESC[engineType]}
            </p>
          ) : null}
        </Card>

        <Card className="p-4 shadow-card">
          <p className="mb-3 text-sm font-medium">能力清单</p>
          <div className="flex flex-wrap gap-2">
            <CapabilityBadge label="重排 rerank" supported={capabilities?.rerankSupported} />
            <CapabilityBadge label="元数据过滤" supported={capabilities?.metadataFilterSupported} />
            <CapabilityBadge label="文档替换" supported={capabilities?.replaceSupported} />
          </div>
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-muted-foreground">引擎自述能力项</p>
            <div className="flex flex-wrap gap-1.5">
              {capabilities?.capabilities && capabilities.capabilities.length > 0 ? (
                capabilities.capabilities.map((c) => (
                  <Badge key={c} variant="outline">
                    {c}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">（无）</span>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            能力为 false 的项，其相关配置在「知识库管理」中会被灰化，避免下发引擎不支持的参数。
          </p>
        </Card>
      </div>
    </div>
  );
}
