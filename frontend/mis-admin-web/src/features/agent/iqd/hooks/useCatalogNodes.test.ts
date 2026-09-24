/**
 * useCatalogNodes.test.ts — 画布派生逻辑的纯函数单测（T02b-1 回归守卫）。
 *
 * <p>本批画布里**唯一有解析风险**的一段是 ER 边的来源：`kind=relationship` 的
 * `expression` 里存的是 join 条件字符串（`IqdMdlParser` 把 `condition` 同时写入
 * description 与 expression），要把 `orders.customer_id = customers.id`
 * 还原成「orders ↔ customers 一条边」。
 *
 * <p>失败模式是**静默的**：解析错不会报错，只会画出一条**错误的 ER 关系**，
 * 直接误导建模者对表间关系的判断。故此处把可解析/不可解析两类形态都钉住：
 * 宁可**不画边**（返回空），也绝不画错边。
 *
 * <p>只测纯函数（不挂 React / 不挂 Query），故沿用项目既有 vitest node 环境即可。
 */
import { describe, expect, it } from 'vitest';
import { parseJoinModels, parseRelationship, resolveTableKey } from './useCatalogNodes';
import type { IqdCatalogItem } from '@/lib/api/iqd';

function stub(partial: Partial<IqdCatalogItem> & Pick<IqdCatalogItem, 'item_key' | 'kind'>): IqdCatalogItem {
  return {
    item_key: partial.item_key,
    kind: partial.kind,
    display_name: partial.display_name ?? null,
    parent_key: partial.parent_key ?? null,
    source: 'mdl',
    in_scope: true,
    ...partial,
  };
}

describe('resolveTableKey（模型 → 物理表 key）', () => {
  const model = stub({
    item_key: 'mdl:model:orders',
    kind: 'model',
    display_name: 'orders',
  });

  it('标准键 ds.schema.table：后缀匹配', () => {
    const catalog = [
      model,
      stub({ item_key: 'pg_main.public.orders', kind: 'table', display_name: 'orders' }),
    ];
    expect(resolveTableKey(catalog, model)).toBe('pg_main.public.orders');
  });

  it('裸表名：与 display_name / item_key 全等', () => {
    const catalog = [
      model,
      stub({ item_key: 'orders', kind: 'table', display_name: 'orders' }),
    ];
    expect(resolveTableKey(catalog, model)).toBe('orders');
  });

  it('无匹配表 → null', () => {
    expect(resolveTableKey([model], model)).toBeNull();
  });
});

describe('parseJoinModels（关系条件 → 参与模型对）', () => {
  it('单条件：orders.customer_id = customers.id → [orders, customers]', () => {
    expect(parseJoinModels('orders.customer_id = customers.id')).toEqual([
      ['orders', 'customers'],
    ]);
  });

  it('复合 AND 条件：逐段解析（每段一对）', () => {
    expect(
      parseJoinModels('orders.customer_id = customers.id and orders.product_id = products.id'),
    ).toEqual([
      ['orders', 'customers'],
      ['orders', 'products'],
    ]);
  });

  it('去除空白与大小写无关的 AND', () => {
    expect(parseJoinModels('orders.customer_id=customers.id AND orders.x = products.y')).toEqual([
      ['orders', 'customers'],
      ['orders', 'products'],
    ]);
  });

  it('自连接（左右同模型）不产出边（避免自环噪音）', () => {
    expect(parseJoinModels('employees.manager_id = employees.id')).toEqual([]);
  });

  it('无限定名（无 schema/表前缀）不产出边', () => {
    expect(parseJoinModels('customer_id = id')).toEqual([]);
  });

  it('非等值条件（无 =）不产出边', () => {
    expect(parseJoinModels('orders.amount > customers.amount')).toEqual([]);
  });

  it('空值 / null / undefined 安全返回空数组', () => {
    expect(parseJoinModels('')).toEqual([]);
    expect(parseJoinModels(null)).toEqual([]);
    expect(parseJoinModels(undefined)).toEqual([]);
  });

  it('带 schema 前缀（三段）取倒数第二段作为表名：public.orders.customer_id → orders', () => {
    expect(parseJoinModels('public.orders.customer_id = public.customers.id')).toEqual([
      ['orders', 'customers'],
    ]);
  });
});

/**
 * T03b 回归守卫：关系条目 → join 语义（**两种落库形态**）。
 *
 * <p>这里钉住的是本批最容易漏的**跨批集成点**：T03a 把新建关系的五个语义字段
 * （join_type/cardinality/condition/source_model/target_model）打包成 JSON **信封**
 * 写进 `expression`。若派生侧仍按「裸条件」解析，左操作数会变成
 * `{"join_type":…"orders.customer_id` → 匹配不到任何模型 → **关系边静默消失**
 * （不报错，只是画布上关系没了）。
 */
describe('parseRelationship（关系条目 → join 语义；两种落库形态）', () => {
  it('★ 形态①：T03a 信封 JSON —— 从 source/target_model 精确取模型对（不能走裸条件解析）', () => {
    const parsed = parseRelationship({
      item_key: 'mdl:relationship:orders_customers',
      kind: 'relationship',
      display_name: 'orders_customers',
      expression: JSON.stringify({
        join_type: 'inner',
        cardinality: '1:N',
        condition: 'orders.customer_id = customers.id',
        source_model: 'mdl:model:orders',
        target_model: 'mdl:model:customers',
      }),
    });

    expect(parsed.joinType).toBe('inner');
    expect(parsed.cardinality).toBe('1:N');
    expect(parsed.condition).toBe('orders.customer_id = customers.id');
    expect(parsed.pairs).toEqual([['orders', 'customers']]);
  });

  it('形态①：信封缺 source/target 时回退条件解析（保证仍能画边）', () => {
    const parsed = parseRelationship({
      item_key: 'mdl:relationship:r',
      kind: 'relationship',
      expression: JSON.stringify({ join_type: 'left', condition: 'orders.customer_id = customers.id' }),
    });

    expect(parsed.joinType).toBe('left');
    expect(parsed.cardinality).toBeNull();
    expect(parsed.pairs).toEqual([['orders', 'customers']]);
  });

  it('形态②：MDL 同步来源的裸条件（无 joinType/cardinality → 交给边组件回退默认值）', () => {
    const parsed = parseRelationship({
      item_key: 'mdl:relationship:legacy',
      kind: 'relationship',
      display_name: 'legacy',
      expression: 'orders.uid = users.id',
    });

    expect(parsed.joinType).toBeNull();
    expect(parsed.cardinality).toBeNull();
    expect(parsed.pairs).toEqual([['orders', 'users']]);
  });

  it('形态②：expression 为空时看 description（IqdMdlParser 把 condition 同时写入两列）', () => {
    const parsed = parseRelationship({
      item_key: 'mdl:relationship:legacy2',
      kind: 'relationship',
      expression: null,
      description: 'orders.uid = users.id',
    });

    expect(parsed.pairs).toEqual([['orders', 'users']]);
  });

  it('起手是 `{` 但 JSON 非法 → 不抛异常，退化为「解析不出模型对」（不画边）', () => {
    const parsed = parseRelationship({
      item_key: 'mdl:relationship:broken',
      kind: 'relationship',
      expression: '{not-valid-json',
    });

    expect(parsed.pairs).toEqual([]);
    expect(parsed.condition).toBe('{not-valid-json');
  });
});
