/**
 * useCodeMirror.ts — CodeMirror 6 的 React hook（v1.11 MR-04/05/06 共用基座）。
 *
 * <h2>三处共用（本批只落第 1 处，另两处是 T03c/T03d 的消费者）</h2>
 * <ol>
 *   <li><b>本批</b>：`RelationshipDialog` 的 join condition 编辑器；</li>
 *   <li>T03d：`ModelEditDrawer` 的 `ref_sql` 编辑器；</li>
 *   <li>T03c：`CalculatedColumnEditor` / Cube measure 表达式编辑器。</li>
 * </ol>
 * 因此本 hook **不含任何业务语义**（不知道「条件」「表达式」的区别）：只负责
 * 「受控 value + onChange + 字段清单 + 只读」四件事，业务由调用方组装。
 *
 * <h2>为什么懒加载（R-5）</h2>
 * CodeMirror 6 五个包合计约 120KB+（gzip），而建模台首屏（画布）根本用不到编辑器：
 * 用户要先点「连线」或「编辑字段」才需要。故本 hook 在 **挂载后**才 `import()`，
 * 依赖 **Vite 的动态 import 自动分 chunk**（R-5 备选方案：一旦动态 import 出问题，
 * 退回静态 import，代价是主 chunk 变大 —— 但不会白屏）。
 *
 * <h2>降级路径（重要）</h2>
 * 编辑器是**可选增强**：任何一环加载失败（依赖缺失 / 动态 import 被 CSP 拦 / 旧浏览器），
 * 本 hook 返回 `error`，由调用方渲染普通 `<Textarea>` 兜底 —— **绝不让编辑器故障
 * 阻断「建关系」这条 M-G2 主路径**。
 *
 * <h2>字段补全的现状与 TODO</h2>
 * 编辑器内的补全下拉需要 `@codemirror/autocomplete` 的 `autocompletion()`，但该包
 * **既不在 `package.json`、也不在 `node_modules`**（它是 `@codemirror/lang-sql` 的传递依赖，
 * T01 装依赖时缺失；`package-lock.json` 亦未登记 T01 新依赖）。为不从本批引入
 * 「装了但锁文件没同步」的不可复现构建，本 hook **不 import 它**，改为：
 * <ul>
 *   <li>把 `fields` 传进 `sql({ schema })` —— lang-sql 的 schema 补全源已就绪；</li>
 *   <li>字段补全在本批以**显式「插入字段」下拉**交付（`RelationshipDialog` 内，
 *       光标处插入），对「十几个字段」的量级比下拉补全更直接；</li>
 * </ul>
 * `TODO(后续批次)`：`@codemirror/autocomplete` 升为直接依赖后，在 {@link loadModules} 里
 * 补一行 `autocompletion()` 即可启用**编辑器内**补全（schema 数据已经备好，无需改调用方）。
 *
 * <h2>与既有 hook 的一致性</h2>
 * 写法对齐 `useCatalogNodes.ts`（T02）：模块头讲清「红线 / 为什么」、纯逻辑抽成可导出函数、
 * 副作用集中在 `useEffect` + `useRef`，不在 render 期做 IO。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** 动态加载的 CodeMirror 模块集合（`typeof import(...)` 避免顶层静态 import 打破懒加载）。 */
interface CmModules {
  state: typeof import('@codemirror/state');
  view: typeof import('@codemirror/view');
  commands: typeof import('@codemirror/commands');
  /** SQL 语言支持；缺失时为 null（编辑器降级为纯文本，仍可输入）。 */
  sql: typeof import('@codemirror/lang-sql') | null;
}

/** 模块级缓存：多实例（同页多个编辑器）只 import 一次。 */
let modulesPromise: Promise<CmModules> | null = null;

/**
 * 懒加载 CodeMirror 模块。
 *
 * <p>必需部分（state/view/commands）失败 → 整体 reject（调用方渲染 Textarea 兜底）；
 * 可选部分（lang-sql）失败 → 只降级高亮，不影响可输入性。
 */
async function loadModules(): Promise<CmModules> {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const [state, view, commands] = await Promise.all([
        import('@codemirror/state'),
        import('@codemirror/view'),
        import('@codemirror/commands'),
      ]);
      let sql: CmModules['sql'] = null;
      try {
        sql = await import('@codemirror/lang-sql');
      } catch {
        // 语义高亮是增强项：缺 @codemirror/lang-sql / 其传递依赖时静默降级。
        sql = null;
      }
      return { state, view, commands, sql };
    })().catch((error) => {
      // 失败不缓存：下次挂载（如网络恢复）可重试。
      modulesPromise = null;
      throw error;
    });
  }
  return modulesPromise;
}

/** `useCodeMirror` 入参。 */
export interface UseCodeMirrorOptions {
  /** 受控值（服务端/draft 真值）。 */
  value: string;
  /** 内容变更回调（每次按键触发；防抖由调用方决定）。 */
  onChange?: (value: string) => void;
  /**
   * 字段清单（补全 / 语句分析数据源）。
   *
   * <p>可传 `col` 或 `table.col`：lang-sql 的 `schema` 接收字符串数组，
   * 裸列名会被当作顶层候选，带点号会被当作限定名 —— 两种都能命中。
   */
  fields?: string[];
  /** 默认表名（`schema` 补全时优先展开该表的字段）。 */
  defaultTable?: string | null;
  /** 只读（查看态）。 */
  readOnly?: boolean;
  /** 占位文案（内容为空时显示）。 */
  placeholder?: string;
  /** 内容区高度（默认 120px）。 */
  height?: number | string;
}

