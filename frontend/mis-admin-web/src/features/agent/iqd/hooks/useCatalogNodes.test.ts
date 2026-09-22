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
import { parseJoinModels } from './useCatalogNodes';

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
