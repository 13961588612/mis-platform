/**
 * 极简测试框架（QA 自建）。
 *
 * 背景：本项目前端**没有 vitest/jest**（唯一门禁是 `npm run typecheck`）。
 * 为了让「核心逻辑测试用例」真的可执行而不是纸面走查，这里用项目自带的 tsc
 * 把测试与被测源码编译成 CommonJS，再由 `run.cjs` 以 node 执行。
 *
 * 注意：本目录位于 `src` 之外，而根 tsconfig.json 的 include 只有 `["src"]`，
 * 因此不会影响 `npm run typecheck` 门禁结果。
 */

type TestFn = () => void | Promise<void>;

interface TestCase {
  suite: string;
  name: string;
  fn: TestFn;
}

const cases: TestCase[] = [];
let currentSuite = '(root)';

export function describe(name: string, body: () => void): void {
  const prev = currentSuite;
  currentSuite = name;
  body();
  currentSuite = prev;
}

export function it(name: string, fn: TestFn): void {
  cases.push({ suite: currentSuite, name, fn });
}

export class AssertionError extends Error {}

function fail(msg: string): never {
  throw new AssertionError(msg);
}

function show(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function assertEqual<T>(actual: T, expected: T, hint = ''): void {
  if (actual !== expected) {
    fail(`期望 ${show(expected)}，实际 ${show(actual)}${hint ? ` — ${hint}` : ''}`);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, hint = ''): void {
  const a = show(actual);
  const b = show(expected);
  if (a !== b) {
    fail(`期望 ${b}，实际 ${a}${hint ? ` — ${hint}` : ''}`);
  }
}

export function assertTrue(cond: boolean, hint = ''): void {
  if (!cond) fail(`期望为 true${hint ? ` — ${hint}` : ''}`);
}

export function assertFalse(cond: boolean, hint = ''): void {
  if (cond) fail(`期望为 false${hint ? ` — ${hint}` : ''}`);
}

export function assertUndefined(actual: unknown, hint = ''): void {
  if (actual !== undefined) {
    fail(`期望 undefined，实际 ${show(actual)}${hint ? ` — ${hint}` : ''}`);
  }
}

export async function runAll(): Promise<number> {
  let passed = 0;
  const failures: { suite: string; name: string; message: string }[] = [];
  let lastSuite = '';

  for (const c of cases) {
    if (c.suite !== lastSuite) {
      // eslint-disable-next-line no-console
      console.log(`\n  ${c.suite}`);
      lastSuite = c.suite;
    }
    try {
      await c.fn();
      passed += 1;
      // eslint-disable-next-line no-console
      console.log(`    [PASS] ${c.name}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ suite: c.suite, name: c.name, message });
      // eslint-disable-next-line no-console
      console.log(`    [FAIL] ${c.name}\n           ${message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n──────────────────────────────────────────────\n` +
      `  合计 ${cases.length} 项｜通过 ${passed}｜失败 ${failures.length}\n` +
      `──────────────────────────────────────────────`,
  );
  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.log('\n失败明细：');
    for (const f of failures) {
      // eslint-disable-next-line no-console
      console.log(`  - [${f.suite}] ${f.name}: ${f.message}`);
    }
  }
  return failures.length;
}
