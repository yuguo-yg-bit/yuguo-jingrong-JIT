// ============================================================
// 玉国金融 Val.town 邮箱触发器（独立部署）
// 功能：接收邮箱入站 → 提取验证码 → 匹配数据库 → 创建用户
// 部署为独立的 Val，类型选 Email Handler
// 邮箱触发器地址（Val.town 自动生成）:
//   yuguoygbit-a648aa1cd06811f18f8b1607ee4eb77e@valtown.email
// ============================================================

export default async function (email) {
  const TURSO_API = process.env.TURSO_API_URL;
  const TURSO_TOKEN = process.env.TURSO_RW_TOKEN;

  if (!TURSO_API || !TURSO_TOKEN) {
    return new Response("Missing env vars: TURSO_API_URL or TURSO_RW_TOKEN", { status: 500 });
  }

  // Val.town email 对象结构: { from, to, subject, text, html, date }
  console.log("[EMAIL-TRIGGER] ========== 收到邮件 ==========");
  console.log("[EMAIL-TRIGGER] 完整 email 对象:", JSON.stringify({
    from: email.from,
    to: email.to,
    subject: email.subject,
    text: email.text ? email.text.substring(0, 200) : "",
    date: email.date
  }));

  const body = (email.text || "").trim();
  const rawFrom = email.from || "";

  console.log("[EMAIL-TRIGGER] 发件人原始值:", rawFrom);
  console.log("[EMAIL-TRIGGER] 邮件正文(前300字):", body.substring(0, 300));

  // ========= 多途径提取发件人真实邮箱 =========
  // 策略：邮件可能经过 yuconemail.cc.cd 转发，From 头可能被改写。
  // 前端 mailto 链接的 body 里写了「注册邮箱：xxx@xxx.com」，从这里提取最可靠。
  var senderEmail = "";

  // 途径1: 从邮件正文提取「注册邮箱：」后面的邮箱地址
  var bodyEmailMatch = body.match(/注册邮箱[：:]\s*([^\s\n\r]+@[^\s\n\r]+)/i);
  if (bodyEmailMatch && bodyEmailMatch[1]) {
    senderEmail = bodyEmailMatch[1].trim().toLowerCase();
    console.log("[EMAIL-TRIGGER] 途径1-从正文提取邮箱:", senderEmail);
  }

  // 途径2: 从邮件正文提取任意邮箱（用户名注册的 mailto body 带了注册邮箱）
  if (!senderEmail || !/@/.test(senderEmail)) {
    var anyEmailMatch = body.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
    if (anyEmailMatch && anyEmailMatch.length > 0) {
      // 排除系统邮箱
      for (var ei = 0; ei < anyEmailMatch.length; ei++) {
        var candidate = anyEmailMatch[ei].trim().toLowerCase();
        if (candidate.indexOf("yuguoemail@") < 0 && candidate.indexOf("valtown.email") < 0 && candidate.indexOf("noreply@") < 0) {
          senderEmail = candidate;
          console.log("[EMAIL-TRIGGER] 途径2-从正文匹配邮箱:", senderEmail);
          break;
        }
      }
    }
  }

  // 途径3: 从 email.from 提取（标准格式 "Name <email>"）
  if (!senderEmail || !/@/.test(senderEmail)) {
    var senderMatch = rawFrom.match(/<([^>]+)>/);
    var extracted = (senderMatch ? senderMatch[1] : rawFrom).trim().toLowerCase();
    if (extracted && /@/.test(extracted)) {
      senderEmail = extracted;
      console.log("[EMAIL-TRIGGER] 途径3-从From头提取邮箱:", senderEmail);
    }
  }

  // 途径4: email.from 本身就是纯邮箱
  if (!senderEmail || !/@/.test(senderEmail)) {
    var cleanFrom = rawFrom.trim().toLowerCase();
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanFrom)) {
      senderEmail = cleanFrom;
      console.log("[EMAIL-TRIGGER] 途径4-From头即邮箱:", senderEmail);
    }
  }

  if (!senderEmail || !/@/.test(senderEmail)) {
    console.log("[EMAIL-TRIGGER] ❌ 无法提取发件人邮箱, rawFrom=" + rawFrom + " body(前200)=" + body.substring(0, 200));
    return new Response("Could not extract sender email from: " + rawFrom, { status: 400 });
  }

  console.log("[EMAIL-TRIGGER] 最终使用的发件人邮箱:", senderEmail);

  // 从邮件正文提取 6 位验证码（转发模式下可以没有验证码）
  const codeMatch = body.match(/\b(\d{6})\b/);
  const code = codeMatch ? codeMatch[1] : null;

  console.log("[EMAIL-TRIGGER] 提取的验证码:", code);

  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  console.log("[EMAIL-TRIGGER] 当前时间:", now);

  try {
    // 1. 查 email_verifications 表：优先匹配邮箱 + 验证码；无验证码时按发件邮箱匹配最近的待验证记录
    console.log("[EMAIL-TRIGGER] 🔍 查询 email_verifications: email=" + senderEmail + " code=" + code);

    const regSql = code
      ? "SELECT username, password_hash, full_name, birthdate, country, province, city, referrer, COALESCE(purpose,'') as purpose FROM email_verifications WHERE email=? AND code=? AND status='pending'"
      : "SELECT username, password_hash, full_name, birthdate, country, province, city, referrer, COALESCE(purpose,'') as purpose FROM email_verifications WHERE email=? AND status='pending' AND created_at>=? ORDER BY created_at DESC LIMIT 1";
    const regArgs = code ? [senderEmail, code] : [senderEmail, cutoff];

    const checkRes = await fetch(TURSO_API, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + TURSO_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests: [{
          type: "execute",
          stmt: {
            sql: regSql,
            args: regArgs.map(function(v) { return { type: "text", value: String(v) }; })
          }
        }]
      })
    });

    const checkData = await checkRes.json();
    const rows = (checkData.results?.[0]?.response?.result?.rows || []);

    console.log("[EMAIL-TRIGGER] Turso响应状态:", checkRes.status);
    console.log("[EMAIL-TRIGGER] 匹配到的注册记录行数:", rows.length);
    if (checkData.results?.[0]?.error) {
      console.log("[EMAIL-TRIGGER] ❌ Turso错误:", JSON.stringify(checkData.results[0].error));
    }

    // 1.5 没有注册记录时，尝试匹配「老用户绑定邮箱」记录
    if (rows.length === 0) {
      const bindSql = code
        ? "SELECT username FROM email_bindings WHERE email=? AND code=? AND status='pending'"
        : "SELECT username FROM email_bindings WHERE email=? AND status='pending' AND created_at>=? ORDER BY created_at DESC LIMIT 1";
      const bindArgs = code ? [senderEmail, code] : [senderEmail, cutoff];
      const bindRes = await fetch(TURSO_API, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + TURSO_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          requests: [{
            type: "execute",
            stmt: { sql: bindSql, args: bindArgs.map(function(v) { return { type: "text", value: String(v) }; }) }
          }]
        })
      });
      const bindData = await bindRes.json();
      const bindRows = (bindData.results?.[0]?.response?.result?.rows || []);
      console.log("[EMAIL-TRIGGER] 匹配到的绑定记录行数:", bindRows.length);

      if (bindRows.length > 0) {
        const bindUser = bindRows[0][0] && typeof bindRows[0][0] === "object" ? bindRows[0][0].value : bindRows[0][0];
        console.log("[EMAIL-TRIGGER] ✅ 绑定邮箱验证通过: " + bindUser + " <- " + senderEmail);
        const bindWrite = await fetch(TURSO_API, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + TURSO_TOKEN,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            requests: [
              { type: "execute", stmt: { sql: "UPDATE email_bindings SET status='verified', verified_at=? WHERE email=? AND username=?", args: [now, senderEmail, bindUser].map(function(v) { return { type: "text", value: String(v) }; }) } },
              { type: "execute", stmt: { sql: "UPDATE users SET email=?, updated_at=? WHERE id=?", args: [senderEmail, now, bindUser].map(function(v) { return { type: "text", value: String(v) }; }) } },
              { type: "execute", stmt: { sql: "UPDATE registrations SET email=?, oauth_id=?, oauth_email=? WHERE username=?", args: [senderEmail, senderEmail, senderEmail, bindUser].map(function(v) { return { type: "text", value: String(v) }; }) } }
            ]
          })
        });
        console.log("[EMAIL-TRIGGER] 绑定写入状态:", bindWrite.status);
        return new Response("OK - Email bound for user " + bindUser + " via " + senderEmail, { status: 200 });
      }

      console.log("[EMAIL-TRIGGER] ❌ 未匹配到待验证记录，完整响应的results:", JSON.stringify(checkData.results).substring(0, 500));
      return new Response("No matching pending verification. Email: " + senderEmail + " Code: " + (code || "(none)"), { status: 404 });
    }

    console.log("[EMAIL-TRIGGER] ✅ 找到匹配记录!");

    // 2. 提取用户数据
    const row = rows[0];
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
    const purpose = gv(row[8]) || "";

    // 如果是重置密码验证，只标记验证通过，不创建用户
    if (purpose === "reset") {
      console.log("[EMAIL-TRIGGER] 检测到重置密码验证，仅标记验证状态");
      await fetch(TURSO_API, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + TURSO_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          requests: [{
            type: "execute",
            stmt: {
              sql: "UPDATE email_verifications SET status='verified', verified_at=? WHERE email=?",
              args: [
                { type: "text", value: now },
                { type: "text", value: senderEmail }
              ]
            }
          }]
        })
      });
      console.log("[EMAIL-TRIGGER] 重置密码验证码已通过");
      return new Response("Reset password verification confirmed for: " + senderEmail, { status: 200 });
    }

    const regId = crypto.randomUUID
      ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).substring(2, 15));

    console.log("[EMAIL-TRIGGER] 用户数据: username=" + username + " fullName=" + fullName + " regId=" + regId);

    // 3. 标记验证通过 + 创建用户（免审核 approved）+ 写入 registrations 表
    console.log("[EMAIL-TRIGGER] ✍️ 写入数据库: 更新验证状态 + 创建用户 + 插入registrations");
    var writeErrors = [];

    // 步骤0: 标记 email_verifications 为已验证
    var u0 = await fetch(TURSO_API, {
      method: "POST",
      headers: { "Authorization": "Bearer " + TURSO_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          type: "execute",
          stmt: {
            sql: "UPDATE email_verifications SET status='verified', verified_at=? WHERE email=?",
            args: [{ type: "text", value: now }, { type: "text", value: senderEmail }]
          }
        }]
      })
    });
    var d0 = await u0.json();
    console.log("[EMAIL-TRIGGER] 步骤0-标记验证状态:", u0.status, d0.results?.[0]?.error ? JSON.stringify(d0.results[0].error) : "OK");

    // 步骤1: 写入 registrations（列名与主代理 /oauth/email/verify-code 完全一致）
    var u1 = await fetch(TURSO_API, {
      method: "POST",
      headers: { "Authorization": "Bearer " + TURSO_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          type: "execute",
          stmt: {
            sql: "INSERT OR REPLACE INTO registrations (id, username, password_hash, full_name, birthdate, country, province, city, referrer, review_status, oauth_provider, oauth_id, oauth_email, email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            args: [
              { type: "text", value: regId },
              { type: "text", value: username },
              { type: "text", value: passwordHash },
              { type: "text", value: fullName },
              { type: "text", value: birthdate || "" },
              { type: "text", value: country || "" },
              { type: "text", value: province || "" },
              { type: "text", value: city || "" },
              { type: "text", value: referrer || "" },
              { type: "text", value: "approved" },
              { type: "text", value: "email" },
              { type: "text", value: senderEmail },
              { type: "text", value: senderEmail },
              { type: "text", value: senderEmail },
              { type: "text", value: now }
            ]
          }
        }]
      })
    });
    var d1 = await u1.json();
    if (d1.results?.[0]?.error) { writeErrors.push("registrations: " + JSON.stringify(d1.results[0].error)); }
    console.log("[EMAIL-TRIGGER] 步骤1-registrations:", u1.status, d1.results?.[0]?.error ? "ERR:" + JSON.stringify(d1.results[0].error) : "OK");

    // 步骤2: 写入 users（与主代理 /oauth/email/verify-code 完全一致）
    var u2 = await fetch(TURSO_API, {
      method: "POST",
      headers: { "Authorization": "Bearer " + TURSO_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          type: "execute",
          stmt: {
            sql: "INSERT INTO users (id, password_hash, full_name, birthdate, country, province, city, referrer, review_status, oauth_provider, oauth_id, email, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET oauth_provider=EXCLUDED.oauth_provider, oauth_id=EXCLUDED.oauth_id, email=EXCLUDED.email, updated_at=EXCLUDED.updated_at",
            args: [
              { type: "text", value: username },
              { type: "text", value: passwordHash },
              { type: "text", value: fullName },
              { type: "text", value: birthdate || "" },
              { type: "text", value: country || "" },
              { type: "text", value: province || "" },
              { type: "text", value: city || "" },
              { type: "text", value: referrer || "" },
              { type: "text", value: "approved" },
              { type: "text", value: "email" },
              { type: "text", value: senderEmail },
              { type: "text", value: senderEmail },
              { type: "text", value: now },
              { type: "text", value: now }
            ]
          }
        }]
      })
    });
    var d2 = await u2.json();
    if (d2.results?.[0]?.error) { writeErrors.push("users: " + JSON.stringify(d2.results[0].error)); }
    console.log("[EMAIL-TRIGGER] 步骤2-users:", u2.status, d2.results?.[0]?.error ? "ERR:" + JSON.stringify(d2.results[0].error) : "OK");

    // 步骤3: 确保 user_levels 记录存在
    try {
      await fetch(TURSO_API, {
        method: "POST",
        headers: { "Authorization": "Bearer " + TURSO_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            type: "execute",
            stmt: {
              sql: "INSERT OR IGNORE INTO user_levels (user_id, level, exp, joined_at) VALUES (?,0,0,?)",
              args: [{ type: "text", value: username }, { type: "text", value: now }]
            }
          }]
        })
      });
      console.log("[EMAIL-TRIGGER] 步骤3-user_levels: OK");
    } catch (e3) {
      console.log("[EMAIL-TRIGGER] 步骤3-user_levels 忽略错误:", e3.message);
    }

    if (writeErrors.length > 0) {
      console.log("[EMAIL-TRIGGER] ❌ 写入失败! 错误列表:", JSON.stringify(writeErrors));
      return new Response("Write errors: " + writeErrors.join("; "), { status: 500 });
    }

    console.log("[EMAIL-TRIGGER] 🎉 验证完成! User " + username + " via " + senderEmail);
    return new Response("OK - User " + username + " verified via " + senderEmail, { status: 200 });

  } catch (e) {
    console.log("[EMAIL-TRIGGER] ❌ 异常:", e.message || "unknown");
    console.log("[EMAIL-TRIGGER] ❌ 堆栈:", e.stack || "no stack");
    return new Response("Internal error: " + (e.message || "unknown"), { status: 500 });
  }
}