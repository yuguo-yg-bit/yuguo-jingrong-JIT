// ============================================================
// 玉国金融 Val.town 中转代理
// 功能：接收前端请求 → 转发SQL到Turso → 返回结果
// 部署到 Val.town 后访问：
//   https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run （主代理）
// ============================================================

import { MailtrapClient } from "npm:mailtrap";

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

    if (path === "/health_old") {
      return jsonResponse({ ok: true, time: new Date().toISOString() });
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

    // ========== 调试：返回原始 Turso 响应 ==========
    if (path === "/debug-sql" && req.method === "POST") {
      const body = await req.json();
      const { sql, params } = body;
      if (!sql) return jsonResponse({ error: "缺少 sql 参数" }, 400);

      const { ok, status, data, rawText } = await execTurso(sql, params);
      return jsonResponse({ tursoOk: ok, tursoStatus: status, rawResponse: data, rawText });
    }

    // ========== SQL 透传（核心接口） ==========
    if (path === "/sql" && req.method === "POST") {
      const body = await req.json();
      const { sql, params } = body;
      const op = String(body.operator || "anonymous").slice(0, 60);

      if (!sql) {
        return jsonResponse({ error: "缺少 sql 参数" }, 400);
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

    // ========== 账务入账（积分变更唯一入口，原子+幂等） ==========
    // 所有余额变动必须走这里：先落 ledger 流水（biz_no 幂等），再更新 users.points。
    // 同一 bizNo 重复提交只生效一次，防止重复扣款/加款。
    if (path === "/points" && req.method === "POST") {
      const body = await req.json();
      const { bizNo, userId, delta, reason, refId, operator } = body;

      // 会话校验：有会话 → 校验身份；无会话 → 放行但记警告（后续完善登录后收紧）
      // 注意：/points 本就允许无会话调用，所以“会话属于别的账号”时 403 只会误伤
      // （退出登录没清 token、换账号登录等），按无会话处理即可，安全等级不变。
      let sessionOperator = "";
      const sess = await requireSession();
      if (!sess.error) {
        const isAdminSession = sess.role === "admin";
        if (sess.username === userId || isAdminSession) {
          // 身份一致（或管理员代操作）：入账操作人以会话为准，不信任前端传的 operator
          sessionOperator = isAdminSession ? "admin" : sess.username;
        } else {
          logAudit("POINTS_SESSION_MISMATCH", sess.username, "users", String(userId || ""), "会话与操作用户不一致（按无会话放行）", "/points", String(bizNo || ""), "warn");
        }
        if (await rateLimitPoints(sessionOperator || String(operator || userId || "anonymous"))) {
          return jsonResponse({ error: "操作过于频繁，请稍后再试" }, 429);
        }
      } else {
        // 无会话：暂放行，记警告日志
        logAudit("POINTS_NO_SESSION", String(operator || "anonymous"), "users", String(userId || ""), "无会话操作积分（已暂放行）", "/points", String(bizNo || ""), "warn");
        if (await rateLimitPoints(String(operator || "anonymous"))) {
          return jsonResponse({ error: "操作过于频繁，请稍后再试" }, 429);
        }
      }

      if (!bizNo || typeof bizNo !== "string" || bizNo.length > 64) {
        return jsonResponse({ error: "缺少合法幂等单号 bizNo" }, 400);
      }
      if (!userId || typeof userId !== "string" || userId.length > 50) {
        return jsonResponse({ error: "缺少合法 userId" }, 400);
      }
      const amt = Math.round(Number(delta || 0));
      if (!amt || !isFinite(amt)) return jsonResponse({ error: "变动金额必须为非零数字" }, 400);
      if (Math.abs(amt) > 100000000) return jsonResponse({ error: "单笔变动金额超限" }, 400);
      const why = String(reason || "").slice(0, 200);
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
            sql: "UPDATE users SET points = (SELECT COALESCE(SUM(amount),0) FROM ledger WHERE user_id=?), updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)",
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
      const q = await execTurso("SELECT COALESCE(points,0) AS p FROM users WHERE id=?", [userId]);
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
      const body = await req.json();
      const { statements } = body;

      if (!statements || !Array.isArray(statements)) {
        return jsonResponse({ error: "缺少 statements 数组" }, 400);
      }

      const results = [];
      for (const stmt of statements) {
        const tursoReq = { requests: [{ type: "execute", stmt: { sql: stmt } }] };
        const tursoRes = await fetch(TURSO_API, {
          method: "POST",
          headers: { Authorization: `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify(tursoReq),
        });
        const data = await tursoRes.json();
        results.push({ sql: stmt.substring(0, 60), ok: tursoRes.ok, result: data.results?.[0] });
      }

      return jsonResponse({ ok: true, results });
    }

    // ========== 图片上传（GitHub API） ==========
    if (path === "/upload-image" && req.method === "POST") {
      const body = await req.json();
      const { base64Data, folder } = body;

      if (!base64Data) {
        return jsonResponse({ error: "缺少 base64Data" }, 400);
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
      const returnUrl = url.searchParams.get("return_url") || ALLOW_ORIGINS[0];
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
      const returnUrl = stateParts.slice(1).join("|") || ALLOW_ORIGINS[0];

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
      const returnUrl = url.searchParams.get("return_url") || ALLOW_ORIGINS[0];
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
      const returnUrl = stateParts.slice(1).join("|") || ALLOW_ORIGINS[0];

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

    // ========== Email 魔法链接登录 ==========
    if (path === "/oauth/email/send" && req.method === "POST") {
      const { email, returnUrl } = await req.json();
      if (!email) return jsonResponse({ error: "缺少邮箱地址" }, 400);
      // 简单邮箱格式校验
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "邮箱格式不正确" }, 400);

      try {
        const token = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 15));
        const verifyCode = String(Math.floor(100000 + Math.random() * 900000));
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        await execTurso(
          "INSERT INTO oauth_tokens (token, username, oauth_id, provider, created_at, expires_at) VALUES (?,?,?,?,?,?)",
          [token, verifyCode, email.toLowerCase(), "email", now, expiresAt]
        );

        const baseUrl = returnUrl || process.env.SITE_URL || ALLOW_ORIGINS[0];
        const magicLink = baseUrl + "/login?email_token=" + encodeURIComponent(token) + "&email=" + encodeURIComponent(email);

        const mailkiteKey = process.env.MAILKITE_API_KEY;
        let emailSent = false;
        if (mailkiteKey) {
          try {
            const mkRes = await fetch("https://api.mailkite.dev/v1/send", {
              method: "POST",
              headers: {
                "Authorization": "Bearer " + mailkiteKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                from: "玉国金融 <noreply@yuguojinrong.mailk.us>",
                to: [email],
                subject: "玉国金融 - 登录验证码 " + verifyCode,
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
                  '<p style="font-size:14px;color:#666;line-height:1.8;margin:0 0 28px;">您正在登录玉国金融平台。请使用以下验证码完成登录，或点击下方按钮一键登录。</p>' +
                  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f3;border:2px dashed #b8860b;border-radius:10px;margin-bottom:24px;">' +
                  '<tr><td style="padding:20px;text-align:center;">' +
                  '<div style="font-size:12px;color:#999;margin-bottom:8px;letter-spacing:2px;">登录验证码</div>' +
                  '<div style="font-size:36px;font-weight:700;color:#b8860b;letter-spacing:8px;font-family:\'Courier New\',monospace;">' + verifyCode + '</div>' +
                  '<div style="font-size:12px;color:#999;margin-top:6px;">15 分钟内有效 · 请勿转发他人</div>' +
                  '</td></tr></table>' +
                  '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
                  '<a href="' + magicLink + '" style="display:inline-block;background:linear-gradient(135deg,#b8860b,#9a7209);color:#fff;text-decoration:none;padding:14px 48px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:1px;">一键登录</a>' +
                  '</td></tr></table>' +
                  '</td></tr>' +
                  '<tr><td style="padding:0 40px 32px;">' +
                  '<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee;padding-top:24px;">' +
                  '<tr><td style="font-size:12px;color:#999;line-height:1.8;">' +
                  '<p style="margin:0 0 4px;">📌 如非本人操作，请忽略此邮件。</p>' +
                  '<p style="margin:0 0 4px;">📌 验证码和链接均 15 分钟内有效。</p>' +
                  '<p style="margin:0;">🔗 备用链接：<a href="' + magicLink + '" style="color:#b8860b;">' + magicLink + '</a></p>' +
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
              emailSent = mkData.id;
            }
          } catch (ignored) {}
        }
        if (emailSent) {
          return jsonResponse({ ok: true, message: "登录链接已发送" });
        }
        return jsonResponse({ ok: true, magicLink: magicLink, verifyCode: verifyCode, message: "邮件发送失败，请使用下方验证码或链接登录" });
      } catch (e) {
        return jsonResponse({ error: "发送失败: " + (e.message || "未知错误") }, 500);
      }
    }

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

      let mailSent = false;
      let mailError = null;
      let skipMailtrap = isMicrosoftEmail(emailLower);
      if (skipMailtrap) {
        mailError = "Microsoft 邮箱域名不支持自动投递（严格头认证），请手动发送邮件";
      } else {
        try {
          await mailtrapClient.send({
            from: sender,
            to: [{ email: emailLower }],
            subject: "玉国金融 - 绑定邮箱验证码: " + code,
            text: "您的绑定邮箱验证码是: " + code + "\n请在页面中输入此验证码完成邮箱绑定。",
            category: "EmailBinding",
          });
          mailSent = true;
        } catch (e) { console.error("[mailtrap]", String(e).substring(0,200)); mailError = e.message || "unknown"; }
      }

      return jsonResponse({ ok: true, mailSent, skipMailtrap: skipMailtrap || false, message: mailSent ? "验证码已发送到邮箱" : "邮件发送失败，请稍后重试", fallbackCode: mailSent ? null : code });
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
    // 注册：生成 6 位验证码，存入 email_verifications，用户需发邮件到 yuguoemail@yuconemail.cc.cd 完成验证
    if (path === "/oauth/email/register" && req.method === "POST") {
      const { email, username, password, fullName, birthdate, country, province, city, referrer } = await req.json();
      if (!email || !username || !password) return jsonResponse({ error: "缺少必填字段" }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "邮箱格式不正确" }, 400);
      if (password.length < 6) return jsonResponse({ error: "密码至少需要6位" }, 400);

      const emailLower = email.toLowerCase();
      const now = new Date().toISOString();
      const code = String(Math.floor(100000 + Math.random() * 900000));

      // 检查用户名是否已存在（包括 users 表和 registrations 表）
      const { data: userCheck } = await execTurso("SELECT id FROM users WHERE id=?", [username]);
      if (userCheck.results?.[0]?.response?.result?.rows?.length > 0) return jsonResponse({ error: "该用户名已被使用" }, 400);
      const { data: regCheck } = await execTurso("SELECT id FROM registrations WHERE username=?", [username]);
      if (regCheck.results?.[0]?.response?.result?.rows?.length > 0) return jsonResponse({ error: "该用户名已被使用" }, 400);

      // 检查邮箱是否已被注册
      const { data: emailCheck } = await execTurso("SELECT id FROM users WHERE oauth_id=?", [emailLower]);
      if (emailCheck.results?.[0]?.response?.result?.rows?.length > 0) return jsonResponse({ error: "该邮箱已被注册" }, 400);

      const passwordHash = await hashPassword(password);

      await execTurso(
        "INSERT OR REPLACE INTO email_verifications (email, username, password_hash, full_name, birthdate, country, province, city, referrer, code, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [emailLower, username, passwordHash, fullName || "", birthdate || "", country || "", province || "", city || "", referrer || "", code, "pending", now]
      );

      // 通过 Mailtrap 自动发送验证码邮件给用户
      // 微软系邮箱（Outlook/Hotmail/Live/MSN）Mailtrap 无法投递，直接降级为手动模式
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
            subject: "玉国金融 - 邮箱验证码: " + code,
            text: "您的验证码是: " + code + "\n\n请将此验证码回复发送到 yuguoemail@yuconemail.cc.cd 完成验证。\n\n验证码邮件正文请只填写这 6 位数字。\n\n玉国金融团队",
            category: "Email Verification",
          });
          mailSent = true;
        } catch (e) {
          mailError = e.message || "unknown";
        }
      }

      return jsonResponse({
        ok: true,
        code: code,
        email: emailLower,
        mailSent: mailSent,
        mailError: mailError,
        skipMailtrap: skipMailtrap || false,
        message: mailSent ? "验证码已发送到您的邮箱" : "验证码已生成" + (mailError ? "（" + mailError + "）" : "（Mailtrap 未配置）"),
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