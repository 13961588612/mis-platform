/**
 * QA 测试运行器（CommonJS）。
 *
 * 职责：
 *  1. 给编译产物目录打上 {"type":"commonjs"}（项目根 package.json 是 "type":"module"，
 *     否则 node 会把 tsc 产出的 CJS 当 ESM 解析而报 SyntaxError）；
 *  2. 注册模块解析钩子，把 `@/...` 别名映射到编译产物
 *     （tsc 不会重写 emit 出来的 require 路径，这是必需的一步）；
 *     其中 `@/lib/api/client` 定向到测试替身，其余 `@/*` 走真实源码；
 *  3. 依次加载各 spec 并汇总结果，失败时以非 0 退出码结束。
 *
 * 用法：node qa-tests/run.cjs   （需先 npx tsc -p qa-tests/tsconfig.qa.json）
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const OUT = path.join(__dirname, '.out');

if (!fs.existsSync(OUT)) {
  console.error('[FATAL] 未找到编译产物 qa-tests/.out —— 请先运行：npx tsc -p qa-tests/tsconfig.qa.json');
  process.exit(2);
}

// 1) 让产物目录以 CommonJS 解析
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

// 2) 别名解析钩子
const STUBS = {
  '@/lib/api/client': path.join(OUT, 'qa-tests', 'stubs', 'api-client.js'),
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) {
    return originalResolve.call(this, STUBS[request], parent, isMain, options);
  }
  if (request.startsWith('@/')) {
    return originalResolve.call(this, path.join(OUT, 'src', request.slice(2)), parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

// 3) 加载 spec 并运行
const SPECS = ['post-query.spec.js', 'filter-logic.spec.js'];

console.log('\n==============================================');
console.log('  前端核心逻辑测试（QA 自建 runner，无 vitest）');
console.log('==============================================');

for (const spec of SPECS) {
  require(path.join(OUT, 'qa-tests', spec));
}

const { runAll } = require(path.join(OUT, 'qa-tests', 'harness.js'));

runAll()
  .then((failed) => {
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error('[FATAL] 运行器异常：', e);
    process.exit(2);
  });
