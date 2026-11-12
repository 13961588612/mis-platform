/**
 * EntitySelect — A2UI `entity-select` 组件（shadcn，T06'）。
 *
 * <p>渲染权限：默认可见。实体选择结果经 Gateway `a2ui_action` 回传 Agent
 * （dispatchAction），**非 BFF 写操作**（03-permission-design.md §3.2）：
 * confirm 确认候选 / manual 手动输入覆盖值 / cancel 取消本次填充。
 */

import { useMemo, useState } from 'react';
import { ListFilter, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useA2ui, useA2uiNode } from '../a2ui-context';
import type { A2uiComponentProps } from '@/lib/a2ui/types';

interface Candidate {
  id?: string;
  displayName?: string;
  name?: string;
  label?: string;
  [key: string]: unknown;
}

export function EntitySelect({ props }: A2uiComponentProps) {
  const { dispatchAction } = useA2ui();
  const node = useA2uiNode();
  const surfaceId = node?.surfaceId ?? '';
  const componentId = node?.componentId ?? '';
  const resumeToken = typeof props.resumeToken === 'string' ? props.resumeToken : '';
  const field = typeof props.field === 'string' ? props.field : '';
  const prompt = typeof props.prompt === 'string' ? props.prompt : '请选择一个候选实体';
  const originalValue = typeof props.originalValue === 'string' ? props.originalValue : '';
  const namespace = typeof props.namespace === 'string' ? props.namespace : '';

  const candidates = useMemo<Candidate[]>(() => {
    if (!Array.isArray(props.candidates)) return [];
    return props.candidates.filter(
      (raw): raw is Candidate => raw != null && typeof raw === 'object',
    );
  }, [props.candidates]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualText, setManualText] = useState('');
  const [responding, setResponding] = useState(false);

  const resolveLabel = (c: Candidate): string =>
    c.displayName ?? c.name ?? c.label ?? c.id ?? '(未命名)';

  const confirm = (candidate: Candidate): void => {
    const id = candidate.id;
    if (!id || responding) return;
    setSelectedId(id);
    setResponding(true);
    dispatchAction({
      surfaceId,
      componentId,
      action: 'confirm',
      payload: { resumeToken, selectedCandidate: candidate as Record<string, unknown> },
    });
  };

  const manual = (): void => {
    if (responding) return;
    const value = manualText.trim();
    if (value.length === 0) return;
    setResponding(true);
    dispatchAction({
      surfaceId,
      componentId,
      action: 'manual',
      payload: { resumeToken, selectedCandidate: { id: value, displayName: value } },
    });
  };

  const cancel = (): void => {
    if (responding) return;
    setResponding(true);
    dispatchAction({
      surfaceId,
      componentId,
      action: 'cancel',
      payload: { resumeToken },
    });
  };

  return (
    <Card className="my-2 w-full rounded-lg border-primary/30 shadow-none">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
        <Badge variant="warning" className="gap-1">
          <ListFilter className="h-3 w-3" />
          表单填充 · 实体选择
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 pt-1">
        <div>
          <CardTitle className="text-sm font-medium">{prompt}</CardTitle>
          {(field || originalValue) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {field ? <span>字段：{field}</span> : null}
              {field && originalValue ? <span className="mx-1">·</span> : null}
              {originalValue ? <span>当前值：{originalValue}</span> : null}
            </p>
          )}
        </div>

        {candidates.length > 0 ? (
          <div className="space-y-1.5">
            {candidates.map((candidate) => {
              const id = candidate.id ?? `candidate-${resolveLabel(candidate)}`;
              const isSelected = selectedId === id;
              return (
                <Button
                  key={id}
                  type="button"
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  className="w-full justify-start text-left"
                  disabled={responding}
                  onClick={() => confirm(candidate)}
                >
                  {resolveLabel(candidate)}
                </Button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">无可选项，请手动输入或取消。</p>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={manualText}
              disabled={responding}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="手动输入覆盖值"
              className="pl-8"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={responding || manualText.trim().length === 0}
            onClick={manual}
          >
            提交
          </Button>
        </div>

        <Button type="button" size="sm" variant="secondary" className="w-full" disabled={responding} onClick={cancel}>
          {responding ? '处理中…' : '取消'}
        </Button>

        {namespace ? (
          <div className="text-[10px] text-muted-foreground/60">来源：{namespace}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default EntitySelect;
