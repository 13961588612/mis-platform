/**
 * 技能详情抽屉（R7/R9/R10/R11，§4.3 #3 增强）。
 *
 * <p>打开即按 skillId 拉取详情（`GET /agent-ops/skills/{id}`，返回 `SkillDetail`），
 * 展示：
 *   - 头部：skill_id、name、状态徽章（复用 `AgentStatusBadge kind="skillStatus"`）、
 *     可执行/文档型徽标（新增 `kind="skillKind"`）；
 *   - 元数据：category、tags、version、source、handler、更新时间；
 *   - 正文区：package skill 有 SKILL.md 正文则 `<pre>` 展示（P2 才做 Markdown 渲染，
 *     本期原样），自建/文档型显示空态文案；
 *   - 附件：scripts / references / assets 三个折叠列表，展示相对路径文件名。
 *
 * <p>复用 `Sheet`（右侧抽屉，与 `features/kb` 的切分抽屉同手感）与
 * `AgentStatusBadge`（skillStatus / skillKind）。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { FileCode2, FileText, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { AgentStatusBadge } from '../components/agent-status-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getSkill } from '../api/agent-ops-api';
import { agentErrorMessage, formatTime } from '../types';
import type { SkillDetail } from '../types';

export interface AgentSkillDetailDrawerProps {
  /** 目标技能 ID；null = 关闭态（不渲染内容）。 */
  skillId: string | null;
  open: boolean;
  onClose: () => void;
}

/** 单个附件分类的折叠展示（无则显示「无」）。onFileClick 可选：传入则列表项可点击查看内容。 */
function AttachmentList({
  title,
  icon,
  files,
  onFileClick,
}: {
  title: string;
  icon: ReactNode;
  files: string[] | undefined;
  onFileClick?: (file: string) => void;
}) {
  const items = files ?? [];
  return (
    <Collapsible defaultOpen={items.length > 0}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted/40">
        {icon}
        <span>{title}</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[0.6875rem]">
          {items.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 py-2">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">无</p>
        ) : (
          <ul className="space-y-1">
            {items.map((f) => (
              onFileClick ? (
                <li key={f}>
                  <button
                    type="button"
                    onClick={() => onFileClick(f)}
                    className="w-full truncate rounded px-1 py-0.5 text-left font-mono text-xs text-foreground underline-offset-2 hover:bg-muted/60 hover:underline"
                    title={`查看 ${f}`}
                  >
                    {f}
                  </button>
                </li>
              ) : (
                <li key={f} className="truncate font-mono text-xs text-foreground" title={f}>
                  {f}
                </li>
              )
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** 元数据字段（标签 + 值）。 */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

export function AgentSkillDetailDrawer({ skillId, open, onClose }: AgentSkillDetailDrawerProps) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(false);
  /** B-1.5：当前正在查看的参考资料文件（name + 内容，内容来自详情接口的 reference_contents）。 */
  const [viewRef, setViewRef] = useState<{ name: string; content: string } | null>(null);

  useEffect(() => {
    if (!open || !skillId) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    void (async () => {
      try {
        const res = await getSkill(skillId);
        if (!cancelled) setDetail(res as SkillDetail);
      } catch (e) {
        if (!cancelled) toast.error(agentErrorMessage(e, '获取技能详情失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, skillId]);

  // handler 非空 → 可执行；否则文档型（R10 徽标依据）
  const kind = detail?.handler && detail.handler.trim() !== '' ? 'executable' : 'document';

  return (
    <>
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            技能详情
            {detail ? (
              <span className="font-mono text-xs text-muted-foreground">{detail.skill_id}</span>
            ) : null}
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          {loading && detail == null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          ) : detail == null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{detail.name}</h3>
                  <AgentStatusBadge kind="skillStatus" value={detail.status} />
                  <AgentStatusBadge kind="skillKind" value={kind} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {detail.description || '（无描述）'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3 text-sm">
                <Field label="分类" value={detail.category || '-'} />
                <Field label="来源" value={detail.source || '-'} />
                <Field label="版本" value={detail.version || '-'} />
                <Field label="执行器" value={detail.handler || '（文档型，无）'} />
                <div className="col-span-2">
                  <Field
                    label="标签"
                    value={(detail.tags ?? []).length ? (detail.tags ?? []).join('、') : '（无）'}
                  />
                </div>
                <div className="col-span-2">
                  <Field label="更新时间" value={formatTime(detail.updated_at)} />
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium">SKILL.md 正文</h4>
                {detail.body ? (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-xs text-foreground">
                    {detail.body}
                  </pre>
                ) : (
                  <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    该技能为自建/文档型，无 SKILL.md 正文。
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium">附件</h4>
                <AttachmentList
                  title="脚本 scripts"
                  icon={<FileCode2 className="h-4 w-4" />}
                  files={detail.scripts}
                />
                <AttachmentList
                  title="参考资料 references"
                  icon={<FileText className="h-4 w-4" />}
                  files={detail.references}
                  onFileClick={(f) =>
                    setViewRef({
                      name: f,
                      content: detail.reference_contents?.[f] ?? '（内容不可用）',
                    })
                  }
                />
                <AttachmentList
                  title="资源 assets"
                  icon={<FolderOpen className="h-4 w-4" />}
                  files={detail.assets}
                />
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>

    {/* B-1.5：参考资料内容预览弹窗（内容来自详情接口的 reference_contents，按相对路径索引） */}
    <Dialog open={viewRef !== null} onOpenChange={(v) => !v && setViewRef(null)}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate font-mono text-sm">{viewRef?.name}</DialogTitle>
          <DialogDescription>参考资料文件内容预览</DialogDescription>
        </DialogHeader>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-xs text-foreground">
          {viewRef?.content}
        </pre>
      </DialogContent>
    </Dialog>
    </>
  );
}
