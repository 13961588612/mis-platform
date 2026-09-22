/**
 * instructionUtils.ts — 指令下发页（MR-07）的**纯逻辑层**（T04d）。
 *
 * <h2>为什么单独成纯函数层</h2>
 * 这里三处逻辑的失效都是**静默**的（沿用 `propertyEditUtils` / `driftUtils` 的范式）：
 * <ul>
 *   <li>{@link detectAtToken} / {@link insertItemKey}：`@` 插入的游标计算错 → 插到错位置、
 *       或把用户已输入的内容吞掉（无报错）；</li>
 *   <li>{@link parseRelatedItemKeys} / {@link serializeRelatedItemKeys}：`related_item_keys`
 *       在 wire 上是 **JSON 字符串**（Java `iqd_knowledge.related_item_keys` 为 jsonb），
 *       序列化错 → 后端 `42200`，或**静默存成错的关联**；</li>
 *   <li>{@link estimatePush}：下发条数估算错 → 用户误判「这次会影响多少条」。</li>
 * </ul>
 * 本文件**零运行时依赖**（只 `import type`），可在 node 环境直接单测。
 *
 * <h2>权限码（核实自 sys_api ⋈ sys_menu_api seed，非文档猜测）</h2>
 * <ul>
 *   <li>`GET /api/v1/iqd/knowledge`（V74:92581）→ 菜单 92521 → **`iqd:enhance:view`**</li>
 *   <li>`POST/DELETE /api/v1/iqd/knowledge`（V74:92582/92583）+ `/knowledge/import-s07`
 *       （92584）→ 菜单 92522 → **`iqd:enhance:save`**</li>
 *   <li>`POST /api/v1/iqd/enhance/sync`（V81:92588）+ `/enhance/push`（V74:92585）→ 菜单 92523
 *       → **`iqd:enhance:sync`**；`GET /enhance/sync-status`（V81:92589）→ 92521 → **view**</li>
 * </ul>
 */
import type { IqdCatalogItem, IqdKnowledge, IqdSyncStatus } from '@/lib/api/iqd';
// T04e：`related_item_keys` 编解码已下沉共享模块（enhance 页知识 Tab 亦消费）。
import { parseRelatedItemKeys, serializeRelatedItemKeys } from '../shared/relatedItemKeys';

/** 指令页权限码（唯一来源，勿在组件里硬编码字符串）。 */
export const INSTRUCTION_PERMISSIONS = {
  /** 列表 / 同步状态 / 页面准入。 */
  view: 'iqd:enhance:view',
  /** 保存 / 删除指令（kind=instruction）。 */
  save: 'iqd:enhance:save',
  /** 立即下发（enhance/sync）+ 待推送登记（enhance/push）。 */
  sync: 'iqd:enhance:sync',
} as const;

/** 「关联对象」候选种类：model / cube（PRD §5.2 e / MR-13）。 */
export const RELATED_KINDS: readonly string[] = ['model', 'cube'];

/** item_key 下拉项。 */
export interface ItemKeyOption {
  value: string;
  label: string;
  kind: string;
}

/**
 * 由 catalog 构造 item_key 候选（升序稳定，防下拉抖动）。
 *
 * @param catalog catalog 全量（`useCatalogNodes`）
 * @param kinds   限定 kind（缺省 = 全部）；「关联对象」用 {@link RELATED_KINDS}
 */
