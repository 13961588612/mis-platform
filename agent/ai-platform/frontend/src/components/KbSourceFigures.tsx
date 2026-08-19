import { useEffect, useState } from "react";
import { fetchDocumentChunkImage } from "../utils/kbApi";
import { hasChunkImage, type KbChatSource } from "../utils/kbSources";

/** Authenticated chunk screenshot (Bearer via API proxy). */
export function ChunkImage({
  libraryId,
  documentId,
  imageId,
  label,
}: {
  libraryId: number;
  documentId: number;
  imageId: string;
  label?: string;
}): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    void (async () => {
      try {
        const url = await fetchDocumentChunkImage(libraryId, documentId, imageId);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoked = url;
        setSrc(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [libraryId, documentId, imageId]);

  if (failed) {
    return <p className="text-[11px] text-surface-dark/45">分片图片加载失败</p>;
  }
  if (!src) {
    return <p className="text-[11px] text-surface-dark/45">图片加载中…</p>;
  }
  return (
    <img
      src={src}
      alt={label ?? "分片截图"}
      className="max-h-64 max-w-full rounded-md border border-surface-light object-contain bg-white/60"
      onError={() => setFailed(true)}
    />
  );
}

/** Inline Fig. N figures below the answer body (RAGFlow-style). */
export function KbSourceFigures({ sources }: { sources: KbChatSource[] }): JSX.Element | null {
  const withImages = sources
    .map((source) => ({ source, label: source.index ?? null }))
    .filter(
      (
        item,
      ): item is {
        source: KbChatSource & { libraryId: number; documentId: number; imageId: string };
        label: number | null;
      } => hasChunkImage(item.source),
    );
  if (withImages.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {withImages.map(({ source, label }, i) => {
        const figNo = label ?? i + 1;
        return (
          <figure key={`${source.imageId}-${figNo}`} className="max-w-xs shrink-0">
            <ChunkImage
              libraryId={source.libraryId}
              documentId={source.documentId}
              imageId={source.imageId}
              label={`Fig. ${figNo}`}
            />
            <figcaption className="mt-1 text-center text-[11px] text-surface-dark/45">
              Fig. {figNo}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
