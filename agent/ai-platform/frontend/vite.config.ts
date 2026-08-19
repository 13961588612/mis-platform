import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@pages": path.resolve(__dirname, "./src/pages"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@stores": path.resolve(__dirname, "./src/stores"),
      "@lib": path.resolve(__dirname, "./src/lib"),
      "@types": path.resolve(__dirname, "./src/types"),
      "@routes": path.resolve(__dirname, "./src/routes"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      // MIS KB API（分片截图等；需 MIS JWT，嵌入 admin 时由父页注入）
      "/api/v1/kb": {
        target: process.env.VITE_MIS_GATEWAY_URL ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      // Agent Core REST API（本地 uvicorn 默认 8000；可用 VITE_BACKEND_URL 覆盖）
      "/api/v1": {
        target: process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      // Gateway REST API
      "/api": {
        target: process.env.VITE_GATEWAY_URL ?? "http://127.0.0.1:3100",
        changeOrigin: true,
      },
      // Gateway WebSocket
      "/ws": {
        target: process.env.VITE_GATEWAY_WS_URL ?? "ws://127.0.0.1:3100",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "copilotkit": [
            "@copilotkit/react-ui",
            "@copilotkit/react-core",
            "@copilotkit/runtime",
          ],
          "charts": ["recharts"],
        },
      },
    },
  },
});
