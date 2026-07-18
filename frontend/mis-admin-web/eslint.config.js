import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// 架构军规1：禁止跨 features 直接依赖。
// 同一 features/<domain> 内允许互引；导入其他 features/<other> 一律报错。
const noCrossFeatureImport = {
  meta: {
    type: 'problem',
    docs: { description: '禁止跨 features 直接依赖（架构军规1）' },
    schema: [],
    messages: {
      cross:
        '禁止跨 features 直接依赖（架构军规1）：请通过路由 / 事件 / 全局 store 通信，或把共享内容抽到 shared/。',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    const self = filename.match(/[\\/]features[\\/]([^\\/]+)[\\/]/);
    if (!self) return {};
    const selfName = self[1];
    const check = (source) => {
      const m = String(source).match(/^@\/features\/([^/]+)/);
      return m && m[1] !== selfName ? m[1] : null;
    };
    return {
      ImportDeclaration(node) {
        if (check(node.source.value)) {
          context.report({ node: node.source, messageId: 'cross' });
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source && check(node.source.value)) {
          context.report({ node: node.source, messageId: 'cross' });
        }
      },
      ExportAllDeclaration(node) {
        if (check(node.source.value)) {
          context.report({ node: node.source, messageId: 'cross' });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'pnpm-lock.yaml', '*.config.js', '*.config.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      arch: { rules: { 'no-cross-feature': noCrossFeatureImport } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'arch/no-cross-feature': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
