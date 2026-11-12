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
    <>
      <style>{`
        .msg-html-view table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
        .msg-html-view th, .msg-html-view td {
          border: 1px solid #cbd5e1;
          padding: 0.35rem 0.5rem;
          vertical-align: top;
        }
        .msg-html-view th { background: #f8fafc; font-weight: 600; }
        .msg-html-view mark { background: #fef08a; padding: 0 0.1em; border-radius: 2px; }
        .msg-html-view img { max-width: 100%; height: auto; }
        .msg-html-view hr { border: none; border-top: 1px solid #cbd5e1; margin: 0.75rem 0; }
      `}</style>
      <div
        className="msg-html-view prose prose-sm max-w-none break-words text-[13px] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </>
  );
}
