// ============================================================
// 玉国金融 Val.town 中转代理
// 功能：接收前端请求 → 转发SQL到Turso → 返回结果
// 部署到 Val.town 后访问：
//   https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run
// ============================================================

export default async function (req) {
  const ALLOW_ORIGINS = ["https://www.yuguojinrong.cc.cd", "https://yuguo-yg-bit.github.io", "https://yuguoygbit.github.io"];
  const TURSO_API = process.env.TURSO_API_URL;
  const TURSO_TOKEN = process.env.TURSO_RW_TOKEN;
  const Github_TOKEN = process.env.GitHub_API_TOKEN;

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

    // ========== SQL 安全校验层（防注入/防删库） ==========
    const ALLOWED_TABLES = [
      "users","vouchers","points_records","points_logs","points_accounts","chat_messages",
      "notifications","notification_replies","blacklist","urgent_blacklist","registrations",
      "whitelist","sys_config","test_ping","test_users","oauth_tokens","task_rewards",
      "user_levels","lottery_tickets","lottery_records","win_wall","risk_control",
      "user_monthly_rewards","user_outfits","community_statuses","community_bans","sqlite_sequence","ledger","audit_logs","sessions","farm_data",
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
        const q = await execTurso("SELECT username, password_hash FROM registrations WHERE username=? AND review_status='approved' LIMIT 1", [username]);
        const rows = q.data?.results?.[0]?.response?.result?.rows || q.data?.results?.[0]?.response?.results?.rows || [];
        if (rows.length > 0) {
          const s = String(rows[0][1]?.value ?? "");
          if (s === String(passwordHash)) valid = true;
          dbUser = { username: username, role: "user" };
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
      logAudit("LOGIN_SUCCESS", dbUser.username, "sessions", token, "登录成功（" + dbUser.role + "）", "/login", "", "ok");
      return jsonResponse({ ok: true, token, username: dbUser.username, role: dbUser.role, expiresAt });
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

    // ========== 农场数据：从数据库加载 ==========
    if (path === "/farm-load" && req.method === "POST") {
      const body = await req.json();
      const { userId } = body;
      if (!userId || typeof userId !== "string" || userId.length > 50) {
        return jsonResponse({ error: "缺少合法 userId" }, 400);
      }
      const sess = await requireSession();
      if (sess.error) {
        logAudit("FARM_LOAD_NO_SESSION", String(userId), "farm_data", userId, sess.error, "/farm-load", "", "blocked");
        return jsonResponse({ error: sess.error }, 403);
      }
      if (sess.role !== "admin" && sess.username !== userId) {
        logAudit("FARM_LOAD_BLOCKED", sess.username, "farm_data", userId, "越权读取他人农场数据被拒绝", "/farm-load", "", "blocked");
        return jsonResponse({ error: "禁止读取他人农场数据" }, 403);
      }
      try {
        await execTurso("CREATE TABLE IF NOT EXISTS farm_data (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)", []);
      } catch (e) {}
      const q = await execTurso("SELECT data FROM farm_data WHERE user_id=?", [userId]);
      const inner = q.data.results?.[0]?.response?.result || q.data.results?.[0]?.response?.results || q.data;
      let data = null;
      try {
        if (inner && inner.rows && inner.rows.length > 0) {
          const raw = typeof inner.rows[0][0] === "object" && "value" in inner.rows[0][0] ? inner.rows[0][0].value : inner.rows[0][0];
          data = JSON.parse(raw);
        }
      } catch (e) {}
      logAudit("FARM_LOAD", userId, "farm_data", userId, "加载农场数据", "/farm-load", "", "ok");
      return jsonResponse({ ok: true, data });
    }

    // ========== 农场数据：保存到数据库 ==========
    if (path === "/farm-save" && req.method === "POST") {
      const body = await req.json();
      const { userId, data } = body;
      if (!userId || typeof userId !== "string" || userId.length > 50) {
        return jsonResponse({ error: "缺少合法 userId" }, 400);
      }
      if (!data || typeof data !== "object") {
        return jsonResponse({ error: "缺少合法 data" }, 400);
      }
      const sess = await requireSession();
      if (sess.error) {
        logAudit("FARM_SAVE_NO_SESSION", String(userId), "farm_data", userId, sess.error, "/farm-save", "", "blocked");
        return jsonResponse({ error: sess.error }, 403);
      }
      if (sess.role !== "admin" && sess.username !== userId) {
        logAudit("FARM_SAVE_BLOCKED", sess.username, "farm_data", userId, "越权写入他人农场数据被拒绝", "/farm-save", "", "blocked");
        return jsonResponse({ error: "禁止写入他人农场数据" }, 403);
      }
      const now = new Date().toISOString();
      const dataJson = JSON.stringify(data);
      if (dataJson.length > 500000) {
        return jsonResponse({ error: "农场数据过大，超过 500KB 限制" }, 400);
      }
      try {
        await execTurso("CREATE TABLE IF NOT EXISTS farm_data (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)", []);
      } catch (e) {}
      await execTurso(
        "INSERT INTO farm_data (user_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at",
        [userId, dataJson, now]
      );
      logAudit("FARM_SAVE", userId, "farm_data", userId, "保存农场数据", "/farm-save", "", "ok");
      return jsonResponse({ ok: true });
    }

    // ========== 游戏引擎（商店+农场+离线结算） ==========
    if (path === "/game" && req.method === "POST") {
      const body = await req.json();
      const { action, userId } = body;
      if (!userId || typeof userId !== "string" || userId.length > 50) {
        return jsonResponse({ error: "缺少合法 userId" }, 400);
      }
      const sess = await requireSession();
      if (sess.error) return jsonResponse({ error: sess.error }, 403);
      if (sess.role !== "admin" && sess.username !== userId) {
        return jsonResponse({ error: "禁止操作他人游戏数据" }, 403);
      }

      // 建表（懒初始化）
      const initTables = async function() {
        const tables = [
          "CREATE TABLE IF NOT EXISTS game_shop_stock (user_id TEXT, item_id TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id,item_id))",
          "CREATE TABLE IF NOT EXISTS game_shelves (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT NOT NULL, item_name TEXT NOT NULL, cost_price INTEGER NOT NULL, profit_pct REAL DEFAULT 0.3, sell_price INTEGER NOT NULL, quantity INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
          "CREATE TABLE IF NOT EXISTS game_farm_plots (user_id TEXT, plot_index INTEGER, crop_type TEXT, planted_at TEXT, growth_hours REAL DEFAULT 0, water_hours REAL DEFAULT 0, wilt_hours REAL DEFAULT 0, last_watered TEXT, status TEXT DEFAULT 'empty', PRIMARY KEY(user_id,plot_index))",
          "CREATE TABLE IF NOT EXISTS game_engine_state (user_id TEXT PRIMARY KEY, last_tick TEXT, market_heat REAL DEFAULT 0.5, buyer_freq INTEGER DEFAULT 1800, auto_restock INTEGER DEFAULT 0, auto_farm INTEGER DEFAULT 0, robot_level INTEGER DEFAULT 1, total_revenue INTEGER DEFAULT 0, total_cost INTEGER DEFAULT 0, updated_at TEXT NOT NULL)",
          "CREATE TABLE IF NOT EXISTS game_engine_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_type TEXT NOT NULL, item_id TEXT, quantity INTEGER, amount INTEGER NOT NULL, detail TEXT, created_at TEXT NOT NULL)"
        ];
        for (let i = 0; i < tables.length; i++) {
          try { await execTurso(tables[i], []); } catch(e) {}
        }
      };

      await initTables();

      const now = new Date().toISOString();
      const nowMs = Date.now();

      // 批发价格表（进货成本）
      const WHOLESALE = {
        wheat:8, corn:16, strawberry:22, carrot:20, tomato:24, sunflower:32,
        seeds_wheat:8, seeds_corn:16, seeds_strawberry:22, seeds_carrot:20, seeds_tomato:24, seeds_sunflower:32,
        fertilizer_basic:12, fertilizer_premium:32, auto_waterer:120
      };

      const getCost = function(itemId) {
        var cost = WHOLESALE[itemId];
        if (cost !== undefined) return cost;
        // 作物收获品的成本基于生长期
        if (CROP_CFG[itemId]) return CROP_CFG[itemId].growthHours * 5;
        return 20;
      };

      const getItemName = function(itemId) {
        if (CROP_CFG[itemId]) return CROP_CFG[itemId].name;
        var base = itemId.replace(/^seeds_/, "");
        if (CROP_CFG[base]) return CROP_CFG[base].name + "种子";
        return itemId;
      };

      // 作物配置
      const CROP_CFG = {
        wheat:{name:"小麦",emoji:"🌾",growthHours:2,waterHours:4,wiltHours:6},
        corn:{name:"玉米",emoji:"🌽",growthHours:4,waterHours:6,wiltHours:8},
        strawberry:{name:"草莓",emoji:"🍓",growthHours:3,waterHours:5,wiltHours:7},
        carrot:{name:"胡萝卜",emoji:"🥕",growthHours:5,waterHours:7,wiltHours:10},
        tomato:{name:"番茄",emoji:"🍅",growthHours:6,waterHours:8,wiltHours:12},
        sunflower:{name:"向日葵",emoji:"🌻",growthHours:8,waterHours:8,wiltHours:14}
      };

      // ====== 获取/初始化引擎状态 ======
      const getEngineState = async function(uid) {
        const q = await execTurso("SELECT * FROM game_engine_state WHERE user_id=?",[uid]);
        const ir = q.data.results?.[0]?.response?.result || q.data.results?.[0]?.response?.results || q.data;
        if (ir && ir.rows && ir.rows.length > 0) {
          const r = ir.rows[0];
          return {
            userId: uid,
            lastTick: String(r[1]?.value ?? r[1] ?? now),
            marketHeat: parseFloat(r[2]?.value ?? r[2] ?? 0.5),
            buyerFreq: parseInt(r[3]?.value ?? r[3] ?? 1800),
            autoRestock: parseInt(r[4]?.value ?? r[4] ?? 0),
            autoFarm: parseInt(r[5]?.value ?? r[5] ?? 0),
            robotLevel: parseInt(r[6]?.value ?? r[6] ?? 1),
            totalRevenue: parseInt(r[7]?.value ?? r[7] ?? 0),
            totalCost: parseInt(r[8]?.value ?? r[8] ?? 0)
          };
        }
        // 初始化
        await execTurso(
          "INSERT OR IGNORE INTO game_engine_state (user_id,last_tick,market_heat,buyer_freq,auto_restock,auto_farm,robot_level,total_revenue,total_cost,updated_at) VALUES (?,?,0.5,1800,0,0,1,0,0,?)",
          [uid, now, now]
        );
        return { userId:uid, lastTick:now, marketHeat:0.5, buyerFreq:1800, autoRestock:0, autoFarm:0, robotLevel:1, totalRevenue:0, totalCost:0 };
      };

      const logGameEvent = async function(uid, eventType, itemId, qty, amt, detail) {
        const lid = "glog_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
        await execTurso(
          "INSERT INTO game_engine_log (id,user_id,event_type,item_id,quantity,amount,detail,created_at) VALUES (?,?,?,?,?,?,?,?)",
          [lid, uid, eventType, itemId||"", qty||0, amt||0, detail||"", now]
        ).catch(function(){});
      };

      // ====== 积分操作（通过账务入账） ======
      const gamePointsChange = async function(uid, delta, reason, bizNo) {
        const bn = bizNo || ("gpts_"+Date.now().toString(36)+Math.random().toString(36).slice(2,7));
        const mkArg = function(v) { return { type:"text", value:String(v) }; };
        const lid = "ld_"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
        const tursoReq = {
          requests: [
            { type:"execute", stmt:{ sql:"INSERT INTO ledger (id,biz_no,user_id,amount,balance_after,reason,ref_id,operator,created_at) SELECT ?,?,?,?,(SELECT COALESCE(points,0) FROM users WHERE id=?)+?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)", args:[lid,bn,uid,delta,uid,delta,reason||"","","engine",now,bn].map(mkArg) } },
            { type:"execute", stmt:{ sql:"UPDATE users SET points=(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE user_id=?), updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)", args:[uid,now,uid,bn].map(mkArg) } },
            { type:"execute", stmt:{ sql:"SELECT COALESCE(points,0) AS p FROM users WHERE id=?", args:[uid].map(mkArg) } }
          ]
        };
        const tursoRes = await fetch(TURSO_API, { method:"POST", headers:{ Authorization:`Bearer ${TURSO_TOKEN}`, "Content-Type":"application/json" }, body:JSON.stringify(tursoReq) });
        const pData = await tursoRes.json();
        if (!tursoRes.ok) throw new Error("积分操作失败");
        let bal = null;
        try { bal = pData.results?.[2]?.response?.result?.rows?.[0]?.[0]?.value ?? pData.results?.[2]?.response?.result?.rows?.[0]?.[0]; } catch(e){}
        return { ok:true, balance:bal };
      };

      // ====== 获取商店数据 ======
      const getShopData = async function(uid) {
        const sq = await execTurso("SELECT item_id,quantity FROM game_shop_stock WHERE user_id=?",[uid]);
        const stock = {};
        const sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        if (sir && sir.rows) {
          for (let i=0;i<sir.rows.length;i++) {
            const rid = sir.rows[i][0]?.value??sir.rows[i][0];
            const rqty = parseInt(sir.rows[i][1]?.value??sir.rows[i][1]??0);
            stock[rid] = rqty;
          }
        }
        const shq = await execTurso("SELECT * FROM game_shelves WHERE user_id=? ORDER BY created_at ASC",[uid]);
        const shelves = [];
        const shr = shq.data.results?.[0]?.response?.result || shq.data.results?.[0]?.response?.results || shq.data;
        if (shr && shr.rows) {
          for (let i=0;i<shr.rows.length;i++) {
            const r = shr.rows[i];
            shelves.push({
              id: r[0]?.value??r[0], itemId: r[2]?.value??r[2], itemName: r[3]?.value??r[3],
              costPrice: parseInt(r[4]?.value??r[4]??0), profitPct: parseFloat(r[5]?.value??r[5]??0.3),
              sellPrice: parseInt(r[6]?.value??r[6]??0), quantity: parseInt(r[7]?.value??r[7]??0),
              createdAt: r[8]?.value??r[8], updatedAt: r[9]?.value??r[9]
            });
          }
        }
        const logQ = await execTurso("SELECT * FROM game_engine_log WHERE user_id=? ORDER BY created_at DESC LIMIT 30",[uid]);
        const logs = [];
        const lr = logQ.data.results?.[0]?.response?.result || logQ.data.results?.[0]?.response?.results || logQ.data;
        if (lr && lr.rows) {
          for (let i=0;i<lr.rows.length;i++) {
            const r = lr.rows[i];
            logs.push({
              id: r[0]?.value??r[0], eventType: r[2]?.value??r[2], itemId: r[3]?.value??r[3],
              quantity: parseInt(r[4]?.value??r[4]??0), amount: parseInt(r[5]?.value??r[5]??0),
              detail: r[6]?.value??r[6], createdAt: r[7]?.value??r[7]
            });
          }
        }
        return { stock, shelves, logs };
      };

      // ====== 获取农场数据 ======
      const getFarmData = async function(uid, defaultLandSize) {
        const landSize = defaultLandSize || 6;
        const fq = await execTurso("SELECT * FROM game_farm_plots WHERE user_id=? ORDER BY plot_index ASC",[uid]);
        const plots = [];
        const fr = fq.data.results?.[0]?.response?.result || fq.data.results?.[0]?.response?.results || fq.data;
        const existingMap = {};
        if (fr && fr.rows) {
          for (let i=0;i<fr.rows.length;i++) {
            const r = fr.rows[i];
            const pi = parseInt((r[1]?.value ?? r[1]) || 0);
            existingMap[pi] = true;
            plots.push({
              plotIndex: pi, cropType: (r[2]?.value ?? r[2]) || null,
              plantedAt: (r[3]?.value ?? r[3]) || null, growthHours: parseFloat((r[4]?.value ?? r[4]) || 0),
              waterHours: parseFloat((r[5]?.value ?? r[5]) || 0), wiltHours: parseFloat((r[6]?.value ?? r[6]) || 0),
              lastWatered: (r[7]?.value ?? r[7]) || null, status: (r[8]?.value ?? r[8]) || "empty"
            });
          }
        }
        // 补齐空地
        for (let i=0;i<landSize;i++) {
          if (!existingMap[i]) {
            await execTurso(
              "INSERT OR IGNORE INTO game_farm_plots (user_id,plot_index,crop_type,planted_at,growth_hours,water_hours,wilt_hours,last_watered,status) VALUES (?,?,NULL,NULL,0,0,0,NULL,'empty')",
              [uid,i]
            );
            plots.push({ plotIndex:i, cropType:null, plantedAt:null, growthHours:0, waterHours:0, wiltHours:0, lastWatered:null, status:"empty" });
          }
        }
        plots.sort(function(a,b){ return a.plotIndex - b.plotIndex; });
        return plots;
      };

      // ====== 引擎 TICK：离线结算核心 ======
      const engineTick = async function(uid) {
        const state = await getEngineState(uid);
        const lastMs = new Date(state.lastTick).getTime();
        const elapsedSec = Math.max(0, (nowMs - lastMs) / 1000);
        if (elapsedSec < 1) {
          const shopData = await getShopData(uid);
          const farmPlots = await getFarmData(uid, 6);
          return { state, shop: shopData, farm: farmPlots, tickElapsed:0 };
        }

        let totalPointsChange = 0;
        const hoursElapsed = elapsedSec / 3600;

        // --- 农场离线结算 ---
        const farmPlots = await getFarmData(uid, 6);
        for (let i=0;i<farmPlots.length;i++) {
          const plot = farmPlots[i];
          if (plot.status !== "growing" || !plot.cropType) continue;

          const cfg = CROP_CFG[plot.cropType];
          if (!cfg) continue;

          const plantedMs = new Date(plot.plantedAt).getTime();
          const growthNeededMs = plot.growthHours * 3600 * 1000;
          const matureMs = plantedMs + growthNeededMs;
          const lastWaterMs = plot.lastWatered ? new Date(plot.lastWatered).getTime() : plantedMs;
          const wiltMs = lastWaterMs + (plot.wiltHours * 3600 * 1000);

          if (state.autoFarm === 1) {
            // 自动浇灌：如果水分低于 50% 且未枯死
            const waterIntervalMs = plot.waterHours * 3600 * 1000;
            const waterThresholdMs = lastWaterMs + waterIntervalMs * 0.5;
            if (nowMs >= waterThresholdMs && nowMs < wiltMs) {
              plot.lastWatered = new Date().toISOString();
              await execTurso(
                "UPDATE game_farm_plots SET last_watered=? WHERE user_id=? AND plot_index=?",
                [now, uid, plot.plotIndex]
              );
              await logGameEvent(uid, "auto_water", plot.cropType, 0, 0, "自动浇灌机器人浇了水");
            }
          }

          // 检查枯死
          if (nowMs >= wiltMs && nowMs < matureMs) {
            plot.status = "withered";
            await execTurso(
              "UPDATE game_farm_plots SET status='withered' WHERE user_id=? AND plot_index=?",
              [uid, plot.plotIndex]
            );
            await logGameEvent(uid, "crop_withered", plot.cropType, 0, 0, cfg.name+"枯死了！");
            continue;
          }

          // 检查成熟
          if (nowMs >= matureMs && nowMs < wiltMs) {
            plot.status = "mature";
            await execTurso(
              "UPDATE game_farm_plots SET status='mature' WHERE user_id=? AND plot_index=?",
              [uid, plot.plotIndex]
            );
            await logGameEvent(uid, "crop_mature", plot.cropType, 0, 0, cfg.name+"成熟了！可收获");
          }
        }

        // --- 自动种植（机器人） ---
        if (state.autoFarm === 1) {
          const stockQ = await execTurso("SELECT item_id,quantity FROM game_shop_stock WHERE user_id=?",[uid]);
          const stock = {};
          const sr = stockQ.data.results?.[0]?.response?.result || stockQ.data.results?.[0]?.response?.results || stockQ.data;
          if (sr && sr.rows) {
            for (let i=0;i<sr.rows.length;i++) {
              stock[sr.rows[i][0]?.value??sr.rows[i][0]] = parseInt(sr.rows[i][1]?.value??sr.rows[i][1]??0);
            }
          }
          for (let i=0;i<farmPlots.length;i++) {
            if (farmPlots[i].status !== "empty") continue;
            const seedTypes = Object.keys(CROP_CFG);
            for (let j=0;j<seedTypes.length;j++) {
              const seedId = "seeds_"+seedTypes[j];
              if ((stock[seedId]||0) > 0) {
                stock[seedId]--;
                const ct = CROP_CFG[seedTypes[j]];
                await execTurso(
                  "UPDATE game_farm_plots SET crop_type=?,planted_at=?,growth_hours=?,water_hours=?,wilt_hours=?,last_watered=?,status='growing' WHERE user_id=? AND plot_index=?",
                  [seedTypes[j], now, ct.growthHours, ct.waterHours, ct.wiltHours, now, uid, i]
                );
                await execTurso(
                  "UPDATE game_shop_stock SET quantity=? WHERE user_id=? AND item_id=?",
                  [stock[seedId], uid, seedId]
                );
                await logGameEvent(uid, "auto_plant", seedTypes[j], 1, 0, "自动种植机器人种了"+ct.name);
                farmPlots[i].status = "growing";
                farmPlots[i].cropType = seedTypes[j];
                break;
              }
            }
          }
        }

        // --- 自动进货（机器人） ---
        if (state.autoRestock === 1) {
          const restocksPerHour = 1.0 * state.robotLevel;
          const expectedRestocks = Math.floor(restocksPerHour * hoursElapsed);
          if (expectedRestocks > 0) {
            const wholesaleKeys = Object.keys(WHOLESALE).filter(function(k){ return k.indexOf("seeds_")===0 || k.indexOf("fertilizer_")===0 || k==="auto_waterer"; });
            for (let r=0;r<Math.min(expectedRestocks,10);r++) {
              const pick = wholesaleKeys[Math.floor(Math.random() * wholesaleKeys.length)];
              const cost = WHOLESALE[pick];
              if (Math.random() < 0.7) {
                try {
                  const bn = "auto_restock_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
                  await gamePointsChange(uid, -cost, "自动进货机器人补货: "+pick, bn);
                  await execTurso(
                    "INSERT INTO game_shop_stock (user_id,item_id,quantity) VALUES (?,?,1) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+1",
                    [uid, pick]
                  );
                  totalPointsChange -= cost;
                  await logGameEvent(uid, "auto_restock", pick, 1, -cost, "机器人自动进货");
                  state.totalCost = (state.totalCost||0) + cost;
                } catch(e) {}
              }
            }
          }
        }

        // --- 买家模拟（商店销售） ---
        const shopData = await getShopData(uid);
        const purchasesPerHour = state.marketHeat * 3.0;
        const expectedPurchases = purchasesPerHour * hoursElapsed;
        const actualPurchases = Math.floor(expectedPurchases) + (Math.random() < (expectedPurchases % 1) ? 1 : 0);

        for (let p=0;p<Math.min(actualPurchases,20);p++) {
          const available = shopData.shelves.filter(function(s){ return s.quantity > 0; });
          if (available.length === 0) break;
          const shelf = available[Math.floor(Math.random() * available.length)];
          const revenue = shelf.sellPrice;
          shelf.quantity--;
          try {
            const bn = "buyer_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
            await gamePointsChange(uid, revenue, "买家购买: "+shelf.itemName, bn);
            totalPointsChange += revenue;
            state.totalRevenue = (state.totalRevenue||0) + revenue;
            await logGameEvent(uid, "buyer_purchase", shelf.itemId, 1, revenue, "买家购买了1个"+shelf.itemName+"，收入"+revenue+"分");
          } catch(e) {}
          if (shelf.quantity <= 0) {
            await execTurso("DELETE FROM game_shelves WHERE id=?",[shelf.id]);
          } else {
            await execTurso("UPDATE game_shelves SET quantity=? WHERE id=?",[shelf.quantity, shelf.id]);
          }
        }

        // 更新引擎状态
        state.marketHeat = Math.max(0.1, Math.min(1.0, state.marketHeat + (Math.random() - 0.5) * 0.1));
        const newTotalRevenue = (state.totalRevenue||0);
        const newTotalCost = (state.totalCost||0);
        await execTurso(
          "UPDATE game_engine_state SET last_tick=?,market_heat=?,total_revenue=?,total_cost=?,updated_at=? WHERE user_id=?",
          [now, state.marketHeat, newTotalRevenue, newTotalCost, now, uid]
        );
        state.lastTick = now;

        const finalShop = await getShopData(uid);
        const finalFarm = await getFarmData(uid, 6);
        await logGameEvent(uid, "engine_tick", "", 0, totalPointsChange, "引擎TICK完成，积分变动"+totalPointsChange+"，耗时"+Math.round(elapsedSec)+"秒");
        return { state, shop: finalShop, farm: finalFarm, tickElapsed: Math.round(elapsedSec), pointsChange: totalPointsChange };
      };

      // ====== 动作路由 ======
      if (action === "tick") {
        const result = await engineTick(userId);
        return jsonResponse({ ok:true, ...result });
      }

      if (action === "getState") {
        const state = await getEngineState(userId);
        const shop = await getShopData(userId);
        const farm = await getFarmData(userId, 6);
        return jsonResponse({ ok:true, state, shop, farm });
      }

      // 进货：消耗积分为商品库存
      if (action === "restock") {
        const { itemId, quantity } = body;
        const qty = Math.min(Math.max(parseInt(quantity)||1, 1), 99);
        const cost = getCost(itemId);
        if (!cost) return jsonResponse({ error:"未知商品: "+itemId }, 400);
        const totalCost = cost * qty;
        const bn = "restock_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
        try {
          await gamePointsChange(userId, -totalCost, "进货: "+itemId+" x"+qty, bn);
        } catch(e) {
          return jsonResponse({ error:"积分不足或操作失败: "+e.message }, 400);
        }
        await execTurso(
          "INSERT INTO game_shop_stock (user_id,item_id,quantity) VALUES (?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+?",
          [userId, itemId, qty, qty]
        );
        const state = await getEngineState(userId);
        state.totalCost = (state.totalCost||0) + totalCost;
        await execTurso("UPDATE game_engine_state SET total_cost=? WHERE user_id=?",[state.totalCost, userId]);
        await logGameEvent(userId, "restock", itemId, qty, -totalCost, "进货"+itemId+" x"+qty+"，花费"+totalCost+"分");
        const shop = await getShopData(userId);
        return jsonResponse({ ok:true, shop });
      }

      // 上架：从库存放到货架
      if (action === "shelf_add") {
        const { itemId, profitPct } = body;
        const pPct = Math.max(0.01, Math.min(5.0, parseFloat(profitPct)||0.3));
        const cost = getCost(itemId);
        const sellPrice = Math.round(cost * (1 + pPct));
        const itemName = getItemName(itemId);

        const sq = await execTurso("SELECT quantity FROM game_shop_stock WHERE user_id=? AND item_id=?",[userId, itemId]);
        const sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        const stockQty = sir && sir.rows && sir.rows.length>0 ? parseInt(sir.rows[0][0]?.value??sir.rows[0][0]??0) : 0;
        if (stockQty <= 0) return jsonResponse({ error:"库存不足" }, 400);

        await execTurso("UPDATE game_shop_stock SET quantity=quantity-1 WHERE user_id=? AND item_id=?",[userId, itemId]);
        const shelfId = "shf_"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
        await execTurso(
          "INSERT INTO game_shelves (id,user_id,item_id,item_name,cost_price,profit_pct,sell_price,quantity,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)",
          [shelfId, userId, itemId, itemName, cost, pPct, sellPrice, now, now]
        );
        await logGameEvent(userId, "shelf_add", itemId, 1, 0, "上架"+itemName+"，售价"+sellPrice+"分");
        const shop = await getShopData(userId);
        return jsonResponse({ ok:true, shop });
      }

      // 下架
      if (action === "shelf_remove") {
        const { shelfId } = body;
        const sq = await execTurso("SELECT item_id,quantity FROM game_shelves WHERE id=? AND user_id=?",[shelfId, userId]);
        const sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        if (!sir || !sir.rows || sir.rows.length===0) return jsonResponse({ error:"货架商品不存在" }, 400);
        const itemId = sir.rows[0][0]?.value??sir.rows[0][0];
        const qty = parseInt(sir.rows[0][1]?.value??sir.rows[0][1]??0);
        await execTurso("DELETE FROM game_shelves WHERE id=?",[shelfId]);
        if (qty > 0) {
          await execTurso(
            "INSERT INTO game_shop_stock (user_id,item_id,quantity) VALUES (?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+?",
            [userId, itemId, qty, qty]
          );
        }
        await logGameEvent(userId, "shelf_remove", itemId, qty, 0, "下架"+itemId+" x"+qty);
        const shop = await getShopData(userId);
        return jsonResponse({ ok:true, shop });
      }

      // 更新利润比例
      if (action === "shelf_update") {
        const { shelfId, profitPct } = body;
        const pPct = Math.max(0.01, Math.min(5.0, parseFloat(profitPct)||0.3));
        const sq = await execTurso("SELECT cost_price FROM game_shelves WHERE id=? AND user_id=?",[shelfId, userId]);
        const sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        if (!sir || !sir.rows || sir.rows.length===0) return jsonResponse({ error:"货架商品不存在" }, 400);
        const cost = parseInt(sir.rows[0][0]?.value??sir.rows[0][0]??0);
        const sellPrice = Math.round(cost * (1 + pPct));
        await execTurso(
          "UPDATE game_shelves SET profit_pct=?,sell_price=?,updated_at=? WHERE id=?",
          [pPct, sellPrice, now, shelfId]
        );
        await logGameEvent(userId, "shelf_update_price", "", 0, 0, "调整利润率至"+(pPct*100).toFixed(0)+"%");
        const shop = await getShopData(userId);
        return jsonResponse({ ok:true, shop });
      }

      // 种植
      if (action === "plant") {
        const { plotIndex, cropType } = body;
        const cfg = CROP_CFG[cropType];
        if (!cfg) return jsonResponse({ error:"未知作物: "+cropType }, 400);
        const seedId = "seeds_"+cropType;
        const sq = await execTurso("SELECT quantity FROM game_shop_stock WHERE user_id=? AND item_id=?",[userId, seedId]);
        const sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        const seedQty = sir && sir.rows && sir.rows.length>0 ? parseInt(sir.rows[0][0]?.value??sir.rows[0][0]??0) : 0;
        if (seedQty <= 0) return jsonResponse({ error:"没有"+cfg.name+"种子！请先进货" }, 400);

        const pq = await execTurso("SELECT status FROM game_farm_plots WHERE user_id=? AND plot_index=?",[userId, plotIndex]);
        const pir = pq.data.results?.[0]?.response?.result || pq.data.results?.[0]?.response?.results || pq.data;
        const curStatus = pir && pir.rows && pir.rows.length>0 ? (pir.rows[0][0]?.value??pir.rows[0][0]) : "empty";
        if (curStatus !== "empty") return jsonResponse({ error:"这块地已经种了东西" }, 400);

        await execTurso("UPDATE game_shop_stock SET quantity=quantity-1 WHERE user_id=? AND item_id=?",[userId, seedId]);
        await execTurso(
          "UPDATE game_farm_plots SET crop_type=?,planted_at=?,growth_hours=?,water_hours=?,wilt_hours=?,last_watered=?,status='growing' WHERE user_id=? AND plot_index=?",
          [cropType, now, cfg.growthHours, cfg.waterHours, cfg.wiltHours, now, userId, plotIndex]
        );
        await logGameEvent(userId, "plant", cropType, 1, 0, "种下了"+cfg.name);
        const farm = await getFarmData(userId, 6);
        return jsonResponse({ ok:true, farm });
      }

      // 收获
      if (action === "harvest") {
        const { plotIndex } = body;
        const pq = await execTurso("SELECT crop_type,status FROM game_farm_plots WHERE user_id=? AND plot_index=?",[userId, plotIndex]);
        const pir = pq.data.results?.[0]?.response?.result || pq.data.results?.[0]?.response?.results || pq.data;
        if (!pir || !pir.rows || pir.rows.length===0) return jsonResponse({ error:"地块不存在" }, 400);
        const cropType = pir.rows[0][0]?.value??pir.rows[0][0];
        const curStatus = pir.rows[0][1]?.value??pir.rows[0][1];
        if (curStatus === "empty" || !cropType) return jsonResponse({ error:"空地没东西可收" }, 400);
        if (curStatus === "withered") return jsonResponse({ error:"已经枯死了" }, 400);
        if (curStatus !== "mature") return jsonResponse({ error:"还没成熟" }, 400);

        await execTurso(
          "UPDATE game_farm_plots SET crop_type=NULL,planted_at=NULL,growth_hours=0,water_hours=0,wilt_hours=0,last_watered=NULL,status='empty' WHERE user_id=? AND plot_index=?",
          [userId, plotIndex]
        );
        await execTurso(
          "INSERT INTO game_shop_stock (user_id,item_id,quantity) VALUES (?,?,1) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+1",
          [userId, cropType]
        );
        const cfg = CROP_CFG[cropType];
        await logGameEvent(userId, "harvest", cropType, 1, 0, "收获了"+(cfg?cfg.name:cropType)+"，已存入商店库存");
        const farm = await getFarmData(userId, 6);
        const shop = await getShopData(userId);
        return jsonResponse({ ok:true, farm, shop });
      }

      // 浇水
      if (action === "water") {
        const { plotIndex } = body;
        const pq = await execTurso("SELECT status FROM game_farm_plots WHERE user_id=? AND plot_index=?",[userId, plotIndex]);
        const pir = pq.data.results?.[0]?.response?.result || pq.data.results?.[0]?.response?.results || pq.data;
        const curStatus = pir && pir.rows && pir.rows.length>0 ? (pir.rows[0][0]?.value??pir.rows[0][0]) : "empty";
        if (curStatus === "empty") return jsonResponse({ error:"空地不需要浇水" }, 400);
        if (curStatus === "withered") return jsonResponse({ error:"已经枯死了" }, 400);
        if (curStatus === "mature") return jsonResponse({ error:"已成熟，请收获" }, 400);

        await execTurso(
          "UPDATE game_farm_plots SET last_watered=? WHERE user_id=? AND plot_index=?",
          [now, userId, plotIndex]
        );
        await logGameEvent(userId, "water", "", 0, 0, "浇水了地块"+plotIndex);
        const farm = await getFarmData(userId, 6);
        return jsonResponse({ ok:true, farm });
      }

      // 清除枯死
      if (action === "clear_dead") {
        const { plotIndex } = body;
        await execTurso(
          "UPDATE game_farm_plots SET crop_type=NULL,planted_at=NULL,growth_hours=0,water_hours=0,wilt_hours=0,last_watered=NULL,status='empty' WHERE user_id=? AND plot_index=? AND status='withered'",
          [userId, plotIndex]
        );
        await logGameEvent(userId, "clear_dead", "", 0, 0, "清除了枯死作物");
        const farm = await getFarmData(userId, 6);
        return jsonResponse({ ok:true, farm });
      }

      // 切换机器人开关
      if (action === "toggle_robot") {
        const { robotType } = body;
        const field = robotType === "auto_restock" ? "auto_restock" : "auto_farm";
        const sq = await execTurso("SELECT "+field+" FROM game_engine_state WHERE user_id=?",[userId]);
        const sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        const curVal = sir && sir.rows && sir.rows.length>0 ? parseInt(sir.rows[0][0]?.value??sir.rows[0][0]??0) : 0;
        const newVal = curVal ? 0 : 1;
        await execTurso("UPDATE game_engine_state SET "+field+"=? WHERE user_id=?",[newVal, userId]);
        const state = await getEngineState(userId);
        await logGameEvent(userId, "toggle_robot", robotType, 0, 0, (newVal?"开启":"关闭")+"了"+(robotType==="auto_restock"?"自动进货":"自动农场"));
        return jsonResponse({ ok:true, state });
      }

      return jsonResponse({ error: "未知游戏动作: "+(action||"空") }, 400);
    }

    return jsonResponse({ error: "未知路径" }, 404);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}