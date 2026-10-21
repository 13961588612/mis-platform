/**
 * EmbedApp — /embed/* 嵌入页路由（T07'）。
 *
 * <p>独立构建入口（embed.html → src/embed/main.tsx）。路由兼容：
 * - 推荐（致远等）：`/embed/{hostId}/chat`（hostId 在路径，便于 OA 只再拼 `?ticket=`）
 * - 兼容旧链：`/embed/chat?hostId=`、`/embed/chat/:sessionId`
 * - 生产：nginx `location /embed` → try_files → embed.html
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EmbedChatPage } from './EmbedChatPage';

export function EmbedApp() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 新：hostId 在路径（静态 /embed/chat 须排在 :hostId 之前，由 RR 静态优先保证） */}
        <Route path="/embed/:hostId/chat/:sessionId" element={<EmbedChatPage />} />
        <Route path="/embed/:hostId/chat" element={<EmbedChatPage />} />
        {/* 旧：query hostId */}
        <Route path="/embed/chat/:sessionId" element={<EmbedChatPage />} />
        <Route path="/embed/chat" element={<EmbedChatPage />} />
        <Route path="/embed" element={<EmbedChatPage />} />
        {/* dev 直达 embed.html */}
        <Route path="/embed.html" element={<EmbedChatPage />} />
        <Route path="*" element={<Navigate to="/embed/chat" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default EmbedApp;
