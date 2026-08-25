/**
 * 知识库来源宿主上下文：Copilot 气泡统一在底部渲染可展开来源列表时，
 * A2UI text 节点不再内联重复展示（静态「条款来源」改为隐藏，由宿主折叠组件承接）。
 */

import { createContext, useContext, type ReactNode } from 'react';

export type KbSourceHostMode = 'inline' | 'host';

const KbSourceHostContext = createContext<KbSourceHostMode>('inline');

export function KbSourceHostProvider({
  mode,
  children,
}: {
  mode: KbSourceHostMode;
  children: ReactNode;
}) {
  return <KbSourceHostContext.Provider value={mode}>{children}</KbSourceHostContext.Provider>;
}

export function useKbSourceHostMode(): KbSourceHostMode {
  return useContext(KbSourceHostContext);
}
