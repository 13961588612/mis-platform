import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { BubbleMenu, EditorContent, Extension, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import CharacterCount from '@tiptap/extension-character-count';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table as TableIcon,
  Type,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { uploadMessageFile, downloadMessageFile } from '@/lib/api/message-manage';
import { toast } from 'sonner';

const TEXT_COLORS = [
  { label: '默认', value: '' },
  { label: '黑', value: '#0f172a' },
  { label: '灰', value: '#64748b' },
  { label: '红', value: '#dc2626' },
  { label: '橙', value: '#ea580c' },
  { label: '绿', value: '#16a34a' },
  { label: '蓝', value: '#2563eb' },
  { label: '紫', value: '#7c3aed' },
];

const FONT_SIZES = [
  { label: '默认', value: '' },
  { label: '12', value: '12px' },
  { label: '13', value: '13px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
];

const IMAGE_WIDTHS = [
  { label: '25%', value: '25%' },
  { label: '50%', value: '50%' },
  { label: '75%', value: '75%' },
  { label: '100%', value: '100%' },
];

/** 字号：挂在 textStyle 上，持久化为 style="font-size:…" */
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => (element as HTMLElement).style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
});

function applyFontSize(editor: Editor, fontSize: string) {
  if (!fontSize) {
    editor.chain().focus().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
    return;
  }
  editor.chain().focus().setMark('textStyle', { fontSize }).run();
}

const MessageImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fileId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-file-id'),
        renderHTML: (attributes) => (attributes.fileId ? { 'data-file-id': attributes.fileId } : {}),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const el = element as HTMLElement;
          return el.getAttribute('width') || el.style.width || null;
        },
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          const w = String(attributes.width);
          return { width: w, style: `width: ${w}; height: auto;` };
        },
      },
    };
  },
});

/** Word / 办公套件粘贴：去掉脚本与危险标签，只保留常用排版样式。 */
export function sanitizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((node) => {
    const el = node as HTMLElement;
    el.removeAttribute('class');
    el.removeAttribute('id');
    el.removeAttribute('onclick');
    el.removeAttribute('onerror');
    const style = el.getAttribute('style');
    if (!style) return;
    const kept = style
      .split(';')
      .map((s) => s.trim())
      .filter((s) =>
        /^(color|background-color|font-size|text-align|font-weight|font-style|text-decoration)\s*:/i.test(
          s,
        ),
      )
      .join('; ');
    if (kept) el.setAttribute('style', kept);
    else el.removeAttribute('style');
  });
  return doc.body.innerHTML;
}