/** `useCodeMirror` 返回值。 */
export interface UseCodeMirrorResult {
  /** 挂载点（放到 `<div ref={containerRef} />` 上）。 */
  containerRef: RefObject<HTMLDivElement>;
  /** 首次懒加载中（调用方可显示骨架）。 */
  loading: boolean;
  /** 编辑器已就绪。 */
  ready: boolean;
  /** 已就绪但 SQL 语言未加载（纯文本模式，仍可输入）。 */
  degraded: boolean;
  /** 加载失败原因（非 null → 调用方应渲染 Textarea 兜底）。 */
  error: string | null;
  /** 在光标处插入片段（字段补全 / 运算符模板）。 */
  insert: (snippet: string) => void;
  /** 聚焦编辑器。 */
  focus: () => void;
}

/**
 * CodeMirror 6 受控 hook（懒加载 + 行号 + SQL 高亮 + 字段插入）。
 *
 * @param options 见 {@link UseCodeMirrorOptions}
 * @returns 挂载点 ref + 状态 + 命令式方法
 */
export function useCodeMirror(options: UseCodeMirrorOptions): UseCodeMirrorResult {
  const { value, onChange, fields, defaultTable, readOnly = false, placeholder, height = 120 } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<import('@codemirror/view').EditorView | null>(null);
  const modulesRef = useRef<CmModules | null>(null);
  const compartmentRef = useRef<import('@codemirror/state').Compartment | null>(null);

  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 回调/初值快照：**不进 effect 依赖** —— 否则父组件每次 render 换了函数身份就会
   * 销毁重建编辑器（丢光标、丢撤销历史，体感是「打字时编辑器闪了一下」）。
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initialValueRef = useRef(value);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  /** 字段清单序列化成稳定 key（数组身份每次都变，直接当依赖会无限重配）。 */
  const fieldsKey = (fields ?? []).join('\u0000');

  // ---------------------------------------------------------------- 建编辑器（挂载一次）
  useEffect(() => {
    let disposed = false;
    const parent = containerRef.current;
    if (!parent) {
      // 容器未挂载（调用方把编辑器放在条件渲染分支里）→ 明确交出 error，不静默卡在 loading
      setLoading(false);
      setError('编辑器容器未挂载');
      return;
    }

    void (async () => {
      try {
        const mods = await loadModules();
        if (disposed) {
          return;
        }
        modulesRef.current = mods;
        const { state, view } = mods;

        const readOnlyCompartment = new state.Compartment();
        compartmentRef.current = readOnlyCompartment;

        const extensions: import('@codemirror/state').Extension[] = [
          view.lineNumbers(),
          view.highlightActiveLine(),
          view.drawSelection(),
          view.EditorView.lineWrapping,
          view.EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
          readOnlyCompartment.of(state.EditorState.readOnly.of(readOnlyRef.current)),
          // 字体/内边距：颜色与边框由**容器**的 Tailwind class 提供（避免在此硬编码主题变量）
          view.EditorView.theme({
            '&': { fontSize: '13px' },
            '.cm-content': {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              padding: '6px 0',
            },
            '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
            '&.cm-focused': { outline: 'none' },
          }),
        ];
        if (placeholder) {
          extensions.push(view.placeholder(placeholder));
        }
        if (height !== undefined) {
          extensions.push(
            view.EditorView.theme({ '&': { maxHeight: typeof height === 'number' ? `${height}px` : height } }),
          );
        }
        if (mods.commands) {
          extensions.push(
            state.EditorState.allowMultipleSelections.of(true),
            mods.commands.history(),
            view.keymap.of([...mods.commands.defaultKeymap, ...mods.commands.historyKeymap]),
          );
        }
        if (mods.sql && fields && fields.length > 0) {
          // 传字符串数组即可（sql() 的 schema 接受 readonly string[]，无需引用 Completion 类型）
          extensions.push(
            mods.sql.sql({
              schema: fields,
              ...(defaultTable ? { defaultTable } : {}),
              upperCaseKeywords: true,
            }),
          );
        }

        const editor = new view.EditorView({
          state: state.EditorState.create({ doc: initialValueRef.current, extensions }),
          parent,
        });
        viewRef.current = editor;
        setDegraded(mods.sql == null);
        setReady(true);
        setError(null);
      } catch (err) {
        // 依赖不可用（见文件头「降级路径」）：交出 error，由调用方渲染 Textarea。
        setError(err instanceof Error ? err.message : '代码编辑器加载失败');
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      modulesRef.current = null;
      compartmentRef.current = null;
    };
  }, [fieldsKey, defaultTable, placeholder, height]);

  // ---------------------------------------------------------------- 外部 value → 编辑器
  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) {
      return;
    }
    const current = editor.state.doc.toString();
    if (current === value) {
      return;
    }
    // 全量替换（条件/表达式都是短文）：保留滚动，光标落到文末由 CM 自行 clamp
    editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value, ready]);

  // ---------------------------------------------------------------- readOnly 热切换
  useEffect(() => {
    const editor = viewRef.current;
    const mods = modulesRef.current;
    const compartment = compartmentRef.current;
    if (!editor || !mods || !compartment) {
      return;
    }
    editor.dispatch({ effects: compartment.reconfigure(mods.state.EditorState.readOnly.of(readOnly)) });
  }, [readOnly, ready]);

  /** 光标处插入（字段补全按钮 / 运算符模板用）。 */
  const insert = useCallback((snippet: string) => {
    const editor = viewRef.current;
    if (!editor) {
      return;
    }
    const { from, to } = editor.state.selection.main;
    editor.dispatch({
      changes: { from, to, insert: snippet },
      selection: { anchor: from + snippet.length },
    });
    editor.focus();
  }, []);

  const focus = useCallback(() => {
    viewRef.current?.focus();
  }, []);

  return { containerRef, loading, ready, degraded, error, insert, focus };
}

export default useCodeMirror;
