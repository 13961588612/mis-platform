// @vitest-environment jsdom
/**
 * useDraggableDialog.test.tsx — 标题栏拖动窗体的行为验证。
 *
 * <p>钉三件容易静默失效的事：① 拖动把手应写入独立 `translate`（不得用 transform，
 * 否则会覆盖 DialogContent 的居中/zoom 动画）；② 点在交互元素上**不**触发拖动；
 * ③ 关闭时 `resetOffset` 把位移归零。
 *
 * <p>jsdom 不实现 PointerEvent，故直接调用 hook 暴露的 `onPointerDown` 事件处理器、
 * 用原生 `Event('pointermove')` 派发坐标，并用 `waitFor` 等 React 状态刷新。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { clampOffset, useDraggableDialog } from './useDraggableDialog';

/** 构造一个最小 PointerEvent 供 onPointerDown 直接调用。 */
function pointerDownEvent(
  target: Element,
  currentTarget: Element,
  clientX: number,
  clientY: number,
): ReactPointerEvent<HTMLElement> {
  return { button: 0, clientX, clientY, target, currentTarget } as unknown as ReactPointerEvent<HTMLElement>;
}

function dispatchMove(clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY }));
}
function dispatchUp() {
  window.dispatchEvent(new MouseEvent('pointerup'));
}

let api: ReturnType<typeof useDraggableDialog>;

function Harness() {
  api = useDraggableDialog();
  return (
    <div>
      <div role="dialog" style={{ ...api.contentStyle }}>
        <div data-testid="handle" style={{ ...api.dragHandleProps.style }}>
          <button type="button" data-testid="inner-btn">
            按钮
          </button>
        </div>
      </div>
      <button type="button" data-testid="reset" onClick={api.resetOffset}>
        reset
      </button>
    </div>
  );
}

afterEach(() => cleanup());

describe('clampOffset（纯函数）', () => {
  it('未布局（rect 全 0，jsdom/首渲染）不钳制，原样返回位移', () => {
    const rect = { width: 0, height: 0, left: 0, top: 0 } as DOMRect;
    expect(clampOffset(rect, 40, 30)).toEqual({ x: 40, y: 30 });
  });
});

describe('useDraggableDialog', () => {
  it('拖动把位移写入独立 translate（不动 transform）', async () => {
    render(<Harness />);
    const handle = screen.getByTestId('handle');
    api.dragHandleProps.onPointerDown(pointerDownEvent(handle, handle, 100, 100));
    dispatchMove(140, 130);
    dispatchUp();
    await waitFor(() => {
      expect(screen.getByRole('dialog').style.translate).toBe('40px 30px');
    });
    // 关键：不使用 transform（避免与居中 -translate-1/2 冲突）
    expect(screen.getByRole('dialog').style.transform).toBe('');
  });

  it('点在交互元素上不触发拖动（把手内按钮可正常点）', () => {
    render(<Harness />);
    const handle = screen.getByTestId('handle');
    const btn = screen.getByTestId('inner-btn');
    // 事件从 button 冒泡，但 target 命中交互元素 → 直接返回、不进入拖动态
    api.dragHandleProps.onPointerDown(pointerDownEvent(btn, handle, 100, 100));
    dispatchMove(200, 200);
    dispatchUp();
    expect(screen.getByRole('dialog').style.translate).toBe('');
  });

  it('resetOffset 将位移归零', async () => {
    render(<Harness />);
    const handle = screen.getByTestId('handle');
    api.dragHandleProps.onPointerDown(pointerDownEvent(handle, handle, 0, 0));
    dispatchMove(50, 20);
    dispatchUp();
    await waitFor(() => {
      expect(screen.getByRole('dialog').style.translate).toBe('50px 20px');
    });
    fireEvent.click(screen.getByTestId('reset'));
    await waitFor(() => {
      expect(screen.getByRole('dialog').style.translate).toBe('');
    });
  });
});
