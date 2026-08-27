import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// VITE_RECON_DIRECT=1 时 dev proxy 直连 recon-service（绕过平台 Gateway/BFF），仅本地独立联调用。
// 默认走平台链路：Gateway(8080) → BFF(8081) → recon-service(8110)。
const reconDirect = process.env.VITE_RECON_DIRECT === '1';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    // 固定 5176，避开 mis 平台 5174（见 README：避免 Vite 端口漂移导致 micro-app 入口地址不确定）
    port: 5176,
    // micro-app 壳子跨源加载本应用入口/资源（fetch HTML + script），dev 需放行 CORS
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    proxy: {
      // 方案 A′：默认统一走平台链路 Gateway(8080) → BFF(8081) → recon-service(8110)。
      // VITE_RECON_DIRECT=1 直连兜底：把前端 /api/v1/recon 前缀改写为后端 /internal/v1/recon
      // （recon-service 已不自验 JWT，直连无需登录上下文）。
      '/api': reconDirect
        ? {
            target: 'http://localhost:8110',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/v1\/recon/, '/internal/v1/recon'),
          }
        : {
            target: 'http://localhost:8080',
            changeOrigin: true,
          },
    },
  },
});
