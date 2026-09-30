// @vitest-environment jsdom
/**
 * ModelFieldReference.test.tsx — Cube 右侧「挂靠模型字段清单」参考面板。
 *
 * <p>为何单独钉：该面板存在的唯一目的是让用户**看得到模型字段**以便写度量表达式。
 * 若「未选模型 / 模型无字段 / 有字段」三态渲染错乱，用户会以为字段丢了而无法录入。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ModelFieldReference, type ModelField } from './ModelFieldReference';

const FIELDS: ModelField[] = [
  { qualified: 'orders.id', name: 'id', dataType: 'BIGINT', isPrimaryKey: true },
  { qualified: 'orders.amount', name: 'amount', dataType: 'DOUBLE', isPrimaryKey: false },
];

afterEach(() => {
  cleanup();
});

describe('ModelFieldReference', () => {
  it('有字段：列出限定名字段 + 类型 + PK 标记', () => {
    render(<ModelFieldReference modelName="orders" fields={FIELDS} />);
    expect(screen.getByText('orders 字段')).toBeTruthy();
    expect(screen.getByText('2 个')).toBeTruthy();
    expect(screen.getByText('id')).toBeTruthy();
    expect(screen.getByText('amount')).toBeTruthy();
    expect(screen.getByText('BIGINT')).toBeTruthy();
    expect(screen.getByText('DOUBLE')).toBeTruthy();
    // 仅主键列带 PK 标记
    expect(screen.getAllByText('PK')).toHaveLength(1);
    // 每个字段可点击复制限定名（title 里带限定名）
    expect(screen.getByTitle('点击复制 orders.amount')).toBeTruthy();
  });

  it('未选模型：提示先选择挂靠模型', () => {
    render(<ModelFieldReference modelName={null} fields={[]} />);
    expect(screen.getByText(/先选择「挂靠模型」/)).toBeTruthy();
  });

  it('已选模型但无字段：提示该模型暂无字段', () => {
    render(<ModelFieldReference modelName="orders" fields={[]} />);
    expect(screen.getByText(/该模型暂无字段/)).toBeTruthy();
  });
});
