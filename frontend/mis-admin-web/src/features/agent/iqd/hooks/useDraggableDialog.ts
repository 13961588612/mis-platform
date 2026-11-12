/**
 * useDraggableDialog.ts —— 让弹窗可被「标题栏拖动」（v1.11 追加）。
 *
 * <h2>为什么需要</h2>
 * Cube 编辑器弹窗较大（左右两栏），默认居中固定在屏幕正中，遮挡下方的模型画布/树。用户
 * 常需要一边参考底下的内容一边录入，故支持**按住标题栏拖动**弹窗（不改变弹窗尺寸/逻辑）。
 *
 * <h2>实现要点（避免与 Radix / 动画打架）</h2>
 * <ul>
 *   <li>位移用 CSS 独立属性 {@code translate}（不是 {@code transform}）——DialogContent 已用
 *       Tailwind {@code -translate-x-1/2 -translate-y-1/2}（走 {@code transform}）做居中、并用
 *       {@code transform} 做 zoom 动画；独立 {@code translate} 与它们**叠加**而非覆盖，动画不受影响。</li>
 *   <li>指针事件绑在 window 上（drag 期间），保证鼠标移出把手也能继续拖。</li>
 *   <li>点按钮/输入框/下拉/链接不触发拖动（把手内常有「显示字段清单」按钮）。</li>
 *   <li>拖动范围做**可见性钳制**：至少保留一部分弹窗在视口内，避免拖到屏幕外找不回来。</li>
 * </ul>
 */
import { useCallback, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

/** 位移量（像素）。 */
export interface DragOffset {
  x: number;
  y: number;
}

/** 拖动期间至少保留在视口内的像素（任一边）。 */
const KEEP_VISIBLE = 80;

/** 命中即**不**启动拖动的交互元素选择器（把手内常有这些控件）。 */
const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [data-drag-ignore]';

/**
 * 可拖动弹窗 hook。
 *
 * @returns {@link UseDraggableDialogResult}
 */
export interface UseDraggableDialogResult {
  /** 当前位移，供内容元素 style 使用（见 {@link UseDraggableDialogResult.contentStyle}）。 */
  offset: DragOffset;
  /** 是否正在拖动（可据此加 grabbing 光标）。 */
  dragging: boolean;
  /** 把位移重置为 0（关闭/重开时调用）。 */
  resetOffset: () => void;
  /** 放到 DialogContent 上的 style（叠加独立 translate）。 */
  contentStyle: CSSProperties;
  /** 放到标题栏（把手）上的 props。 */
  dragHandleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
}

/** 视口内钳制：保证弹窗（rect + 位移）至少留 {@link KEEP_VISIBLE}px 可见。 */
export function clampOffset(rect: DOMRect, dx: number, dy: number): DragOffset {
  // 未布局（rect 全 0，如 jsdom / 首次渲染）→ 不钳制，直接采用位移
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: dx, y: dy };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = rect.left + dx;
  const top = rect.top + dy;
  const minLeft = -(rect.width - KEEP_VISIBLE);
  const maxLeft = vw - KEEP_VISIBLE;
  const minTop = 0;
  const maxTop = vh - KEEP_VISIBLE;
  const clampedLeft = Math.min(Math.max(left, minLeft), maxLeft);
  const clampedTop = Math.min(Math.max(top, minTop), maxTop);
  return { x: clampedLeft - rect.left, y: clampedTop - rect.top };
}

export function useDraggableDialog(): UseDraggableDialogResult {
  const [offset, setOffset] = useState<DragOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerX: number;
    pointerY: number;
    baseX: number;
    baseY: number;
    rect: DOMRect | null;
  } | null>(null);

  const resetOffset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as Element | null;
      if (target && target.closest(INTERACTIVE_SELECTOR)) {
        return;
      }
      const handle = event.currentTarget as HTMLElement;
      const dialog = handle.closest('[role="dialog"]') as HTMLElement | null;
      dragRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        baseX: offset.x,
        baseY: offset.y,
        rect: dialog?.getBoundingClientRect() ?? null,
      };
      setDragging(true);

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) {
          return;
        }
        let dx = drag.baseX + (ev.clientX - drag.pointerX);
        let dy = drag.baseY + (ev.clientY - drag.pointerY);
        if (drag.rect) {
          const clamped = clampOffset(drag.rect, dx, dy);
          dx = clamped.x;
          dy = clamped.y;
        }
        setOffset({ x: dx, y: dy });
      };
      const onUp = () => {
        dragRef.current = null;
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [offset.x, offset.y],
  );

  // 零位移时不写 style（避免无谓地设 translate:0，也让「未拖动」在 DOM 上可辨）
  const contentStyle: CSSProperties =
    offset.x === 0 && offset.y === 0 ? {} : { translate: `${offset.x}px ${offset.y}px` };

  return {
    offset,
    dragging,
    resetOffset,
    contentStyle,
    dragHandleProps: {
      onPointerDown,
      style: {
        cursor: dragging ? 'grabbing' : 'grab',
        // 拖动时不选中标题文字（避免出现蓝色选字干扰）
        userSelect: dragging ? 'none' : undefined,
        touchAction: 'none',
      },
    },
  };
}

export default useDraggableDialog;
