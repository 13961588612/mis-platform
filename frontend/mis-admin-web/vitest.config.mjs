/**
 * Vitest 独立配置（JS，不经过 vite.config.ts 的 TS 编译）。
 *
 * <p>原因：vite.config.ts 经 esbuild 编译会生成 `vite.config.ts.timestamp-*.mjs`
 * 临时文件，清理时触发沙箱批量删除保护（safe-delete），导致 vitest/vite build
 * 在受限环境无法运行。本文件为纯 JS 配置，vitest 优先使用（vitest.config.*
 * 优先于 vite.config.*），并复刻 vite.config.ts 的 alias 与 test 配置。
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
