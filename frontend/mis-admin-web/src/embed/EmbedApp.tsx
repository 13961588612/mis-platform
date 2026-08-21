/**
 * EmbedApp — /embed/* 嵌入页路由（T07'）。
 *
 * <p>独立构建入口（embed.html → src/embed/main.tsx）。路由兼容：
 * - 生产：nginx 将 /embed/* rewrite 到 embed.html（URL 保持 /embed/chat）
 * - 开发：直接访问 /embed.html?hostId=...（Vite MPA dev server 直达）
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EmbedChatPage } from './EmbedChatPage';

export function EmbedApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/embed" element={<EmbedChatPage />} />
        <Route path="/embed/chat" element={<EmbedChatPage />} />
        <Route path="/embed/chat/:sessionId" element={<EmbedChatPage />} />
        {/* dev 直达 embed.html */}
        <Route path="/embed.html" element={<EmbedChatPage />} />
        <Route path="*" element={<Navigate to="/embed/chat" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default EmbedApp;
