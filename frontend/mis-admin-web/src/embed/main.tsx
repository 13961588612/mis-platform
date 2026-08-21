/**
 * embed 独立构建入口（T07'）。
 *
 * <p>Vite 多页：embed.html → src/embed/main.tsx。只引入对话 + A2UI 渲染层 + 事件桥，
 * 不加载管理后台布局 / 菜单 / 系统管理代码（体积门槛：embed 入口 ≤ 150KB gzip）。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configureEmbedAuthStore } from './embed-auth';
import { EmbedApp } from './EmbedApp';
import '@/styles/globals.css';

// 将 auth-store 持久化切到内存：外部兑换的短时 JWT 不写入 localStorage（不污染 admin 会话）
configureEmbedAuthStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmbedApp />
  </StrictMode>,
);
