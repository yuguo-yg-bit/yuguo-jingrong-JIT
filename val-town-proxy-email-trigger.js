// ============================================================
// 玉国金融 Val.town 邮箱触发器（独立部署）
// 功能：接收邮箱入站 → 提取验证码 → 匹配数据库 → 创建用户
// 部署为独立的 Val，邮箱触发器地址:
//   yuguoygbit-a648aa1cd06811f18f8b1607ee4eb77e@valtown.email
// ============================================================

export default async function (email) {
  const TURSO_API = process.env.TURSO_API_URL;
  const TURSO_TOKEN = process.env.TURSO_RW_TOKEN;

  // 提取发件人邮箱
  const senderMatch = (email.from || "").match(/<([^>]+)>/);
  const senderEmail = (senderMatch ? senderMatch[1] : email.from || "").trim().toLowerCase();
  const body = (email.text || "").trim();

  // 从邮件正文提取 6 位验证码
  const codeMatch = body.match(/\b(\d{6})\b/);
  const code = codeMatch ? codeMatch[1] : null;

  if (!code) {
    return new Response("No verification code found in email body", { status: 400 });
  }

  const now = new Date().toISOString();

  try {
    // 1. 查 email_verifications 表：匹配邮箱 + 验证码 + 未验证状态
    const checkRes = await fetch(TURSO_API + "/v2/pipeline", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + TURSO_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests: [{
          type: "execute",
          stmt: {
            sql: "SELECT username, password_hash, full_name, birthdate, country, province, city, referrer FROM email_verifications WHERE email=? AND code=? AND status='pending'",
            args: [
              { type: "text", value: senderEmail },
              { type: "text", value: code }
            ]
          }
        }]
      })
    });

    const checkData = await checkRes.json();
    const rows = (checkData.results?.[0]?.response?.result?.rows || []);

    if (rows.length === 0) {
      return new Response("No matching pending verification found for " + senderEmail, { status: 404 });
    }

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

    const regId = crypto.randomUUID
      ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).substring(2, 15));

    // 3. 标记验证通过 + 创建用户（免审核 approved）+ 写入 registrations 表
    const stmts = [
      {
        sql: "UPDATE email_verifications SET status='verified', verified_at=? WHERE email=?",
        args: [
          { type: "text", value: now },
          { type: "text", value: senderEmail }
        ]
      },
      {
        sql: "INSERT OR REPLACE INTO registrations (id, username, password_hash, full_name, birthdate, country, province, city, referrer, review_status, oauth_provider, oauth_id, oauth_email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [
          { type: "text", value: regId },
          { type: "text", value: username },
          { type: "text", value: passwordHash },
          { type: "text", value: fullName },
          { type: "text", value: birthdate },
          { type: "text", value: country },
          { type: "text", value: province },
          { type: "text", value: city },
          { type: "text", value: referrer },
          { type: "text", value: "approved" },
          { type: "text", value: "email" },
          { type: "text", value: senderEmail },
          { type: "text", value: senderEmail },
          { type: "text", value: now }
        ]
      },
      {
        sql: "INSERT INTO users (id, password_hash, full_name, birthdate, country, province, city, referrer, review_status, oauth_provider, oauth_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET oauth_provider=EXCLUDED.oauth_provider, oauth_id=EXCLUDED.oauth_id, updated_at=EXCLUDED.updated_at",
        args: [
          { type: "text", value: username },
          { type: "text", value: passwordHash },
          { type: "text", value: fullName },
          { type: "text", value: birthdate },
          { type: "text", value: country },
          { type: "text", value: province },
          { type: "text", value: city },
          { type: "text", value: referrer },
          { type: "text", value: "approved" },
          { type: "text", value: "email" },
          { type: "text", value: senderEmail },
          { type: "text", value: now },
          { type: "text", value: now }
        ]
      }
    ];

    await fetch(TURSO_API + "/v2/pipeline", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + TURSO_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests: stmts.map(function(s) {
          return { type: "execute", stmt: s };
        })
      })
    });

    return new Response("OK - User " + username + " verified via email " + senderEmail, { status: 200 });

  } catch (e) {
    return new Response("Internal error: " + (e.message || ""), { status: 500 });
  }
}