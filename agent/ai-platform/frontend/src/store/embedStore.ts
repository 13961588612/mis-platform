/**
 * 嵌入上下文（父系统 postMessage PAGE_CONTEXT）。
 * 供 Chat 侧展示/透传当前 MIS 页面路由，不参与鉴权。
 */

import { create } from "zustand";

export interface EmbedPageContext {
  route: string;
  module: string;
  title?: string;
}

interface EmbedState {
  pageContext: EmbedPageContext | null;
  setPageContext: (ctx: EmbedPageContext) => void;
  clearPageContext: () => void;
}

export const useEmbedStore = create<EmbedState>((set) => ({
  pageContext: null,
  setPageContext: (pageContext) => set({ pageContext }),
  clearPageContext: () => set({ pageContext: null }),
}));

export default useEmbedStore;
