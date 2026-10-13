/**
 * 流程详情「裸页」：无顶栏 / 侧栏 / Tab 条，仅流程进度 + 表单 + 历史。
 *
 * <p>供抽屉「在完整页打开」新开浏览器标签使用（路由 `/task/process-view/:id`，
 * 挂在 {@code AppLayout} 外）。内容复用 {@link ProcessShell} 的 {@code bare} 变体（左右分栏新布局）。
 *
 * <p>打开方用命名 {@code window.open} 以便复用标签，故未带 noopener；此处切断
 * {@code window.opener}，避免反向引用。
 */
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ProcessShell } from './process-shell';

export function ProcessBarePage() {
  const { id } = useParams<{ id: string }>();
  const instanceId = useMemo(() => {
    if (!id) return null;
    try {
      const seg = decodeURIComponent(id);
      if (!/^\d+$/.test(seg) || Number(seg) <= 0) return null;
      return String(Number(seg));
    } catch {
      return null;
    }
  }, [id]);

  useEffect(() => {
    try {
      window.opener = null;
    } catch {
      /* ignore */
    }
  }, []);

  if (!instanceId) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        流程实例 ID 非法或缺失
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <ProcessShell key={instanceId} instanceId={instanceId} variant="bare" />
      </div>
    </div>
  );
}

export default ProcessBarePage;
