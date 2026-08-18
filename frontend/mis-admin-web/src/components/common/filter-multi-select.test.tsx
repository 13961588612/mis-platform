// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FilterMultiSelect } from './filter-multi-select';

const options = [
  { label: '组织一', value: '1' },
  { label: '组织二', value: '2' },
  { label: '组织三', value: 3 },
];

afterEach(() => {
  cleanup();
});

function openDropdown() {
  fireEvent.click(screen.getByRole('button', { name: /请选择/ }));
}

describe('FilterMultiSelect 全选/清空', () => {
  it('指针按下「全选」回传全部 option 值', () => {
    const onChange = vi.fn();
    render(<FilterMultiSelect options={options} value={[]} onChange={onChange} />);
    openDropdown();

    fireEvent.pointerDown(screen.getByRole('button', { name: '全选' }), { button: 0 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['1', '2', 3]);
  });

  it('键盘激活「全选」（click.detail=0）同样回传全部值', () => {
    const onChange = vi.fn();
    render(<FilterMultiSelect options={options} value={[]} onChange={onChange} />);
    openDropdown();

    fireEvent.click(screen.getByRole('button', { name: '全选' }), { detail: 0 });

    expect(onChange).toHaveBeenCalledWith(['1', '2', 3]);
  });

  it('指针按下「清空」回传空数组', () => {
    const onChange = vi.fn();
    render(<FilterMultiSelect options={options} value={['1', '2']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /组织一/ }));

    fireEvent.pointerDown(screen.getByRole('button', { name: '清空' }), { button: 0 });

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
