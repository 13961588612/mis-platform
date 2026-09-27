/**
 * iqd-test-chat-page.tsx — 问数测试台（W2，路径 /iqd/test-chat）。
 *
 * <p>后台模拟问数：可指定角色（simulate_role_code）与范围表集合（scope_hint），
 * 调用非流式 `/api/v1/iqd/ask`（需 ai:chat:use）；结果渲染 scope 裁定、SQL、
 * 执行计划、表格与脱敏列。该页为运营/QA 验证双闸门与行级注入用。
 */

import { useCallback, useState } from 'react';
import { Loader2, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import { askIqd, type IqdAskResponse } from '@/lib/api/iqd';

export const IQD_TEST_CHAT_PAGE_PATH = '/iqd/test-chat';

const PLAN_LABEL: Record<string, string> = {
  scope_check: '范围校验',
  understanding: '意图理解',
  searching: '语义检索',
  generating: 'SQL 生成',
  lineage_check: '血缘校验',
  executing: '执行',
  masking: '脱敏',
  finished: '完成',
};

export function IqdTestChatPage() {
  const [question, setQuestion] = useState('');
  const [simulateRole, setSimulateRole] = useState('');
  const [scopeHint, setScopeHint] = useState('');
  const [view, setView] = useState<'user' | 'admin'>('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IqdAskResponse | null>(null);

  const run = useCallback(async () => {
    if (!question.trim()) {
      setError('请输入问题');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const scopeHintList = scopeHint
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await askIqd({
        question: question.trim(),
        view,
        simulate_role_code: simulateRole.trim() || null,
        scope_hint: scopeHintList.length > 0 ? scopeHintList : undefined,
      });
      setResult(res);
      // Worker/BFF 失败帧常无 scope；仍 setResult 以便展示 error_message，同时顶栏提示
      if (res.error_message || (res.status && res.status !== 'succeeded')) {
        setError(res.error_message || `问数状态：${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '问数失败');
    } finally {
      setLoading(false);
    }
  }, [question, simulateRole, scopeHint, view]);

  const reset = useCallback(() => {
    setQuestion('');
    setSimulateRole('');
    setScopeHint('');
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="问数测试台"
        description="模拟角色/范围执行问数，验证范围裁定、行级注入与脱敏（admin 视图可见 SQL）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '问数测试台' })}
      />

      {/* 请求区 */}
      <div className="mb-3 rounded-lg border bg-card p-3">
        <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">问题</label>
            <Input
              placeholder="例如：上季度各门店销售额是多少？"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void run();
              }}
            />
          </div>
          <div>
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">
              模拟角色（可空）
            </label>
            <Input
              placeholder="SALES_MANAGER"
              value={simulateRole}
              onChange={(e) => setSimulateRole(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">视图</label>
            <select
              className="h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground"
              value={view}
              onChange={(e) => setView(e.target.value as 'user' | 'admin')}
            >
              <option value="admin">admin（含 SQL）</option>
              <option value="user">user（剥 SQL）</option>
            </select>
          </div>
        </div>
        <div className="mb-2">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">
            范围表限定（scope_hint，逗号分隔，可空）
          </label>
          <Input
            placeholder="pg_main.public.orders,pg_main.public.customers"
            value={scopeHint}
            onChange={(e) => setScopeHint(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void run()} disabled={loading || !question.trim()}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            执行问数
          </Button>
          <Button size="sm" variant="outline" onClick={reset} disabled={loading}>
            <RotateCcw className="h-4 w-4" />
            重置
          </Button>
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
      </div>

      {/* 结果区（scope/plan/data 在失败帧可能为 null，须空值安全） */}
      {result ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
          <div className="border-b px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge
                variant={result.status === 'succeeded' ? 'default' : 'destructive'}
              >
                {result.status || 'unknown'}
              </Badge>
              <span className="text-muted-foreground">{result.query_id || '—'}</span>
              <span className="text-muted-foreground">
                {result.scope
                  ? `${result.scope.decision ?? '—'} · ${(result.scope.allowed_item_keys ?? []).length} 张授权表`
                  : '范围未返回'}
              </span>
              <span className="text-muted-foreground">{result.latency_ms ?? '—'} ms</span>
              {(result.masked_columns ?? []).length > 0 ? (
                <Badge variant="secondary">脱敏 {(result.masked_columns ?? []).join(', ')}</Badge>
              ) : null}
            </div>
            {result.error_message ? (
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                {result.error_code ? `[${result.error_code}] ` : ''}
                {result.error_message}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2">
            {/* 执行计划 */}
            <div className="rounded-md border p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                完整计划时间线（各阶段 status + 耗时 + SQL）
              </div>
              {(result.plan ?? []).length === 0 ? (
                <div className="text-xs text-muted-foreground">无计划步骤（可能问数在编排前失败）</div>
              ) : (
                <ol className="space-y-1">
                  {(result.plan ?? []).map((p, idx) => (
                    <li key={p.seq ?? idx} className="rounded-md border border-border/60 p-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            p.status === 'done' ? 'bg-success' : p.status === 'failed' ? 'bg-destructive' : 'bg-muted',
                          )}
                        />
                        <span className="w-20 shrink-0 font-medium">{PLAN_LABEL[p.code] ?? p.code}</span>
                        <span className="truncate text-muted-foreground">{p.detail ?? ''}</span>
                        {(() => {
                          const ms =
                            p.duration_ms ??
                            (p as { durationMs?: number | null }).durationMs;
                          if (ms == null) return null;
                          return (
                            <span className="ml-auto shrink-0 text-muted-foreground">{ms} ms</span>
                          );
                        })()}
                      </div>
                      {p.sql ? (
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[0.7rem] leading-relaxed">
                          {p.sql}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* 范围与 SQL */}
            <div className="rounded-md border p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">范围裁定</div>
              <div className="text-xs text-muted-foreground">
                {result.scope
                  ? `${result.scope.reason ?? '通过'}（主体 ${result.scope.subject_summary ?? '—'}）`
                  : '本次响应未包含范围裁定（常见于 Worker 空响应 / 解析失败）'}
              </div>
              <div className="mt-2 mb-1 text-xs font-medium text-muted-foreground">SQL（注入后）</div>
              <pre className="max-h-56 overflow-auto rounded bg-muted p-2 font-mono text-[0.7rem] leading-relaxed">
                {result.sql || '（无 SQL / user 视图已剥离）'}
              </pre>
            </div>
          </div>

          {/* NL→SQL LLM 入参/出参（仅 admin 视图有） */}
          {result.nl2sql_debug ? (
            <div className="p-3 pt-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                NL→SQL · LLM 输入 / 输出
                {result.nl2sql_debug.context_chars != null
                  ? `（context ${result.nl2sql_debug.context_chars} 字符）`
                  : ''}
              </div>
              {result.nl2sql_debug.note ? (
                <div className="mb-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-[0.7rem] text-muted-foreground">
                  {result.nl2sql_debug.note}
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-md border p-2">
                  <div className="mb-1 text-[0.7rem] font-medium text-muted-foreground">
                    prompt_user（发给模型的上下文）
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[0.65rem] leading-relaxed">
                    {result.nl2sql_debug.prompt_user || '（空）'}
                  </pre>
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-1 text-[0.7rem] font-medium text-muted-foreground">
                    raw_output（模型原始输出）
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[0.65rem] leading-relaxed">
                    {result.nl2sql_debug.raw_output || '（空）'}
                  </pre>
                </div>
              </div>
              {(result.nl2sql_debug.attempts ?? []).length > 1 ? (
                <div className="mt-2 space-y-2">
                  <div className="text-[0.7rem] font-medium text-muted-foreground">
                    多次尝试（含 dry_run 列错误重试）
                  </div>
                  {(result.nl2sql_debug.attempts ?? []).map((a, i) => (
                    <div key={`${a.label}-${i}`} className="rounded-md border border-border/60 p-2">
                      <div className="mb-1 text-[0.7rem] text-muted-foreground">
                        #{i + 1} {a.label || 'attempt'} · {a.type || '—'}
                      </div>
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[0.65rem]">
                        {a.sql || a.raw_output || '（无 SQL）'}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : null}
              <details className="mt-2">
                <summary className="cursor-pointer text-[0.7rem] text-muted-foreground">
                  展开 system prompt
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[0.65rem]">
                  {result.nl2sql_debug.prompt_system || '（空）'}
                </pre>
              </details>
            </div>
          ) : null}

          {/* 引用明细（W4 归一化：表/字段/知识片段） */}
          {(result.citations ?? []).length > 0 ? (
            <div className="p-3 pt-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">引用明细</div>
              <div className="flex flex-wrap gap-2">
                {(result.citations ?? []).map((c) => (
                  <div
                    key={`${c.kind}-${c.item_key}`}
                    className="max-w-[22rem] rounded-md border border-border/60 p-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{c.kind}</Badge>
                      <span className="font-mono">{c.item_key}</span>
                      <span className="text-muted-foreground">{c.display_name ?? ''}</span>
                    </div>
                    {c.snippet ? (
                      <div className="mt-1 line-clamp-2 text-muted-foreground">{c.snippet}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 结果表格 */}
          <div className="p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              结果集（{result.data?.row_count ?? 0} 行 · {(result.data?.columns ?? []).length} 列）
            </div>
            {(result.data?.columns ?? []).length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {result.answer_summary || result.error_message || '无结果集'}
              </div>
            ) : (
              <div className="overflow-auto rounded border">
                <table className="w-full border-separate border-spacing-0 text-left text-xs">
                  <thead className="bg-table-header text-muted-foreground">
                    <tr>
                      {(result.data?.columns ?? []).map((col) => (
                        <th key={col.name} className="whitespace-nowrap border-b px-2 py-1.5 font-bold">
                          {col.display_name || col.name}
                          {col.masked ? (
                            <Badge variant="secondary" className="ml-1">
                              脱敏
                            </Badge>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(result.data?.rows ?? []).slice(0, 100).map((row, ri) => (
                      <tr key={ri} className="border-b border-border/40 bg-table-row even:bg-table-stripe">
                        {row.map((cell, ci) => (
                          <td key={ci} className="max-w-[16rem] truncate whitespace-nowrap px-2 py-1">
                            {String(cell ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.data?.truncated ? (
              <div className="mt-1 text-xs text-warning">结果已截断（上限 1000 行 / 50 列）</div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {loading ? '问数执行中…' : '输入问题后点击「执行问数」'}
        </div>
      )}
    </div>
  );
}

export default IqdTestChatPage;
