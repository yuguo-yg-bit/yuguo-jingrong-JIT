// ============================================================
// 玉国金融 Val.town 中转代理
// 功能：接收前端请求 → 转发SQL到Turso → 返回结果
// 部署到 Val.town 后访问：
//   https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run （主代理）
// ============================================================

import { MailtrapClient } from "npm:mailtrap";

let _negativePointsFixed = false;

export default async function (req) {
  // ========== HTTP 代理 ==========

  const ALLOW_ORIGINS = ["https://www.yuguojinrong.cc.cd", "https://yuguo-yg-bit.github.io", "https://yuguoygbit.github.io"];
  const TURSO_API = process.env.TURSO_API_URL;
  const TURSO_TOKEN = process.env.TURSO_RW_TOKEN;
  const Github_TOKEN = process.env.GitHub_API_TOKEN;
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

  // return_url 只允许精确匹配白名单 origin，防止开放重定向把 token 送到攻击者域名
  function safeReturnUrl(raw) {
    try {
      const u = new URL(String(raw || ""));
      if (ALLOW_ORIGINS.includes(u.origin)) return u.origin;
    } catch (e) {}
    return ALLOW_ORIGINS[0];
  }

  function jsonResponse(data, status = 200) {
    const origin = req.headers.get("origin") || "";
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // ========== Cloudflare Turnstile 服务端校验 ==========
  // 密钥只从环境变量读取，绝不写进前端或仓库
  const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET;
  const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  async function verifyTurnstile(token, ip) {
    // 未配置密钥时视为功能未开启（便于部署过渡，不阻断登录）；配置后严格校验
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

  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") || "";
    const ch = getCorsHeaders(origin);
    return new Response(null, { status: 204, headers: ch });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    // ========== 工具：把 Turso 带类型格式转成纯值 ==========
    function unwrapTurso(cols, rows) {
      const columns = (cols || []).map(function(c) { return c.name || c; });
      const unwrappedRows = (rows || []).map(function(row) {
        return row.map(function(cell) {
          if (cell !== null && typeof cell === "object" && "value" in cell) return cell.value;
          return cell;
        });
      });
      return { columns, rows: unwrappedRows };
    }

 if (path === "/health") {
      return jsonResponse({ ok: true, time: new Date().toISOString() });
    }

    try { await execTurso("CREATE TABLE IF NOT EXISTS oauth_tokens (token TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER DEFAULT 0, created_at TEXT, last_used_at TEXT)", []); } catch (e) {}
    try { await execTurso("ALTER TABLE oauth_tokens ADD COLUMN last_used_at TEXT DEFAULT ''", []); } catch (e) {}
    try { await execTurso("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''", []); } catch (e) {}
    try { await execTurso("ALTER TABLE registrations ADD COLUMN email TEXT DEFAULT ''", []); } catch (e) {}
    // 表结构自愈（原由前端在每次加载时执行，现收归服务端）
    try { await execTurso("ALTER TABLE users ADD COLUMN frozen INTEGER DEFAULT 0", []); } catch (e) {}
    try { await execTurso("ALTER TABLE user_levels ADD COLUMN theme TEXT DEFAULT 'default'", []); } catch (e) {}
    try { await execTurso("ALTER TABLE user_levels ADD COLUMN avatar_frame TEXT DEFAULT 'none'", []); } catch (e) {}
    try { await execTurso("ALTER TABLE user_levels ADD COLUMN bio TEXT DEFAULT ''", []); } catch (e) {}
    try { await execTurso("ALTER TABLE user_levels ADD COLUMN location TEXT DEFAULT ''", []); } catch (e) {}
    try { await execTurso("ALTER TABLE user_levels ADD COLUMN joined_at TEXT DEFAULT ''", []); } catch (e) {}
    try { await execTurso("ALTER TABLE user_levels ADD COLUMN cover TEXT DEFAULT ''", []); } catch (e) {}
    try { await execTurso("ALTER TABLE user_levels ADD COLUMN last_wheel_free TEXT DEFAULT ''", []); } catch (e) {}
    try { await execTurso("ALTER TABLE user_levels ADD COLUMN discount_backup TEXT DEFAULT '[]'", []); } catch (e) {}

    // ========== 密码哈希：SHA-256(盐 + 密码) ==========
    const SALT = "yuguo-jr-salt-2024";
    async function hashPassword(password) {
      const input = SALT + password;
      if (crypto.subtle && crypto.subtle.digest) {
        const enc = new TextEncoder();
        const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
        const hex = Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
        return "sha256$" + hex;
      }
      // 回退：简易哈希（Val.town 环境不一定支持 crypto.subtle）
      var h = 0;
      for (var i = 0; i < input.length; i++) { h = ((h << 5) - h + input.charCodeAt(i)) | 0; }
      return "sha256$" + (h >>> 0).toString(16).padStart(8, "0");
    }

    // ========== SQL 安全校验层（防注入/防删库） ==========
    const ALLOWED_TABLES = [
      "users","vouchers","points_records","points_logs","points_accounts","chat_messages",
      "notifications","notification_replies","blacklist","urgent_blacklist","registrations",
      "whitelist","sys_config","test_ping","test_users","oauth_tokens","task_rewards",
      "user_levels","lottery_tickets","lottery_records","win_wall","risk_control",
      "user_monthly_rewards","user_outfits","community_statuses","community_likes","community_comments","community_bans","email_verifications","sqlite_sequence","ledger","audit_logs","sessions","farm_data",
      "game_shop_stock","game_shelves","game_farm_plots","game_engine_state","game_engine_log"
    ];
    const DANGER_KEYWORDS = ["DROP","ATTACH","DETACH","VACUUM","REINDEX","TRIGGER","TRUNCATE","PRAGMA"];

    function assertSqlSafe(sql) {
      if (!sql || typeof sql !== "string") throw new Error("sql 必须是字符串");
      const trimmed = sql.trim();
      const upper = trimmed.toUpperCase().replace(/\s+/g, " ");
      // 1) 禁止多语句（防堆叠注入）
      const semis = (trimmed.match(/;/g) || []).length;
      if (semis > 1) throw new Error("禁止多语句执行");
      if (semis === 1 && !/;$/.test(trimmed)) throw new Error("SQL 格式异常");
      // 2) 危险关键字黑名单
      for (let i = 0; i < DANGER_KEYWORDS.length; i++) {
        if (new RegExp("\\b" + DANGER_KEYWORDS[i] + "\\b", "i").test(upper)) {
          throw new Error("禁止危险语句: " + DANGER_KEYWORDS[i]);
        }
      }
      // 3) ALTER 只允许 ADD COLUMN（迁移用）
      if (/^ALTER\s+/i.test(trimmed)) {
        if (!/^ALTER\s+TABLE\s+[A-Za-z_0-9]+\s+ADD\s+COLUMN\s+/i.test(trimmed)) {
          throw new Error("只允许 ADD COLUMN 迁移语句");
        }
      }
      // 4) UPDATE / DELETE 强制 WHERE（防全表修改/清空）
      if (/^(UPDATE|DELETE)\s+/i.test(trimmed)) {
        if (!/\bWHERE\b/i.test(upper)) throw new Error("UPDATE/DELETE 必须带 WHERE");
      }
      // 5) 建表只允许 IF NOT EXISTS 且表名白名单（防 CREATE TABLE AS 拖库）
      if (/^CREATE\s+/i.test(trimmed)) {
        const mTable = trimmed.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_0-9]+)/i);
        if (mTable) {
          if (ALLOWED_TABLES.indexOf(mTable[1].toLowerCase()) === -1) throw new Error("非法建表: " + mTable[1]);
          if (!/IF\s+NOT\s+EXISTS/i.test(upper)) throw new Error("建表必须 IF NOT EXISTS");
        } else {
          const mIdx = trimmed.match(/^CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[A-Za-z_0-9]+\s+ON\s+([A-Za-z_0-9]+)/i);
          if (!mIdx) throw new Error("非法 CREATE 语句");
          if (ALLOWED_TABLES.indexOf(mIdx[1].toLowerCase()) === -1) throw new Error("非法建索引表: " + mIdx[1]);
        }
      }
      // 6) 表名白名单已移除（正则提取不可靠，Keep: 危险关键字 + 多语句 + WHERE 强制等硬规则）
      // 7) 积分安全：禁止通过 /sql 直接修改 users.points（强制走 /points 账务入账）
      if (/\bUPDATE\s+users\s/i.test(trimmed) && /\bpoints\b/i.test(trimmed)) {
        throw new Error("禁止直接操作积分字段，请通过 /points 端点操作");
      }
      if (/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+users\s/i.test(trimmed) && /\bpoints\b/i.test(trimmed)) {
        throw new Error("禁止直接操作积分字段，请通过 /points 端点操作");
      }
    }

    // ========== 通用：执行 Turso 请求 ==========
    const normalizeNegativePoints = async function() {
      if (_negativePointsFixed) return;
      _negativePointsFixed = true;
      try { await execTurso("UPDATE users SET points=0 WHERE points<0", []); } catch (e) {}
    };
    async function execTurso(sql, params) {
      const tursoReq = {
        requests: [{
          type: "execute",
          stmt: { sql, args: (params || []).map(function(v) { return { type: "text", value: String(v) }; }) },
        }],
      };

      const tursoRes = await fetch(TURSO_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TURSO_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tursoReq),
      });

      const rawText = await tursoRes.text();
      let data;
      try { data = JSON.parse(rawText); } catch (e) { throw new Error("Turso 返回非JSON: " + rawText.substring(0, 200)); }

      // 检查 Turso pipeline 内部错误（如表不存在、权限不足等）
      if (data && data.results && Array.isArray(data.results)) {
        for (var i = 0; i < data.results.length; i++) {
          if (data.results[i].error) {
            throw new Error("Turso 错误: " + (data.results[i].error.message || JSON.stringify(data.results[i].error)));
          }
        }
      }

      if (!tursoRes.ok) {
        throw new Error("Turso HTTP " + tursoRes.status + ": " + rawText.substring(0, 200));
      }

      return { ok: tursoRes.ok, status: tursoRes.status, data, rawText };
    }

    // ========== 审计日志（详细、仅追加，全部写入数据库） ==========
    function getClientInfo() {
      const h = req.headers || {};
      let ip = h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for") || "";
      if (ip.indexOf(",") > -1) ip = ip.split(",")[0].trim();
      const ua = h.get("user-agent") || "";
      return { ip, ua };
    }

    function logAudit(action, operator, targetType, targetId, detail, endpoint, bizNo, status) {
      const { ip, ua } = getClientInfo();
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

    // 一次性归一：历史遗留的负积分统一归零（余额永不为负）
    try { await normalizeNegativePoints(); } catch (e) {}

    // ========== 具名数据库操作目录（客户端只能传 op 名，SQL 只存在于服务端） ==========
    // auth: public=无需登录 | user=需登录 | admin=需管理员
    // owner: params 中必须是当前登录用户名的下标
    // voucher: params 中存放凭证 id 的下标（-1 表示最后一个），服务端校验凭证归属
    const DB_OPS = {
  "vouchers.list_mine": { sql: "SELECT * FROM vouchers WHERE user_id=? AND user_id NOT LIKE '【%】%' AND shop_name NOT LIKE '【%】%' ORDER BY created_at DESC LIMIT 500", auth: "user", owner: 0 },
  "vouchers.list_all": { sql: "SELECT * FROM vouchers WHERE user_id NOT LIKE '【%】%' AND shop_name NOT LIKE '【%】%' ORDER BY created_at DESC LIMIT 500", auth: "user" },
  "vouchers.next_id": { sql: "SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) + 1 AS next_id FROM vouchers", auth: "user" },
  "vouchers.mark_completed": { sql: "UPDATE vouchers SET payment_status='completed', payment_method=COALESCE(NULLIF(?,''),payment_method), status='已完成交易', updated_at=? WHERE id=?", auth: "user", voucher: 2 },
  "vouchers.mark_paid": { sql: "UPDATE vouchers SET payment_status='paid', payment_method=COALESCE(NULLIF(?,''),payment_method), status='已付款·待确认', updated_at=? WHERE id=?", auth: "user", voucher: 2 },
  "chat.list": { sql: "SELECT * FROM chat_messages WHERE user_id=? ORDER BY created_at ASC LIMIT 500", auth: "public", optionalAuth: true, owner: 0 },
  "chat.send": { sql: "INSERT INTO chat_messages (id, user_id, sender, content, image_url, is_read, created_at) VALUES (?,?,?,?,?,0,?)", auth: "public", optionalAuth: true, owner: 1, anonRewrite: { 2: "user" }, forceSenderForUser: true },
  "chat.users": { sql: "SELECT user_id, MAX(created_at) AS last_at FROM chat_messages GROUP BY user_id ORDER BY last_at DESC", auth: "admin" },
  "vouchers.users": { sql: "SELECT DISTINCT user_id FROM vouchers ORDER BY user_id ASC LIMIT 1000", auth: "admin" },
  "chat.mark_read": { sql: "UPDATE chat_messages SET is_read=1 WHERE user_id=?", auth: "user", owner: 0 },
  "levels.get": { sql: "SELECT * FROM user_levels WHERE user_id=? LIMIT 1", auth: "user" },
  "vouchers.delete": { sql: "DELETE FROM vouchers WHERE id=?", auth: "user", voucher: 0 },
  "vouchers.update_lottery": { sql: "UPDATE vouchers SET discount=?, final_price=?, updated_at=? WHERE id=?", auth: "admin" },
  "reg.list": { sql: "SELECT * FROM registrations ORDER BY created_at DESC LIMIT 500", auth: "admin" },
  "reg.approve": { sql: "UPDATE registrations SET review_status='approved' WHERE id=?", auth: "admin" },
  "reg.reject": { sql: "UPDATE registrations SET review_status='rejected' WHERE id=?", auth: "admin" },
  "reg.find_approved": { sql: "SELECT id, username, full_name, review_status, created_at FROM registrations WHERE username=? AND review_status='approved' LIMIT 1", auth: "public" },
  "reg.find_pending": { sql: "SELECT id, username, created_at FROM registrations WHERE username=? AND review_status='pending' LIMIT 1", auth: "public" },
  "reg.create": { sql: "INSERT INTO registrations (id, username, password_hash, full_name, birthdate, country, province, city, referrer, review_status, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?)", auth: "public" },
  "reg.pending_list": { sql: "SELECT * FROM registrations WHERE review_status='pending' ORDER BY created_at DESC", auth: "admin" },
  "reg.referrals": { sql: "SELECT * FROM registrations WHERE referrer=? AND review_status='approved' ORDER BY created_at DESC", auth: "user", owner: 0 },
  "notif.send": { sql: "INSERT INTO notifications (id, title, content, target_users, created_at) VALUES (?,?,?,?,?)", auth: "admin" },
  "notif.list": { sql: "SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200", auth: "user" },
  "notif.reply": { sql: "INSERT INTO notification_replies (notification_id, username, message, created_at) VALUES (?,?,?,?)", auth: "user", owner: 1 },
  "notif.replies": { sql: "SELECT * FROM notification_replies WHERE notification_id=? ORDER BY created_at ASC", auth: "user" },
  "vouchers.urgent_mark": { sql: "UPDATE vouchers SET is_urgent=1, urgent_reason=?, urgent_username=?, urgent_time=?, updated_at=? WHERE id=?", auth: "user", owner: 1 },
  "vouchers.urgent_remove": { sql: "UPDATE vouchers SET is_urgent=0, urgent_reason='', urgent_username='', urgent_time='', updated_at=? WHERE id=?", auth: "user", voucher: 1 },
  "vouchers.urgent_info": { sql: "SELECT is_urgent, urgent_reason, urgent_username, urgent_time FROM vouchers WHERE id=? LIMIT 1", auth: "user", voucher: 0 },
  "users.update_password": { sql: "UPDATE users SET password_hash=?, updated_at=? WHERE id=?", auth: "user", owner: 2 },
  "reg.update_password": { sql: "UPDATE registrations SET password_hash=? WHERE username=? AND review_status='approved'", auth: "user", owner: 1 },
  "users.profile": { sql: "SELECT * FROM users WHERE id=? LIMIT 1", auth: "user", strip: ["password_hash"] },
  "oauth.token_get": { sql: "SELECT * FROM oauth_tokens WHERE token=? LIMIT 1", auth: "public" },
  "oauth.token_delete": { sql: "DELETE FROM oauth_tokens WHERE token=?", auth: "public" },
  "oauth.token_touch": { sql: "UPDATE oauth_tokens SET last_used_at=? WHERE token=?", auth: "public" },
  "admin_config.get": { sql: "SELECT value FROM admin_config WHERE key=?", auth: "admin" },
  "admin_config.set": { sql: "INSERT OR REPLACE INTO admin_config (key, value, updated_at) VALUES (?,?,?)", auth: "admin" },
  "admin_config.list": { sql: "SELECT key, value FROM admin_config", auth: "admin" },
  "bl.urgent_add": { sql: "INSERT OR REPLACE INTO urgent_blacklist (username, reason, from_time, until, operator, created_at) VALUES (?,?,?,?,?,?)", auth: "admin" },
  "bl.urgent_remove": { sql: "DELETE FROM urgent_blacklist WHERE username=?", auth: "admin" },
  "bl.urgent_list": { sql: "SELECT * FROM urgent_blacklist ORDER BY created_at DESC LIMIT 500", auth: "user" },
  "bl.add": { sql: "INSERT OR REPLACE INTO blacklist (username, reason, time, type, until, created_at) VALUES (?,?,?,?,?,?)", auth: "admin" },
  "bl.remove": { sql: "DELETE FROM blacklist WHERE username=?", auth: "admin" },
  "bl.list": { sql: "SELECT * FROM blacklist ORDER BY created_at DESC LIMIT 500", auth: "user" },
  "community.list": { sql: "SELECT * FROM community_statuses ORDER BY created_at DESC LIMIT 200", auth: "user" },
  "community.post": { sql: "INSERT INTO community_statuses (username, content, created_at) VALUES (?,?,?)", auth: "user", owner: 0 },
  "community.bans": { sql: "SELECT * FROM community_bans ORDER BY created_at DESC LIMIT 500", auth: "admin" },
  "community.ban_get": { sql: "SELECT * FROM community_bans WHERE user_id=? ORDER BY id DESC LIMIT 1", auth: "user", owner: 0 },
  "community.ban_find": { sql: "SELECT id FROM community_bans WHERE user_id=? LIMIT 1", auth: "admin" },
  "community.ban_insert": { sql: "INSERT INTO community_bans (user_id, banned_until, reason, created_by, created_at) VALUES (?,?,?,?,?)", auth: "admin" },
  "community.ban_update": { sql: "UPDATE community_bans SET banned_until=?, reason=?, created_by=?, created_at=? WHERE id=?", auth: "admin" },
  "community.ban_remove": { sql: "DELETE FROM community_bans WHERE user_id=?", auth: "admin" },
  "community.status_delete": { sql: "DELETE FROM community_statuses WHERE id=?", auth: "admin" },
  "levels.list": { sql: "SELECT * FROM user_levels LIMIT 500", auth: "user" },
  "levels.upsert": { sql: "INSERT OR REPLACE INTO user_levels (user_id, level, exp, streak_days, total_vouchers, basic_tickets, rare_tickets, last_login, last_upload, badges, avatar, theme, avatar_frame, bio, location, joined_at, cover, last_wheel_free, discount_backup, nickname, real_name, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", auth: "user", owner: 0 },
  "tickets.count": { sql: "SELECT COUNT(*) AS cnt FROM lottery_tickets WHERE user_id=? AND status='unused' AND expires_at > ?", auth: "user", owner: 0 },
  "tickets.expired_count": { sql: "SELECT COUNT(*) AS cnt FROM lottery_tickets WHERE user_id=? AND (status='expired' OR expires_at <= ?)", auth: "user", owner: 0 },
  "tickets.add": { sql: "INSERT INTO lottery_tickets (id, user_id, ticket_type, source, status, expires_at, created_at) VALUES (?,?,?,?,'unused',?,?)", auth: "admin" },
  "tickets.use": { sql: "UPDATE lottery_tickets SET status='used', used_at=? WHERE id=(SELECT id FROM lottery_tickets WHERE user_id=? AND status='unused' AND expires_at > ? LIMIT 1)", auth: "user", owner: 1 },
  "tickets.expire_old": { sql: "UPDATE lottery_tickets SET status='expired' WHERE status IN ('unused','used') AND expires_at <= ? AND user_id=?", auth: "user", owner: 0 },
  "lottery.record_add": { sql: "INSERT INTO lottery_records (id, user_id, voucher_id, pool_type, prize_id, prize_name, prize_cash, prize_rate, voucher_amount, final_reward, is_win, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", auth: "user", owner: 1 },
  "winwall.list": { sql: "SELECT * FROM win_wall ORDER BY created_at DESC LIMIT 200", auth: "user" },
  "winwall.add": { sql: "INSERT INTO win_wall (id, user_id, prize_name, prize_cash, pool_type, voucher_amount, created_at) VALUES (?,?,?,?,?,?,?)", auth: "user", owner: 1 },
  "tasks.list": { sql: "SELECT * FROM task_rewards WHERE user_id=? ORDER BY created_at DESC", auth: "user", owner: 0 },
  "tasks.add": { sql: "INSERT INTO task_rewards (id, user_id, task_id, reward_type, reward_amount, claimed_at, created_at) VALUES (?,?,?,?,?,?,?)", auth: "user", owner: 1 },
  "outfits.list": { sql: "SELECT outfit_id FROM user_outfits WHERE user_id=? ORDER BY unlocked_at ASC", auth: "user", owner: 0 },
  "outfits.unlock": { sql: "INSERT OR IGNORE INTO user_outfits (id, user_id, outfit_id, unlocked_at) VALUES (?,?,?,?)", auth: "user", owner: 1 },
  "risk.get": { sql: "SELECT * FROM risk_control WHERE id='global' LIMIT 1", auth: "user" },
  "risk.update": { sql: "INSERT OR REPLACE INTO risk_control (id, monthly_budget, monthly_spent, per_user_monthly_cap, per_ticket_cap, rare_pool_open, month_key, updated_at) VALUES ('global',?,?,?,?,?,?,?)", auth: "admin" },
  "monthly.get": { sql: "SELECT * FROM user_monthly_rewards WHERE user_id=? AND month_key=? LIMIT 1", auth: "user", owner: 0 },
  "monthly.add": { sql: "INSERT INTO user_monthly_rewards (id, user_id, month_key, total_reward, draw_count, updated_at) VALUES (?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET total_reward = total_reward + ?, draw_count = draw_count + 1, updated_at=?", auth: "user", owner: 1 },
  "users.create_account": { sql: "INSERT INTO users (id, password_hash, points, sign_ins, last_sign_in, streak_days, frozen, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)", auth: "user", owner: 0 },
  "points.log_add": { sql: "INSERT INTO points_records (id, user_id, delta, reason, created_at) VALUES (?,?,?,?,?)", auth: "user", owner: 1 },
  "users.signin_update": { sql: "UPDATE users SET sign_ins = ?, last_sign_in = ?, streak_days = ?, updated_at = ? WHERE id = ?", auth: "user", owner: 4 },
  "users.set_frozen": { sql: "UPDATE users SET frozen = ?, updated_at = ? WHERE id = ?", auth: "admin" },
  "points.account_get": { sql: "SELECT id, points, sign_ins, last_sign_in, streak_days, frozen FROM users WHERE id = ?", auth: "user", owner: 0 },
  "points.logs_recent": { sql: "SELECT delta, reason, created_at FROM points_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", auth: "user", owner: 0 },
  "points.logs_all": { sql: "SELECT delta, reason, created_at FROM points_records WHERE user_id = ? ORDER BY created_at DESC", auth: "user", owner: 0 },
  "users.list_points": { sql: "SELECT id, points, sign_ins, last_sign_in, streak_days, frozen FROM users", auth: "admin" },
      "vouchers.create": { sql: "INSERT OR REPLACE INTO vouchers (id, user_id, shop_name, latitude, longitude, amount, discount, order_photos, payment_method, signature, remark, reject_reason, platform, order_no, product_photo, shopping_photos, electric_category, electric_brand, electric_apply_amount, electric_subsidy_rate, electric_subsidy_amount, review_result, final_price, shop_photo, status, order_type, payment_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", auth: "user", owner: 1 },
      "vouchers.update_full": { sql: "UPDATE vouchers SET shop_name=?, shop_photo=?, order_photos=?, latitude=?, longitude=?, amount=?, discount=?, payment_method=?, remark=?, signature=?, reject_reason=?, platform=?, order_no=?, product_photo=?, shopping_photos=?, electric_category=?, electric_brand=?, electric_apply_amount=?, electric_subsidy_rate=?, electric_subsidy_amount=?, review_result=?, final_price=?, updated_at=? WHERE id=?", auth: "user", voucher: -1 },
      "lottery.records_mine": { sql: "SELECT * FROM lottery_records WHERE user_id=? ORDER BY created_at DESC LIMIT 200", auth: "user", owner: 0 },
      "lottery.records_all": { sql: "SELECT * FROM lottery_records ORDER BY created_at DESC LIMIT 500", auth: "admin" },
      "vouchers.update_status": { sql: "UPDATE vouchers SET status=?, reject_reason=COALESCE(NULLIF(?,''),reject_reason), updated_at=? WHERE id=?", auth: "admin" },
      "vouchers.update_status_electric": { sql: "UPDATE vouchers SET status=?, reject_reason=COALESCE(NULLIF(?,''),reject_reason), electric_subsidy_rate=?, electric_subsidy_amount=?, updated_at=? WHERE id=?", auth: "admin" },
      "vouchers.update_fields": { auth: "admin", run: async function (p) {
        var allowed = ["shop_name","shop_photo","order_photos","latitude","longitude","amount","discount","payment_method","remark","signature","reject_reason","platform","order_no","product_photo","shopping_photos","electric_category","electric_brand","electric_apply_amount","electric_subsidy_rate","electric_subsidy_amount","review_result","final_price","status","order_type","payment_status"];
        var id = String(p[0] || "");
        var fields = (p[1] && typeof p[1] === "object") ? p[1] : {};
        var sets = [], vals = [];
        Object.keys(fields).forEach(function (k) {
          if (allowed.indexOf(k) > -1) { sets.push(k + "=?"); vals.push(fields[k] === undefined ? "" : fields[k]); }
        });
        if (sets.length === 0) return { ok: true, affectedRowCount: 0 };
        sets.push("updated_at=?"); vals.push(new Date().toISOString()); vals.push(id);
        var r = await execTurso("UPDATE vouchers SET " + sets.join(",") + " WHERE id=?", vals);
        if (!r.ok) return { ok: false, error: "更新失败" };
        return { ok: true, affectedRowCount: 1 };
      } },
      "levels.increment": { auth: "user", owner: 0, run: async function (p) {
        var columnMap = { exp: "exp", streak: "streak_days", totalVouchers: "total_vouchers", basicTickets: "basic_tickets", rareTickets: "rare_tickets" };
        var column = columnMap[String(p[1] || "")];
        if (!column) return { ok: false, error: "非法字段" };
        var delta = Number(p[2] || 0) || 0;
        var now = new Date().toISOString();
        var r = await execTurso("INSERT INTO user_levels (user_id, " + column + ", updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET " + column + " = COALESCE(user_levels." + column + ",0) + ?, updated_at=?", [String(p[0] || ""), delta, now, delta, now]);
        if (!r.ok) return { ok: false, error: "更新失败" };
        return { ok: true };
      } },
      "reg.verify_password": { auth: "public", run: async function (p) {
        var username = String(p[0] || "");
        var hash = String(p[1] || "");
        var q = await execTurso("SELECT password_hash, full_name FROM registrations WHERE username=? AND review_status='approved' LIMIT 1", [username]);
        var inner = q.data?.results?.[0]?.response?.result || q.data?.results?.[0]?.response?.results || q.data?.results?.[0];
        var rows = (inner && inner.rows) ? inner.rows : [];
        if (!rows.length) return { ok: true, valid: false, reason: "not_found" };
        var stored = String(rows[0][0] && typeof rows[0][0] === "object" ? rows[0][0].value : rows[0][0]);
        var fullName = String(rows[0][1] && typeof rows[0][1] === "object" ? rows[0][1].value : rows[0][1] || "");
        if (stored === hash) return { ok: true, valid: true, fullName: fullName };
        if (stored.indexOf("sha256$") !== 0 && stored === String(p[2] || "")) {
          // 历史明文数据：验证通过后就地升级为哈希
          try { await execTurso("UPDATE registrations SET password_hash=? WHERE username=? AND review_status='approved'", [hash, username]); } catch (e) {}
          return { ok: true, valid: true, fullName: fullName };
        }
        return { ok: true, valid: false, reason: "wrong_password" };
      } },
      "tickets.grant": { auth: "user", run: async function (p, sess) {
        var isAdmin = sess.role === "admin";
        var userId = String(p[0] || "");
        if (!isAdmin && sess.username !== userId) return { ok: false, error: "无权为他人发放抽奖券" };
        var count = parseInt(p[1], 10) || 1;
        var type = String(p[2] || "basic");
        var source = String(p[3] || "system");
        var now = new Date().toISOString();
        var expire = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
        if (!isAdmin) {
          if (source === "daily_login") {
            var c1 = await dbCount("SELECT COUNT(*) AS cnt FROM lottery_tickets WHERE user_id=? AND source='daily_login' AND created_at >= ?", [userId, now.slice(0, 10)]);
            if (c1 > 0) return { ok: true, granted: 0, reason: "今日抽奖券已发放" };
            count = Math.min(Math.max(count, 1), 3);
          } else if (source === "migrate") {
            var c2 = await dbCount("SELECT COUNT(*) AS cnt FROM lottery_tickets WHERE user_id=?", [userId]);
            if (c2 > 0) return { ok: true, granted: 0 };
            count = Math.min(Math.max(count, 1), 50);
          } else {
            return { ok: false, error: "无权发放抽奖券" };
          }
        } else {
          count = Math.min(Math.max(count, 1), 100);
        }
        for (var i = 0; i < count; i++) {
          var tid = "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + "_" + i;
          await execTurso("INSERT INTO lottery_tickets (id, user_id, ticket_type, source, status, expires_at, created_at) VALUES (?,?,?,?,'unused',?,?)", [tid, userId, type, source, expire, now]);
        }
        return { ok: true, granted: count };
      } }
    };

    async function dbCount(sql, params) {
      const q = await execTurso(sql, params);
      const inner = q.data?.results?.[0]?.response?.result || q.data?.results?.[0]?.response?.results || q.data?.results?.[0];
      const rows = (inner && inner.rows) ? inner.rows : [];
      if (!rows.length) return 0;
      const v = rows[0][0];
      return parseInt(String(v && typeof v === "object" ? v.value : v), 10) || 0;
    }

    async function dbVoucherOwner(id) {
      const q = await execTurso("SELECT user_id FROM vouchers WHERE id=?", [String(id)]);
      const inner = q.data?.results?.[0]?.response?.result || q.data?.results?.[0]?.response?.results || q.data?.results?.[0];
      const rows = (inner && inner.rows) ? inner.rows : [];
      if (!rows.length) return null;
      const v = rows[0][0];
      return String(v && typeof v === "object" ? v.value : v);
    }

    // ========== 具名数据库接口（客户端只传 op 名，不接触 SQL） ==========
    if (path === "/db" && req.method === "POST") {
      const body = await req.json();
      const opName = String(body.op || "");
      const params = Array.isArray(body.params) ? body.params : [];
      const def = DB_OPS[opName];
      if (!def) return jsonResponse({ error: "未知操作" }, 400);
      if (params.length > 40) return jsonResponse({ error: "参数过多" }, 400);
      for (let pi = 0; pi < params.length; pi++) {
        const pv = params[pi] === undefined ? "" : params[pi];
        if (String(pv).length > 500000) return jsonResponse({ error: "参数过大" }, 413);
      }
      let sess = { username: "", role: "anon" };
      if (def.auth !== "public") {
        const s = await requireSession();
        if (s.error) {
          logAudit("DB_UNAUTHORIZED", opName, "", "", s.error, "/db", "", "blocked");
          return jsonResponse({ error: "未登录或会话已失效，请重新登录" }, 401);
        }
        sess = s;
        if (def.auth === "admin" && s.role !== "admin") {
          logAudit("DB_FORBIDDEN", s.username, "", "", "非管理员调用 " + opName, "/db", "", "blocked");
          return jsonResponse({ error: "无权执行该操作" }, 403);
        }
      } else if (def.optionalAuth) {
        // 匿名留言板等场景：有会话按会话身份，无会话按匿名通道身份
        const s = await requireSession();
        if (!s.error) sess = s;
      }
      if (sess.role === "anon" && def.anonRewrite) {
        Object.keys(def.anonRewrite).forEach(function (k) { params[Number(k)] = def.anonRewrite[k]; });
      }
      if (sess.role !== "admin" && def.forceSenderForUser) {
        params[2] = "user";
      }
      if (sess.role !== "admin") {
        if (def.owner !== undefined) {
          const ownerVal = String(params[def.owner] === undefined ? "" : params[def.owner]);
          const anonOk = sess.role === "anon" && ownerVal === "匿名";
          if (!anonOk && ownerVal !== String(sess.username)) {
            logAudit("DB_FORBIDDEN_OWNER", sess.username, "", "", "越权访问 " + opName, "/db", "", "blocked");
            return jsonResponse({ error: "无权访问他人数据" }, 403);
          }
        }
        if (def.voucher !== undefined) {
          const vIdx = def.voucher === -1 ? params.length - 1 : def.voucher;
          const owner = await dbVoucherOwner(params[vIdx]);
          if (owner === null || owner !== String(sess.username)) {
            logAudit("DB_FORBIDDEN_VOUCHER", sess.username, "vouchers", String(params[vIdx] || ""), "越权操作凭证 " + opName, "/db", "", "blocked");
            return jsonResponse({ error: "无权操作该凭证" }, 403);
          }
        }
      }
      try {
        if (typeof def.run === "function") {
          const out = await def.run(params, sess);
          return jsonResponse(out || { ok: true });
        }
        try { assertSqlSafe(def.sql); } catch (e) {
          return jsonResponse({ error: "操作定义异常: " + e.message }, 500);
        }
        const { ok: tursoOk, status: tursoStatus, data } = await execTurso(def.sql, params);
        if (!tursoOk) throw new Error("数据库返回异常 HTTP " + tursoStatus);
        const result = data.results?.[0];
        if (!result) throw new Error("数据库返回空结果");
        if (result.type === "error") throw new Error(result.error?.message || "数据库执行错误");
        const inner = result.response?.result || result.response?.results || result;
        if (/^\s*SELECT\b/i.test(def.sql)) {
          const { columns, rows } = unwrapTurso(inner.cols || inner.columns, inner.rows);
          if (Array.isArray(def.strip) && def.strip.length) {
            const keep = [];
            const keepIdx = [];
            columns.forEach(function (c, ci) {
              if (def.strip.indexOf(c) === -1) { keep.push(c); keepIdx.push(ci); }
            });
            const masked = rows.map(function (r) { return keepIdx.map(function (ci) { return r[ci]; }); });
            return jsonResponse({ ok: true, columns: keep, rows: masked, rowCount: masked.length });
          }
          return jsonResponse({ ok: true, columns: columns, rows: rows, rowCount: rows.length });
        }
        return jsonResponse({ ok: true, affectedRowCount: inner.rows_affected ?? inner.row_count ?? inner.rows_written ?? 0 });
      } catch (e) {
        logAudit("DB_ERROR", opName, "", "", String(e && e.message || e).slice(0, 200), "/db", "", "fail");
        return jsonResponse({ error: String(e && e.message || e) }, 400);
      }
    }

    // ========== SQL 透传（仅管理员后台使用） ==========
    if (path === "/sql" && req.method === "POST") {
      const body = await req.json();
      const { sql, params } = body;
      const op = String(body.operator || "anonymous").slice(0, 60);

      if (!sql) {
        return jsonResponse({ error: "缺少 sql 参数" }, 400);
      }

      // 鉴权：/sql 仅保留给管理员后台（普通用户所有读写已迁移到 /db 具名接口）
      const sqlSess = await requireSession();
      if (sqlSess.error) {
        logAudit("SQL_UNAUTHORIZED", op, "", "", sqlSess.error + " | " + String(sql).slice(0, 80), "/sql", "", "blocked");
        return jsonResponse({ error: "未登录或会话已失效，请重新登录" }, 401);
      }
      if (sqlSess.role !== "admin") {
        logAudit("SQL_FORBIDDEN", sqlSess.username, "", "", "非管理员调用通用 SQL：" + String(sql).slice(0, 80), "/sql", "", "blocked");
        return jsonResponse({ error: "通用 SQL 通道仅限管理员" }, 403);
      }

      // 安全校验：危险语句 / 多语句 / 全表修改 / 非法表名一律拒绝（拦截行为记日志）
      try {
        assertSqlSafe(sql);
      } catch (e) {
        logAudit("SQL_BLOCKED", op, "", "", e.message, "/sql", "", "blocked");
        return jsonResponse({ error: "SQL 安全校验失败: " + e.message }, 403);
      }

      const sqlKind = sql.trim().replace(/\s+/g, " ").substring(0, 100);
      const { ok: tursoOk, status: tursoStatus, data } = await execTurso(sql, params);

      if (!tursoOk) {
        logAudit("SQL_ERROR", op, "", "", "HTTP " + tursoStatus + " " + sqlKind, "/sql", "", "fail");
        throw new Error(`Turso HTTP ${tursoStatus}: ${JSON.stringify(data).substring(0, 300)}`);
      }
      logAudit("SQL_EXEC", op, "", "", sqlKind, "/sql", "", "ok");

      const result = data.results?.[0];
      if (!result) throw new Error("Turso 返回空结果");
      if (result.type === "error") throw new Error(result.error?.message || "Turso 执行错误");

      const isQuery = sql.trim().toUpperCase().startsWith("SELECT") ||
        sql.trim().toUpperCase().startsWith("PRAGMA");

      if (isQuery) {
        const inner = result.response?.result || result.response?.results || result;
        const { columns, rows } = unwrapTurso(inner.cols || inner.columns, inner.rows);
        return jsonResponse({
          ok: true,
          columns: columns,
          rows: rows,
          rowCount: rows.length
        });
      } else {
        const inner = result.response?.result || result.response?.results || result;
        return jsonResponse({
          ok: true,
          affectedRowCount: inner.rows_affected ?? inner.row_count ?? inner.rows_written ?? 0,
          lastInsertRowid: inner.last_insert_rowid || result.last_insert_rowid || null
        });
      }
    }

    // ========== 登录（发会话 token，密码哈希校验） ==========
    if (path === "/login" && req.method === "POST") {
      const body = await req.json();
      const { username, password, passwordHash, role } = body;
      if (!username || typeof username !== "string" || username.length > 50) {
        return jsonResponse({ error: "缺少合法 username" }, 400);
      }
      const isAdmin = String(role || "") === "admin";
      const nowIso = new Date().toISOString();
      const { ip, ua } = getClientInfo();

      // 人机验证（登录接口全量校验，管理员同样需要）
      const tsr = await verifyTurnstile(body.turnstileToken, ip);
      if (!tsr.ok) {
        logAudit("LOGIN_TURNSTILE_FAILED", username, "sessions", "", tsr.error || "人机验证失败", "/login", "", "fail");
        return jsonResponse({ error: tsr.error, turnstileFailed: true }, 403);
      }

      let valid = false;
      let dbUser = null;
      if (isAdmin) {
        // admin：前端 SHA-256(盐+密码) 后比对
        if (!passwordHash) return jsonResponse({ error: "缺少 passwordHash" }, 400);
        const q = await execTurso("SELECT id, password_hash FROM users WHERE id='admin' AND is_admin=1", []);
        const rows = q.data?.results?.[0]?.response?.result?.rows || q.data?.results?.[0]?.response?.results?.rows || [];
        if (rows.length > 0 && rows[0][1]?.value === passwordHash) valid = true;
        dbUser = { username: "admin", role: "admin" };
      } else {
        // 注册用户：密码哈希为唯一验证方式（不再兼容明文）
        if (!passwordHash || String(passwordHash).indexOf("sha256$") !== 0) {
          return jsonResponse({ error: "请使用安全密码登录" }, 400);
        }
        // 先用 username 查，找不到再用 email（oauth_id）查
        let q = await execTurso("SELECT username, password_hash FROM registrations WHERE username=? AND review_status='approved' LIMIT 1", [username]);
        let rows = q.data?.results?.[0]?.response?.result?.rows || q.data?.results?.[0]?.response?.results?.rows || [];
        if (rows.length === 0 && username.indexOf("@") > 0) {
          q = await execTurso("SELECT username, password_hash FROM registrations WHERE oauth_id=? AND review_status='approved' LIMIT 1", [username.toLowerCase()]);
          rows = q.data?.results?.[0]?.response?.result?.rows || q.data?.results?.[0]?.response?.results?.rows || [];
        }
        if (rows.length > 0) {
          const s = String(rows[0][1]?.value ?? "");
          if (s === String(passwordHash)) valid = true;
          dbUser = { username: rows[0][0]?.value || username, role: "user" };
        }
      }

      if (!valid) {
        logAudit("LOGIN_FAILED", username, "sessions", "", "登录失败（密码错误或用户不存在）", "/login", "", "fail");
        return jsonResponse({ error: "用户名或密码错误" }, 401);
      }

      // 生成会话（7 天有效）
      const token = "sess_" + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Date.now().toString(36) + Math.random().toString(36).slice(2, 18));
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      await execTurso("INSERT OR REPLACE INTO sessions (token, username, role, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?)",
        [token, dbUser.username, dbUser.role, nowIso, expiresAt, ip, ua]);

      // 检查是否有绑定邮箱（老用户可能没有）
      let emailOk = true;
      if (!isAdmin) {
        const eq = await execTurso("SELECT email FROM users WHERE id=? AND email IS NOT NULL AND email != '' LIMIT 1", [dbUser.username]);
        const erows = eq.data?.results?.[0]?.response?.result?.rows || eq.data?.results?.[0]?.response?.results?.rows || [];
        if (erows.length === 0) emailOk = false;
      }

      logAudit("LOGIN_SUCCESS", dbUser.username, "sessions", token, "登录成功（" + dbUser.role + "）" + (emailOk ? "" : " [需绑定邮箱]"), "/login", "", "ok");
      return jsonResponse({ ok: true, token, username: dbUser.username, role: dbUser.role, expiresAt, emailBindingRequired: !emailOk });
    }

    // ========== 会话校验（供游戏引擎/社区代理调用） ==========
    if (path === "/session/validate" && req.method === "GET") {
      const sess = await requireSession();
      if (sess.error) return jsonResponse({ error: sess.error }, 401);
      return jsonResponse({ ok: true, username: sess.username, role: sess.role });
    }

    // ========== 邮箱状态检查（已登录用户） ==========
    if (path === "/session/email-check" && req.method === "GET") {
      const username = new URL(req.url).searchParams.get("username");
      if (!username) return jsonResponse({ error: "缺少 username 参数" }, 400);
      const eq = await execTurso("SELECT email FROM users WHERE id=? AND email IS NOT NULL AND email != '' LIMIT 1", [username]);
      const erows = eq.data?.results?.[0]?.response?.result?.rows || eq.data?.results?.[0]?.response?.results?.rows || [];
      return jsonResponse({ hasEmail: erows.length > 0, email: erows.length > 0 ? (erows[0][0]?.value || "") : "" });
    }

    // ========== 会话校验（写资金操作强制） ==========
    async function requireSession() {
      const token = (req.headers.get("x-session-token") || "").trim();
      if (!token) return { error: "缺少登录会话，请先登录" };
      // 1) 标准会话
      const q = await execTurso("SELECT username, role, expires_at FROM sessions WHERE token=?", [token]);
      const rows = q.data?.results?.[0]?.response?.result?.rows || q.data?.results?.[0]?.response?.results?.rows || [];
      if (rows.length > 0) {
        const username = rows[0][0]?.value ?? rows[0][0];
        const role = rows[0][1]?.value ?? rows[0][1];
        const exp = rows[0][2]?.value ?? rows[0][2];
        if (exp && new Date(exp).getTime() < Date.now()) return { error: "会话已过期，请重新登录" };
        return { username: String(username), role: String(role || "user"), token };
      }
      // 2) 兼容 OAuth token（oauth_tokens 未过期视为有效会话）
      const q2 = await execTurso("SELECT username, expires_at FROM oauth_tokens WHERE token=? LIMIT 1", [token]);
      const rows2 = q2.data?.results?.[0]?.response?.result?.rows || q2.data?.results?.[0]?.response?.results?.rows || [];
      if (rows2.length > 0) {
        const username = rows2[0][0]?.value ?? rows2[0][0];
        const expMs = Number(rows2[0][1]?.value ?? rows2[0][1] ?? 0);
        if (expMs > 0 && Date.now() >= expMs) return { error: "OAuth 会话已过期，请重新登录" };
        return { username: String(username), role: "user", token };
      }
      return { error: "会话无效，请重新登录" };
    }

    // ========== 资金操作限流（60 秒内同操作人最多 15 次） ==========
    async function rateLimitPoints(operator) {
      try {
        const q = await execTurso(
          "SELECT COUNT(*) AS c FROM audit_logs WHERE action='POINTS_CHANGE' AND operator=? AND created_at > ?",
          [operator, new Date(Date.now() - 60000).toISOString()]);
        const rows = q.data?.results?.[0]?.response?.result?.rows || q.data?.results?.[0]?.response?.results?.rows || [];
        const c = rows.length > 0 ? Number(rows[0][0]?.value ?? rows[0][0] ?? 0) : 0;
        if (c >= 15) {
          logAudit("RATE_LIMIT", operator, "", "", "60 秒内积分操作超频被限流", "/points", "", "blocked");
          return true;
        }
      } catch (e) {}
      return false;
    }

    // ========== 积分操作（业务动作映射） ==========
    // 前端只传业务动作名称，积分多少、规则全部由中转层决定，杜绝前端篡改
    // ========== 抽奖开奖（服务端唯一可信源） ==========
    // 折扣、最终价、积分全部由服务端抽取并落库；客户端只负责播放动画。
    if (path === "/lottery/draw" && req.method === "POST") {
      const body = await req.json();
      const { userId, voucherId, poolType } = body || {};

      const drawSess = await requireSession();
      if (drawSess.error) return jsonResponse({ error: "未登录或会话已失效，请重新登录" }, 401);
      if (drawSess.username !== userId && drawSess.role !== "admin") {
        return jsonResponse({ error: "无权执行该操作" }, 403);
      }
      if (!voucherId) return jsonResponse({ error: "缺少凭证ID" }, 400);

      try { await execTurso("CREATE TABLE IF NOT EXISTS lottery_draws (id TEXT PRIMARY KEY, user_id TEXT, voucher_id TEXT UNIQUE, discount TEXT, value TEXT, points INTEGER, created_at TEXT)", []); } catch (e) {}

      const vq = await execTurso("SELECT user_id, amount, discount FROM vouchers WHERE id=?", [String(voucherId)]);
      const vr = vq.data.results?.[0]?.response?.result || vq.data.results?.[0]?.response?.results || vq.data.results?.[0];
      const vrows = (vr && vr.rows) ? vr.rows : [];
      if (vrows.length === 0) return jsonResponse({ error: "凭证不存在" }, 404);
      const vOwner = vrows[0][0]?.value ?? vrows[0][0];
      if (String(vOwner) !== String(userId) && drawSess.role !== "admin") {
        return jsonResponse({ error: "无权操作该凭证" }, 403);
      }

      const dq = await execTurso("SELECT discount FROM lottery_draws WHERE voucher_id=?", [String(voucherId)]);
      const dr = dq.data.results?.[0]?.response?.result || dq.data.results?.[0]?.response?.results || dq.data.results?.[0];
      if (dr && dr.rows && dr.rows.length > 0) {
        return jsonResponse({ error: "该凭证已抽过奖，不能重复抽取" }, 400);
      }

      // 与服务端奖池一致：7折~14折
      const SCRATCH_POOL = [
        { discount: "7折",   value: 0.7,  weight: 5 },
        { discount: "8折",   value: 0.8,  weight: 5 },
        { discount: "9折",   value: 0.9,  weight: 10 },
        { discount: "9.5折", value: 0.95, weight: 15 },
        { discount: "10折",  value: 1.0,  weight: 25 },
        { discount: "11折",  value: 1.1,  weight: 15 },
        { discount: "12折",  value: 1.2,  weight: 10 },
        { discount: "13折",  value: 1.3,  weight: 10 },
        { discount: "14折",  value: 1.4,  weight: 5 }
      ];
      const totalWeight = SCRATCH_POOL.reduce(function(s, x) { return s + x.weight; }, 0);
      const rbuf = new Uint32Array(1);
      crypto.getRandomValues(rbuf);
      let roll = rbuf[0] % totalWeight;
      let picked = SCRATCH_POOL[SCRATCH_POOL.length - 1];
      for (let i = 0; i < SCRATCH_POOL.length; i++) {
        if (roll < SCRATCH_POOL[i].weight) { picked = SCRATCH_POOL[i]; break; }
        roll -= SCRATCH_POOL[i].weight;
      }

      const amountNum = parseFloat(vrows[0][1]?.value ?? vrows[0][1] ?? 0) || 0;
      const finalPrice = (amountNum * picked.value).toFixed(2) + "元";
      const pointsAward = picked.value <= 0.95 ? 50 : 60;
      const now = new Date().toISOString();
      const drawId = "ldraw_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const bizNo = "lottery_" + String(voucherId);
      const lid = "ld_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const mkArg = (v) => ({ type: "text", value: String(v) });
      const requests = [
        { type: "execute", stmt: { sql: "INSERT OR IGNORE INTO lottery_draws (id,user_id,voucher_id,discount,value,points,created_at) VALUES (?,?,?,?,?,?,?)", args: [drawId, userId, String(voucherId), picked.discount, String(picked.value), pointsAward, now].map(mkArg) } },
        { type: "execute", stmt: { sql: "UPDATE vouchers SET discount=?, final_price=?, updated_at=? WHERE id=? AND user_id=?", args: [picked.discount, finalPrice, now, String(voucherId), userId].map(mkArg) } },
        { type: "execute", stmt: { sql: "INSERT INTO ledger (id,biz_no,user_id,amount,balance_after,reason,ref_id,operator,created_at) SELECT ?,?,?,?,(SELECT COALESCE(points,0) FROM users WHERE id=?)+?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)", args: [lid, bizNo, userId, pointsAward, userId, pointsAward, "抽到 " + picked.discount + " 奖励", "lottery", "engine", now, bizNo].map(mkArg) } },
        { type: "execute", stmt: { sql: "UPDATE users SET points=MAX(0,(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE user_id=?)), updated_at=? WHERE id=?", args: [userId, now, userId].map(mkArg) } },
        { type: "execute", stmt: { sql: "SELECT COALESCE(points,0) FROM users WHERE id=?", args: [userId].map(mkArg) } }
      ];
      const lres = await fetch(TURSO_API, { method: "POST", headers: { Authorization: "Bearer " + TURSO_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ requests }) });
      const ldata = await lres.json().catch(function() { return {}; });
      if (!lres.ok) throw new Error("开奖落库失败");
      let balance = null;
      try {
        const br = (ldata.results || [])[4]?.response?.result || (ldata.results || [])[4]?.response?.results || (ldata.results || [])[4];
        if (br && br.rows) balance = br.rows[0]?.[0]?.value ?? br.rows[0]?.[0];
      } catch (e) {}
      logAudit("LOTTERY_DRAW", userId, "vouchers", String(voucherId), "服务端开奖 " + picked.discount + "，奖励 " + pointsAward + " 积分", "/lottery/draw", bizNo, "ok");
      return jsonResponse({
        ok: true,
        discount: picked.discount,
        value: picked.value,
        finalPrice: finalPrice,
        points: pointsAward,
        balance: balance,
        poolType: String(poolType || "scratch")
      });
    }

    // ========== 积分业务动作（规则由服务端决定） ==========
    if (path === "/points/action" && req.method === "POST") {
      const body = await req.json();
      const { action, userId, params } = body;
      if (!action || !userId) return jsonResponse({ error: "缺少 action 或 userId" }, 400);

      // 鉴权：所有积分动作必须登录，且只能作用于本人（管理员可代操作）
      const actSess = await requireSession();
      if (actSess.error) {
        return jsonResponse({ error: "未登录或会话已失效，请重新登录" }, 401);
      }
      if (actSess.username !== userId && actSess.role !== "admin") {
        logAudit("POINTS_ACTION_FORBIDDEN", actSess.username, "users", String(userId), "越权执行积分动作: " + String(action), "/points/action", "", "blocked");
        return jsonResponse({ error: "无权执行该操作" }, 403);
      }

      const p = params || {};

      // ======== 服务端可信随机与统计（客户端不得参与金额计算） ========
      const _cryptoRand = function(n) {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        return buf[0] % n;
      };
      const _rowsOf = function(q) {
        const r = q && q.data && q.data.results && q.data.results[0]
          ? (q.data.results[0].response?.result || q.data.results[0].response?.results || q.data.results[0])
          : null;
        return (r && r.rows) ? r.rows : [];
      };
      const _cell = function(row, i) {
        if (!row) return undefined;
        return row[i] && typeof row[i] === "object" ? (row[i].value ?? row[i]) : row[i];
      };
      // 中国时区当天 0 点
      const _dayStartIso = function() {
        const nowMs = Date.now();
        const cnMidnight = nowMs - ((nowMs + 8 * 3600 * 1000) % (24 * 3600 * 1000));
        return new Date(cnMidnight).toISOString();
      };
      const _ledgerCountToday = async function(uid, act) {
        const q = await execTurso(
          "SELECT COUNT(*) FROM ledger WHERE user_id=? AND biz_no LIKE ? AND created_at>=?",
          [uid, "biz_" + uid + "_" + act + "_%", _dayStartIso()]
        );
        const rows = _rowsOf(q);
        return rows.length ? Number(_cell(rows[0], 0) || 0) : 0;
      };
      const _pointsOf = async function(uid) {
        const q = await execTurso("SELECT COALESCE(points,0) FROM users WHERE id=?", [uid]);
        const rows = _rowsOf(q);
        return rows.length ? Number(_cell(rows[0], 0) || 0) : 0;
      };
      // 必须与 js/wheel.js 的 SEGMENTS 顺序完全一致
      const WHEEL_SEGMENTS = [
        { label: "+10", delta: 10 },
        { label: "-10", delta: -10 },
        { label: "+20", delta: 20 },
        { label: "-20", delta: -20 },
        { label: "+30", delta: 30 },
        { label: "+40", delta: 40 },
        { label: "+50", delta: 50 }
      ];

      // ======== 积分规则表（唯一可信源） ========
      const R = {
        // 每日任务（服务端限次）
        daily_task_add_voucher:      { delta: 15,  reason: "完成每日「添加凭证」任务", dailyLimit: 1 },
        daily_task_3_draws:          { delta: 30,  reason: "完成每日「完成3次抽奖」任务", dailyLimit: 1 },
        // 连续打卡
        checkin_streak:              { delta: 10,  reason: () => "连续打卡" + (p.streak || 0) + "天奖励", dailyLimit: 1 },
        // 消费达人
        spending_master:             { delta: 100, reason: "完成「消费达人」任务（月消费≥¥5000）", dailyLimit: 1 },
        // 添加凭证
        add_voucher:                 { delta: 15,  reason: "添加凭证", dailyLimit: 20 },
        add_online_voucher:          { delta: 15,  reason: "添加线上购物凭证", dailyLimit: 20 },
        add_appliance_voucher:       { delta: 15,  reason: "添加电器补贴凭证", dailyLimit: 20 },
        // 凭证审核（只能由管理员触发，否则任何用户可反复给自己加 25 分）
        voucher_approved:            { delta: 25,  reason: "凭证审核通过", requireAdmin: true },
        // 连续N天添加凭证
        streak_bonus:                { delta: 30,  reason: () => "连续" + (p.streak || 0) + "天添加凭证奖励", dailyLimit: 1 },
        // 积分抵消（只会扣分，且扣分前有余额护栏）
        points_offset: {
          calc: function() {
            const yuan = Number(p.amountYuan || 0);
            if (!yuan || yuan <= 0) return null;
            const needed = Math.ceil(yuan * 10);
            if (needed > 100000) return null;
            return { delta: -needed, reason: "积分抵消¥" + yuan.toFixed(2) };
          }
        },
        points_offset_payment: {
          calc: function() {
            const pts = Number(p.maxPoints || 0);
            if (!pts || pts <= 0) return null;
            return { delta: -pts, reason: "用积分抵消 ¥" + (pts / 10).toFixed(2) + " 支付差额" };
          }
        },
        // 幸运抽奖兑换
        lucky_lottery_exchange:      { delta: -45, reason: "兑换幸运抽奖1次" },
        // 转盘：结果由服务端抽取，客户端传什么金额都不生效
        wheel_free_reward: {
          dailyLimit: 1,
          calc: async function() {
            const idx = _cryptoRand(WHEEL_SEGMENTS.length);
            const seg = WHEEL_SEGMENTS[idx];
            const delta = seg.delta > 0 ? seg.delta : 0; // 免费抽不扣分
            return { delta: delta, reason: "转盘免费抽奖 " + seg.label, extra: { prizeIndex: idx, prizeLabel: seg.label } };
          }
        },
        wheel_reward: {
          calc: async function() {
            const cost = 10;
            const bal = await _pointsOf(userId);
            if (bal < cost) return { error: "积分不足，转盘需要 " + cost + " 积分" };
            const idx = _cryptoRand(WHEEL_SEGMENTS.length);
            const seg = WHEEL_SEGMENTS[idx];
            return {
              delta: seg.delta - cost,
              reason: "转盘抽奖 " + seg.label + "（消耗" + cost + "积分）",
              extra: { prizeIndex: idx, prizeLabel: seg.label, cost: cost }
            };
          }
        },
        // 抽奖折扣/完整奖励：改由 /lottery/draw 服务端开奖并结算，这里一律拒绝
        lottery_discount_reward: {
          calc: function() { return { error: "抽奖已改为服务端开奖，请刷新页面后重试" }; }
        },
        lottery_full_reward: {
          calc: function() { return { error: "抽奖已改为服务端开奖，请刷新页面后重试" }; }
        },
        // 装扮：只能是扣分，且服务端限制上限
        unlock_outfit: {
          calc: function() {
            const cost = Number(p.cost || 0);
            if (!cost || cost <= 0 || cost > 1000) return null;
            return { delta: -cost, reason: "解锁装扮: " + String(p.outfitId || "unknown").slice(0, 30) };
          }
        },
        // 邀请好友（前端未使用，仅管理员可补发）
        invite_reward:               { delta: 50,  reason: "邀请好友奖励", requireAdmin: true },
        // 管理员调整（必须管理员会话）
        admin_adjust: {
          requireAdmin: true,
          calc: function() {
            const d = Number(p.delta || 0);
            if (!d || Math.abs(d) > 1000000) return null;
            return { delta: d, reason: String(p.reason || "管理员调整积分").slice(0, 200) };
          }
        },
      };

      const rule = R[action];
      if (!rule) return jsonResponse({ error: "未知的业务动作: " + action }, 400);

      // 管理员动作必须验证会话
      if (rule.requireAdmin) {
        const sess = await requireSession();
        if (sess.error || sess.role !== "admin") {
          logAudit("POINTS_ACTION_UNAUTHORIZED", String(sess.username || "anonymous"), "users", String(userId), "非管理员尝试执行管理动作: " + action, "/points/action", "", "blocked");
          return jsonResponse({ error: "无权操作" }, 403);
        }
      }

      // 每日限次（按 ledger 流水统计，不信任前端）
      if (rule.dailyLimit) {
        const usedToday = await _ledgerCountToday(userId, action);
        if (usedToday >= rule.dailyLimit) {
          return jsonResponse({ error: "今日该操作次数已用完" }, 429);
        }
      }

      // 计算 delta 和 reason（calc 允许异步，金额由服务端决定）
      let result;
      if (typeof rule.calc === "function") {
        result = await rule.calc();
        if (!result) return jsonResponse({ error: "参数无效" }, 400);
        if (result.error) return jsonResponse({ error: result.error }, 400);
      } else {
        const reason = typeof rule.reason === "function" ? rule.reason() : rule.reason;
        result = { delta: rule.delta, reason: reason };
      }
      if (!result || Math.abs(result.delta) > 100000000) return jsonResponse({ error: "变动金额超限" }, 400);

      // 复用积分账务逻辑（幂等入账）
      const bizNo = "biz_" + userId + "_" + action + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 5);
      const now = new Date().toISOString();
      const lid = "ld_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const mkArg = (v) => ({ type: "text", value: String(v) });
      const requests = [
        { type: "execute", stmt: { sql: "INSERT INTO ledger (id, biz_no, user_id, amount, balance_after, reason, ref_id, operator, created_at) SELECT ?,?,?,?,(SELECT COALESCE(points,0) FROM users WHERE id=?)+?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)", args: [lid, bizNo, userId, result.delta, userId, result.delta, result.reason, action, "engine", now, bizNo].map(mkArg) } },
        { type: "execute", stmt: { sql: "UPDATE users SET points=MAX(0,(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE user_id=?)), updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)", args: [userId, now, userId, bizNo].map(mkArg) } },
        { type: "execute", stmt: { sql: "SELECT COALESCE(points,0) AS p FROM users WHERE id=?", args: [userId].map(mkArg) } }
      ];
      const tres = await fetch(TURSO_API, { method:"POST", headers:{ Authorization:"Bearer "+TURSO_TOKEN, "Content-Type":"application/json" }, body:JSON.stringify({ requests }) });
      const td = await tres.json();
      if (!tres.ok) throw new Error("账务执行失败: " + JSON.stringify(td).substring(0,300));
      const first = (td.results||[])[0]?.response?.result || (td.results||[])[0]?.response?.results || (td.results||[])[0];
      const inserted = (first ? (first.rows_affected ?? first.row_count ?? first.rows_written ?? 0) : 0) > 0;
      let balance = null;
      try { const br = (td.results||[])[2]?.response?.result || (td.results||[])[2]?.response?.results || (td.results||[])[2]; if (br&&br.rows) balance = br.rows[0]?.[0]?.value ?? br.rows[0]?.[0]; } catch(e){}
      logAudit("POINTS_ACTION", "engine", "users", userId, action + " → " + (result.delta>0?"+":"")+result.delta+" 积分", "/points/action", bizNo, inserted?"ok":"dup");
      return jsonResponse(Object.assign({ ok: true, inserted, balance, bizNo, delta: result.delta, reason: result.reason }, result.extra || {}));
    }

    // ========== 积分操作（直接入账，兼容旧版） ==========
    // 所有余额变动必须走这里：先落 ledger 流水（biz_no 幂等），再更新 users.points。
    // 同一 bizNo 重复提交只生效一次，防止重复扣款/加款。
    if (path === "/points" && req.method === "POST") {
      const body = await req.json();
      const { bizNo, userId, delta, reason, refId, operator } = body;

      // 会话校验：必须登录；普通用户只能操作自己的积分
      const sess = await requireSession();
      if (sess.error) {
        logAudit("POINTS_NO_SESSION", String(operator || "anonymous"), "users", String(userId || ""), sess.error, "/points", String(bizNo || ""), "blocked");
        return jsonResponse({ error: "未登录或会话已失效，请重新登录" }, 401);
      }
      const isAdminSession = sess.role === "admin";
      if (sess.username !== userId && !isAdminSession) {
        logAudit("POINTS_FORBIDDEN", sess.username, "users", String(userId || ""), "越权操作他人积分", "/points", String(bizNo || ""), "blocked");
        return jsonResponse({ error: "无权操作他人积分" }, 403);
      }
      const sessionOperator = isAdminSession ? "admin" : sess.username;
      if (await rateLimitPoints(sessionOperator)) {
        return jsonResponse({ error: "操作过于频繁，请稍后再试" }, 429);
      }

      if (!bizNo || typeof bizNo !== "string" || bizNo.length > 64) {
        return jsonResponse({ error: "缺少合法幂等单号 bizNo" }, 400);
      }
      if (!userId || typeof userId !== "string" || userId.length > 50) {
        return jsonResponse({ error: "缺少合法 userId" }, 400);
      }
      const why = String(reason || "").slice(0, 200);
      const amt = Math.round(Number(delta || 0));
      // 免费转盘抽到负数扇区时按 0 结算，但仍然要留一条流水用于每日次数统计
      const zeroAllowed = amt === 0 && why.indexOf("免费抽奖") !== -1;
      if ((!amt || !isFinite(amt)) && !zeroAllowed) return jsonResponse({ error: "变动金额必须为非零数字" }, 400);
      if (Math.abs(amt) > 100000000) return jsonResponse({ error: "单笔变动金额超限" }, 400);
      const ref = String(refId || "").slice(0, 100);
      const op = String(sessionOperator || operator || "system").slice(0, 50);
      const now = new Date().toISOString();
      const lid = "ld_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

      // 原子 pipeline（Turso 在同一事务执行全部语句）：
      // 1) 幂等插入流水（biz_no 唯一，已存在则跳过）
      // 2) 余额 = 该用户流水 SUM（原则：流水唯一可信源，余额为派生视图；重放时流水不增→余额不变）
      // 3) 读取最新余额返回
      const mkArg = (v) => ({ type: "text", value: String(v) });
      const requests = [
        {
          type: "execute",
          stmt: {
            sql: "INSERT INTO ledger (id, biz_no, user_id, amount, balance_after, reason, ref_id, operator, created_at) SELECT ?, ?, ?, ?, (SELECT COALESCE(points,0) FROM users WHERE id=?) + ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)",
            args: [lid, bizNo, userId, amt, userId, amt, why, ref, op, now, bizNo].map(mkArg)
          }
        },
        {
          type: "execute",
          stmt: {
            sql: "UPDATE users SET points = MAX(0,(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE user_id=?)), updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)",
            args: [userId, now, userId, bizNo].map(mkArg)
          }
        },
        {
          type: "execute",
          stmt: {
            sql: "SELECT COALESCE(points,0) AS p FROM users WHERE id=?",
            args: [userId].map(mkArg)
          }
        }
      ];

      const tursoRes = await fetch(TURSO_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });
      const pData = await tursoRes.json();
      if (!tursoRes.ok) {
        throw new Error("账务执行失败: " + JSON.stringify(pData).substring(0, 300));
      }
      const pResults = pData.results || [];
      const first = pResults[0]?.response?.result || pResults[0]?.response?.results || pResults[0];
      const insertedRows = first ? (first.rows_affected ?? first.row_count ?? first.rows_written ?? 0) : 0;
      const inserted = insertedRows > 0;
      // 余额
      let balance = null;
      try {
        const balRes = pResults[2]?.response?.result || pResults[2]?.response?.results || pResults[2];
        if (balRes && balRes.rows) balance = balRes.rows[0]?.[0]?.value ?? balRes.rows[0]?.[0];
      } catch (e) {}
      logAudit("POINTS_CHANGE", op, "users", userId, (amt > 0 ? "+" : "") + amt + " 积分： " + why, "/points", bizNo, inserted ? "ok" : "dup");
      return jsonResponse({ ok: true, inserted, balance, bizNo });
    }

    // ========== 余额查询（只能查自己，越权拒绝并记日志） ==========
    if (path === "/balance" && req.method === "POST") {
      const body = await req.json();
      const { userId, viewer } = body;
      if (!userId || typeof userId !== "string" || userId.length > 50) {
        return jsonResponse({ error: "缺少合法 userId" }, 400);
      }
      // 强制会话校验
      const sess = await requireSession();
      if (sess.error) {
        logAudit("BALANCE_NO_SESSION", String(viewer || "anonymous"), "users", userId, sess.error, "/balance", "", "blocked");
        return jsonResponse({ error: sess.error }, 403);
      }
      const isAdminSession = sess.role === "admin";
      if (!isAdminSession && (sess.username !== userId || String(viewer) !== String(userId))) {
        logAudit("BALANCE_QUERY_BLOCKED", sess.username, "users", userId, "越权查询他人余额被拒绝", "/balance", "", "blocked");
        return jsonResponse({ error: "禁止查询他人余额" }, 403);
      }
      const q = await execTurso("SELECT MAX(0,COALESCE(points,0)) AS p FROM users WHERE id=?", [userId]);
      let points = null;
      try {
        const inner = q.data.results?.[0]?.response?.result || q.data.results?.[0]?.response?.results || q.data;
        if (inner && inner.rows) points = inner.rows[0]?.[0]?.value ?? inner.rows[0]?.[0];
      } catch (e) {}
      logAudit("BALANCE_QUERY", String(viewer || "anonymous"), "users", userId, "查询自身余额", "/balance", "", "ok");
      return jsonResponse({ ok: true, points });
    }

    // ========== 显式审计日志端点（业务自定义动作） ==========
    if (path === "/audit" && req.method === "POST") {
      const body = await req.json();
      const { action, operator, targetType, targetId, detail, bizNo } = body;
      if (!action || typeof action !== "string") return jsonResponse({ error: "缺少 action" }, 400);
      logAudit(action, String(operator || "anonymous"), String(targetType || ""), String(targetId || ""), String(detail || ""), "/audit", String(bizNo || ""), "ok");
      return jsonResponse({ ok: true });
    }

    // ========== 批量建表 ==========
    if (path === "/init" && req.method === "POST") {
      // 已下线：任意 SQL 批量执行接口，等同 DROP DATABASE 公网入口
      return jsonResponse({ error: "接口已下线" }, 410);
    }

    // ========== 图片上传（GitHub API） ==========
    if (path === "/upload-image" && req.method === "POST") {
      const body = await req.json();
      const { base64Data, folder } = body;

      if (!base64Data) {
        return jsonResponse({ error: "缺少 base64Data" }, 400);
      }
      // 鉴权：上传必须登录，否则等于把仓库当公开图床
      const upSess = await requireSession();
      if (upSess.error) {
        return jsonResponse({ error: "未登录或会话已失效，请重新登录" }, 401);
      }

      const ts = Date.now();
      const rand = Math.random().toString(36).substring(2, 8);
      const fileName = `${ts}-${rand}.jpg`;
      const filePath = folder ? `${folder}/${fileName}` : fileName;
      const repo = "yuguo-yg-bit/yuguo-jingrong-JIT-images";

      const ghRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${Github_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "ValTown-JIT",
        },
        body: JSON.stringify({
          message: `Upload image ${folder || "system"}`,
          content: base64Data,
          branch: "main",
        }),
      });

      const ghResult = await ghRes.json();
      if (!ghRes.ok) {
        return jsonResponse({ error: "GitHub 上传失败", details: ghResult }, 500);
      }

      return jsonResponse({ ok: true, url: ghResult.content.download_url, path: filePath });
    }

    // ========== GitHub OAuth 登录入口 ==========
    if (path === "/oauth/github") {
      const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
      if (!clientId) return jsonResponse({ error: "GitHub OAuth 未配置，请设置 GITHUB_OAUTH_CLIENT_ID 环境变量" }, 500);
      const state = url.searchParams.get("state") || "default";
      const returnUrl = safeReturnUrl(url.searchParams.get("return_url") || ALLOW_ORIGINS[0]);
      const githubAuthUrl = "https://github.com/login/oauth/authorize?" +
        "client_id=" + encodeURIComponent(clientId) +
        "&redirect_uri=" + encodeURIComponent("https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run/oauth/github/callback") +
        "&scope=" + encodeURIComponent("user:email") +
        "&state=" + encodeURIComponent(state + "|" + returnUrl);
      return new Response(null, { status: 302, headers: { "Location": githubAuthUrl } });
    }

    // ========== GitHub OAuth 回调 ==========
    if (path === "/oauth/github/callback") {
      const code = url.searchParams.get("code");
      const fullState = url.searchParams.get("state") || "default|" + ALLOW_ORIGINS[0];
      const stateParts = fullState.split("|");
      const state = stateParts[0] || "default";
      const returnUrl = safeReturnUrl(stateParts.slice(1).join("|") || ALLOW_ORIGINS[0]);

      if (!code) {
        const redirectUrl = returnUrl + "/login?oauth_error=" + encodeURIComponent("授权被取消");
        return new Response(null, { status: 302, headers: { "Location": redirectUrl } });
      }

      try {
        const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
        const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

        // 1. 用 code 换取 access_token
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "ValTown-JIT" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: code })
        });
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) throw new Error("获取 GitHub access_token 失败: " + (tokenData.error_description || tokenData.error || JSON.stringify(tokenData)));

        // 2. 获取 GitHub 用户信息
        const userRes = await fetch("https://api.github.com/user", {
          headers: { "Authorization": "Bearer " + accessToken, "User-Agent": "ValTown-JIT" }
        });
        const githubUser = await userRes.json();
        if (!githubUser.id) throw new Error("获取 GitHub 用户信息失败: " + (githubUser.message || ""));

        // 3. 获取邮箱
        const emailRes = await fetch("https://api.github.com/user/emails", {
          headers: { "Authorization": "Bearer " + accessToken, "User-Agent": "ValTown-JIT" }
        });
        const emails = await emailRes.json();
        const primaryEmail = Array.isArray(emails)
          ? ((emails.find(function(e) { return e.primary; }) || emails[0] || {}).email || "")
          : "";

        const githubId = String(githubUser.id);
        const githubUsername = (githubUser.login || "").replace(/[^a-zA-Z0-9_\\-]/g, "").substring(0, 39);
        const githubName = githubUser.name || githubUsername || "";
        const githubAvatar = githubUser.avatar_url || "";

        if (!githubUsername) throw new Error("无法获取有效的 GitHub 用户名");

        // 4. 查找是否已有该 OAuth 用户
        const { data: lookupData } = await execTurso(
          "SELECT id, review_status FROM users WHERE oauth_provider='github' AND oauth_id=?",
          [githubId]
        );
        const lookupResult = lookupData.results?.[0];
        let existingUsername = "";
        let existingStatus = "";

        if (lookupResult && lookupResult.type !== "error") {
          const inner = lookupResult.response?.result || lookupResult.response?.results || {};
          const rows = inner.rows || [];
          if (rows.length > 0) {
            existingUsername = typeof rows[0][0] === "object" && "value" in rows[0][0] ? rows[0][0].value : rows[0][0];
            existingStatus = typeof rows[0][1] === "object" && "value" in rows[0][1] ? rows[0][1].value : rows[0][1];
          }
        }

        const now = new Date().toISOString();

        if (existingStatus === "approved") {
          // 已审核用户 → 生成 token 直接登录
          const token = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 15));
          const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          await execTurso(
            "INSERT INTO oauth_tokens (token, username, oauth_id, provider, created_at, expires_at) VALUES (?,?,?,?,?,?)",
            [token, existingUsername, githubId, "github", now, expiresAt]
          );
          const redirectUrl = returnUrl + "/login?oauth_token=" + encodeURIComponent(token) + "&state=" + encodeURIComponent(state);
          return new Response(null, { status: 302, headers: { "Location": redirectUrl } });
        } else if (existingStatus === "pending") {
          // 已有待审核记录
          const redirectUrl = returnUrl + "/login?oauth_pending=1&username=" + encodeURIComponent(existingUsername) + "&state=" + encodeURIComponent(state);
          return new Response(null, { status: 302, headers: { "Location": redirectUrl } });
        }

        // 5. 新用户 → 检查用户名是否被普通注册占用
        const { data: nameCheck } = await execTurso(
          "SELECT id FROM users WHERE id=?",
          [githubUsername]
        );
        const nameResult = nameCheck.results?.[0];
        let finalUsername = githubUsername;
        if (nameResult && nameResult.type !== "error") {
          const inner = nameResult.response?.result || nameResult.response?.results || {};
          if ((inner.rows || []).length > 0) {
            finalUsername = "gh_" + githubId.substring(0, 30);
          }
        }

        // 6. 创建注册申请
        const regId = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 15));
        await execTurso(
          "INSERT OR REPLACE INTO registrations (id, username, password_hash, full_name, birthdate, country, province, city, referrer, review_status, oauth_provider, oauth_id, oauth_email, oauth_avatar, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [regId, finalUsername, "", githubName, "", "", "", "", "", "pending", "github", githubId, primaryEmail, githubAvatar, now]
        );

        // 同时创建/更新 users 记录（pending 状态，即使已有同名用户也写入 OAuth 字段）
        await execTurso(
          "INSERT INTO users (id, password_hash, full_name, review_status, oauth_provider, oauth_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET oauth_provider=EXCLUDED.oauth_provider, oauth_id=EXCLUDED.oauth_id, updated_at=EXCLUDED.updated_at",
          [finalUsername, "", githubName, "pending", "github", githubId, now, now]
        );

        const redirectUrl = returnUrl + "/login?oauth_pending=1&username=" + encodeURIComponent(finalUsername) + "&state=" + encodeURIComponent(state);
        return new Response(null, { status: 302, headers: { "Location": redirectUrl } });

      } catch (e) {
        const redirectUrl = returnUrl + "/login?oauth_error=" + encodeURIComponent(e.message || "OAuth 处理失败");
        return new Response(null, { status: 302, headers: { "Location": redirectUrl } });
      }
    }

    // ========== Microsoft OAuth 登录入口 ==========
    if (path === "/oauth/microsoft") {
      const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
      if (!clientId) return jsonResponse({ error: "Microsoft OAuth 未配置，请设置 MICROSOFT_OAUTH_CLIENT_ID 环境变量" }, 500);
      const state = url.searchParams.get("state") || "default";
      const returnUrl = safeReturnUrl(url.searchParams.get("return_url") || ALLOW_ORIGINS[0]);
      const msAuthUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" +
        "client_id=" + encodeURIComponent(clientId) +
        "&response_type=code" +
        "&redirect_uri=" + encodeURIComponent("https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run/oauth/microsoft/callback") +
        "&scope=" + encodeURIComponent("openid profile email User.Read") +
        "&state=" + encodeURIComponent(state + "|" + returnUrl);
      return new Response(null, { status: 302, headers: { "Location": msAuthUrl } });
    }

    // ========== Microsoft OAuth 回调 ==========
    if (path === "/oauth/microsoft/callback") {
      const code = url.searchParams.get("code");
      const fullState = url.searchParams.get("state") || "default|" + ALLOW_ORIGINS[0];
      const stateParts = fullState.split("|");
      const state = stateParts[0] || "default";
      const returnUrl = safeReturnUrl(stateParts.slice(1).join("|") || ALLOW_ORIGINS[0]);

      if (!code) {
        const redirectUrl = returnUrl + "/login?oauth_error=" + encodeURIComponent("授权被取消");
        return new Response(null, { status: 302, headers: { "Location": redirectUrl } });
      }

      try {
        const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
        const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;

        // 1. 用 code 换取 access_token
        const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            redirect_uri: "https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run/oauth/microsoft/callback",
            grant_type: "authorization_code"
          }).toString()
        });
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) throw new Error("获取 Microsoft access_token 失败: " + (tokenData.error_description || tokenData.error || JSON.stringify(tokenData)));

        // 2. 获取 Microsoft 用户信息（Graph API）
        const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { "Authorization": "Bearer " + accessToken }
        });
        const msUser = await userRes.json();
        if (!msUser.id) throw new Error("获取 Microsoft 用户信息失败: " + (msUser.error?.message || JSON.stringify(msUser)));

        const msId = String(msUser.id);
        const msDisplayName = msUser.displayName || "";
        const msEmail = msUser.mail || msUser.userPrincipalName || "";
        const msUsernameBase = msEmail ? msEmail.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").substring(0, 30) : ("ms_" + msId.replace(/-/g, "").substring(0, 25));

        if (!msUsernameBase) throw new Error("无法获取有效的 Microsoft 用户名");

        // 3. 查找是否已有该 OAuth 用户
        const { data: lookupData } = await execTurso(
          "SELECT id, review_status FROM users WHERE oauth_provider='microsoft' AND oauth_id=?",
          [msId]
        );
        const lookupResult = lookupData.results?.[0];
        let existingUsername = "";
        let existingStatus = "";

        if (lookupResult && lookupResult.type !== "error") {
          const inner = lookupResult.response?.result || lookupResult.response?.results || {};
          const rows = inner.rows || [];
          if (rows.length > 0) {
            existingUsername = typeof rows[0][0] === "object" && "value" in rows[0][0] ? rows[0][0].value : rows[0][0];
            existingStatus = typeof rows[0][1] === "object" && "value" in rows[0][1] ? rows[0][1].value : rows[0][1];
          }
        }

        const now = new Date().toISOString();

        if (existingStatus === "approved") {
          const token = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 15));
          const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          await execTurso(
            "INSERT INTO oauth_tokens (token, username, oauth_id, provider, created_at, expires_at) VALUES (?,?,?,?,?,?)",
            [token, existingUsername, msId, "microsoft", now, expiresAt]
          );
          const redirectUrl = returnUrl + "/login?oauth_token=" + encodeURIComponent(token) + "&state=" + encodeURIComponent(state);
          return new Response(null, { status: 302, headers: { "Location": redirectUrl } });
        } else if (existingStatus === "pending") {
          const redirectUrl = returnUrl + "/login?oauth_pending=1&username=" + encodeURIComponent(existingUsername) + "&state=" + encodeURIComponent(state);
          return new Response(null, { status: 302, headers: { "Location": redirectUrl } });
        }

        // 4. 新用户 → 检查用户名是否被占用
        const { data: nameCheck } = await execTurso(
          "SELECT id FROM users WHERE id=?",
          [msUsernameBase]
        );
        const nameResult = nameCheck.results?.[0];
        let finalUsername = msUsernameBase;
        if (nameResult && nameResult.type !== "error") {
          const inner = nameResult.response?.result || nameResult.response?.results || {};
          if ((inner.rows || []).length > 0) {
            finalUsername = "ms_" + msId.replace(/-/g, "").substring(0, 30);
          }
        }

        // 5. 创建注册申请
        const regId = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 15));
        await execTurso(
          "INSERT OR REPLACE INTO registrations (id, username, password_hash, full_name, birthdate, country, province, city, referrer, review_status, oauth_provider, oauth_id, oauth_email, oauth_avatar, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [regId, finalUsername, "", msDisplayName, "", "", "", "", "", "pending", "microsoft", msId, msEmail, "", now]
        );

        await execTurso(
          "INSERT INTO users (id, password_hash, full_name, review_status, oauth_provider, oauth_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET oauth_provider=EXCLUDED.oauth_provider, oauth_id=EXCLUDED.oauth_id, updated_at=EXCLUDED.updated_at",
          [finalUsername, "", msDisplayName, "pending", "microsoft", msId, now, now]
        );

        const redirectUrl = returnUrl + "/login?oauth_pending=1&username=" + encodeURIComponent(finalUsername) + "&state=" + encodeURIComponent(state);
        return new Response(null, { status: 302, headers: { "Location": redirectUrl } });

      } catch (e) {
        const redirectUrl = returnUrl + "/login?oauth_error=" + encodeURIComponent(e.message || "Microsoft OAuth 处理失败");
        return new Response(null, { status: 302, headers: { "Location": redirectUrl } });
      }
    }

    // 检测 Microsoft 系列邮箱域名（Outlook/Hotmail/Live/MSN），Mailtrap 无法投递，需降级为手动模式
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

    // ========== 验证邮件模板 ==========
    const FORWARD_MAILBOX = "yuguoemail@yuconemail.cc.cd";
    const MAIL_FROM = { email: "hello@yuguojinrongemail.cc.cd", name: "玉国金融" };
    const mailShell = function(title, subtitle, inner) {
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
        '<body style="margin:0;padding:0;background:#f5f0e8;">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:36px 12px;">' +
        '<tr><td align="center">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 28px rgba(0,0,0,0.10);">' +
        '<tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:30px 32px;text-align:center;">' +
        '<div style="font-size:26px;font-weight:700;color:#c9a227;letter-spacing:2px;">玉国金融</div>' +
        '<div style="font-size:12px;color:#8b95a7;margin-top:6px;letter-spacing:1.5px;">YUGUO FINANCE</div>' +
        '</td></tr>' +
        '<tr><td style="padding:32px 32px 24px;">' +
        '<p style="font-size:17px;color:#222;margin:0 0 6px;font-weight:600;">' + title + '</p>' +
        '<p style="font-size:13px;color:#777;line-height:1.8;margin:0 0 24px;">' + subtitle + '</p>' +
        inner +
        '</td></tr>' +
        '<tr><td style="background:#fafafa;padding:16px 32px;text-align:center;border-top:1px solid #eee;">' +
        '<div style="font-size:11px;color:#aaa;line-height:1.7;">此邮件由系统自动发送，请勿直接回复<br>玉国金融 © ' + new Date().getFullYear() + '</div>' +
        '</td></tr>' +
        '</table></td></tr></table></body></html>';
    };
    // 模式一：直接下发 6 位验证码（不放任何“转发到某邮箱”的提示）
    const buildCodeEmail = function(code, username, purpose) {
      const inner =
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f3;border:2px dashed #c9a227;border-radius:12px;margin:0 0 22px;">' +
        '<tr><td style="padding:22px 16px;text-align:center;">' +
        '<div style="font-size:12px;color:#999;letter-spacing:2px;margin-bottom:10px;">' + (purpose || "邮箱验证码") + '</div>' +
        '<div style="font-size:42px;font-weight:700;color:#b8860b;letter-spacing:12px;font-family:\'Courier New\',Consolas,monospace;">' + code + '</div>' +
        '<div style="font-size:12px;color:#999;margin-top:10px;">30 分钟内有效 · 请勿转发给他人</div>' +
        '</td></tr></table>' +
        '<p style="font-size:13px;color:#666;line-height:1.8;margin:0;">请在网页中输入这 6 位验证码完成验证。如非本人操作，请忽略本邮件。</p>';
      return mailShell("您好，" + (username || "新用户"), "我们收到了您的验证请求，请使用下方验证码继续。", inner);
    };
    // 模式二：邮箱无法直接投递时，引导用户用本人邮箱转发/发送到收件邮箱（不含正常验证码）
    const buildForwardEmail = function(username, email) {
      const inner =
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef6ff;border:1px solid #9ec5fe;border-radius:12px;margin:0 0 22px;">' +
        '<tr><td style="padding:18px 20px;font-size:13px;color:#1b4b82;line-height:1.9;">' +
        '<strong>您的邮箱（' + email + '）暂不支持自动接收验证码。</strong><br>' +
        '请直接使用该邮箱发送一封邮件，或把本邮件转发至：<br>' +
        '<span style="font-size:15px;font-weight:700;color:#0b3d75;">' + FORWARD_MAILBOX + '</span>' +
        '</td></tr></table>' +
        '<p style="font-size:13px;color:#666;line-height:1.9;margin:0 0 6px;">操作步骤：</p>' +
        '<p style="font-size:13px;color:#666;line-height:1.9;margin:0;">1. 在邮件正文保留下面这一行：<br>' +
        '<span style="display:inline-block;margin:6px 0;padding:8px 12px;background:#f7f7f7;border-radius:6px;color:#333;">请将本邮件转发至 ' + FORWARD_MAILBOX + ' 完成玉国金融邮箱验证</span><br>' +
        '2. 回到注册页面，点击「刷新验证状态」即可自动通过。</p>';
      return mailShell("您好，" + (username || "新用户"), "需要您用本人邮箱手动完成一次验证。", inner);
    };
    const buildForwardEmailText = function(email) {
      return "您的邮箱（" + email + "）暂不支持自动接收验证码。\n\n" +
        "请使用该邮箱发送邮件或转发本邮件至：" + FORWARD_MAILBOX + "\n\n" +
        "邮件正文请保留这一行：请将本邮件转发至 " + FORWARD_MAILBOX + " 完成玉国金融邮箱验证\n\n" +
        "发送后回到注册页面点击「刷新验证状态」即可自动通过。";
    };
    // 发送邮件：返回 true 表示已投递
    const sendVerifyMail = async function(to, subject, html, text) {
      if (!MAILTRAP_TOKEN) return false;
      const mailtrap = new MailtrapClient({ token: MAILTRAP_TOKEN });
      await mailtrap.send({ from: MAIL_FROM, to: [{ email: to }], subject: subject, html: html, text: text, category: "Email Verification" });
      return true;
    };

    // ========== 老用户绑定邮箱（发送验证码） ==========
    if (path === "/oauth/email/bind" && req.method === "POST") {
      const { username, email } = await req.json();
      if (!username || !email) return jsonResponse({ error: "缺少 username 或 email" }, 400);
      const emailLower = email.toLowerCase();
      const now = new Date().toISOString();

      const uq = await execTurso("SELECT id FROM users WHERE id=? LIMIT 1", [username]);
      const urows = uq.data?.results?.[0]?.response?.result?.rows || uq.data?.results?.[0]?.response?.results?.rows || [];
      if (urows.length === 0) return jsonResponse({ error: "用户不存在" }, 404);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await execTurso(
        "INSERT OR REPLACE INTO email_bindings (email, username, code, status, created_at) VALUES (?,?,?,?,?)",
        [emailLower, username, code, "pending", now]
      );

      let mode = "forward";
      let mailSent = false;
      let mailError = null;
      const skipMailtrap = isMicrosoftEmail(emailLower);
      if (!skipMailtrap && MAILTRAP_TOKEN) {
        try {
          await sendVerifyMail(
            emailLower,
            "玉国金融 - 绑定邮箱验证码 " + code,
            buildCodeEmail(code, username, "邮箱绑定验证码"),
            "您的玉国金融绑定邮箱验证码是：" + code + "\n\n30 分钟内有效，请勿转发给他人。"
          );
          mode = "code";
          mailSent = true;
        } catch (e) {
          console.error("[mailtrap]", String(e).substring(0, 200));
          mailError = e.message || "unknown";
        }
      } else if (skipMailtrap) {
        mailError = "该邮箱域名暂不支持自动投递，已自动切换为转发验证模式";
      }

      return jsonResponse({
        ok: true,
        mode: mode,
        mailSent: mailSent,
        mailError: mailError,
        skipMailtrap: skipMailtrap || false,
        forwardTo: FORWARD_MAILBOX,
        message: mode === "code"
          ? "验证码已发送到邮箱"
          : "请用您的邮箱发送验证邮件到 " + FORWARD_MAILBOX
      });
    }

    // ========== 老用户绑定邮箱：查询邮箱触发器验证结果 ==========
    if (path === "/oauth/email/check-bind" && req.method === "GET") {
      const u = new URL(req.url);
      const username = u.searchParams.get("username");
      const email = u.searchParams.get("email");
      if (!username || !email) return jsonResponse({ error: "缺少参数" }, 400);
      const emailLower = email.toLowerCase();
      const bq = await execTurso("SELECT status FROM email_bindings WHERE username=? AND email=?", [username, emailLower]);
      const brows = bq.data?.results?.[0]?.response?.result?.rows || bq.data?.results?.[0]?.response?.results?.rows || [];
      const status = brows.length > 0 ? ((brows[0][0]?.value ?? brows[0][0]) || "") : "";
      return jsonResponse({ verified: status === "verified", status: status || "pending" });
    }

    // ========== 老用户绑定邮箱（验证验证码） ==========
    if (path === "/oauth/email/verify-bind" && req.method === "POST") {
      const { username, email, code } = await req.json();
      if (!username || !email || !code) return jsonResponse({ error: "缺少参数" }, 400);
      const emailLower = email.toLowerCase();
      const now = new Date().toISOString();

      const bq = await execTurso(
        "SELECT code FROM email_bindings WHERE username=? AND email=? AND code=? AND status='pending'",
        [username, emailLower, code]
      );
      const brows = bq.data?.results?.[0]?.response?.result?.rows || bq.data?.results?.[0]?.response?.results?.rows || [];
      if (brows.length === 0) return jsonResponse({ verified: false, error: "验证码错误或已过期" });

      await execTurso("UPDATE email_bindings SET status='verified', verified_at=? WHERE email=? AND username=?", [now, emailLower, username]);
      await execTurso("UPDATE users SET email=?, updated_at=? WHERE id=?", [emailLower, now, username]);
      await execTurso("UPDATE registrations SET email=?, oauth_id=?, oauth_email=? WHERE username=?", [emailLower, emailLower, emailLower, username]);

      return jsonResponse({ verified: true, message: "邮箱绑定成功" });
    }

    // ========== Email 注册 + 验证码 ==========
    // 注册：生成 6 位验证码，存入 email_verifications
    // 模式一（code）：直接发送漂亮的 HTML 验证码邮件；
    // 模式二（forward）：邮箱无法自动接收时，引导用户用本人邮箱发送/转发邮件到 yuguoemail@yuconemail.cc.cd，不下发验证码
    if (path === "/oauth/email/register" && req.method === "POST") {
      const { email, username, password, passwordHash: clientHash, fullName, birthdate, country, province, city, referrer, turnstileToken } = await req.json();
      if (!email || !username || !password) return jsonResponse({ error: "缺少必填字段" }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "邮箱格式不正确" }, 400);
      if (password.length < 6) return jsonResponse({ error: "密码至少需要6位" }, 400);

      // 人机验证（防止脚本批量注册 / 刷邮件）
      const { ip: regIp } = getClientInfo();
      const tsr = await verifyTurnstile(turnstileToken, regIp);
      if (!tsr.ok) return jsonResponse({ error: tsr.error, turnstileFailed: true }, 403);

      const emailLower = email.toLowerCase();
      const now = new Date().toISOString();
      const code = String(Math.floor(100000 + Math.random() * 900000));

      // 优先使用前端传来的密码哈希（与登录接口一致），确保注册后能正常登录
      const passwordHash = (clientHash && String(clientHash).startsWith("sha256$"))
        ? clientHash
        : await hashPassword(password);

      // 检查用户名是否已存在（包括 users 表和 registrations 表）
      const { data: userCheck } = await execTurso("SELECT id FROM users WHERE id=?", [username]);
      if (userCheck.results?.[0]?.response?.result?.rows?.length > 0) return jsonResponse({ error: "该用户名已被使用" }, 400);
      const { data: regCheck } = await execTurso("SELECT id FROM registrations WHERE username=?", [username]);
      if (regCheck.results?.[0]?.response?.result?.rows?.length > 0) return jsonResponse({ error: "该用户名已被使用" }, 400);

      // 检查邮箱是否已被注册
      const { data: emailCheck } = await execTurso("SELECT id FROM users WHERE oauth_id=?", [emailLower]);
      if (emailCheck.results?.[0]?.response?.result?.rows?.length > 0) return jsonResponse({ error: "该邮箱已被注册" }, 400);

      await execTurso(
        "INSERT OR REPLACE INTO email_verifications (email, username, password_hash, full_name, birthdate, country, province, city, referrer, code, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [emailLower, username, passwordHash, fullName || "", birthdate || "", country || "", province || "", city || "", referrer || "", code, "pending", now]
      );

      // 两种投递模式：
      //   code    = 直接发送 6 位验证码邮件（好看 HTML，不附带任何转发提示）
      //   forward = 邮箱无法自动接收（微软系等），降级为用户用本人邮箱转发/发送完成验证，不下发验证码
      let mode = "forward";
      let mailSent = false;
      let mailError = null;
      const skipMailtrap = isMicrosoftEmail(emailLower);
      if (!skipMailtrap && MAILTRAP_TOKEN) {
        try {
          await sendVerifyMail(
            emailLower,
            "玉国金融 - 邮箱验证码 " + code,
            buildCodeEmail(code, username, "注册验证码"),
            "您的玉国金融验证码是：" + code + "\n\n30 分钟内有效，请勿转发给他人。"
          );
          mode = "code";
          mailSent = true;
        } catch (e) {
          mailError = e.message || "unknown";
        }
      } else if (skipMailtrap) {
        mailError = "该邮箱域名暂不支持自动投递，已自动切换为转发验证模式";
      }

      // 转发模式：尝试把「转发说明」邮件发给用户（不含验证码）；投递不了也不影响页面手动验证
      if (mode === "forward" && !skipMailtrap && MAILTRAP_TOKEN) {
        try {
          await sendVerifyMail(
            emailLower,
            "玉国金融 - 请转发此邮件完成邮箱验证",
            buildForwardEmail(username, emailLower),
            buildForwardEmailText(emailLower)
          );
        } catch (e) { /* 忽略，页面会引导手动发送 */ }
      }

      return jsonResponse({
        ok: true,
        mode: mode,
        email: emailLower,
        forwardTo: FORWARD_MAILBOX,
        mailSent: mailSent,
        mailError: mailError,
        skipMailtrap: skipMailtrap || false,
        message: mode === "code"
          ? "验证码已发送到您的邮箱"
          : "请用您的邮箱发送验证邮件到 " + FORWARD_MAILBOX
      });
    }

    // ========== 直接验证码校验（用户在邮箱收到码后填入前端） ==========
    if (path === "/oauth/email/verify-code" && req.method === "POST") {
      const { email, code } = await req.json();
      if (!email || !code) return jsonResponse({ error: "缺少 email 或 code 参数" }, 400);
      const emailLower = email.toLowerCase();
      const now = new Date().toISOString();

      const { data: verData } = await execTurso(
        "SELECT username, password_hash, full_name, birthdate, country, province, city, referrer FROM email_verifications WHERE email=? AND code=? AND status='pending'",
        [emailLower, code]
      );
      const vrows = verData.results?.[0]?.response?.result?.rows || [];
      if (vrows.length === 0) return jsonResponse({ verified: false, error: "验证码错误或已过期" });

      const row = vrows[0];
      const gv = function(cell) {
        return cell !== null && typeof cell === "object" && "value" in cell ? cell.value : cell;
      };
      const username = gv(row[0]);
      const passwordHash = gv(row[1]);
      const fullName = gv(row[2]);
      const birthdate = gv(row[3]);
      const country = gv(row[4]);
      const province = gv(row[5]);
      const city = gv(row[6]);
      const referrer = gv(row[7]);
      const regId = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2,15));

      // 标记验证通过
      await execTurso("UPDATE email_verifications SET status='verified', verified_at=? WHERE email=?", [now, emailLower]);

      // 写入 registrations（免审核）
      await execTurso(
        "INSERT OR REPLACE INTO registrations (id, username, password_hash, full_name, birthdate, country, province, city, referrer, review_status, oauth_provider, oauth_id, oauth_email, email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [regId, username, passwordHash, fullName, birthdate, country, province, city, referrer, "approved", "email", emailLower, emailLower, emailLower, now]
      );

      // 写入 users
      await execTurso(
        "INSERT INTO users (id, password_hash, full_name, birthdate, country, province, city, referrer, review_status, oauth_provider, oauth_id, email, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET oauth_provider=EXCLUDED.oauth_provider, oauth_id=EXCLUDED.oauth_id, email=EXCLUDED.email, updated_at=EXCLUDED.updated_at",
        [username, passwordHash, fullName, birthdate, country, province, city, referrer, "approved", "email", emailLower, emailLower, now, now]
      );

      // 生成登录 token
      const loginToken = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2,15));
      const loginExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await execTurso(
        "INSERT INTO oauth_tokens (token, username, oauth_id, provider, created_at, expires_at) VALUES (?,?,?,?,?,?)",
        [loginToken, username, emailLower, "email", now, loginExpires]
      );

      return jsonResponse({ verified: true, oauth_token: loginToken, username: username, message: "验证通过" });
    }

    // 轮询：检查邮箱是否已验证通过（降级场景：邮箱触发器验证）
    if (path === "/oauth/email/check-register" && req.method === "GET") {
      const email = new URL(req.url).searchParams.get("email");
      if (!email) return jsonResponse({ error: "缺少 email 参数" }, 400);
      const emailLower = email.toLowerCase();
      const now = new Date().toISOString();

      const { data: verData } = await execTurso(
        "SELECT status, username, created_at FROM email_verifications WHERE email=?",
        [emailLower]
      );
      const vrows = verData.results?.[0]?.response?.result?.rows || [];
      if (vrows.length === 0) return jsonResponse({ verified: false, error: "未找到注册记录" });

      // 老用户：如果在 users 表中存在且已审核，直接返回已验证
      const status = (vrows[0][0]?.value || vrows[0][0] || "");
      if (status === "verified") {
        const uname = (vrows[0][1]?.value || vrows[0][1] || "");
        const loginToken = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2,15));
        const loginExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await execTurso(
          "INSERT INTO oauth_tokens (token, username, oauth_id, provider, created_at, expires_at) VALUES (?,?,?,?,?,?)",
          [loginToken, uname, emailLower, "email", now, loginExpires]
        );
        return jsonResponse({ verified: true, oauth_token: loginToken, username: uname });
      }
      return jsonResponse({ verified: false, status: "pending" });
    }

    // ========== Email 魔法链接验证 ==========
    if (path === "/oauth/email/verify" && req.method === "POST") {
      const { token, email, code } = await req.json();
      const verifyToken = code || token;
      if (!verifyToken || !email) return jsonResponse({ error: "缺少验证码或 email 参数" }, 400);

      try {
        // 1. 验证 - 支持 UUID token 和 6位验证码
        const now = new Date().toISOString();
        const isCode = /^\d{6}$/.test(verifyToken);
        const { data: tokenData } = await execTurso(
          isCode
            ? "SELECT token, oauth_id, provider, expires_at FROM oauth_tokens WHERE username=? AND provider='email' AND oauth_id=?"
            : "SELECT username, oauth_id, provider, expires_at FROM oauth_tokens WHERE token=? AND provider='email' AND oauth_id=?",
          [verifyToken, email.toLowerCase()]
        );
        const tokenResult = tokenData.results?.[0];
        if (!tokenResult || tokenResult.type === "error" || !tokenResult.response?.result?.rows?.length) {
          return jsonResponse({ error: "链接无效或已过期" }, 401);
        }
        const rows = tokenResult.response.result.rows;
        const tokenExpires = (typeof rows[0][3] === "object" && "value" in rows[0][3]) ? rows[0][3].value : rows[0][3];
        if (tokenExpires < now) return jsonResponse({ error: "链接已过期，请重新发送" }, 401);

        // 2. 删除已用的 token（用数据库中的 UUID 删除）
        const dbToken = rows[0][0];
        await execTurso("DELETE FROM oauth_tokens WHERE token=?", [dbToken]);

        const emailLower = email.toLowerCase();
        const emailUsername = emailLower.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").substring(0, 30);

        // 3. 查找是否已有该 email 注册的用户
        const { data: lookupData } = await execTurso(
          "SELECT id, review_status FROM users WHERE oauth_provider='email' AND oauth_id=?",
          [emailLower]
        );
        const lookupResult = lookupData.results?.[0];
        let existingUsername = "";
        let existingStatus = "";

        if (lookupResult && lookupResult.type !== "error") {
          const inner = lookupResult.response?.result || lookupResult.response?.results || {};
          const r = inner.rows || [];
          if (r.length > 0) {
            existingUsername = typeof r[0][0] === "object" && "value" in r[0][0] ? r[0][0].value : r[0][0];
            existingStatus = typeof r[0][1] === "object" && "value" in r[0][1] ? r[0][1].value : r[0][1];
          }
        }

        // 4. 已审核 → 发 OAuth token
        if (existingStatus === "approved") {
          const loginToken = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 15));
          const loginExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          await execTurso(
            "INSERT INTO oauth_tokens (token, username, oauth_id, provider, created_at, expires_at) VALUES (?,?,?,?,?,?)",
            [loginToken, existingUsername, emailLower, "email", now, loginExpires]
          );
          return jsonResponse({ ok: true, oauth_token: loginToken, username: existingUsername });
        }

        if (existingStatus === "pending") {
          return jsonResponse({ pending: true, username: existingUsername, message: "账户审核中" });
        }

        // 5. 新用户 → 检查用户名
        const { data: nameCheck } = await execTurso(
          "SELECT id FROM users WHERE id=?",
          [emailUsername]
        );
        const nameResult = nameCheck.results?.[0];
        let finalUsername = emailUsername;
        if (nameResult && nameResult.type !== "error") {
          const inner = nameResult.response?.result || nameResult.response?.results || {};
          if ((inner.rows || []).length > 0) {
            finalUsername = "em_" + emailLower.replace(/[^a-z0-9]/g, "").substring(0, 27);
          }
        }

        // 6. 创建注册申请
        const regId = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 15));
        await execTurso(
          "INSERT OR REPLACE INTO registrations (id, username, password_hash, full_name, birthdate, country, province, city, referrer, review_status, oauth_provider, oauth_id, oauth_email, oauth_avatar, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [regId, finalUsername, "", "", "", "", "", "", "", "pending", "email", emailLower, emailLower, "", now]
        );

        await execTurso(
          "INSERT INTO users (id, password_hash, full_name, review_status, oauth_provider, oauth_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET oauth_provider=EXCLUDED.oauth_provider, oauth_id=EXCLUDED.oauth_id, updated_at=EXCLUDED.updated_at",
          [finalUsername, "", "", "pending", "email", emailLower, now, now]
        );

        return jsonResponse({ pending: true, username: finalUsername, message: "注册申请已提交，请等待管理员审核" });

      } catch (e) {
        return jsonResponse({ error: "验证失败: " + (e.message || "未知错误") }, 500);
      }
    }

    // ========== 验证 OAuth Token ==========
    if (path === "/verify-oauth-token" && req.method === "POST") {
      const body = await req.json();
      const { token } = body;
      if (!token) return jsonResponse({ error: "缺少 token 参数" }, 400);

      const { data } = await execTurso(
        "SELECT username, provider, oauth_id, expires_at FROM oauth_tokens WHERE token=?",
        [token]
      );

      const result = data.results?.[0];
      if (!result || result.type === "error") return jsonResponse({ error: "无效的 token" }, 401);

      const inner = result.response?.result || result.response?.results || {};
      const rows = inner.rows || [];
      if (rows.length === 0) return jsonResponse({ error: "无效的 token" }, 401);

      const row = rows[0];
      const uname = typeof row[0] === "object" && "value" in row[0] ? row[0].value : row[0];
      const provider = typeof row[1] === "object" && "value" in row[1] ? row[1].value : row[1];
      const oauthId = typeof row[2] === "object" && "value" in row[2] ? row[2].value : row[2];
      const expiresAt = typeof row[3] === "object" && "value" in row[3] ? row[3].value : row[3];

      if (new Date(expiresAt) < new Date()) {
        await execTurso("DELETE FROM oauth_tokens WHERE token=?", [token]);
        return jsonResponse({ error: "token 已过期，请重新登录" }, 401);
      }

      // 一次性 token，用完销毁
      await execTurso("DELETE FROM oauth_tokens WHERE token=?", [token]);

      return jsonResponse({ ok: true, username: uname, provider: provider, oauth_id: oauthId });
    }


    return jsonResponse({ error: "未知路径" }, 404);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}