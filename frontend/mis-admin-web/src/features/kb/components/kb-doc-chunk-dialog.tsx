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
  /** 库级切片设置，用于「继承库级」预填默认值（可为 null）。 */
  librarySettings?: KbRagSettings | null;
  /** 改参成功（含清除覆盖）后回调（父级刷新列表）。 */
  onUpdated: () => void | Promise<void>;
}

/**
 * 单文档切片设置弹窗（kb_settings_model_chunk，R-P0-08）。
 *
 * <p>七字段全 null = 继承库级（后端按「快照式继承」把库级当前有效值下发到该文档，
 * 引擎侧后续库级变更不会自动跟进存量文档——本弹窗文案已提示）。
 *
 * <p>T7 扩展：{@code pageIndex} / {@code imageTableContextWindow} / {@code autoKeywords} /
 * {@code autoQuestions} 与库级同名语义一致（null = 继承库级）。⚠ 文件级 PUT 白名单
 * 只含 chunk_token_num/delimiter/auto_keywords/auto_questions——toc/context/overlap
 * 键不下发（后端 {@code RagflowClient.updateDocumentConfig} 白名单剔除），
 * 故这里只做展示/落库，提交体不越白名单边界。
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
  const [pageIndex, setPageIndex] = useState<boolean | null>(null);
  const [imageTableContextWindow, setImageTableContextWindow] = useState('');
  const [autoKeywords, setAutoKeywords] = useState('');
  const [autoQuestions, setAutoQuestions] = useState('');
  const [saving, setSaving] = useState(false);

  // 文档切换/打开时同步表单。doc 列 null = 继承库级 → 表单置空（数字/开关置 null），
  // 库级预填默认值仅作为 placeholder/提示展示（「继承库级：X」），不写进表单值——
  // 否则未改动直接保存会把继承值误写成文件级覆盖（来源徽标退化为 FILE_OVERRIDE）。
  useEffect(() => {
    if (!open || doc == null) return;
    setChunkMethod(doc.chunkMethod ?? '');
    setChunkTokenNum(doc.chunkTokenNum == null ? '' : String(doc.chunkTokenNum));
    setSeparator(doc.separator ?? '');
    setPageIndex(doc.pageIndex ?? null);
    setImageTableContextWindow(
      doc.imageTableContextWindow == null ? '' : String(doc.imageTableContextWindow),
    );
    setAutoKeywords(doc.autoKeywords == null ? '' : String(doc.autoKeywords));
    setAutoQuestions(doc.autoQuestions == null ? '' : String(doc.autoQuestions));
    setSaving(false);
  }, [open, doc]);

  const tokenNum = useMemo(() => {
    if (chunkTokenNum.trim() === '') return null;
    const n = Number(chunkTokenNum);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }, [chunkTokenNum]);

  const imageWindow = useMemo(() => {
    if (imageTableContextWindow.trim() === '') return null;
    const n = Number(imageTableContextWindow);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }, [imageTableContextWindow]);

  const keywords = useMemo(() => {
    if (autoKeywords.trim() === '') return null;
    const n = Number(autoKeywords);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }, [autoKeywords]);

  const questions = useMemo(() => {
    if (autoQuestions.trim() === '') return null;
    const n = Number(autoQuestions);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }, [autoQuestions]);

  const payloadError = useMemo<string | null>(() => {
    if (tokenNum != null && (tokenNum < 256 || tokenNum > 2048)) {
      return '切片长度需在 256 ~ 2048 之间';
    }
    if (imageWindow != null && (imageWindow < 1 || imageWindow > 4096)) {
      return '图像/表格上下文窗口需在 1 ~ 4096 之间';
    }
    if (keywords != null && (keywords < 0 || keywords > 32)) {
      return '自动关键字数量需在 0 ~ 32 之间（0 = 关闭）';
    }
    if (questions != null && (questions < 0 || questions > 10)) {
      return '自动问题数量需在 0 ~ 10 之间（0 = 关闭）';
    }
    return null;
  }, [tokenNum, imageWindow, keywords, questions]);

  /** 当前是否有任一文件级覆盖（用于展示「清除文件级配置」入口）。 */
  const hasOverride =
    chunkMethod.trim() !== '' ||
    tokenNum != null ||
    separator !== '' ||
    pageIndex != null ||
    imageWindow != null ||
    keywords != null ||
    questions != null;

  /** 库级当前有效切片方法（仅供「继承库级」标注）。 */
  const libraryMethod = librarySettings?.chunkMethod ?? null;
  /** 库级当前有效页码索引（null 时按引擎默认 true 标注）。 */
  const libraryPageIndex = librarySettings?.pageIndex ?? true;
  /** 库级当前有效上下文窗口（null 时按引擎默认 256 标注）。 */
  const libraryImageWindow = librarySettings?.imageTableContextWindow ?? 256;
  /** 库级当前有效自动关键字数量（null 时按引擎默认 0 标注）。 */
  const libraryKeywords = librarySettings?.autoKeywords ?? 0;
  /** 库级当前有效自动问题数量（null 时按引擎默认 0 标注）。 */
  const libraryQuestions = librarySettings?.autoQuestions ?? 0;

  /** 提交：全空 = 清空文件级覆盖（继承库级）。 */
  async function onSubmit(clearOverride: boolean): Promise<void> {
    if (doc == null) return;
    if (!clearOverride && payloadError) {
      toast.warning(payloadError);
      return;
    }
    const config: KbDocumentChunkConfig = clearOverride
      ? {
          chunkMethod: null,
          chunkTokenNum: null,
          separator: null,
          pageIndex: null,
          imageTableContextWindow: null,
          autoKeywords: null,
          autoQuestions: null,
        }
      : {
          chunkMethod: chunkMethod.trim() || null,
          chunkTokenNum: tokenNum,
          separator: separator === '' ? null : separator,
          pageIndex,
          imageTableContextWindow: imageWindow,
          autoKeywords: keywords,
          autoQuestions: questions,
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>切片设置 · {doc?.title ?? '文档'}</DialogTitle>
          <DialogDescription>
            七个配置项全部留空 = 继承库级（清除文件级覆盖）；保存后触发重新解析。
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
                  type="number"
                  min={256}
                  max={2048}
                  value={chunkTokenNum}
                  onChange={(e) => setChunkTokenNum(e.target.value)}
                  placeholder={
                    tokenNum == null
                      ? `继承库级：${libraryTokenDefault(librarySettings)}`
                      : undefined
                  }
                  inputMode="numeric"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  256 ~ 2048；留空继承库级 {libraryTokenDefault(librarySettings)}
                </p>
              </div>
              <div>
                <label className={fieldLabel}>分隔符</label>
                <Input
                  value={separator}
                  onChange={(e) => setSeparator(e.target.value)}
                  placeholder="留空继承库级"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  如 {'\\n。；！？'}；库级当前：{librarySettings?.separator || '引擎默认'}
                </p>
              </div>
            </div>

            {/* 解析器增量 + 切片参数对齐（T7）：4 个文件级可用字段。
                pageIndex 用三态循环：继承（null）→ 开（true）→ 关（false）→ 继承；
                数字字段留空 = 继承库级；placeholder 展示库级当前有效值。 */}
            <div className="rounded-md border border-dashed bg-muted/30 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={pageIndex === true}
                      onChange={() => {
                        setPageIndex((prev) => {
                          if (prev == null) return true;
                          if (prev === true) return false;
                          return null;
                        });
                      }}
                    />
                    页码索引（TOC 提取）
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pageIndex == null
                      ? `继承库级：${libraryPageIndex ? '开' : '关'}` +
                        '（点击循环：开 → 关 → 继承）'
                      : pageIndex
                        ? '本文件已指定：开（再次点击改为关）'
                        : '本文件已指定：关（再次点击改为继承库级）'}
                  </p>
                </div>
                <div>
                  <label className={fieldLabel}>图像与表格上下文窗口（token）</label>
                  <Input
                    type="number"
                    min={1}
                    max={4096}
                    step={1}
                    value={imageTableContextWindow}
                    onChange={(e) => setImageTableContextWindow(e.target.value)}
                    placeholder={
                      imageWindow == null ? `继承库级：${libraryImageWindow}` : undefined
                    }
                    inputMode="numeric"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    范围 1 ~ 4096；留空继承库级 {libraryImageWindow}
                  </p>
                </div>
                <div>
                  <label className={fieldLabel}>自动关键字数量</label>
                  <Input
                    type="number"
                    min={0}
                    max={32}
                    step={1}
                    value={autoKeywords}
                    onChange={(e) => setAutoKeywords(e.target.value)}
                    placeholder={keywords == null ? `继承库级：${libraryKeywords}` : undefined}
                    inputMode="numeric"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    0 ~ 32（0 = 关闭）；留空继承库级 {libraryKeywords}（对应 RAGFlow{' '}
                    <span className="font-mono">auto_keywords</span>）
                  </p>
                </div>
                <div>
                  <label className={fieldLabel}>自动问题数量</label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    value={autoQuestions}
                    onChange={(e) => setAutoQuestions(e.target.value)}
                    placeholder={questions == null ? `继承库级：${libraryQuestions}` : undefined}
                    inputMode="numeric"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    0 ~ 10（0 = 关闭）；留空继承库级 {libraryQuestions}（对应 RAGFlow{' '}
                    <span className="font-mono">auto_questions</span>）
                  </p>
                </div>
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

/** 库级当前有效切片 token 数（null 时按引擎默认 2048 标注）。 */
function libraryTokenDefault(settings: KbRagSettings | null | undefined): number {
  return settings?.chunkTokenNum ?? 2048;
}