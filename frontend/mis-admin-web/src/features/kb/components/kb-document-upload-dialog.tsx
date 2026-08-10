import { useMemo, useState } from 'react';
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

  // 打开时重置表单，避免上次残留
  const reset = () => {
    setFile(null);
    setChunkMethod('');
    setChunkTokenNum('');
    setSeparator('');
    setUploading(false);
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
    if (tokenNum != null && (tokenNum < 16 || tokenNum > 4096)) {
      return '切片长度需在 16 ~ 4096 之间';
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
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
              onChange={(e) => setChunkMethod(e.target.value)}
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
                value={chunkTokenNum}
                onChange={(e) => setChunkTokenNum(e.target.value)}
                placeholder="如 512；留空继承库级"
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