export function buildItemKeyOptions(
  catalog: IqdCatalogItem[],
  kinds?: readonly string[],
): ItemKeyOption[] {
  const allow = kinds && kinds.length > 0 ? new Set(kinds) : null;
  return catalog
    .filter((item) => item.item_key && (allow === null || allow.has(item.kind)))
    .map((item) => ({
      value: item.item_key,
      label: item.display_name ?? item.item_key,
      kind: item.kind,
    }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

/** `@` 触发词（`@` 起到光标之间的片段）。 */
export interface AtToken {
  /** `@` 的下标。 */
  start: number;
  /** `@` 之后、光标之前的内容（不含 `@`）。 */
  query: string;
}

/**
 * 检测光标处是否存在 `@` 触发词（用于弹出 item_key 下拉）。
 *
 * 规则：从光标回溯到最近的 `@`；两者之间**不能含空白**（否则已结束该 token）；
 * `@` 必须是行首或紧跟在空白之后（避免 `a@b` 误触发）。
 *
 * @returns 命中返回 `{start, query}`，否则 `null`
 */
export function detectAtToken(text: string, caret: number): AtToken | null {
  if (caret < 0 || caret > text.length) {
    return null;
  }
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) {
    return null;
  }
  const between = before.slice(at + 1);
  if (/\s/.test(between)) {
    return null;
  }
  if (at > 0 && !/\s/.test(text[at - 1])) {
    return null;
  }
  return { start: at, query: between };
}

/** 过滤 item_key 候选（空 query → 前 limit 条；否则 value/label 子串命中）。 */
export function filterItemKeyOptions(
  options: ItemKeyOption[],
  query: string,
  limit = 20,
): ItemKeyOption[] {
  const q = query.trim().toLowerCase();
  const matched =
    q === ''
      ? options
      : options.filter(
          (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
        );
  return matched.slice(0, limit);
}

/**
 * 在 `@` 触发词处插入 item_key（**替换** `@query`）。
 *
 * <p>返回新文本与新光标位置（供调用方回写并重新聚焦）。若当前光标处无触发词，
 * 则在光标处插入。
 */
export function insertItemKey(
  text: string,
  caret: number,
  itemKey: string,
): { content: string; caret: number } {
  const token = detectAtToken(text, caret);
  const start = token ? token.start : caret;
  const content = `${text.slice(0, start)}${itemKey}${text.slice(caret)}`;
  return { content, caret: start + itemKey.length };
}

/**
 * 解析 `related_item_keys`（wire 上是 **JSON 字符串**；容错 list / null）。
 *
 * <p><b>T04e：实现已下沉到共享模块 {@link ../shared/relatedItemKeys}（enhance 页知识 Tab 亦消费）；
 * 此处仅**再导出**以保持既有导入路径与单测不变（零回归）。</b>
 */
export { parseRelatedItemKeys, serializeRelatedItemKeys };

/** 下发估算结果（**前端估算**，见 {@link estimatePush}）。 */
export interface PushEstimate {
  /** 本次整库下发会携带的条数（= 启用中的指令数；整库 build 不带上下文）。 */
  total: number;
  /** 其中「无关联」的通用条数（每问必发）。 */
  global: number;
  /** 其中「有关联对象」的条数（问数时按上下文命中）。 */
  scoped: number;
}

/**
 * 下发条数估算（前端，基于本地指令列表 + ② 的裁剪语义）。
 *
 * <p>口径说明（与 `push_enhancements` 的裁剪语义对齐）：
 * <ul>
 *   <li>「立即下发」= 整库 build（**不带**上下文）→ 启用中的指令**全部**会被携带 → `total`；</li>
 *   <li>其中**无 `related_item_keys`** 的 = 全连接通用，问数时**恒命中** → `global`；</li>
 *   <li>有 `related_item_keys` 的 = 作用域条目，仅当问数请求的上下文与其**有交集**时才命中
 *       → `scoped`（因此问数时实际注入数 ≤ `total`）。</li>
 * </ul>
 *
 * <p>⚠️ 这是**估算**：权威条数以服务端 `POST /iqd/enhance/sync` 的作业回填
 * （`synced_knowledge_count`）为准。
 */
export function estimatePush(instructions: IqdKnowledge[]): PushEstimate {
  const enabled = instructions.filter((it) => it.enabled !== false);
  const scoped = enabled.filter(
    (it) => parseRelatedItemKeys(it.related_item_keys).length > 0,
  ).length;
  return { total: enabled.length, global: enabled.length - scoped, scoped };
}

/** 同步阶段/状态 → 中文标签（未知值原样）。 */
const SYNC_STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  running: '进行中',
  success: '成功',
  failed: '失败',
  skipped: '已跳过',
};

/** 状态码 → 中文标签（空 → `—`）。 */
export function syncStatusLabel(status?: string | null): string {
  if (!status) {
    return '—';
  }
  return SYNC_STATUS_LABEL[status] ?? status;
}

/**
 * 描述「上次下发状态」（下发前展示，让用户判断这次下发是否安全）。
 *
 * @param status `GET /iqd/enhance/sync-status` 的最近一次作业（null = 从未下发）
 */
export function describeLastPush(status: IqdSyncStatus | null): string {
  if (!status) {
    return '尚未下发';
  }
  const synced = status.synced_knowledge_count ?? 0;
  return `构建 ${syncStatusLabel(status.build_status)} · 索引 ${syncStatusLabel(status.index_status)} · 回填知识 ${synced} 条`;
}
