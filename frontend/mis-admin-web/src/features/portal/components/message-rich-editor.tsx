import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import type { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { uploadMessageFile, downloadMessageFile } from '@/lib/api/message-manage';
import { toast } from 'sonner';

const MessageImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fileId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-file-id'),
        renderHTML: (attributes) => (attributes.fileId ? { 'data-file-id': attributes.fileId } : {}),
      },
    };
  },
});

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      className="h-7 w-7 p-0"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function MessageRichEditor({ editorRef }: { editorRef: MutableRefObject<Editor | null> }) {
  const imageInput = useRef<HTMLInputElement>(null);
  const [tick, setTick] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      MessageImage,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: '编写通知正文' }),
    ],
    content: '<p></p>',
    onTransaction: () => setTick((n) => n + 1),
    editorProps: {
      attributes: {
        class: 'min-h-40 px-3 py-2 text-[13px] leading-relaxed outline-none',
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  async function insertImage(file: File | undefined) {
    if (!file || !editor) return;
    try {
      const uploaded = await uploadMessageFile(file, 'image');
      const blob = await downloadMessageFile(uploaded.fileId);
      const url = URL.createObjectURL(blob);
      editor.chain().focus().insertContent({
        type: 'image',
        attrs: { src: url, alt: uploaded.name, fileId: uploaded.fileId },
      }).run();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '图片上传失败');
    }
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('链接地址（http 或 https）', prev ?? 'https://');
    if (href === null) return;
    if (href.trim() === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }

  if (!editor) return null;

  return (
    <div className="rounded-md border bg-background" data-editor-tick={tick}>
      <div className="flex flex-wrap gap-1 border-b p-2">
        <ToolButton label="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="下划线" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="标题" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="小标题" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="代码" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="编号" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="左对齐" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="居中" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="右对齐" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="链接" active={editor.isActive('link')} onClick={setLink}><Link2 className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="图片" onClick={() => imageInput.current?.click()}><ImageIcon className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton label="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-3.5 w-3.5" /></ToolButton>
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            void insertImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      <EditorContent editor={editor} />
      <style>{`
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          height: 0;
          color: #94a3b8;
          pointer-events: none;
        }
        .ProseMirror img { max-width: 100%; height: auto; }
        .ProseMirror h2 { font-size: 1.15rem; font-weight: 600; margin: 0.4rem 0; }
        .ProseMirror h3 { font-size: 1.02rem; font-weight: 600; margin: 0.3rem 0; }
        .ProseMirror ul, .ProseMirror ol { padding-left: 1.25rem; }
        .ProseMirror blockquote { border-left: 3px solid #cbd5e1; margin: 0.4rem 0; padding-left: 0.75rem; color: #475569; }
        .ProseMirror pre { background: #f1f5f9; border-radius: 6px; padding: 0.5rem 0.75rem; overflow: auto; }
      `}</style>
    </div>
  );
}

/** 把编辑器里的本地预览地址换成可持久化的文件路径。 */
export function normalizeEditorHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('img').forEach((img) => {
    const fileId = img.getAttribute('data-file-id');
    if (fileId) img.setAttribute('src', `/api/v1/messages/files/${fileId}`);
  });
  return doc.body.innerHTML;
}