function ToolButton({
  active,
  label,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function ToolDivider() {
  return <span className="mx-0.5 h-5 w-px self-center bg-border" aria-hidden />;
}

export function MessageRichEditor({ editorRef }: { editorRef: MutableRefObject<Editor | null> }) {
  const imageInput = useRef<HTMLInputElement>(null);
  const insertImageRef = useRef<(file: File | undefined) => Promise<void>>(async () => undefined);
  const [tick, setTick] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('https://');
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // HorizontalRule 用官方扩展按钮；StarterKit 已含
      }),
      Underline,
      TextStyle,
      FontSize,
      Color,
      Highlight.configure({ multicolor: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      MessageImage.configure({ allowBase64: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: '编写通知正文' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CharacterCount,
    ],
    content: '<p></p>',
    onTransaction: () => setTick((n) => n + 1),
    editorProps: {
      attributes: {
        class: 'min-h-40 px-3 py-2 text-[13px] leading-relaxed outline-none',
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            void insertImageRef.current(item.getAsFile() ?? undefined);
            return true;
          }
        }
        return false;
      },
      transformPastedHTML: (html) => sanitizePastedHtml(html),
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  const insertImage = useCallback(
    async (file: File | undefined) => {
      if (!file || !editor) return;
      try {
        const uploaded = await uploadMessageFile(file, 'image');
        const blob = await downloadMessageFile(uploaded.fileId);
        const url = URL.createObjectURL(blob);
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'image',
            attrs: { src: url, alt: uploaded.name, fileId: uploaded.fileId, width: '100%' },
          })
          .run();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '图片上传失败');
      }
    },
    [editor],
  );

  useEffect(() => {
    insertImageRef.current = insertImage;
  }, [insertImage]);

  const applyLink = () => {
    if (!editor) return;
    const href = linkHref.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setLinkOpen(false);
  };

  const clearFormats = () => {
    if (!editor) return;
    editor.chain().focus().unsetAllMarks().clearNodes().run();
  };

  if (!editor) return null;

  const chars = editor.storage.characterCount?.characters?.() ?? 0;
  const words = editor.storage.characterCount?.words?.() ?? 0;
  const imageSelected = editor.isActive('image');

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1 border-b p-2">
      <ToolButton label="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="下划线"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolButton>

      <Popover open={colorOpen} onOpenChange={setColorOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline" className="h-7 w-7 p-0" title="文字颜色" aria-label="文字颜色">
            <Palette className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="grid grid-cols-4 gap-1.5">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.label}
                type="button"
                title={c.label}
                className="h-6 w-6 rounded border"
                style={{ background: c.value || '#ffffff' }}
                onClick={() => {
                  if (!c.value) editor.chain().focus().unsetColor().run();
                  else editor.chain().focus().setColor(c.value).run();
                  setColorOpen(false);
                }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <ToolButton
        label="高亮"
        active={editor.isActive('highlight')}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <Highlighter className="h-3.5 w-3.5" />
      </ToolButton>

      <Popover open={sizeOpen} onOpenChange={setSizeOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline" className="h-7 gap-0.5 px-1.5" title="字号" aria-label="字号">
            <Type className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-28 p-1" align="start">
          {FONT_SIZES.map((s) => (
            <button
              key={s.label}
              type="button"
              className="flex w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
              onClick={() => {
                applyFontSize(editor, s.value);
                setSizeOpen(false);
              }}
            >
              {s.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <ToolButton label="清除格式" onClick={clearFormats}>
        <RemoveFormatting className="h-3.5 w-3.5" />
      </ToolButton>

      <ToolDivider />

      <ToolButton
        label="一级标题"
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="标题"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="小标题"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="代码" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Code className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="列表"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="编号"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="引用"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="分割线" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="h-3.5 w-3.5" />
      </ToolButton>

      <ToolDivider />

      <ToolButton
        label="左对齐"
        active={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="居中"
        active={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="右对齐"
        active={editor.isActive({ textAlign: 'right' })}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >
        <AlignRight className="h-3.5 w-3.5" />
      </ToolButton>

      <ToolDivider />

      <Popover
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open);
          if (open) {
            const prev = (editor.getAttributes('link').href as string | undefined) ?? 'https://';
            setLinkHref(prev);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant={editor.isActive('link') ? 'default' : 'outline'}
            className="h-7 w-7 p-0"
            title="链接"
            aria-label="链接"
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2 p-3" align="start">
          <p className="text-xs text-muted-foreground">链接地址（http / https）</p>
          <Input
            value={linkHref}
            onChange={(e) => setLinkHref(e.target.value)}
            placeholder="https://"
            aria-label="链接地址"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
            }}
          />
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setLinkOpen(false);
              }}
            >
              清除
            </Button>
            <Button type="button" size="sm" onClick={applyLink}>
              应用
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <ToolButton label="图片" onClick={() => imageInput.current?.click()}>
        <ImageIcon className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="插入表格"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <TableIcon className="h-3.5 w-3.5" />
      </ToolButton>
      {editor.isActive('table') ? (
        <>
          <ToolButton label="删表" onClick={() => editor.chain().focus().deleteTable().run()}>
            <Eraser className="h-3.5 w-3.5" />
          </ToolButton>
        </>
      ) : null}

      {imageSelected ? (
        <select
          className="h-7 rounded-md border border-input bg-background px-1 text-[11px]"
          aria-label="图片宽度"
          title="图片宽度"
          value={(editor.getAttributes('image').width as string) || '100%'}
          onChange={(e) => {
            editor.chain().focus().updateAttributes('image', { width: e.target.value }).run();
          }}
        >
          {IMAGE_WIDTHS.map((w) => (
            <option key={w.value} value={w.value}>
              图宽 {w.label}
            </option>
          ))}
        </select>
      ) : null}

      <ToolDivider />

      <ToolButton label="撤销" onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="重做" onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label={fullscreen ? '退出全屏' : '全屏'} onClick={() => setFullscreen((v) => !v)}>
        {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </ToolButton>

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
  );

  const shell = (
    <div
      className={cn(
        'flex flex-col rounded-md border bg-background',
        fullscreen && 'fixed inset-3 z-50 shadow-lg',
      )}
      data-editor-tick={tick}
    >
      {toolbar}
      <div className={cn('min-h-0 flex-1 overflow-auto', fullscreen && 'min-h-[calc(100%-5rem)]')}>
        {editor ? (
          <BubbleMenu
            editor={editor}
            tippyOptions={{ duration: 100 }}
            shouldShow={({ editor: ed }) => ed.isActive('link')}
            className="flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
          >
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                const prev = (editor.getAttributes('link').href as string | undefined) ?? 'https://';
                setLinkHref(prev);
                setLinkOpen(true);
              }}
            >
              编辑链接
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
            >
              取消链接
            </Button>
          </BubbleMenu>
        ) : null}
        <EditorContent editor={editor} />
      </div>
      <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {chars} 字 · {words} 词
        </span>
        <span>粘贴图片将自动上传；办公文档粘贴已做基础清洗</span>
      </div>
      <style>{`
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          height: 0;
          color: #94a3b8;
          pointer-events: none;
        }
        .ProseMirror img { max-width: 100%; height: auto; }
        .ProseMirror h1 { font-size: 1.35rem; font-weight: 650; margin: 0.5rem 0; }
        .ProseMirror h2 { font-size: 1.15rem; font-weight: 600; margin: 0.4rem 0; }
        .ProseMirror h3 { font-size: 1.02rem; font-weight: 600; margin: 0.3rem 0; }
        .ProseMirror ul, .ProseMirror ol { padding-left: 1.25rem; }
        .ProseMirror blockquote { border-left: 3px solid #cbd5e1; margin: 0.4rem 0; padding-left: 0.75rem; color: #475569; }
        .ProseMirror pre { background: #f1f5f9; border-radius: 6px; padding: 0.5rem 0.75rem; overflow: auto; }
        .ProseMirror hr { border: none; border-top: 1px solid #cbd5e1; margin: 0.75rem 0; }
        .ProseMirror table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; table-layout: fixed; }
        .ProseMirror th, .ProseMirror td {
          border: 1px solid #cbd5e1;
          padding: 0.35rem 0.5rem;
          vertical-align: top;
        }
        .ProseMirror th { background: #f8fafc; font-weight: 600; }
        .ProseMirror .selectedCell { background: #e0e7ff; }
        .ProseMirror mark { background: #fef08a; padding: 0 0.1em; border-radius: 2px; }
      `}</style>
    </div>
  );

  return shell;
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
