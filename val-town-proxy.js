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
      "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
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

      if (!sql) {
        return jsonResponse({ error: "缺少 sql 参数" }, 400);
      }

      const { ok: tursoOk, status: tursoStatus, data } = await execTurso(sql, params);

      if (!tursoOk) {
        throw new Error(`Turso HTTP ${tursoStatus}: ${JSON.stringify(data).substring(0, 300)}`);
      }

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
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        await execTurso(
          "INSERT INTO oauth_tokens (token, username, oauth_id, provider, created_at, expires_at) VALUES (?,?,?,?,?,?)",
          [token, "", email.toLowerCase(), "email", now, expiresAt]
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
                subject: "玉国金融 - 登录链接",
                html: '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;">' +
                  '<h2 style="color:#b8860b;">玉国金融</h2>' +
                  '<p>您好！</p>' +
                  '<p>点击下方按钮即可登录：</p>' +
                  '<a href="' + magicLink + '" style="display:inline-block;background:#b8860b;color:#fff;padding:12px 30px;text-decoration:none;border-radius:6px;font-size:16px;margin:16px 0;">登录玉国金融</a>' +
                  '<p style="color:#999;font-size:12px;">此链接 15 分钟内有效。如非本人操作请忽略。</p>' +
                  '<p style="color:#999;font-size:12px;">链接：' + magicLink + '</p>' +
                  '</div>'
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
        return jsonResponse({ ok: true, magicLink: magicLink, message: "邮件发送失败，请使用下方链接直接登录" });
      } catch (e) {
        return jsonResponse({ error: "发送失败: " + (e.message || "未知错误") }, 500);
      }
    }

    // ========== Email 魔法链接验证 ==========
    if (path === "/oauth/email/verify" && req.method === "POST") {
      const { token, email } = await req.json();
      if (!token || !email) return jsonResponse({ error: "缺少 token 或 email 参数" }, 400);

      try {
        // 1. 验证 token
        const now = new Date().toISOString();
        const { data: tokenData } = await execTurso(
          "SELECT username, oauth_id, provider, expires_at FROM oauth_tokens WHERE token=? AND provider='email' AND oauth_id=?",
          [token, email.toLowerCase()]
        );
        const tokenResult = tokenData.results?.[0];
        if (!tokenResult || tokenResult.type === "error" || !tokenResult.response?.result?.rows?.length) {
          return jsonResponse({ error: "链接无效或已过期" }, 401);
        }
        const rows = tokenResult.response.result.rows;
        const tokenExpires = (typeof rows[0][3] === "object" && "value" in rows[0][3]) ? rows[0][3].value : rows[0][3];
        if (tokenExpires < now) return jsonResponse({ error: "链接已过期，请重新发送" }, 401);

        // 2. 删除已用的 token
        await execTurso("DELETE FROM oauth_tokens WHERE token=?", [token]);

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