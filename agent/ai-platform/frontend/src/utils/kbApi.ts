/**
 * KB chunk image fetch — proxied to MIS Gateway `/api/v1/kb/...` (see vite.config).
 */

import { apiClient } from "./api";

/** Fetch chunk layout screenshot via authenticated API (returns object URL). */
export async function fetchDocumentChunkImage(
  libraryId: number,
  docId: number,
  imageId: string,
): Promise<string> {
  const res = await apiClient.get<Blob>(
    `/kb/libraries/${libraryId}/documents/${docId}/chunk-images/${encodeURIComponent(imageId)}`,
    { responseType: "blob" },
  );
  const rawType =
    String(res.headers?.["content-type"] ?? "image/jpeg").split(";")[0]?.trim() ??
    "image/jpeg";
  if (rawType.includes("json") || rawType.startsWith("text/")) {
    const text = await res.data.text();
    throw new Error(text.slice(0, 200) || "分片图片响应格式异常");
  }
  const blob = res.data.type ? res.data : new Blob([res.data], { type: rawType });
  if (blob.size === 0) {
    throw new Error("分片图片为空");
  }
  return URL.createObjectURL(blob);
}
