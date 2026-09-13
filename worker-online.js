addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event.env));
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
  'Access-Control-Max-Age': '86400'
};

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const token = request.headers.get('X-Auth-Token');

  if (token !== env.AUTH_TOKEN) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    if (path === '/upload-image' && request.method === 'POST') {
      return handleImageUpload(request, env);
    }

    const body = await request.json();
    const sql = body.sql;
    const params = body.params || [];

    if (!sql) {
      return jsonResponse({ error: 'Missing sql' }, 400);
    }

    const stmt = env.Jrb.prepare(sql);
    const bound = params.reduce((s, p, i) => s.bind(p), stmt);

    if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('PRAGMA')) {
      const result = await bound.all();
      return jsonResponse(result);
    } else {
      const result = await bound.run();
      return jsonResponse(result);
    }
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function handleImageUpload(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { base64Data, folder } = body;
  if (!base64Data) {
    return jsonResponse({ error: 'Missing base64Data' }, 400);
  }

  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  const fileName = `${ts}-${rand}.jpg`;
  const filePath = folder ? `${folder}/${fileName}` : fileName;

  const repo = 'yuguo-yg-bit/yuguo-jingrong-JIT-images';
  const branch = 'main';

  const ghUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;

  const ghRes = await fetch(ghUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CloudflareWorker-JIT'
    },
    body: JSON.stringify({
      message: `Upload image ${folder || 'system'}`,
      content: base64Data,
      branch: branch
    })
  });

  const ghResult = await ghRes.json();

  if (!ghRes.ok) {
    return jsonResponse({ error: 'GitHub upload failed', details: ghResult }, 500);
  }

  return jsonResponse({
    ok: true,
    url: ghResult.content.download_url,
    path: filePath
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}