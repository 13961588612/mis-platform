/**
 * WizardShell.tsx — 向导通用壳（v1.11 MR-S1/MR-02）。
 *
 * <h2>为什么用 Dialog 而不是独立路由页</h2>
 * 两个向导都从建模台内触发（连接向导 = 顶部「新建连接」；表发现向导 = 左树导入入口），
 * 用户需要**边看画布边配**。若做成独立路由，要多注册 2 条路径 —— 而 BFF 的
 * `deny-unmapped=true` 注册表意味着**每条新路径都得配一次 sys_api + sys_menu_api 种子**
 * （见 V87/V88 的教训），无谓地把前端导航和后端种子耦合起来。Dialog 天然：
 * ① 不新增路径、不碰注册表；② 自带焦点陷阱/滚动锁/Esc；③ 「取消二次确认」可用嵌套 Dialog 表达。
 * 代价是大内容需要一个内部滚动容器 —— 本壳统一处理（`max-h-[85vh]` + `min-h-0 flex-1 overflow-auto`）。
 *
 * <h2>步骤状态由调用方持有（红线：向导状态走 store）</h2>
 * 本壳**不持有步骤状态**：`currentKey` / `onBack` / `onNext` 全部由调用方（向导）从
 * zustand `modeling-store` 的 `wizardStep` / `wizardHistory` / `pushWizardStep` / `popWizardStep`
 * 读取与驱动（T01 已实现且有 12 个单测）。壳只负责**渲染**步骤条与上下步按钮。
 *
 * <h2>离开二次确认</h2>
 * `dirty=true` 时，Esc / 点遮罩 / 右上 X / 「取消」都会**先弹确认**再关闭（输入不白填）。
 * 实现走 radix 的 `onEscapeKeyDown` / `onPointerDownOutside` + `preventDefault`，
 * 避免直接受控 `onOpenChange` 造成「先关后问」的闪烁。
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** 单个步骤定义（由调用方传入，壳不感知业务语义）。 */
export interface WizardStep {
  key: string;
  title: string;
  /** 步骤说明（可选，展示在步骤条下方）。 */
  hint?: string;
}

/** `WizardShell` Props。 */
export interface WizardShellProps {
  open: boolean;
  /** 关闭请求（X / Esc / 遮罩 / 取消）。**不保证已确认**——由本壳的 dirty 守卫决定最终是否调用。 */
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  steps: WizardStep[];
  /** 当前步骤 key（来自 store.wizardStep）。 */
  currentKey: string;
  /** 上一步（调用方 popWizardStep）。 */
  onBack: () => void;
  /** 下一步（调用方 pushWizardStep）。 */
  onNext: () => void;
  /** 是否存在未保存输入（true → 离开需二次确认）。 */
  dirty?: boolean;
  /** 「下一步」禁用（如本步必填项未填）。 */
  nextDisabled?: boolean;
  /** 最后一步时改为「完成」。 */
  finish?: boolean;
  nextLabel?: string;
  /** 提交中：禁用全部按钮防重复提交。 */
  busy?: boolean;
  /** 内容区宽度（默认 `max-w-3xl`；表发现向导用 `max-w-5xl`）。 */
  widthClassName?: string;
  children: ReactNode;
}

/**
 * 向导壳。步骤条 + 内容区（单层滚动）+ 底部导航 + 离开二次确认。
 */
export function WizardShell({
  open,
  onOpenChange,
  title,
  description,
  steps,
  currentKey,
  onBack,
  onNext,
  dirty = false,
  nextDisabled = false,
  finish = false,
  nextLabel,
  busy = false,
  widthClassName = 'max-w-3xl',
  children,
}: WizardShellProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.key === currentKey),
  );

  /** 关闭请求统一入口：dirty 则先确认。 */
  const requestClose = () => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent
          className={cn('flex max-h-[85vh] flex-col gap-0 p-0', widthClassName)}
          // Esc / 点遮罩：dirty 时拦下，改走确认
          onEscapeKeyDown={(event) => {
            if (dirty) {
              event.preventDefault();
              setConfirmDiscard(true);
            }
          }}
          onPointerDownOutside={(event) => {
            if (dirty) {
              event.preventDefault();
              setConfirmDiscard(true);
            }
          }}
        >
          <DialogHeader className="border-b border-border/60 px-4 py-3">
            <DialogTitle className="text-[14px]">{title}</DialogTitle>
            {description && (
              <DialogDescription className="text-[12px]">{description}</DialogDescription>
            )}
          </DialogHeader>

          {/* 步骤条 */}
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
            {steps.map((step, index) => {
              const active = index === currentIndex;
              const done = index < currentIndex;
              return (
                <div key={step.key} className="flex min-w-0 items-center gap-2">
                  <div
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]',
                      active && 'border-primary bg-primary text-primary-foreground',
                      done && 'border-primary/60 text-primary',
                      !active && !done && 'border-border text-muted-foreground',
                    )}
                  >
                    {done ? <Check className="h-3 w-3" /> : index + 1}
                  </div>
                  <span
                    className={cn(
                      'truncate text-[13px]',
                      active ? 'font-medium' : 'text-muted-foreground',
                    )}
                    title={step.title}
                  >
                    {step.title}
                  </span>
                  {index < steps.length - 1 && (
                    <span className="mx-1 h-px w-6 shrink-0 bg-border" aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </div>

          {/* 内容区：单层滚动（min-h-0 + flex-1 + overflow-auto） */}
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>

          <DialogFooter className="border-t border-border/60 px-4 py-3">
            <Button variant="outline" size="sm" onClick={requestClose} disabled={busy}>
              取消
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onBack} disabled={busy || currentIndex === 0}>
                上一步
              </Button>
              <Button size="sm" onClick={onNext} disabled={busy || nextDisabled}>
                {nextLabel ?? (finish ? '完成' : '下一步')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 离开二次确认（嵌套 Dialog：radix 支持，层级自动处理） */}
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[14px]">放弃未保存的填写？</DialogTitle>
            <DialogDescription className="text-[12px]">
              当前步骤的输入尚未提交，关闭后将丢失。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDiscard(false)}>
              继续填写
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              放弃并关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default WizardShell;
