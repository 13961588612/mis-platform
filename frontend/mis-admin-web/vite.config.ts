import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true, // 同时监听 0.0.0.0 / ::，避免仅 [::1] 时 127.0.0.1 无响应
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // chat-core 发送通道（/ws/chat）与接收通道（/api/events/stream）均直连 Gateway；
      // WS 需 ws:true 才能升级握手（QA 建议 3）
      '/ws': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  // T07'：Vite 多页 admin/embed 双入口
  // - index.html（管理后台，不静态 import 对话包）
  // - embed.html（嵌入页，只含对话 + A2UI + 事件桥；外部系统 iframe 只拉 embed 包）
  // 生产 nginx 需将 /embed/* rewrite 到 /embed.html（URL 保持 /embed/chat）；dev 直达 /embed.html
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        embed: fileURLToPath(new URL('./embed.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
