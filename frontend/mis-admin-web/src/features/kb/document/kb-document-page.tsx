import { useState } from 'react';
import { PageHeader } from '@/components/common/page-header';
import { KbLibraryPicker } from '../components/kb-library-picker';
import { KbDocumentTable } from './kb-document-table';
import { formatSize } from '../types';

/**
 * 知识库文档管理页。
 *
 * <p>库选择 + 文档列表两部分：选择器决定目标库，列表 UI 复用 {@link KbDocumentTable}
 * （库详情页 L-06 的「文档」Tab 也用它，避免两份相同表格漂移）。
 */
export function KbDocumentPage() {
  const [libraryId, setLibraryId] = useState<number | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title="文档管理"
        description="上传后由引擎异步解析切片；停用文档不参与检索但保留记录。"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">知识库</span>
        <div className="w-72">
          <KbLibraryPicker value={libraryId} onChange={setLibraryId} />
        </div>
        <span className="text-xs text-muted-foreground">
          单文件不超过 {formatSize(50 * 1024 * 1024)}
        </span>
      </div>

      {libraryId == null ? (
        <div className="rounded-lg border bg-table-surface py-10 text-center text-sm text-muted-foreground">
          请先选择知识库
        </div>
      ) : (
        <KbDocumentTable libraryId={libraryId} showUpload fill />
      )}
    </div>
  );
}
