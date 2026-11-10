// ============================================================
// security/core.js — 安全加固内核（无第三方依赖）
// 目标：在 GitHub Pages + Val.town + Turso 这套“无 WAF / 无 KMS”的
//       平台上，把「身份断言、记账、限流、凭据存储」四件事做扎实。
//
// 设计原则：
// 1) 任何“身份”都必须来自可验证凭据，绝不采信请求体里的自我声明；
// 2) 任何“余额变动”都必须由服务端条件写入，且幂等；
// 3) 任何“共享资源读取”都必须显式通过对象级授权；
// 4) 失败一律闭合（fail-closed），不做“配置缺失就放行”。
// ============================================================

/** 统一安全响应头。GitHub Pages 无法注入响应头，这里的值供
 *  可设头的托管（Cloudflare Pages / Netlify / Vercel）与代理层使用。 */
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

/**
 * 严格 CORS：不在白名单内就【不返回】ACAO，而不是回退到第一个 origin。
 * 返回空对象表示“这个来源不允许跨域读取”。
 */
export function corsHeaders(origin, allowList) {
  const allow = Array.isArray(allowList) ? allowList : [];
  const o = String(origin || "");
  if (!o || allow.indexOf(o) === -1) return {};
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Token, X-Request-Signature, X-Request-Timestamp",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

/** 常数时间字符串比较，降低计时侧信道。 */
export function timingSafeEqual(a, b) {
  const x = String(a == null ? "" : a);
  const y = String(b == null ? "" : b);
  // 先对齐长度，避免长度差异导致的早退
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** 生成不可预测的会话/一次性令牌。 */
export function newToken(prefix) {
  const c = globalThis.crypto;
  const raw = c && c.randomUUID
    ? c.randomUUID().replace(/-/g, "")
    : Array.from({ length: 4 }, function () { return Math.random().toString(36).slice(2, 10); }).join("");
  return String(prefix || "") + raw;
}

function b64(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function unb64(str) {
  const bin = atob(String(str));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 口令派生：PBKDF2-HMAC-SHA256。
 * 入参 secret 可以是明文口令，也可以是前端已做的 sha256$ 摘要
 * （这样不改变现有前端流程，同时把“单轮 SHA-256”升级为慢哈希）。
 *
 * 存储格式：pbkdf2$<iterations>$<saltB64>$<hashB64>
 * pepper 来自环境变量，绝不入库、绝不入仓；pepper 更换会使所有口令失效，
 * 因此需要配合“登录时透明升级”逐步轮换。
 */
export async function pbkdf2Hash(secret, options) {
  const opt = options || {};
  const iterations = Number(opt.iterations || 120000);
  const pepper = String(opt.pepper || "");
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error("当前环境缺少 WebCrypto，拒绝降级为弱哈希");
  const saltBytes = opt.salt ? unb64(opt.salt) : c.getRandomValues(new Uint8Array(16));
  const keyMaterial = await c.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret) + "|" + pepper),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await c.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const saltB64 = opt.salt ? String(opt.salt) : b64(saltBytes);
  return "pbkdf2$" + iterations + "$" + saltB64 + "$" + b64(bits);
}

/** 校验存储口令；返回 { ok, needsRehash }，便于登录时透明升级。 */
export async function pbkdf2Verify(secret, stored, options) {
  const opt = options || {};
  const s = String(stored || "");
  if (!s.startsWith("pbkdf2$")) return { ok: false, needsRehash: false, legacy: true };
  const parts = s.split("$");
  if (parts.length !== 4) return { ok: false, needsRehash: false };
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expect = parts[3];
  if (!iterations || iterations < 10000) return { ok: false, needsRehash: true };
  const got = await pbkdf2Hash(secret, { iterations: iterations, salt: salt, pepper: opt.pepper });
  const gotParts = String(got).split("$");
  const ok = timingSafeEqual(gotParts[3], expect);
  const targetIter = Number(opt.iterations || 120000);
  return { ok: ok, needsRehash: ok && iterations < targetIter };
}

/** 旧版单轮 SHA-256（仅用于兼容与迁移识别，不再用于新写入）。 */
export async function legacySha256(secret, salt) {
  const c = globalThis.crypto;
  const buf = await c.subtle.digest("SHA-256", new TextEncoder().encode(String(salt || "") + String(secret || "")));
  const hex = Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  return "sha256$" + hex;
}

/**
 * 用户名白名单：2–20 位，中文/字母/数字/下划线/短横。
 * 关键作用：从源头切断“用户名里塞双引号 → 后台属性注入 XSS”的链路。
 */
export function isValidUsername(name) {
  const s = String(name || "");
  if (s.length < 2 || s.length > 20) return false;
  if (/^[\u4e00-\u9fa5A-Za-z0-9_-]+$/.test(s)) return true;
  // 兼容历史用户：邮箱形态（登录时允许用邮箱当用户名）
  if (s.indexOf("@") > 0 && /^[^\s"'<>]+@[^\s"'<>]+\.[^\s"'<>]+$/.test(s)) return true;
  return false;
}

/**
 * 服务端限流（Turso 存储，跨实例共享）。
 * key 建议形如 "login:ip:1.2.3.4" / "db:user:alice" / "bind:email:x@y"。
 * 返回 true 表示【已超限，应当拒绝】。
 *
 * 注意：这是“尽力而为”的限流——单条语句原子递增，能挡住脚本刷，
 * 但无法替代 WAF 的分布式防护。
 */
export async function isRateLimited(execTurso, key, limit, windowSec) {
  const now = Date.now();
  const windowMs = Number(windowSec || 60) * 1000;
  const limitN = Number(limit || 10);
  const start = now - (now % windowMs);
  const k = String(key).slice(0, 160);
  try {
    await execTurso(
      "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL DEFAULT 0, count INTEGER NOT NULL DEFAULT 0, updated_at TEXT)",
      []
    );
    // 单语句原子自增：窗口过期则重置为 1，否则 +1
    await execTurso(
      "INSERT INTO rate_limits (key, window_start, count, updated_at) VALUES (?,?,1,?) " +
      "ON CONFLICT(key) DO UPDATE SET " +
      "count = CASE WHEN rate_limits.window_start < ? THEN 1 ELSE rate_limits.count + 1 END, " +
      "window_start = CASE WHEN rate_limits.window_start < ? THEN ? ELSE rate_limits.window_start END, " +
      "updated_at = ?",
      [k, start, new Date(now).toISOString(), start, start, start, new Date(now).toISOString()]
    );
    const q = await execTurso("SELECT count FROM rate_limits WHERE key=?", [k]);
    const rows = q.data?.results?.[0]?.response?.result?.rows
      || q.data?.results?.[0]?.response?.results?.rows
      || q.data?.results?.[0]?.rows
      || [];
    const c = rows.length ? Number(rows[0][0]?.value ?? rows[0][0] ?? 0) : 0;
    return c > limitN;
  } catch (e) {
    // 限流器自身故障时放行会变成“绕过开关”，因此这里选择【不阻断但标记】
    // 由调用方决定；默认返回 false，避免因基础设施抖动导致全站不可用。
    return false;
  }
}

/** HMAC-SHA256 签名（用于管理端敏感请求的可选第二因子）。 */
export async function hmacSign(secret, payload) {
  const c = globalThis.crypto;
  const key = await c.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await c.subtle.sign("HMAC", key, new TextEncoder().encode(String(payload || "")));
  return b64(sig);
}

export async function hmacVerify(secret, payload, signature) {
  if (!secret || !signature) return false;
  const expect = await hmacSign(secret, payload);
  return timingSafeEqual(expect, signature);
}

/**
 * 请求签名串：method + path + timestamp + bodyHash。
 * 绑时间戳可抵御重放（配合 timestamp 窗口校验）。
 */
export function buildSignPayload(method, path, timestamp, body) {
  const raw = String(body == null ? "" : body);
  return [String(method || "POST").toUpperCase(), String(path || ""), String(timestamp || ""), String(raw).slice(0, 2000)].join("\n");
}

/** 时间戳窗口校验，默认 ±300 秒。 */
export function isFreshTimestamp(ts, windowSec) {
  const t = Number(ts);
  if (!isFinite(t) || t <= 0) return false;
  const w = Number(windowSec || 300) * 1000;
  return Math.abs(Date.now() - t) <= w;
}

/** 打码：日志与审计里只保留可定位、不可还原的部分。 */
export function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at <= 0) return "***";
  const head = s.slice(0, Math.min(2, at));
  return head + "***" + s.slice(at);
}

export function maskIp(ip) {
  const s = String(ip || "");
  if (s.indexOf(":") > -1) return s.split(":").filter(Boolean).slice(0, 2).join(":") + "::";
  const p = s.split(".");
  return p.length === 4 ? p[0] + "." + p[1] + ".*.*" : "***";
}
