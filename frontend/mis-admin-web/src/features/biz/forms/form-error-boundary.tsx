/**
 * 表单渲染 ErrorBoundary（方案 §3.4 最后一行，**唯一的硬性防御性要求**）。
 *
 * 业务表单组件是人工写的代码，一定会有人写出 `value.amount.toFixed(2)`
 * 而 `amount` 是 undefined。没有这层⇒ 整个 ProcessShell 白屏 ⇒ 审批功能整体不可用。
 *
 * ⚠️ **只挡表单，不挡审批栏**：本Boundary 由 `form-shell.tsx` 包在业务组件**外面**，
 * 审批栏在套壳之外，所以表单炸了同意/驳回依然可点。这是硬要求，不是优化。
 *
 * ⚠️ **必须写 `componentDidCatch` 或 `getDerivedStateFromError`**：
 * React 18 里错误在渲染期抛出，若无这两者之一，React 会把整棵树卸载。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { FormMissing, type FormMissingReason } from './form-missing';

interface Props {
  /** 流程实例的 formCode，用于兜底卡文案。 */
  formCode?: string | null;
  /** 后端 form_data 原文/对象，出错时展示给开发定位。 */
  rawData?: string | Record<string, unknown> | null;
  /** 重新加载回调（可选）。 */
  onRetry?: () => void;
  /** 额外插入在兜底卡下方的内容（如流程信息折叠区）。 */
  children?: ReactNode;
}

interface State {
  error: Error | null;
}

export class FormErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 生产环境留日志：ErrorBoundary 吞掉错误后，没有日志就等于没兜底
    // eslint-disable-next-line no-console
    console.error('[FormErrorBoundary] 表单渲染异常', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children ?? null;

    return (
      <FormMissing
        // 业务组件抛错 ⇒ 组件一定是已注册的（注册表能查到才有资格渲染它）
        reason={'render-error' satisfies FormMissingReason}
        formCode={this.props.formCode}
        rawData={this.props.rawData}
        errorMessage={error.message}
        onRetry={this.handleRetry}
      />
    );
  }
}
