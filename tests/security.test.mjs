// tests/security.test.mjs — 纯逻辑单测，不依赖网络与数据库
// 运行：node tests/security.test.mjs
import assert from "node:assert/strict";
import {
  corsHeaders, timingSafeEqual, isValidUsername, pbkdf2Hash, pbkdf2Verify,
  isFreshTimestamp, maskEmail, maskIp, hmacSign, hmacVerify, buildSignPayload,
  isRateLimited,
} from "../security/core.js";

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + " → " + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + " → " + e.message); process.exitCode = 1; }
}

console.log("\nCORS");
ok("白名单来源放行", () => {
  const h = corsHeaders("https://www.yuguojinrong.cc.cd", ["https://www.yuguojinrong.cc.cd"]);
  assert.equal(h["Access-Control-Allow-Origin"], "https://www.yuguojinrong.cc.cd");
});
ok("未知来源不下发 ACAO（不再回退）", () => {
  const h = corsHeaders("https://evil.example", ["https://www.yuguojinrong.cc.cd"]);
  assert.equal(h["Access-Control-Allow-Origin"], undefined);
});
ok("空 Origin 不下发 ACAO", () => {
  assert.deepEqual(corsHeaders("", ["https://a.b"]), {});
});

console.log("\n常数时间比较");
ok("相等返回 true", () => assert.equal(timingSafeEqual("abc", "abc"), true));
ok("不等返回 false", () => assert.equal(timingSafeEqual("abc", "abd"), false));
ok("长度不同返回 false 且不抛错", () => assert.equal(timingSafeEqual("a", "abcdef"), false));
ok("null 安全", () => assert.equal(timingSafeEqual(null, ""), true));

console.log("\n用户名白名单（关掉属性注入 XSS 的入口）");
ok("正常中文名", () => assert.equal(isValidUsername("谭绣云"), true));
ok("正常英文名", () => assert.equal(isValidUsername("alice_01"), true));
ok("拒绝双引号（admin 面板 XSS 载荷）", () => assert.equal(isValidUsername('a" onmouseover="alert(1)'), false));
ok("拒绝尖括号", () => assert.equal(isValidUsername("<script>x</script>"), false));
ok("拒绝过短/过长", () => {
  assert.equal(isValidUsername("a"), false);
  assert.equal(isValidUsername("x".repeat(21)), false);
});
ok("邮箱形态兼容", () => assert.equal(isValidUsername("user@example.com"), true));

console.log("\n口令派生（PBKDF2）");
await okAsync("哈希格式正确且可校验", async () => {
  const stored = await pbkdf2Hash("sha256$deadbeef", { pepper: "p1", iterations: 10000 });
  assert.match(stored, /^pbkdf2\$10000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  const v = await pbkdf2Verify("sha256$deadbeef", stored, { pepper: "p1", iterations: 10000 });
  assert.equal(v.ok, true);
  assert.equal(v.needsRehash, false);
});
await okAsync("错误口令被拒绝", async () => {
  const stored = await pbkdf2Hash("right", { pepper: "p1", iterations: 10000 });
  const v = await pbkdf2Verify("wrong", stored, { pepper: "p1", iterations: 10000 });
  assert.equal(v.ok, false);
});
await okAsync("同样口令在不同盐下产出不同哈希", async () => {
  const a = await pbkdf2Hash("same", { pepper: "p1", iterations: 10000 });
  const b = await pbkdf2Hash("same", { pepper: "p1", iterations: 10000 });
  assert.notEqual(a, b);
});
await okAsync("迭代数低于目标时标记需要重算", async () => {
  const stored = await pbkdf2Hash("x", { pepper: "p1", iterations: 10000 });
  const v = await pbkdf2Verify("x", stored, { pepper: "p1", iterations: 120000 });
  assert.equal(v.ok, true);
  assert.equal(v.needsRehash, true);
});
await okAsync("pepper 不同则校验失败", async () => {
  const stored = await pbkdf2Hash("x", { pepper: "p1", iterations: 10000 });
  const v = await pbkdf2Verify("x", stored, { pepper: "p2", iterations: 10000 });
  assert.equal(v.ok, false);
});
await okAsync("旧 sha256 存储被识别为 legacy，不误判通过", async () => {
  const v = await pbkdf2Verify("x", "sha256$abc", { pepper: "p1" });
  assert.equal(v.ok, false);
  assert.equal(v.legacy, true);
});

console.log("\n重放防护");
ok("刚生成的时间戳通过", () => assert.equal(isFreshTimestamp(Date.now()), true));
ok("过期时间戳被拒", () => assert.equal(isFreshTimestamp(Date.now() - 600000), false));
ok("未来时间戳被拒", () => assert.equal(isFreshTimestamp(Date.now() + 600000), false));
ok("非数字被拒", () => assert.equal(isFreshTimestamp("abc"), false));

console.log("\n签名");
await okAsync("HMAC 往返一致", async () => {
  const p = buildSignPayload("POST", "/db", 1700000000000, '{"op":"vouchers.create"}');
  const sig = await hmacSign("secret", p);
  assert.equal(await hmacVerify("secret", p, sig), true);
});
await okAsync("篡改 body 后签名失效", async () => {
  const p1 = buildSignPayload("POST", "/db", 1700000000000, '{"amount":1}');
  const p2 = buildSignPayload("POST", "/db", 1700000000000, '{"amount":100}');
  const sig = await hmacSign("secret", p1);
  assert.equal(await hmacVerify("secret", p2, sig), false);
});

console.log("\n日志脱敏");
ok("邮箱打码", () => {
  assert.equal(maskEmail("victim@example.com"), "vi***@example.com");
  assert.equal(maskEmail("no-at-sign"), "***");
});
ok("IP 打码", () => {
  assert.equal(maskIp("203.0.113.42"), "203.0.*.*");
  assert.equal(maskIp("2001:db8::1"), "2001:db8::");
});

console.log("\n跨实例限流");
await okAsync("peek 只读检查不递增计数（登录锁号 DoS 修复）", async () => {
  const store = new Map();
  const exec = async function (sql, params) {
    const s = String(sql);
    if (/^CREATE TABLE/i.test(s)) return {};
    if (/^INSERT INTO rate_limits/i.test(s)) {
      const k = params[0];
      const start = Number(params[1]);
      const rec = store.get(k);
      if (rec && rec.windowStart >= start) rec.count++;
      else store.set(k, { count: 1, windowStart: start });
      return {};
    }
    if (/^SELECT count, window_start/i.test(s)) {
      const rec = store.get(params[0]);
      return { data: { results: [{ response: { result: { rows: rec ? [[rec.count, rec.windowStart]] : [] } } }] } };
    }
    if (/^SELECT count FROM/i.test(s)) {
      const rec = store.get(params[0]);
      return { data: { results: [{ response: { result: { rows: rec ? [[rec.count]] : [] } } }] } };
    }
    return {};
  };
  // 记一次失败
  assert.equal(await isRateLimited(exec, "loginfail:a|bob", 8, 900), false);
  const before = store.get("loginfail:a|bob").count;
  // 只读检查不应改变计数
  assert.equal(await isRateLimited(exec, "loginfail:a|bob", 8, 900, { peek: true }), false);
  assert.equal(store.get("loginfail:a|bob").count, before);
});

console.log("\n共 " + passed + " 项断言通过\n");
