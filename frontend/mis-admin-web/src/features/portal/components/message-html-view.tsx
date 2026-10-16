import { useEffect, useState } from 'react';
import { downloadMessageFile } from '@/lib/api/message-manage';

const FILE_SRC = /\/api\/v1\/messages\/files\/(\d+)/;

export function messageHtmlBody(content: string | null): string | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as { format?: string; body?: string };
    if (parsed.format === 'html' && typeof parsed.body === 'string') {
      return parsed.body;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseAttachmentList(raw: string | null): { fileId: string; name: string; size?: number }[] {
  if (!raw || raw === '[]') return [];
  try {
    const parsed = JSON.parse(raw) as { fileId?: string; name?: string; size?: number }[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item.fileId)
      .map((item) => ({ fileId: String(item.fileId), name: item.name || item.fileId || '附件', size: item.size }));
  } catch {
    return [];
  }
}

/** 已清洗的 HTML。图片经登录态拉取后再显示。 */
export function MessageHtmlView({ html }: { html: string }) {
  const [markup, setMarkup] = useState(html);

  useEffect(() => {
    const urls: string[] = [];
    let cancelled = false;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const images = [...doc.querySelectorAll('img')];
    void Promise.all(
      images.map(async (img) => {
        const match = FILE_SRC.exec(img.getAttribute('src') || '');
        if (!match) {
          img.remove();
          return;
        }
        const blob = await downloadMessageFile(match[1]);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        img.setAttribute('src', url);
      }),
    ).then(() => {
      if (!cancelled) setMarkup(doc.body.innerHTML);
    });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [html]);

  return (
    <div
      className="prose prose-sm max-w-none break-words text-[13px] leading-relaxed"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
