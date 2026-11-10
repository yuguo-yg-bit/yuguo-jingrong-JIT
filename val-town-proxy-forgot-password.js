// ============================================================
// 玉国金融 Val.town 忘记密码代理
// 功能：发送重置验证码 + 校验验证码 + 重置密码
// 部署到 Val.town 后访问：
//   https://yuguoygbit--[val-id].web.val.run
// ============================================================

import { MailtrapClient } from "npm:mailtrap";

export default async function (req) {
  const ALLOW_ORIGINS = ["https://www.yuguojinrong.cc.cd", "https://yuguo-yg-bit.github.io", "https://yuguoygbit.github.io"];
  const TURSO_API = process.env.TURSO_API_URL;
  const TURSO_TOKEN = process.env.TURSO_RW_TOKEN;
  const MAILTRAP_TOKEN = process.env.MAILTRAP_TOKEN;

  function getCorsHeaders(origin) {
    const allowed = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
    return {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, X-Session-Token",
      "Access-Control-Max-Age": "86400",
    };
  }

  function jsonResponse(data, status = 200) {
    const origin = req.headers.get("origin") || "";
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") || "";
    const ch = getCorsHeaders(origin);
    return new Response(null, { status: 204, headers: ch });
  }

  // ========== Cloudflare Turnstile 服务端校验 ==========
  const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET;
  const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  async function verifyTurnstile(token, ip) {
    if (!TURNSTILE_SECRET) return { ok: true, skipped: true };
    if (!token) return { ok: false, error: "请先完成人机验证" };
    try {
      const form = new URLSearchParams();
      form.append("secret", TURNSTILE_SECRET);
      form.append("response", String(token));
      if (ip && ip !== "unknown") form.append("remoteip", ip);
      const r = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
      const d = await r.json().catch(function () { return {}; });
      if (d.success) return { ok: true };
      const codes = Array.isArray(d["error-codes"]) ? d["error-codes"].join(",") : "";
      return { ok: false, error: "人机验证未通过" + (codes ? "（" + codes + "）" : ""), codes: codes };
    } catch (e) {
      return { ok: false, error: "人机验证服务暂不可用，请稍后重试" };
    }
  }

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    // ========== 密码哈希 ==========
    const SALT = "yuguo-jr-salt-2024";
    async function hashPassword(password) {
      const input = SALT + password;
      if (crypto.subtle && crypto.subtle.digest) {
        const enc = new TextEncoder();
        const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
        const hex = Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
        return "sha256$" + hex;
      }
      var h = 0;
      for (var i = 0; i < input.length; i++) { h = ((h << 5) - h + input.charCodeAt(i)) | 0; }
      return "sha256$" + (h >>> 0).toString(16).padStart(8, "0");
    }

    // ========== Turso 执行 ==========
    async function execTurso(sql, params) {
      const tursoReq = {
        requests: [{
          type: "execute",
          stmt: { sql, args: (params || []).map(function(v) { return { type: "text", value: String(v) }; }) },
        }],
      };
      const tursoRes = await fetch(TURSO_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(tursoReq),
      });
      const rawText = await tursoRes.text();
      let data;
      try { data = JSON.parse(rawText); } catch (e) { throw new Error("Turso 返回非JSON: " + rawText.substring(0, 200)); }
      if (data && data.results && Array.isArray(data.results)) {
        for (var i = 0; i < data.results.length; i++) {
          if (data.results[i].error) throw new Error("Turso 错误: " + (data.results[i].error.message || JSON.stringify(data.results[i].error)));
        }
      }
      if (!tursoRes.ok) throw new Error("Turso HTTP " + tursoRes.status + ": " + rawText.substring(0, 200));
      return { ok: tursoRes.ok, status: tursoRes.status, data, rawText };
    }

    // ========== Microsoft 邮箱检测 ==========
    function isMicrosoftEmail(email) {
      const domain = (email || "").split("@")[1]?.toLowerCase() || "";
      if (!domain) return false;
      const msDomains = [
        "outlook.com", "outlook.jp", "outlook.fr", "outlook.de", "outlook.co.uk",
        "outlook.co.jp", "outlook.kr", "outlook.in", "outlook.com.br", "outlook.com.au",
        "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.co.jp",
        "hotmail.it", "hotmail.es", "hotmail.com.br",
        "live.com", "live.co.uk", "live.fr", "live.de", "live.jp", "live.cn",
        "msn.com", "windowslive.com", "passport.com"
      ];
      return msDomains.some(function(d) { return domain === d || domain.endsWith("." + d); });
    }

    // ========== 审计日志 ==========
    function logAudit(action, operator, targetType, targetId, detail, endpoint, bizNo, status) {
      const h = req.headers || {};
      let ip = h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for") || "";
      if (ip.indexOf(",") > -1) ip = ip.split(",")[0].trim();
      const ua = h.get("user-agent") || "";
      const aid = "aud_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const now = new Date().toISOString();
      const st = status || "ok";
      try {
        execTurso(
          "INSERT INTO audit_logs (id, action, operator, target_type, target_id, detail, endpoint, ip, ua, biz_no, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          [aid, String(action || "").slice(0, 60), String(operator || "anonymous").slice(0, 60),
           String(targetType || "").slice(0, 40), String(targetId || "").slice(0, 100),
           String(detail || "").slice(0, 500), String(endpoint || "").slice(0, 40),
           ip, String(ua).slice(0, 200), String(bizNo || "").slice(0, 80), st, now]
        ).catch(function() {});
      } catch (e) {}
    }

    if (path === "/health") {
      return jsonResponse({ ok: true, time: new Date().toISOString(), service: "forgot-password" });
    }

    // ========== 忘记密码 — 发送重置验证码 ==========
    if (path === "/oauth/email/forgot-password" && req.method === "POST") {
      const { email, turnstileToken } = await req.json();
      if (!email) return jsonResponse({ error: "缺少邮箱地址" }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "邮箱格式不正确" }, 400);

      const h = req.headers || {};
      let ip = h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for") || "";
      if (ip.indexOf(",") > -1) ip = ip.split(",")[0].trim();
      const tsr = await verifyTurnstile(turnstileToken, ip);
      if (!tsr.ok) {
        logAudit("FORGOT_PWD_TURNSTILE_FAILED", email.toLowerCase(), "users", "", tsr.error || "人机验证失败", "/oauth/email/forgot-password", "", "fail");
        return jsonResponse({ error: tsr.error, turnstileFailed: true }, 403);
      }

      const emailLower = email.toLowerCase();
      const now = new Date().toISOString();

      const { data: userCheck } = await execTurso(
        "SELECT username FROM registrations WHERE (oauth_email=? OR email=?) AND review_status='approved' LIMIT 1",
        [emailLower, emailLower]
      );
      const urows = userCheck.results?.[0]?.response?.result?.rows || [];
      if (urows.length === 0) {
        const { data: userCheck2 } = await execTurso(
          "SELECT id FROM users WHERE (oauth_id=? OR email=?) AND review_status='approved' LIMIT 1",
          [emailLower, emailLower]
        );
        const urows2 = userCheck2.results?.[0]?.response?.result?.rows || [];
        if (urows2.length === 0) {
          return jsonResponse({ error: "该邮箱未注册或尚未通过审核" }, 404);
        }
      }

      try {
        await execTurso("ALTER TABLE email_verifications ADD COLUMN purpose TEXT DEFAULT ''", []);
      } catch (e) {}
      try {
        await execTurso("ALTER TABLE email_verifications ADD COLUMN attempts INTEGER DEFAULT 0", []);
      } catch (e) {}

      const code = String(Math.floor(100000 + Math.random() * 900000));

      await execTurso(
        "INSERT OR REPLACE INTO email_verifications (email, username, password_hash, full_name, birthdate, country, province, city, referrer, code, status, purpose, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [emailLower, "__reset__", "", "", "", "", "", "", "", code, "pending", "reset", now]
      );

      let mailSent = false;
      let mailError = null;
      let skipMailtrap = isMicrosoftEmail(emailLower);
      if (skipMailtrap) {
        mailError = "Microsoft 邮箱域名不支持自动投递（严格头认证），请手动发送邮件";
      } else if (MAILTRAP_TOKEN) {
        try {
          const mailtrap = new MailtrapClient({ token: MAILTRAP_TOKEN });
          await mailtrap.send({
            from: { email: "hello@yuguojinrongemail.cc.cd", name: "玉国金融" },
            to: [{ email: emailLower }],
            subject: "玉国金融 - 重置密码验证码: " + code,
            text: "您的重置密码验证码是: " + code + "\n\n请将此验证码输入页面完成密码重置。\n\n如非本人操作，请忽略此邮件。\n\n玉国金融团队",
            category: "Password Reset",
          });
          mailSent = true;
        } catch (e) {
          mailError = e.message || "unknown";
        }
      }

      if (!mailSent && !skipMailtrap) {
        const mailkiteKey = process.env.MAILKITE_API_KEY;
        if (mailkiteKey) {
          try {
            const mkRes = await fetch("https://api.mailkite.dev/v1/send", {
              method: "POST",
              headers: { "Authorization": "Bearer " + mailkiteKey, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: "玉国金融 <noreply@yuguojinrong.mailk.us>",
                to: [emailLower],
                subject: "玉国金融 - 重置密码验证码 " + code,
                html: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f5f0e8;">' +
                  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 0;">' +
                  '<tr><td align="center">' +
                  '<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">' +
                  '<tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 40px;text-align:center;">' +
                  '<div style="font-size:28px;font-weight:700;color:#b8860b;letter-spacing:2px;">玉国金融</div>' +
                  '<div style="font-size:13px;color:#8892a4;margin-top:6px;letter-spacing:1px;">YUGUO FINANCE</div>' +
                  '</td></tr>' +
                  '<tr><td style="padding:36px 40px 28px;">' +
                  '<p style="font-size:16px;color:#333;margin:0 0 8px;">您好，</p>' +
                  '<p style="font-size:14px;color:#666;line-height:1.8;margin:0 0 28px;">您正在重置玉国金融账户的登录密码。请使用以下验证码完成密码重置。</p>' +
                  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f3;border:2px dashed #b8860b;border-radius:10px;margin-bottom:24px;">' +
                  '<tr><td style="padding:20px;text-align:center;">' +
                  '<div style="font-size:12px;color:#999;margin-bottom:8px;letter-spacing:2px;">重置密码验证码</div>' +
                  '<div style="font-size:36px;font-weight:700;color:#b8860b;letter-spacing:8px;font-family:\'Courier New\',monospace;">' + code + '</div>' +
                  '<div style="font-size:12px;color:#999;margin-top:6px;">15 分钟内有效 · 请勿转发他人</div>' +
                  '</td></tr></table>' +
                  '</td></tr>' +
                  '<tr><td style="padding:0 40px 32px;">' +
                  '<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee;padding-top:24px;">' +
                  '<tr><td style="font-size:12px;color:#999;line-height:1.8;">' +
                  '<p style="margin:0 0 4px;">📌 如非本人操作，请忽略此邮件。</p>' +
                  '<p style="margin:0;">🔒 验证码 15 分钟内有效。</p>' +
                  '</td></tr></table>' +
                  '</td></tr>' +
                  '<tr><td style="background:#fafafa;padding:20px 40px;text-align:center;">' +
                  '<div style="font-size:11px;color:#bbb;">此邮件由系统自动发送 · 请勿回复 · 玉国金融 © ' + new Date().getFullYear() + '</div>' +
                  '</td></tr>' +
                  '</table></td></tr></table></body></html>'
              })
            });
            if (mkRes.ok) {
              const mkData = await mkRes.json();
              mailSent = !!mkData.id;
            }
          } catch (ignored) {}
        }
      }

      logAudit("FORGOT_PWD_SEND", emailLower, "users", "", "发送重置验证码", "/oauth/email/forgot-password", "", mailSent ? "ok" : "mail_fail");
      // 安全：验证码永远不出现在响应体里（历史漏洞：发信失败时回传 code，可接管任意账号）
      if (!mailSent) {
        return jsonResponse({
          ok: false,
          email: emailLower,
          mailSent: false,
          error: "验证码发送失败，请稍后重试或联系管理员"
        }, 502);
      }
      return jsonResponse({
        ok: true,
        email: emailLower,
        mailSent: true,
        message: "重置密码验证码已发送到您的邮箱"
      });
    }

    // ========== 忘记密码 — 验证码校验 + 重置密码 ==========
    if (path === "/oauth/email/reset-password" && req.method === "POST") {
      const { email, code, newPassword, newPasswordHash } = await req.json();
      if (!email || !code || !newPassword) return jsonResponse({ error: "缺少必填字段" }, 400);
      if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        return jsonResponse({ error: "新密码至少 8 位，且必须包含字母和数字" }, 400);
      }
      if (!/^\d{6}$/.test(code)) return jsonResponse({ error: "验证码格式不正确" }, 400);

      const emailLower = email.toLowerCase();
      const now = new Date().toISOString();

      const { data: verData } = await execTurso(
        "SELECT code, created_at, attempts FROM email_verifications WHERE email=? AND code=? AND status='pending' AND purpose='reset'",
        [emailLower, code]
      );
      const vrows = verData.results?.[0]?.response?.result?.rows || [];
      if (vrows.length === 0) {
        // 失败计数：同一邮箱累计 5 次错误即作废当前验证码
        try {
          const { data: cData } = await execTurso(
            "SELECT attempts FROM email_verifications WHERE email=? AND status='pending' AND purpose='reset'",
            [emailLower]
          );
          const crows = cData.results?.[0]?.response?.result?.rows || [];
          const cur = crows.length > 0 ? Number(crows[0][0]?.value ?? crows[0][0] ?? 0) : 0;
          const next = cur + 1;
          await execTurso(
            "UPDATE email_verifications SET attempts=?, status=CASE WHEN ? >= 5 THEN 'locked' ELSE status END WHERE email=? AND status='pending' AND purpose='reset'",
            [next, next, emailLower]
          );
        } catch (ignored) {}
        return jsonResponse({ error: "验证码错误或已过期" }, 400);
      }

      // 有效期 15 分钟（历史漏洞：验证码永久有效）
      const createdRaw = vrows[0][1]?.value ?? vrows[0][1];
      const createdMs = new Date(createdRaw).getTime();
      if (!createdMs || isNaN(createdMs) || Date.now() - createdMs > 15 * 60 * 1000) {
        await execTurso("UPDATE email_verifications SET status='expired' WHERE email=? AND purpose='reset' AND status='pending'", [emailLower]);
        return jsonResponse({ error: "验证码已过期，请重新获取" }, 400);
      }

      const passwordHash = (newPasswordHash && String(newPasswordHash).startsWith("sha256$"))
        ? newPasswordHash
        : await hashPassword(newPassword);

      // 先取出用户名，用于重置后强制回收旧会话
      let resetUsername = "";
      try {
        const { data: uData } = await execTurso(
          "SELECT username FROM registrations WHERE (oauth_email=? OR email=?) AND review_status='approved' LIMIT 1",
          [emailLower, emailLower]
        );
        const urows = uData.results?.[0]?.response?.result?.rows || [];
        if (urows.length > 0) resetUsername = String(urows[0][0]?.value ?? urows[0][0] ?? "");
      } catch (e) {}

      // registrations 表没有 updated_at 列（见 turso-schema.sql），只更新密码
      await execTurso(
        "UPDATE registrations SET password_hash=? WHERE (oauth_email=? OR email=?) AND review_status='approved'",
        [passwordHash, emailLower, emailLower]
      );

      await execTurso(
        "UPDATE users SET password_hash=?, updated_at=? WHERE (oauth_id=? OR email=?) AND review_status='approved'",
        [passwordHash, now, emailLower, emailLower]
      );

      // 重置密码后旧 Token 全部作废，防止账号被旧会话继续接管
      if (resetUsername) {
        try { await execTurso("DELETE FROM sessions WHERE username=?", [resetUsername]); } catch (e) {}
        try { await execTurso("DELETE FROM oauth_tokens WHERE username=?", [resetUsername]); } catch (e) {}
      }

      await execTurso("UPDATE email_verifications SET status='verified', verified_at=? WHERE email=?", [now, emailLower]);

      logAudit("PASSWORD_RESET", emailLower, "users", "", "密码重置成功", "/oauth/email/reset-password", "", "ok");
      return jsonResponse({ ok: true, message: "密码重置成功，请使用新密码登录" });
    }

    return jsonResponse({ error: "请求路径不存在" }, 404);
  } catch (e) {
    return jsonResponse({ error: "服务器繁忙，请稍后重试" }, 500);
  }
}