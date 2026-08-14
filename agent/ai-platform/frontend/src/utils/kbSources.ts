/**
 * Parse structured knowledge-base citations out of assistant markdown.
 *
 * Backend `format_kb_answer_for_chat` appends a ```kb-sources fence.
 * Older turns used a plain "来源：" numbered list — still accepted.
 */

export interface KbChatSource {
  source: string;
  score?: number | null;
  chunk?: string;
  page?: number | null;
  offset?: number | null;
}

const FENCE_RE = /```kb-sources\s*\n([\s\S]*?)\n```/i;
const LEGACY_RE = /\n+来源：\s*\n((?:\d+\.\s+.+\n?)+)\s*$/;
const LEGACY_LINE_RE = /^\d+\.\s+(.+?)(?:（相关度\s*([\d.]+)）)?\s*$/;

export function splitKbSources(content: string): {
  body: string;
  sources: KbChatSource[];
} {
  const text = content ?? "";
  const fenceStart = text.lastIndexOf("```kb-sources");
  const fence = text.match(FENCE_RE);
  if (fenceStart >= 0 && !fence) {
    return { body: text.slice(0, fenceStart).trimEnd(), sources: [] };
  }
  if (fence) {
    const sources = parseFencePayload(fence[1]);
    const body = text.replace(fence[0], "").replace(/\n{3,}/g, "\n\n").trimEnd();
    return { body, sources };
  }
  const legacy = text.match(LEGACY_RE);
  if (legacy && legacy.index != null) {
    return {
      body: text.slice(0, legacy.index).trimEnd(),
      sources: parseLegacyList(legacy[1]),
    };
  }
  return { body: text, sources: [] };
}

function parseFencePayload(raw: string): KbChatSource[] {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (!Array.isArray(parsed)) return [];
    const sources: KbChatSource[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const source = String(rec.source ?? rec.title ?? "").trim();
      if (!source) continue;
      const chunkRaw = rec.chunk ?? rec.chunkText ?? rec.chunk_text;
      sources.push({
        source,
        score: toFiniteNumber(rec.score),
        chunk: typeof chunkRaw === "string" && chunkRaw.trim() ? chunkRaw : undefined,
        page: toFiniteNumber(rec.page),
        offset: toFiniteNumber(rec.offset),
      });
    }
    return sources;
  } catch {
    return [];
  }
}

function parseLegacyList(block: string): KbChatSource[] {
  const sources: KbChatSource[] = [];
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(LEGACY_LINE_RE);
    if (!m) continue;
    sources.push({
      source: m[1].trim(),
      score: m[2] != null ? toFiniteNumber(m[2]) : null,
    });
  }
  return sources;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
