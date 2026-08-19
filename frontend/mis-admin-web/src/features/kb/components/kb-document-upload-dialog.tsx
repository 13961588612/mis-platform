import { useEffect, useMemo, useState } from 'react';
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
import type { KbDocumentChunkConfig, KbRagSettings } from '../types';
import { KB_CHUNK_METHOD_OPTIONS, formatSize } from '../types';

/** 与 BFF `KbFacadeService` 的 50MB 上限保持一致，前端提前拦截避免无谓上传。 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/**
 * 按扩展名建议默认切片方式（P1-3）。
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

/** 库级 RAG 设置 → 上传表单四参数默认值（显式落库，非 null 继承）。 */
function parserDefaultsFromLibrary(librarySettings?: KbRagSettings | null) {
  return {
    pageIndex: librarySettings?.pageIndex !== false,
    imageTableContextWindow: String(librarySettings?.imageTableContextWindow ?? 256),
    autoKeywords: String(librarySettings?.autoKeywords ?? 0),
    autoQuestions: String(librarySettings?.autoQuestions ?? 0),
  };
}

export interface KbDocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryId: number;
  /** 库级 RAG 设置：预填解析器四参数默认值。 */
  librarySettings?: KbRagSettings | null;
  /** 上传成功后回调（父级刷新列表）。 */
  onUploaded: () => void | Promise<void>;
}

/**
 * 文档上传弹窗（kb_settings_model_chunk，R-P0-06/07）。
 *
 * <p>可选文件级切片参数 + 解析器四参数（默认带出库级值，可改，提交后写入文档列）。
 */
export function KbDocumentUploadDialog({
  open,
  onOpenChange,
  libraryId,
  librarySettings = null,
  onUploaded,
}: KbDocumentUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [chunkMethod, setChunkMethod] = useState('');
  const [chunkTokenNum, setChunkTokenNum] = useState('');
  const [separator, setSeparator] = useState('');
  const [pageIndex, setPageIndex] = useState(true);
  const [imageTableContextWindow, setImageTableContextWindow] = useState('256');
  const [autoKeywords, setAutoKeywords] = useState('0');
  const [autoQuestions, setAutoQuestions] = useState('0');
  const [uploading, setUploading] = useState(false);
  /** 用户是否手动改过切片方式（P1-3：手动改过后不再按扩展名覆盖预填）。 */
  const [chunkMethodTouched, setChunkMethodTouched] = useState(false);

  const applyLibraryDefaults = () => {
    const d = parserDefaultsFromLibrary(librarySettings);
    setPageIndex(d.pageIndex);
    setImageTableContextWindow(d.imageTableContextWindow);
    setAutoKeywords(d.autoKeywords);
    setAutoQuestions(d.autoQuestions);
    if (librarySettings?.chunkTokenNum != null) {
      setChunkTokenNum(String(librarySettings.chunkTokenNum));
    }
  };

  const reset = () => {
    setFile(null);
    setChunkMethod('');
    setChunkTokenNum('');
    setSeparator('');
    applyLibraryDefaults();
    setUploading(false);
    setChunkMethodTouched(false);
  };

  useEffect(() => {
    if (open) {
      applyLibraryDefaults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅弹窗打开时刷新库级默认
  }, [open, librarySettings]);

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

  const imageWindow = useMemo(() => {
    const n = Number(imageTableContextWindow);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }, [imageTableContextWindow]);

  const keywords = useMemo(() => {
    const n = Number(autoKeywords);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }, [autoKeywords]);

  const questions = useMemo(() => {
    const n = Number(autoQuestions);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }, [autoQuestions]);

  const payloadError = useMemo<string | null>(() => {
    if (file != null && file.size > MAX_UPLOAD_BYTES) {
      return `文件超过 ${formatSize(MAX_UPLOAD_BYTES)} 上限`;
    }
    if (tokenNum != null && (tokenNum < 256 || tokenNum > 2048)) {
      return '切片长度需在 256 ~ 2048 之间';
    }
    if (imageWindow == null || imageWindow < 1 || imageWindow > 4096) {
      return '图像与表格上下文窗口需在 1 ~ 4096 之间';
    }
    if (keywords == null || keywords < 0 || keywords > 32) {
      return '自动关键字数量需在 0 ~ 32 之间';
    }
    if (questions == null || questions < 0 || questions > 10) {
      return '自动问题数量需在 0 ~ 10 之间';
    }
    return null;
  }, [file, tokenNum, imageWindow, keywords, questions]);

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
      separator: separator === '' ? null : separator,
      pageIndex,
      imageTableContextWindow: imageWindow,
      autoKeywords: keywords,
      autoQuestions: questions,
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
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>上传文档</DialogTitle>
          <DialogDescription>
            解析器参数默认带出知识库级设置，可按文件修改；提交后写入该文档的文件级参数。
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

          <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">解析器参数（默认库级，提交后落文档级）</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={pageIndex}
                    onChange={(e) => setPageIndex(e.target.checked)}
                  />
                  页码索引（PageIndex / TOC 提取）
                </label>
              </div>
              <div>
                <label className={fieldLabel}>图像与表格上下文窗口</label>
                <Input
                  type="number"
                  min={1}
                  max={4096}
                  value={imageTableContextWindow}
                  onChange={(e) => setImageTableContextWindow(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className={fieldLabel}>自动关键字数量</label>
                <Input
                  type="number"
                  min={0}
                  max={32}
                  value={autoKeywords}
                  onChange={(e) => setAutoKeywords(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className={fieldLabel}>自动问题数量</label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={autoQuestions}
                  onChange={(e) => setAutoQuestions(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>
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
