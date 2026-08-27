/**
 * iqd-config-page.tsx — 问数连接配置（W2，路径 /ai/iqd/config）。
 *
 * <p>覆盖 mis-iqd 连接配置（iqd_connection）：WrenAI 基址 / auth_type / 超时等，
 * 连通性自检 GET {baseUrl}/health。数据源为 BFF 代理 `/api/v1/iqd/config**`
 * （权限码 iqd:config:view / iqd:config:save / iqd:config:test）。
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import {
  getIqdConfig,
  saveIqdConfig,
  testIqdConfig,
  type IqdConnectionConfig,
  type IqdConnectionTest,
} from '@/lib/api/iqd';

export const IQD_CONFIG_PAGE_PATH = '/iqd/config';

export function IqdConfigPage() {
  const [config, setConfig] = useState<IqdConnectionConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<IqdConnectionTest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfig(await getIqdConfig());
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveIqdConfig({
        name: config.name || 'default',
        base_url: config.base_url,
        auth_type: config.auth_type,
        secret_ref: config.secret_ref,
        project_id: config.project_id,
        default_connector: config.default_connector,
        timeout_seconds: config.timeout_seconds ?? 60,
        language: config.language || 'zh-CN',
        enabled: config.enabled ?? true,
        mdl_writeback_enabled: config.mdl_writeback_enabled ?? true,
      });
      setConfig(saved);
      setTestResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const test = useCallback(async () => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      setTestResult(await testIqdConfig());
    } catch (e) {
      setError(e instanceof Error ? e.message : '自检失败');
    } finally {
      setTesting(false);
    }
  }, []);

  const field = (key: keyof IqdConnectionConfig): string | number => {
    const v = config?.[key];
    // 布尔/空值统一回退为空串，避免 boolean 误入 Input/select value（TS2322）
    if (typeof v === 'boolean' || v == null) return '';
    return v;
  };

  const setField = (key: keyof IqdConnectionConfig, value: string | boolean | number | null) => {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="问数连接配置"
        description="配置 WrenAI 连接（凭证经 profile 注入，不落明文），连通自检后生效。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '问数连接配置' })}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || !config}>
              <Save className="h-4 w-4" />
              保存
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="max-w-2xl space-y-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-medium">连接信息</span>
            <Badge variant={config?.status === 'active' ? 'default' : 'secondary'}>
              {config?.status ?? 'inactive'}
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-[0.4rem] block text-xs text-muted-foreground">连接名</label>
              <Input value={field('name')} onChange={(e) => setField('name', e.target.value)} />
            </div>
            <div>
              <label className="mb-[0.4rem] block text-xs text-muted-foreground">WrenAI 地址</label>
              <Input
                placeholder="http://host:port"
                value={field('base_url')}
                onChange={(e) => setField('base_url', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-[0.4rem] block text-xs text-muted-foreground">认证方式</label>
              <select
                className="h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm"
                value={field('auth_type') || 'none'}
                onChange={(e) => setField('auth_type', e.target.value)}
              >
                <option value="none">none</option>
                <option value="api_key">api_key</option>
                <option value="bearer">bearer</option>
              </select>
            </div>
            <div>
              <label className="mb-[0.4rem] block text-xs text-muted-foreground">
                密钥引用（提交非空才更新）
              </label>
              <Input
                placeholder="******"
                type="password"
                value={field('secret_ref') || ''}
                onChange={(e) => setField('secret_ref', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-[0.4rem] block text-xs text-muted-foreground">Project ID</label>
              <Input value={field('project_id')} onChange={(e) => setField('project_id', e.target.value)} />
            </div>
            <div>
              <label className="mb-[0.4rem] block text-xs text-muted-foreground">默认连接器</label>
              <Input
                value={field('default_connector')}
                onChange={(e) => setField('default_connector', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-[0.4rem] block text-xs text-muted-foreground">超时（秒）</label>
              <Input
                type="number"
                min={1}
                max={600}
                value={field('timeout_seconds') || 60}
                onChange={(e) => setField('timeout_seconds', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-[0.4rem] block text-xs text-muted-foreground">语言</label>
              <Input value={field('language') || 'zh-CN'} onChange={(e) => setField('language', e.target.value)} />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={config?.enabled ?? true}
                onChange={(e) => setField('enabled', e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">启用该连接</span>
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={Boolean(config?.mdl_writeback_enabled)}
                onChange={(e) => setField('mdl_writeback_enabled', e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">
                允许平台编辑语义模型并写回 WrenAI（MDL 写回）
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-medium">连通性自检</span>
            <Button size="sm" variant="outline" onClick={() => void test()} disabled={testing}>
              <Activity className={cn('h-4 w-4', testing && 'animate-pulse')} />
              {testing ? '检测中…' : '执行自检'}
            </Button>
          </div>
          {testResult ? (
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant={testResult.status === 'active' ? 'default' : 'destructive'}>
                  {testResult.status}
                </Badge>
                <span className="text-muted-foreground">{testResult.message ?? ''}</span>
              </div>
              {testResult.latency_ms != null ? (
                <div className="text-muted-foreground">延迟 {testResult.latency_ms} ms</div>
              ) : null}
              {testResult.last_health_at ? (
                <div className="text-muted-foreground">最近检测 {testResult.last_health_at}</div>
              ) : null}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">保存后执行自检，验证 WrenAI 可达性。</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default IqdConfigPage;
