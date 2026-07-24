/**
 * DEP-10 网关 RS256 双验签冒烟测试（无 jest/vitest 运行器，用 tsx 直跑纯函数）。
 *
 * 覆盖：
 *  ① MIS 签发的 RS256 JWT（iss=mis-platform）→ verifyJwtRs256 通过且 claim 正确映射
 *     （sub→userId、username、roles、department、channel 默认 web、iss 透传）
 *  ② agent 自有 HS256 JWT（iss=ai-platform）→ verifyJwt 仍被接受
 *  ③ 错误算法（HS256 token 喂给 RS256 校验）→ 拒（AuthError 1005）
 *  ④ 错误 iss → 拒（1003）
 *  ⑤ 篡改签名 → 拒（1002）
 *  ⑥ 过期 token → 拒（1004）
 *
 * 运行：node_modules/.bin/tsx tests/auth.rs256.smoke.ts
 * 退出码：0=全部通过，1=存在失败。
 */

import crypto from "node:crypto";
import { AuthError, verifyJwt, verifyJwtRs256 } from "../src/middleware/auth.js";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

function expectThrow(name: string, fn: () => void, code: number): void {
  try {
    fn();
    failed++;
    console.error(`  FAIL  ${name} (expected AuthError ${code}, but nothing thrown)`);
  } catch (e) {
    if (e instanceof AuthError && e.code === code) {
      passed++;
      console.log(`  PASS  ${name}`);
    } else {
      failed++;
      const got = e instanceof AuthError ? `AuthError/${e.code}` : (e as Error).constructor.name;
      console.error(`  FAIL  ${name} (got ${got}, expected AuthError/${code})`);
    }
  }
}

// 自包含：生成一对测试 RSA 密钥，避免依赖仓库内 keys（部署期由 MIS_JWT_PUBLIC_KEY_PATH 挂载）
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signRs256(payload: Record<string, unknown>, issuer: string): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iss: issuer }));
  const signingInput = `${header}.${body}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${header}.${body}.${b64url(sig)}`;
}

function signHs256(payload: Record<string, unknown>, secret: string, issuer: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iss: issuer }));
  const signingInput = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(signingInput).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

const now = Math.floor(Date.now() / 1000);

console.log("\n[① RS256] MIS JWT (iss=mis-platform) 接受 + claim 映射");
const misTok = signRs256(
  { sub: "u-123", username: "alice", roles: ["admin", "user"], department: "deptA", tenantId: "t1", iat: now, exp: now + 3600 },
  "mis-platform",
);
const c = verifyJwtRs256(misTok, publicKey, "mis-platform");
check("sub -> userId", c.userId === "u-123", `got ${c.userId}`);
check("username 映射", c.username === "alice");
check("roles 映射", Array.isArray(c.roles) && c.roles.length === 2 && c.roles[0] === "admin");
check("department 映射", c.department === "deptA");
check("channel 默认 web", c.channel === "web");
check("iss 透传", c.iss === "mis-platform");
check("exp 在未来", c.exp > now);

console.log("\n[② HS256] agent 自有 JWT (iss=ai-platform) 仍被接受");
const agentTok = signHs256(
  { userId: "agent-1", username: "svc", roles: ["svc"], iat: now, exp: now + 3600 },
  "agent-secret",
  "ai-platform",
);
const a = verifyJwt(agentTok, "agent-secret", "ai-platform");
check("agent userId", a.userId === "agent-1");
check("agent iss", a.iss === "ai-platform");

console.log("\n[③ 拒] 错误算法（HS256 token 喂给 RS256 校验）");
expectThrow(
  "wrong-alg -> 1005",
  () => verifyJwtRs256(signHs256({ sub: "x" }, "k", "mis-platform"), publicKey, "mis-platform"),
  1005,
);

console.log("\n[④ 拒] 错误 iss");
expectThrow(
  "wrong-iss -> 1003",
  () => verifyJwtRs256(signRs256({ sub: "x" }, "evil"), publicKey, "mis-platform"),
  1003,
);

console.log("\n[⑤ 拒] 篡改签名");
const good = signRs256({ sub: "x" }, "mis-platform");
const parts = good.split(".");
const tampered = `${parts[0]}.${parts[1]}.${b64url("tampered-signature")}`;
expectThrow("tampered-sig -> 1002", () => verifyJwtRs256(tampered, publicKey, "mis-platform"), 1002);

console.log("\n[⑥ 拒] 过期 token");
expectThrow(
  "expired -> 1004",
  () =>
    verifyJwtRs256(
      signRs256({ sub: "x", exp: now - 10, iat: now - 100 }, "mis-platform"),
      publicKey,
      "mis-platform",
    ),
  1004,
);

console.log(`\nRS256 双验签冒烟结果：${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
