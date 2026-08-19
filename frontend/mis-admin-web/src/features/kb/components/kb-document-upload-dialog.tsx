import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
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
import { uploadDocument } from '../api/kb-api';
import type { KbDocumentChunkConfig } from '../types';
import { KB_CHUNK_METHOD_OPTIONS, formatSize } from '../types';

/** 与 BFF `KbFacadeService` 的 50MB 上限保持一致，前端提前拦截避免无谓上传。 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/**
 * 按扩展名建议默认切片方式（P1-3）。
 *
 * <p>仅作「带出默认值」的便利：用户仍可在弹窗内手动修改，或改回「继承库级（不指定）」。
 * 映射基于 RAGFlow 现有 chunk_method 枚举（见 {@code KB_CHUNK_METHOD_OPTIONS}）：
 * <ul>
 *   <li>纯文本/ Markdown → {@code naive}（通用切块，最稳）；</li>
 *   <li>PDF → {@code paper}（论文/结构化文档专用，按章节/标题切，比 naive 更适合 PDF 版面）；</li>
 *   <li>Word → {@code naive}（docx/doc 无专用方法，naive 通用处理最稳）；</li>
 *   <li>Excel/CSV → {@code table}（表格专用，按表格结构切片）；</li>
 *   <li>PPT → {@code presentation}（演示文稿专用，按幻灯片切）；</li>
 *   <li>图片 → {@code picture}（图片专用，OCR 后整图切块）；</li>
 *   <li>其他/未知 → {@code naive}（通用兜底，不强制）。</li>
 * </ul>
 *
 * @param fileName 上传文件名
 * @return 建议的 chunk_method 码值
 */
function suggestChunkMethodByFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const EXT_TO_METHOD: Record<string, string> = {
    md: 'naive',
    txt: 'naive',
    markdown: 'naive',
    pdf: 'paper',
    doc: 'naive',
    docx: 'naive',
    xls: 'table',
    xlsx: 'table',
    csv: 'table',
    ppt: 'presentation',
    pptx: 'presentation',
    jpg: 'picture',
    jpeg: 'picture',
    png: 'picture',
    json: 'naive',
    html: 'naive',
  };
  return EXT_TO_METHOD[ext] ?? 'naive';
}

export interface KbDocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryId: number;
  /** 上传成功后回调（父级刷新列表）。 */
  onUploaded: () => void | Promise<void>;
}

/**
 * 文档上传弹窗（kb_settings_model_chunk，R-P0-06/07）。
 *
 * <p>逐文件可选「切片方式 / 切片长度 / 分隔符」，三字段全空 = 继承库级
 * （行为与旧版直传完全一致）。上传成功后父级负责刷新列表；
 * 引擎侧解析为异步流程，列表轮询由 {@code KbDocumentTable} 收敛。
 */
export function KbDocumentUploadDialog({
  open,
  onOpenChange,
  libraryId,
  onUploaded,
}: KbDocumentUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [chunkMethod, setChunkMethod] = useState('');
  const [chunkTokenNum, setChunkTokenNum] = useState('');
  const [separator, setSeparator] = useState('');
  const [uploading, setUploading] = useState(false);
  /** 用户是否手动改过切片方式（P1-3：手动改过后不再按扩展名覆盖预填）。 */
  const [chunkMethodTouched, setChunkMethodTouched] = useState(false);

  // 打开时重置表单，避免上次残留
  const reset = () => {
    setFile(null);
    setChunkMethod('');
    setChunkTokenNum('');
    setSeparator('');
    setUploading(false);
    setChunkMethodTouched(false);
  };

  /** 选择文件：仅当用户尚未手动改过切片方式时，按扩展名预填默认值。 */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0] ?? null;
    setFile(next);
    if (next != null && !chunkMethodTouched) {
      setChunkMethod(suggestChunkMethodByFileName(next.name));
    }
  };

  const tokenNum = useMemo(() => {
    if (chunkTokenNum.trim() === '') return null;
    const n = Number(chunkTokenNum);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }, [chunkTokenNum]);

  const payloadError = useMemo<string | null>(() => {
    if (file != null && file.size > MAX_UPLOAD_BYTES) {
      return `文件超过 ${formatSize(MAX_UPLOAD_BYTES)} 上限`;
    }
    if (tokenNum != null && (tokenNum < 256 || tokenNum > 4096)) {
      return '切片长度需在 256 ~ 4096 之间';
    }
    return null;
  }, [file, tokenNum]);

  async function onSubmit(): Promise<void> {
    if (!file) {
      toast.warning('请选择要上传的文件');
      return;
    }
    if (payloadError) {
      toast.warning(payloadError);
      return;
    }
    const config: KbDocumentChunkConfig = {
      chunkMethod: chunkMethod.trim() || null,
      chunkTokenNum: tokenNum,
      // separator 允许是纯空白（如换行符），只在完全为空串时归 null
      separator: separator === '' ? null : separator,
      // T4 扩展四字段：上传弹窗不提供独立控件，一律 null = 继承库级
      // （引擎侧按 dataset 快照继承；文件级 PUT 白名单不含 toc/context/overlap 键）
      pageIndex: null,
      imageTableContextWindow: null,
      autoKeywords: null,
      autoQuestions: null,
    };
    setUploading(true);
    try {
      const result = await uploadDocument(libraryId, file, config);
      toast.success(`已上传「${file.name}」，解析状态：${result.parseStatus}`);
      reset();
      onOpenChange(false);
      await onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>上传文档</DialogTitle>
          <DialogDescription>
            可选文件级切片参数；不填则继承知识库级设置（引擎侧沿用 dataset 快照）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className={fieldLabel}>文件 *</label>
            <Input
              type="file"
              accept=".txt,.md,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.html,.jpg,.jpeg,.png"
              onChange={handleFileChange}
            />
            {file != null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {file.name} · {formatSize(file.size)}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">单文件不超过 {formatSize(MAX_UPLOAD_BYTES)}</p>
            )}
          </div>

          <div>
            <label className={fieldLabel}>切片方式</label>
            <select
              className={selectClass}
              value={chunkMethod}
              onChange={(e) => {
                setChunkMethodTouched(true);
                setChunkMethod(e.target.value);
              }}
            >
              <option value="">继承库级（不指定）</option>
              {KB_CHUNK_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              已按文件类型预填推荐方式；可手动修改，或选「继承库级」改回默认。
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={fieldLabel}>切片长度（token）</label>
              <Input
                type="number"
                min={256}
                max={4096}
                value={chunkTokenNum}
                onChange={(e) => setChunkTokenNum(e.target.value)}
                placeholder="如 512；留空继承库级"
                inputMode="numeric"
              />
              <p className="mt-1 text-xs text-muted-foreground">256 ~ 4096</p>
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
          <p className="text-xs text-muted-foreground">
            任一字段非空即视为「文件指定」；切片参数在上传后由引擎按此配置切片并解析。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={uploading} onClick={() => void onSubmit()}>
            <Upload className="h-4 w-4" />
            {uploading ? '上传中…' : '上传'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
