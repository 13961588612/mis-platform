import { useState } from "react";
import { clsx } from "../utils/format";
import { ChunkImage } from "./KbSourceFigures";
import { hasChunkImage, type KbChatSource } from "../utils/kbSources";

function formatScore(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  const pct = score > 1 ? score : score * 100;
  return `${pct.toFixed(1)}%`;
}

function locator(source: KbChatSource): string | null {
  const parts: string[] = [];
  if (source.page != null) parts.push(`第 ${source.page} 页`);
  if (source.offset != null) parts.push(`偏移 ${source.offset}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Collapsed knowledge-source list for Copilot answers.
 * First click expands titles; a second click on a row shows the snippet.
 */
export function KbSourceDisclosure({
  sources,
}: {
  sources: KbChatSource[];
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  if (sources.length === 0) return null;

  return (
    <div className="mt-2 border-t border-surface-light/70 pt-2">
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          if (open) setActive(null);
        }}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs text-surface-dark/65 hover:bg-white/60 hover:text-surface-dark"
        aria-expanded={open}
      >
        <span
          className={clsx(
            "inline-block text-surface-dark/35 transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        >
          ›
        </span>
        <span className="font-medium">来源 · {sources.length} 篇</span>
        <span className="text-surface-dark/40">{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <ul className="mt-1 space-y-1">
          {sources.map((source, index) => {
            const selected = active === index;
            const score = formatScore(source.score);
            const loc = locator(source);
            const showImage = selected && hasChunkImage(source);
            return (
              <li key={`${source.source}-${index}`}>
                <button
                  type="button"
                  onClick={() => setActive(selected ? null : index)}
                  className={clsx(
                    "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    selected ? "bg-white" : "hover:bg-white/70",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 leading-relaxed text-surface-dark/85">
                      <span className="mr-1 text-surface-dark/40">{index + 1}.</span>
                      {source.source}
                    </span>
                    {score ? (
                      <span className="shrink-0 tabular-nums text-surface-dark/40">
                        {score}
                      </span>
                    ) : null}
                  </div>
                  {selected ? (
                    <div className="mt-1.5 space-y-1 border-t border-surface-light/60 pt-1.5 text-surface-dark/70">
                      {loc ? <p className="text-[11px] text-surface-dark/45">{loc}</p> : null}
                      {showImage ? (
                        <ChunkImage
                          libraryId={source.libraryId}
                          documentId={source.documentId}
                          imageId={source.imageId}
                          label={source.source}
                        />
                      ) : null}
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {source.chunk?.trim() || "（无片段原文）"}
                      </p>
                    </div>
                  ) : source.chunk ? (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-surface-dark/45">
                      {source.chunk}
                    </p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
