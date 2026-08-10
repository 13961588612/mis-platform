import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RotateCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updateDocumentChunkConfig } from '../api/kb-api';
import type { KbDocument, KbDocumentChunkConfig, KbRagSettings } from '../types';
import { KB_CHUNK_METHOD_OPTIONS, chunkMethodLabel } from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

export interface KbDocChunkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryId: number;
  /** 目标文档；null = 关闭态（不渲染内容）。 */
  doc: KbDocument | null;
  /** 库级切片设置，用于「继承库级」标注（可为 null）。 */
  librarySettings?: KbRagSettings | null;
  /** 改参成功（含清除覆盖）后回调（父级刷新列表）。 */
  onUpdated: () => void | Promise<void>;
}

/**
 * 单文档切片设置弹窗（kb_settings_model_chunk，R-P0-08）。
 *
 * <p>三字段全空 = 继承库级（后端按「快照式继承」把库级当前有效值下发到该文档，
 * 引擎侧后续库级变更不会自动跟进存量文档——本弹窗文案已提示）。
 *
 * <p>改参触发重解析：RAGFlow 先删旧 chunks 再重切，解析期间该文档<b>暂不参与检索</b>，
 * 提交后明示该提示（设计 §8-9）。清空文件级覆盖同样需要重解析一次。
 */
export function KbDocChunkDialog({
  open,
  onOpenChange,
  libraryId,
  doc,
  librarySettings,
  onUpdated,
}: KbDocChunkDialogProps) {
  const [chunkMethod, setChunkMethod] = useState('');
  const [chunkTokenNum, setChunkTokenNum] = useState('');
  const [separator, setSeparator] = useState('');
  const [saving, setSaving] = useState(false);

  // 文档切换/打开时同步表单
  useEffect(() => {
    if (!open || doc == null) return;
    setChunkMethod(doc.chunkMethod ?? '');
    setChunkTokenNum(doc.chunkTokenNum == null ? '' : String(doc.chunkTokenNum));
    setSeparator(doc.separator ?? '');
    setSaving(false);
  }, [open, doc]);

  const tokenNum = useMemo(() => {
    if (chunkTokenNum.trim() === '') return null;
    const n = Number(chunkTokenNum);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }, [chunkTokenNum]);

  const payloadError = useMemo<string | null>(() => {
    if (tokenNum != null && (tokenNum < 16 || tokenNum > 4096)) {
      return '切片长度需在 16 ~ 4096 之间';
    }
    return null;
  }, [tokenNum]);

  /** 当前是否有任一文件级覆盖（用于展示「清除文件级配置」入口）。 */
  const hasOverride = chunkMethod.trim() !== '' || tokenNum != null || separator !== '';

  /** 库级当前有效切片方法（仅供「继承库级」标注）。 */
  const libraryMethod = librarySettings?.chunkMethod ?? null;

  /** 提交：全空 = 清空文件级覆盖（继承库级）。 */
  async function onSubmit(clearOverride: boolean): Promise<void> {
    if (doc == null) return;
    if (!clearOverride && payloadError) {
      toast.warning(payloadError);
      return;
    }
    const config: KbDocumentChunkConfig = clearOverride
      ? { chunkMethod: null, chunkTokenNum: null, separator: null }
      : {
          chunkMethod: chunkMethod.trim() || null,
          chunkTokenNum: tokenNum,
          separator: separator === '' ? null : separator,
        };
    setSaving(true);
    try {
      await updateDocumentChunkConfig(libraryId, doc.id, config);
      toast.success(
        clearOverride ? '已清除文件级覆盖，该文档将按库级设置重新切片' : '已更新切片配置并触发重新解析',
        { description: '解析期间该文档暂不参与检索' },
      );
      onOpenChange(false);
      await onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新切片配置失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>切片设置 · {doc?.title ?? '文档'}</DialogTitle>
          <DialogDescription>
            三字段全空 = 继承库级（清除文件级覆盖）；保存后触发重新解析。
          </DialogDescription>
        </DialogHeader>

        {doc == null ? null : (
          <div className="space-y-3">
            <div>
              <label className={fieldLabel}>切片方式</label>
              <select
                className={selectClass}
                value={chunkMethod}
                onChange={(e) => setChunkMethod(e.target.value)}
              >
                <option value="">继承库级（不指定）</option>
                {KB_CHUNK_METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {libraryMethod ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  库级当前：{chunkMethodLabel(libraryMethod)}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>切片长度（token）</label>
                <Input
                  value={chunkTokenNum}
                  onChange={(e) => setChunkTokenNum(e.target.value)}
                  placeholder="留空继承库级"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className={fieldLabel}>分隔符</label>
                <Input
                  value={separator}
                  onChange={(e) => setSeparator(e.target.value)}
                  placeholder={'如 \\n。；！？'}
                />
              </div>
            </div>

            {hasOverride ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                disabled={saving}
                onClick={() => void onSubmit(true)}
              >
                <Trash2 className="h-4 w-4" />
                清除文件级配置（恢复继承库级）
              </Button>
            ) : null}

            <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>
                修改切片参数会触发重新解析：引擎将<b>先删除旧切片再重切</b>，
                解析期间该文档<b>暂不参与检索</b>（设计 §8-9）。
              </p>
              <p className="mt-1">
                清除覆盖后按「快照式继承」把库级当前有效值下发到本文档；此后库级再变更
                <b>不会</b>自动跟进存量文档。
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving || doc == null} onClick={() => void onSubmit(false)}>
            <RotateCw className="h-4 w-4" />
            {saving ? '保存中…' : '保存并重新解析'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
