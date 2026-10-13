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

    return jsonResponse({ error: "未知路径" }, 404);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}