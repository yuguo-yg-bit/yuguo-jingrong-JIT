// ============================================================
// 玉国金融 游戏引擎（商店+农场+离线结算）
// 部署地址：https://yuguoygbit--8f55f7b6d02111f18f891607ee4eb77e.web.val.run
// 前端通过 /game 端点调用
// ============================================================

export default async function (req) {
  const ALLOW_ORIGINS = ["https://www.yuguojinrong.cc.cd","https://yuguo-yg-bit.github.io","https://yuguoygbit.github.io"];
  const TURSO_API = process.env.TURSO_API_URL;
  const TURSO_TOKEN = process.env.TURSO_RW_TOKEN;

  function getCorsHeaders(origin) {
    const allowed = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
    return {"Access-Control-Allow-Origin":allowed,"Access-Control-Allow-Methods":"GET, POST, PUT, DELETE, OPTIONS","Access-Control-Allow-Headers":"Content-Type, X-Auth-Token, X-Session-Token","Access-Control-Max-Age":"86400"};
  }
  function jsonResponse(data, status) {
    const origin = req.headers.get("origin") || "";
    return new Response(JSON.stringify(data), {status:status||200, headers:{...getCorsHeaders(origin),"Content-Type":"application/json"}});
  }
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") || "";
    return new Response(null, {status:204, headers:getCorsHeaders(origin)});
  }

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    // ========== Turso 执行器 ==========
    async function execTurso(sql, params) {
      var mkArg = function(v) { return { type:"text", value:String(v) }; };
      var args = (params||[]).map(mkArg);
      var tursoReq = { requests: [{ type:"execute", stmt:{ sql:sql, args:args } }] };
      var tursoRes = await fetch(TURSO_API, {
        method:"POST",
        headers: { Authorization:"Bearer "+TURSO_TOKEN, "Content-Type":"application/json" },
        body: JSON.stringify(tursoReq)
      });
      var rawText = await tursoRes.text();
      var data;
      try { data = JSON.parse(rawText); } catch(e) { throw new Error("Turso JSON: "+rawText.substring(0,200)); }
      return { ok:tursoRes.ok, status:tursoRes.status, data:data, rawText:rawText };
    }

    if (path === "/health") {
      return jsonResponse({ ok:true, time:new Date().toISOString() });
    }

    // ========== 会话校验 ==========
    async function requireSession() {
      const token = (req.headers.get("x-session-token") || "").trim();
      if (!token) return { error:"缺少登录会话" };
      const q = await execTurso("SELECT username, role, expires_at FROM sessions WHERE token=?",[token]);
      const rows = q.data?.results?.[0]?.response?.result?.rows || q.data?.results?.[0]?.response?.results?.rows || [];
      if (rows.length > 0) {
        const username = rows[0][0]?.value ?? rows[0][0];
        const role = rows[0][1]?.value ?? rows[0][1];
        const exp = rows[0][2]?.value ?? rows[0][2];
        if (exp && new Date(exp).getTime() < Date.now()) return { error:"会话已过期" };
        return { username:String(username), role:String(role||"user"), token };
      }
      const q2 = await execTurso("SELECT username, expires_at FROM oauth_tokens WHERE token=? LIMIT 1",[token]);
      const rows2 = q2.data?.results?.[0]?.response?.result?.rows || q2.data?.results?.[0]?.response?.results?.rows || [];
      if (rows2.length > 0) {
        const username = rows2[0][0]?.value ?? rows2[0][0];
        const expMs = Number(rows2[0][1]?.value ?? rows2[0][1] ?? 0);
        if (expMs > 0 && Date.now() >= expMs) return { error:"OAuth 会话已过期" };
        return { username:String(username), role:"user", token };
      }
      return { error:"会话无效" };
    }

    // ========== 共享数据配置 ==========
    const CROP_CFG = {
      wheat:{name:"小麦",emoji:"🌾",growthHours:2,waterHours:4,wiltHours:6},
      corn:{name:"玉米",emoji:"🌽",growthHours:4,waterHours:6,wiltHours:8},
      strawberry:{name:"草莓",emoji:"🍓",growthHours:3,waterHours:5,wiltHours:7},
      carrot:{name:"胡萝卜",emoji:"🥕",growthHours:5,waterHours:7,wiltHours:10},
      tomato:{name:"番茄",emoji:"🍅",growthHours:6,waterHours:8,wiltHours:12},
      sunflower:{name:"向日葵",emoji:"🌻",growthHours:8,waterHours:8,wiltHours:14}
    };
    const WHOLESALE = {
      wheat:40,corn:80,strawberry:110,carrot:100,tomato:120,sunflower:160,
      seeds_wheat:8,seeds_corn:16,seeds_strawberry:22,seeds_carrot:20,seeds_tomato:24,seeds_sunflower:32,
      fertilizer_basic:12,fertilizer_premium:32,auto_waterer:120
    };
    const getCost = function(itemId) {
      var c = WHOLESALE[itemId];
      if (c !== undefined) return c;
      if (CROP_CFG[itemId]) return CROP_CFG[itemId].growthHours * 5;
      return 20;
    };
    const getItemName = function(itemId) {
      if (CROP_CFG[itemId]) return CROP_CFG[itemId].name;
      var base = itemId.replace(/^seeds_/,"");
      if (CROP_CFG[base]) return CROP_CFG[base].name + "种子";
      return itemId;
    };

    // ========== 共享数据读取（引擎状态、商店、农场） ==========
    const getEngineState = async function(uid) {
      var nw = new Date().toISOString();
      var q = await execTurso("SELECT * FROM game_engine_state WHERE user_id=?",[uid]);
      var ir = q.data.results?.[0]?.response?.result || q.data.results?.[0]?.response?.results || q.data;
      if (ir && ir.rows && ir.rows.length > 0) {
        var r = ir.rows[0];
        return { userId:uid, lastTick:String(r[1]?.value ?? r[1] ?? nw), marketHeat:parseFloat(r[2]?.value ?? r[2] ?? 0.5), buyerFreq:parseInt(r[3]?.value ?? r[3] ?? 1800), autoRestock:parseInt(r[4]?.value ?? r[4] ?? 0), autoFarm:parseInt(r[5]?.value ?? r[5] ?? 0), robotLevel:parseInt(r[6]?.value ?? r[6] ?? 1), totalRevenue:parseInt(r[7]?.value ?? r[7] ?? 0), totalCost:parseInt(r[8]?.value ?? r[8] ?? 0) };
      }
      await execTurso("INSERT OR IGNORE INTO game_engine_state (user_id,last_tick,market_heat,buyer_freq,auto_restock,auto_farm,robot_level,total_revenue,total_cost,updated_at) VALUES (?,?,0.5,1800,0,0,1,0,0,?)",[uid,nw,nw]);
      return { userId:uid, lastTick:nw, marketHeat:0.5, buyerFreq:1800, autoRestock:0, autoFarm:0, robotLevel:1, totalRevenue:0, totalCost:0 };
    };
    const logGameEvent = async function(uid, evType, itemId, qty, amt, detail) {
      var nw = new Date().toISOString();
      var lid = "glog_"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      await execTurso("INSERT INTO game_engine_log (id,user_id,event_type,item_id,quantity,amount,detail,created_at) VALUES (?,?,?,?,?,?,?,?)",[lid,uid,evType,itemId||"",qty||0,amt||0,detail||"",nw]).catch(function(){});
    };
    const getShopData = async function(uid) {
      var sq = await execTurso("SELECT item_id,quantity FROM game_shop_stock WHERE user_id=?",[uid]);
      var stock = {};
      var sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
      if (sir && sir.rows) {
        for (var i=0;i<sir.rows.length;i++) {
          stock[sir.rows[i][0]?.value??sir.rows[i][0]] = parseInt(sir.rows[i][1]?.value??sir.rows[i][1]??0);
        }
      }
      var shq = await execTurso("SELECT * FROM game_shelves WHERE user_id=? ORDER BY created_at ASC",[uid]);
      var shelves = [];
      var shr = shq.data.results?.[0]?.response?.result || shq.data.results?.[0]?.response?.results || shq.data;
      if (shr && shr.rows) {
        for (var i=0;i<shr.rows.length;i++) {
          var r = shr.rows[i];
          shelves.push({ id:r[0]?.value??r[0], itemId:r[2]?.value??r[2], itemName:r[3]?.value??r[3], costPrice:parseInt(r[4]?.value??r[4]??0), profitPct:parseFloat(r[5]?.value??r[5]??0.3), sellPrice:parseInt(r[6]?.value??r[6]??0), quantity:parseInt(r[7]?.value??r[7]??0), createdAt:r[8]?.value??r[8], updatedAt:r[9]?.value??r[9] });
        }
      }
      var logQ = await execTurso("SELECT * FROM game_engine_log WHERE user_id=? ORDER BY created_at DESC LIMIT 30",[uid]);
      var logs = [];
      var lr = logQ.data.results?.[0]?.response?.result || logQ.data.results?.[0]?.response?.results || logQ.data;
      if (lr && lr.rows) {
        for (var i=0;i<lr.rows.length;i++) {
          var r = lr.rows[i];
          logs.push({ id:r[0]?.value??r[0], eventType:r[2]?.value??r[2], itemId:r[3]?.value??r[3], quantity:parseInt(r[4]?.value??r[4]??0), amount:parseInt(r[5]?.value??r[5]??0), detail:r[6]?.value??r[6], createdAt:r[7]?.value??r[7] });
        }
      }
      return { stock, shelves, logs };
    };
    const getFarmData = async function(uid, dls) {
      var landSize = dls || 6;
      var fq = await execTurso("SELECT * FROM game_farm_plots WHERE user_id=? ORDER BY plot_index ASC",[uid]);
      var plots = [];
      var fr = fq.data.results?.[0]?.response?.result || fq.data.results?.[0]?.response?.results || fq.data;
      var existingMap = {};
      if (fr && fr.rows) {
        for (var i=0;i<fr.rows.length;i++) {
          var r = fr.rows[i];
          var pi = parseInt((r[1]?.value ?? r[1]) || 0);
          existingMap[pi] = true;
          plots.push({ plotIndex:pi, cropType:(r[2]?.value ?? r[2]) || null, plantedAt:(r[3]?.value ?? r[3]) || null, growthHours:parseFloat((r[4]?.value ?? r[4]) || 0), waterHours:parseFloat((r[5]?.value ?? r[5]) || 0), wiltHours:parseFloat((r[6]?.value ?? r[6]) || 0), lastWatered:(r[7]?.value ?? r[7]) || null, status:(r[8]?.value ?? r[8]) || "empty" });
        }
      }
      for (var i=0;i<landSize;i++) {
        if (!existingMap[i]) {
          await execTurso("INSERT OR IGNORE INTO game_farm_plots (user_id,plot_index,crop_type,planted_at,growth_hours,water_hours,wilt_hours,last_watered,status) VALUES (?,?,NULL,NULL,0,0,0,NULL,'empty')",[uid,i]);
          plots.push({ plotIndex:i, cropType:null, plantedAt:null, growthHours:0, waterHours:0, wiltHours:0, lastWatered:null, status:"empty" });
        }
      }
      plots.sort(function(a,b){ return a.plotIndex - b.plotIndex; });
      return plots;
    };

    // ========== 游戏引擎 ==========
    if (path === "/game" && req.method === "POST") {
      const body = await req.json();
      const { action, userId } = body;
      if (!userId || typeof userId !== "string" || userId.length > 50) {
        return jsonResponse({ error:"缺少合法 userId" }, 400);
      }
      const sess = await requireSession();
      if (sess.error) return jsonResponse({ error:sess.error }, 403);
      if (sess.role !== "admin" && sess.username !== userId) {
        return jsonResponse({ error:"禁止操作他人游戏数据" }, 403);
      }

      const now = new Date().toISOString();
      const nowMs = Date.now();

      // 建表（懒初始化）
      const initTables = async function() {
        var tbls = [
          "CREATE TABLE IF NOT EXISTS game_shop_stock (user_id TEXT, item_id TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id,item_id))",
          "CREATE TABLE IF NOT EXISTS game_shelves (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT NOT NULL, item_name TEXT NOT NULL, cost_price INTEGER NOT NULL, profit_pct REAL DEFAULT 0.3, sell_price INTEGER NOT NULL, quantity INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
          "CREATE TABLE IF NOT EXISTS game_farm_plots (user_id TEXT, plot_index INTEGER, crop_type TEXT, planted_at TEXT, growth_hours REAL DEFAULT 0, water_hours REAL DEFAULT 0, wilt_hours REAL DEFAULT 0, last_watered TEXT, status TEXT DEFAULT 'empty', PRIMARY KEY(user_id,plot_index))",
          "CREATE TABLE IF NOT EXISTS game_engine_state (user_id TEXT PRIMARY KEY, last_tick TEXT, market_heat REAL DEFAULT 0.5, buyer_freq INTEGER DEFAULT 1800, auto_restock INTEGER DEFAULT 0, auto_farm INTEGER DEFAULT 0, robot_level INTEGER DEFAULT 1, total_revenue INTEGER DEFAULT 0, total_cost INTEGER DEFAULT 0, updated_at TEXT NOT NULL)",
          "CREATE TABLE IF NOT EXISTS game_engine_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_type TEXT NOT NULL, item_id TEXT, quantity INTEGER, amount INTEGER NOT NULL, detail TEXT, created_at TEXT NOT NULL)",
          "CREATE TABLE IF NOT EXISTS community_likes (status_id TEXT NOT NULL, username TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(status_id,username))",
          "CREATE TABLE IF NOT EXISTS community_comments (id TEXT PRIMARY KEY, status_id TEXT NOT NULL, username TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)"
        ];
        for (var i=0;i<tbls.length;i++) {
          try { await execTurso(tbls[i],[]); } catch(e) {}
        }
      };
      await initTables();

      // 积分操作（账务入账）
      const gamePointsChange = async function(uid, delta, reason, bizNo) {
        var bn = bizNo || ("gpts_"+Date.now().toString(36)+Math.random().toString(36).slice(2,7));
        var mkArg = function(v) { return { type:"text", value:String(v) }; };
        var lid = "ld_"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
        var treq = {
          requests: [
            { type:"execute", stmt:{ sql:"INSERT INTO ledger (id,biz_no,user_id,amount,balance_after,reason,ref_id,operator,created_at) SELECT ?,?,?,?,(SELECT COALESCE(points,0) FROM users WHERE id=?)+?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)", args:[lid,bn,uid,delta,uid,delta,reason||"","","engine",now,bn].map(mkArg) } },
            { type:"execute", stmt:{ sql:"UPDATE users SET points=(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE user_id=?), updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)", args:[uid,now,uid,bn].map(mkArg) } },
            { type:"execute", stmt:{ sql:"SELECT COALESCE(points,0) AS p FROM users WHERE id=?", args:[uid].map(mkArg) } }
          ]
        };
        var tres = await fetch(TURSO_API, { method:"POST", headers:{ Authorization:"Bearer "+TURSO_TOKEN, "Content-Type":"application/json" }, body:JSON.stringify(treq) });
        var tData = await tres.json();
        if (!tres.ok) throw new Error("积分操作失败");
        var bal = null;
        try { bal = tData.results?.[2]?.response?.result?.rows?.[0]?.[0]?.value ?? tData.results?.[2]?.response?.result?.rows?.[0]?.[0]; } catch(e) {}
        return { ok:true, balance:bal };
      };

      // ====== TICK：离线结算 ======
      const engineTick = async function(uid) {
        var state = await getEngineState(uid);
        var lastMs = new Date(state.lastTick).getTime();
        var elapsedSec = Math.max(0, (nowMs - lastMs) / 1000);
        if (elapsedSec < 1) {
          var sd = await getShopData(uid);
          var fp = await getFarmData(uid, 6);
          return { state, shop:sd, farm:fp, tickElapsed:0 };
        }
        var totalPts = 0;
        var hoursElapsed = elapsedSec / 3600;

        // 农场离线结算
        var farmPlots = await getFarmData(uid, 6);
        for (var i=0;i<farmPlots.length;i++) {
          var plot = farmPlots[i];
          if (plot.status !== "growing" || !plot.cropType) continue;
          var cfg = CROP_CFG[plot.cropType];
          if (!cfg) continue;
          var plantedMs = new Date(plot.plantedAt).getTime();
          var matureMs = plantedMs + plot.growthHours * 3600000;
          var lastWaterMs = plot.lastWatered ? new Date(plot.lastWatered).getTime() : plantedMs;
          var wiltMs = lastWaterMs + plot.wiltHours * 3600000;

          if (state.autoFarm === 1) {
            var waterInt = plot.waterHours * 3600000;
            if (nowMs >= lastWaterMs + waterInt * 0.5 && nowMs < wiltMs) {
              plot.lastWatered = new Date().toISOString();
              await execTurso("UPDATE game_farm_plots SET last_watered=? WHERE user_id=? AND plot_index=?",[now,uid,plot.plotIndex]);
              await logGameEvent(uid, "auto_water", plot.cropType, 0, 0, "自动浇灌");
            }
          }
          if (nowMs >= wiltMs && nowMs < matureMs) {
            plot.status = "withered";
            await execTurso("UPDATE game_farm_plots SET status='withered' WHERE user_id=? AND plot_index=?",[uid,plot.plotIndex]);
            await logGameEvent(uid, "crop_withered", plot.cropType, 0, 0, cfg.name+"枯死了");
            continue;
          }
          if (nowMs >= matureMs && nowMs < wiltMs) {
            plot.status = "mature";
            await execTurso("UPDATE game_farm_plots SET status='mature' WHERE user_id=? AND plot_index=?",[uid,plot.plotIndex]);
            await logGameEvent(uid, "crop_mature", plot.cropType, 0, 0, cfg.name+"成熟了");
          }
        }

        // 自动种植
        if (state.autoFarm === 1) {
          var stkQ = await execTurso("SELECT item_id,quantity FROM game_shop_stock WHERE user_id=?",[uid]);
          var stk = {};
          var srr = stkQ.data.results?.[0]?.response?.result || stkQ.data.results?.[0]?.response?.results || stkQ.data;
          if (srr && srr.rows) {
            for (var i=0;i<srr.rows.length;i++) {
              stk[srr.rows[i][0]?.value??srr.rows[i][0]] = parseInt(srr.rows[i][1]?.value??srr.rows[i][1]??0);
            }
          }
          for (var i=0;i<farmPlots.length;i++) {
            if (farmPlots[i].status !== "empty") continue;
            var seedTypes = Object.keys(CROP_CFG);
            for (var j=0;j<seedTypes.length;j++) {
              var sid = "seeds_"+seedTypes[j];
              if ((stk[sid]||0) > 0) {
                stk[sid]--;
                var ct = CROP_CFG[seedTypes[j]];
                await execTurso("UPDATE game_farm_plots SET crop_type=?,planted_at=?,growth_hours=?,water_hours=?,wilt_hours=?,last_watered=?,status='growing' WHERE user_id=? AND plot_index=?",[seedTypes[j],now,ct.growthHours,ct.waterHours,ct.wiltHours,now,uid,i]);
                await execTurso("UPDATE game_shop_stock SET quantity=? WHERE user_id=? AND item_id=?",[stk[sid],uid,sid]);
                await logGameEvent(uid, "auto_plant", seedTypes[j], 1, 0, "自动种植"+ct.name);
                farmPlots[i].status = "growing";
                farmPlots[i].cropType = seedTypes[j];
                break;
              }
            }
          }
        }

        // 自动进货
        if (state.autoRestock === 1) {
          var rph = 1.0 * state.robotLevel;
          var expR = Math.floor(rph * hoursElapsed);
          if (expR > 0) {
            var wKeys = Object.keys(WHOLESALE).filter(function(k){ return k.indexOf("seeds_")===0 || k.indexOf("fertilizer_")===0 || k==="auto_waterer"; });
            for (var r=0;r<Math.min(expR,10);r++) {
              var pick = wKeys[Math.floor(Math.random() * wKeys.length)];
              var cost = WHOLESALE[pick];
              if (Math.random() < 0.7) {
                try {
                  var bn = "ar_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
                  await gamePointsChange(uid, -cost, "自动进货: "+pick, bn);
                  await execTurso("INSERT INTO game_shop_stock (user_id,item_id,quantity) VALUES (?,?,1) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+1",[uid,pick]);
                  totalPts -= cost;
                  await logGameEvent(uid, "auto_restock", pick, 1, -cost, "机器人自动进货");
                  state.totalCost = (state.totalCost||0) + cost;
                } catch(e) {}
              }
            }
          }
        }

        // 买家模拟
        var shopData = await getShopData(uid);
        var pph = state.marketHeat * 3.0;
        var expP = pph * hoursElapsed;
        var actualP = Math.floor(expP) + (Math.random() < (expP % 1) ? 1 : 0);
        for (var p=0;p<Math.min(actualP,20);p++) {
          var avail = shopData.shelves.filter(function(s){ return s.quantity > 0; });
          if (avail.length === 0) break;
          var shelf = avail[Math.floor(Math.random() * avail.length)];
          var rev = shelf.sellPrice;
          shelf.quantity--;
          try {
            var bn = "by_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
            await gamePointsChange(uid, rev, "买家购买: "+shelf.itemName, bn);
            totalPts += rev;
            state.totalRevenue = (state.totalRevenue||0) + rev;
            await logGameEvent(uid, "buyer_purchase", shelf.itemId, 1, rev, "买家购买x1，+"+rev+"分");
          } catch(e) {}
          if (shelf.quantity <= 0) {
            await execTurso("DELETE FROM game_shelves WHERE id=?",[shelf.id]);
          } else {
            await execTurso("UPDATE game_shelves SET quantity=? WHERE id=?",[shelf.quantity, shelf.id]);
          }
        }

        state.marketHeat = Math.max(0.1, Math.min(1.0, state.marketHeat + (Math.random() - 0.5) * 0.1));
        await execTurso("UPDATE game_engine_state SET last_tick=?,market_heat=?,total_revenue=?,total_cost=?,updated_at=? WHERE user_id=?",[now,state.marketHeat,state.totalRevenue||0,state.totalCost||0,now,uid]);
        state.lastTick = now;
        var finalShop = await getShopData(uid);
        var finalFarm = await getFarmData(uid, 6);
        await logGameEvent(uid, "engine_tick", "", 0, totalPts, "TICK完成，积分"+totalPts+"，耗时"+Math.round(elapsedSec)+"s");
        return { state, shop:finalShop, farm:finalFarm, tickElapsed:Math.round(elapsedSec), pointsChange:totalPts };
      };

      // ====== 动作路由 ======
      if (action === "tick") {
        var result = await engineTick(userId);
        return jsonResponse({ ok:true, ...result });
      }
      if (action === "getState") {
        var st = await getEngineState(userId);
        var sh = await getShopData(userId);
        var fm = await getFarmData(userId, 6);
        return jsonResponse({ ok:true, state:st, shop:sh, farm:fm });
      }
      if (action === "restock") {
        var itemId = body.itemId;
        var qty = Math.min(Math.max(parseInt(body.quantity)||1, 1), 99);
        var cost = getCost(itemId);
        if (!cost) return jsonResponse({ error:"未知商品: "+itemId }, 400);
        var totalCost = cost * qty;
        var bn = "rs_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
        try {
          await gamePointsChange(userId, -totalCost, "进货: "+itemId+" x"+qty, bn);
        } catch(e) {
          return jsonResponse({ error:"积分不足: "+e.message }, 400);
        }
        await execTurso("INSERT INTO game_shop_stock (user_id,item_id,quantity) VALUES (?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+?",[userId,itemId,qty,qty]);
        var st = await getEngineState(userId);
        st.totalCost = (st.totalCost||0) + totalCost;
        await execTurso("UPDATE game_engine_state SET total_cost=? WHERE user_id=?",[st.totalCost,userId]);
        await logGameEvent(userId, "restock", itemId, qty, -totalCost, "进货"+itemId+" x"+qty);
        var sh = await getShopData(userId);
        return jsonResponse({ ok:true, shop:sh });
      }
      if (action === "shelf_add") {
        var itemId = body.itemId;
        var pPct = Math.max(0.01, Math.min(5.0, parseFloat(body.profitPct)||0.3));
        var cost = getCost(itemId);
        var sellPrice = Math.round(cost * (1 + pPct));
        var itemName = getItemName(itemId);
        var sq = await execTurso("SELECT quantity FROM game_shop_stock WHERE user_id=? AND item_id=?",[userId,itemId]);
        var sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        var stkQty = sir && sir.rows && sir.rows.length>0 ? parseInt(sir.rows[0][0]?.value??sir.rows[0][0]??0) : 0;
        if (stkQty <= 0) return jsonResponse({ error:"库存不足" }, 400);
        await execTurso("UPDATE game_shop_stock SET quantity=quantity-1 WHERE user_id=? AND item_id=?",[userId,itemId]);
        var shelfId = "shf_"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
        await execTurso("INSERT INTO game_shelves (id,user_id,item_id,item_name,cost_price,profit_pct,sell_price,quantity,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)",[shelfId,userId,itemId,itemName,cost,pPct,sellPrice,now,now]);
        await logGameEvent(userId, "shelf_add", itemId, 1, 0, "上架"+itemName+" 售价"+sellPrice+"分");
        var sh = await getShopData(userId);
        return jsonResponse({ ok:true, shop:sh });
      }
      if (action === "shelf_remove") {
        var shelfId = body.shelfId;
        var sq = await execTurso("SELECT item_id,quantity FROM game_shelves WHERE id=? AND user_id=?",[shelfId,userId]);
        var sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        if (!sir || !sir.rows || sir.rows.length===0) return jsonResponse({ error:"货架商品不存在" }, 400);
        var itemId = sir.rows[0][0]?.value??sir.rows[0][0];
        var qty = parseInt(sir.rows[0][1]?.value??sir.rows[0][1]??0);
        await execTurso("DELETE FROM game_shelves WHERE id=?",[shelfId]);
        if (qty > 0) {
          await execTurso("INSERT INTO game_shop_stock (user_id,item_id,quantity) VALUES (?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+?",[userId,itemId,qty,qty]);
        }
        await logGameEvent(userId, "shelf_remove", itemId, qty, 0, "下架"+itemId+" x"+qty);
        var sh = await getShopData(userId);
        return jsonResponse({ ok:true, shop:sh });
      }
      if (action === "shelf_update") {
        var shelfId = body.shelfId;
        var pPct = Math.max(0.01, Math.min(5.0, parseFloat(body.profitPct)||0.3));
        var sq = await execTurso("SELECT cost_price FROM game_shelves WHERE id=? AND user_id=?",[shelfId,userId]);
        var sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        if (!sir || !sir.rows || sir.rows.length===0) return jsonResponse({ error:"货架商品不存在" }, 400);
        var cost = parseInt(sir.rows[0][0]?.value??sir.rows[0][0]??0);
        var sellPrice = Math.round(cost * (1 + pPct));
        await execTurso("UPDATE game_shelves SET profit_pct=?,sell_price=?,updated_at=? WHERE id=?",[pPct,sellPrice,now,shelfId]);
        await logGameEvent(userId, "shelf_update_price", "", 0, 0, "调利润率至"+(pPct*100).toFixed(0)+"%");
        var sh = await getShopData(userId);
        return jsonResponse({ ok:true, shop:sh });
      }
      if (action === "plant") {
        var pi = body.plotIndex;
        var ct = body.cropType;
        var cfg = CROP_CFG[ct];
        if (!cfg) return jsonResponse({ error:"未知作物: "+ct }, 400);
        var seedId = "seeds_"+ct;
        var sq = await execTurso("SELECT quantity FROM game_shop_stock WHERE user_id=? AND item_id=?",[userId,seedId]);
        var sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        var seedQty = sir && sir.rows && sir.rows.length>0 ? parseInt(sir.rows[0][0]?.value??sir.rows[0][0]??0) : 0;
        if (seedQty <= 0) return jsonResponse({ error:"没有"+cfg.name+"种子" }, 400);
        var pq = await execTurso("SELECT status FROM game_farm_plots WHERE user_id=? AND plot_index=?",[userId,pi]);
        var pir = pq.data.results?.[0]?.response?.result || pq.data.results?.[0]?.response?.results || pq.data;
        var cur = pir && pir.rows && pir.rows.length>0 ? (pir.rows[0][0]?.value??pir.rows[0][0]) : "empty";
        if (cur !== "empty") return jsonResponse({ error:"这块地有种东西了" }, 400);
        await execTurso("UPDATE game_shop_stock SET quantity=quantity-1 WHERE user_id=? AND item_id=?",[userId,seedId]);
        await execTurso("UPDATE game_farm_plots SET crop_type=?,planted_at=?,growth_hours=?,water_hours=?,wilt_hours=?,last_watered=?,status='growing' WHERE user_id=? AND plot_index=?",[ct,now,cfg.growthHours,cfg.waterHours,cfg.wiltHours,now,userId,pi]);
        await logGameEvent(userId, "plant", ct, 1, 0, "种了"+cfg.name);
        var fm = await getFarmData(userId, 6);
        return jsonResponse({ ok:true, farm:fm });
      }
      if (action === "harvest") {
        var pi = body.plotIndex;
        var pq = await execTurso("SELECT crop_type,status FROM game_farm_plots WHERE user_id=? AND plot_index=?",[userId,pi]);
        var pir = pq.data.results?.[0]?.response?.result || pq.data.results?.[0]?.response?.results || pq.data;
        if (!pir || !pir.rows || pir.rows.length===0) return jsonResponse({ error:"地块不存在" }, 400);
        var ct = pir.rows[0][0]?.value??pir.rows[0][0];
        var cur = pir.rows[0][1]?.value??pir.rows[0][1];
        if (cur === "empty" || !ct) return jsonResponse({ error:"空地没东西" }, 400);
        if (cur === "withered") return jsonResponse({ error:"枯死了" }, 400);
        if (cur !== "mature") return jsonResponse({ error:"还没成熟" }, 400);
        await execTurso("UPDATE game_farm_plots SET crop_type=NULL,planted_at=NULL,growth_hours=0,water_hours=0,wilt_hours=0,last_watered=NULL,status='empty' WHERE user_id=? AND plot_index=?",[userId,pi]);
        await execTurso("INSERT INTO game_shop_stock (user_id,item_id,quantity) VALUES (?,?,1) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+1",[userId,ct]);
        var cfg = CROP_CFG[ct];
        await logGameEvent(userId, "harvest", ct, 1, 0, "收获"+(cfg?cfg.name:ct)+"，已入库");
        var fm = await getFarmData(userId, 6);
        var sh = await getShopData(userId);
        return jsonResponse({ ok:true, farm:fm, shop:sh });
      }
      if (action === "water") {
        var pi = body.plotIndex;
        var pq = await execTurso("SELECT status FROM game_farm_plots WHERE user_id=? AND plot_index=?",[userId,pi]);
        var pir = pq.data.results?.[0]?.response?.result || pq.data.results?.[0]?.response?.results || pq.data;
        var cur = pir && pir.rows && pir.rows.length>0 ? (pir.rows[0][0]?.value??pir.rows[0][0]) : "empty";
        if (cur === "empty") return jsonResponse({ error:"空地不用浇水" }, 400);
        if (cur === "withered") return jsonResponse({ error:"枯死了" }, 400);
        if (cur === "mature") return jsonResponse({ error:"已成熟，请收获" }, 400);
        await execTurso("UPDATE game_farm_plots SET last_watered=? WHERE user_id=? AND plot_index=?",[now,userId,pi]);
        await logGameEvent(userId, "water", "", 0, 0, "浇水地块"+pi);
        var fm = await getFarmData(userId, 6);
        return jsonResponse({ ok:true, farm:fm });
      }
      if (action === "clear_dead") {
        var pi = body.plotIndex;
        await execTurso("UPDATE game_farm_plots SET crop_type=NULL,planted_at=NULL,growth_hours=0,water_hours=0,wilt_hours=0,last_watered=NULL,status='empty' WHERE user_id=? AND plot_index=? AND status='withered'",[userId,pi]);
        await logGameEvent(userId, "clear_dead", "", 0, 0, "清除枯死");
        var fm = await getFarmData(userId, 6);
        return jsonResponse({ ok:true, farm:fm });
      }
      if (action === "toggle_robot") {
        var rt = body.robotType;
        var field = rt === "auto_restock" ? "auto_restock" : "auto_farm";
        var sq = await execTurso("SELECT "+field+" FROM game_engine_state WHERE user_id=?",[userId]);
        var sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        var curVal = sir && sir.rows && sir.rows.length>0 ? parseInt(sir.rows[0][0]?.value??sir.rows[0][0]??0) : 0;
        var newVal = curVal ? 0 : 1;
        await execTurso("UPDATE game_engine_state SET "+field+"=? WHERE user_id=?",[newVal,userId]);
        var st = await getEngineState(userId);
        await logGameEvent(userId, "toggle_robot", rt, 0, 0, (newVal?"开启":"关闭")+(rt==="auto_restock"?"自动进货":"自动农场"));
        return jsonResponse({ ok:true, state:st });
      }
      if (action === "buy_from_user") {
        var targetUserId = body.targetUserId;
        var shelfId = body.shelfId;
        if (!targetUserId || !shelfId) return jsonResponse({ error:"缺少参数" }, 400);
        if (targetUserId === userId) return jsonResponse({ error:"不能买自己的商品" }, 400);
        var sq = await execTurso("SELECT item_name,sell_price,quantity FROM game_shelves WHERE id=? AND user_id=? AND quantity>0",[shelfId,targetUserId]);
        var sir = sq.data.results?.[0]?.response?.result || sq.data.results?.[0]?.response?.results || sq.data;
        if (!sir || !sir.rows || sir.rows.length===0) return jsonResponse({ error:"商品已售罄或不存在" }, 400);
        var itemName = String((sir.rows[0][0]?.value ?? sir.rows[0][0]) || "");
        var sellPrice = parseInt(sir.rows[0][1]?.value??sir.rows[0][1]??0);
        if (sellPrice <= 0) return jsonResponse({ error:"售价异常" }, 400);
        var bn = "buy_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
        try {
          await gamePointsChange(userId, -sellPrice, "购买用户["+targetUserId+"]的"+itemName, bn);
        } catch(e) {
          return jsonResponse({ error:"积分不足: "+e.message }, 400);
        }
        var bn2 = "sell_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
        try {
          await gamePointsChange(targetUserId, sellPrice, "卖出了"+itemName+"给用户["+userId+"]", bn2);
        } catch(e) {}
        await execTurso("UPDATE game_shelves SET quantity=quantity-1 WHERE id=? AND quantity>0",[shelfId]);
        var sq2 = await execTurso("SELECT quantity FROM game_shelves WHERE id=?",[shelfId]);
        var qr = sq2.data.results?.[0]?.response?.result || sq2.data.results?.[0]?.response?.results || sq2.data;
        var newQty = qr && qr.rows && qr.rows.length>0 ? parseInt(qr.rows[0][0]?.value??qr.rows[0][0]??0) : 0;
        if (newQty <= 0) { await execTurso("DELETE FROM game_shelves WHERE id=?",[shelfId]); }
        await logGameEvent(userId, "buy_from_user", "", 1, -sellPrice, "从["+targetUserId+"]购买了"+itemName);
        await logGameEvent(targetUserId, "sold_to_user", "", 1, sellPrice, "卖出了"+itemName+"给["+userId+"]");
        var myShop = await getShopData(userId);
        return jsonResponse({ ok:true, shop:myShop, cost:sellPrice, itemName:itemName });
      }

      return jsonResponse({ error:"未知游戏动作: "+(action||"空") }, 400);
    }

    // ========== 访客农场（无需登录，只读） ==========
    if (path === "/visit" && req.method === "POST") {
      var vbody = await req.json();
      var vuid = vbody.targetUserId;
      if (!vuid || typeof vuid !== "string" || vuid.length > 50) {
        return jsonResponse({ error:"缺少合法 targetUserId" }, 400);
      }
      var vst = await getEngineState(vuid);
      var vsh = await getShopData(vuid);
      var vfm = await getFarmData(vuid, 6);
      return jsonResponse({ ok:true, state:vst, shop:vsh, farm:vfm });
    }

    // ========== 社区互动：点赞（得先登录） ==========
    if (path === "/community" && req.method === "POST") {
      var cbody = await req.json();
      var cAction = cbody.action;
      var csess = await requireSession();
      if (csess.error) return jsonResponse({ error:csess.error }, 403);

      // 切换点赞
      if (cAction === "toggle_like") {
        var sid = cbody.statusId;
        var uname = csess.username;
        if (!sid) return jsonResponse({ error:"缺少 statusId" }, 400);
        var exQ = await execTurso("SELECT 1 FROM community_likes WHERE status_id=? AND username=?",[sid,uname]);
        var exR = exQ.data.results?.[0]?.response?.result || exQ.data.results?.[0]?.response?.results || exQ.data;
        var exists = exR && exR.rows && exR.rows.length > 0;
        if (exists) {
          await execTurso("DELETE FROM community_likes WHERE status_id=? AND username=?",[sid,uname]);
        } else {
          await execTurso("INSERT INTO community_likes (status_id,username,created_at) VALUES (?,?,?)",[sid,uname,new Date().toISOString()]);
        }
        var cntQ = await execTurso("SELECT COUNT(*) AS c FROM community_likes WHERE status_id=?",[sid]);
        var cntR = cntQ.data.results?.[0]?.response?.result || cntQ.data.results?.[0]?.response?.results || cntQ.data;
        var cnt = cntR && cntR.rows && cntR.rows.length>0 ? parseInt(cntR.rows[0][0]?.value??cntR.rows[0][0]??0) : 0;
        return jsonResponse({ ok:true, liked:!exists, likeCount:cnt });
      }

      // 添加评论
      if (cAction === "add_comment") {
        var sid = cbody.statusId;
        var txt = (cbody.content||"").trim();
        var uname = csess.username;
        if (!sid) return jsonResponse({ error:"缺少 statusId" }, 400);
        if (!txt || txt.length > 500) return jsonResponse({ error:"评论内容不能为空或超过500字" }, 400);
        var cid = "cmt_"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
        var nw = new Date().toISOString();
        await execTurso("INSERT INTO community_comments (id,status_id,username,content,created_at) VALUES (?,?,?,?,?)",[cid,sid,uname,txt,nw]);
        return jsonResponse({ ok:true, comment:{ id:cid, statusId:sid, username:uname, content:txt, createdAt:nw } });
      }

      // 加载某条动态的评论
      if (cAction === "load_comments") {
        var sid = cbody.statusId;
        if (!sid) return jsonResponse({ error:"缺少 statusId" }, 400);
        var cmtQ = await execTurso("SELECT id,username,content,created_at FROM community_comments WHERE status_id=? ORDER BY created_at ASC",[sid]);
        var cmtR = cmtQ.data.results?.[0]?.response?.result || cmtQ.data.results?.[0]?.response?.results || cmtQ.data;
        var list = [];
        if (cmtR && cmtR.rows) {
          for (var ci=0;ci<cmtR.rows.length;ci++) {
            var cr = cmtR.rows[ci];
            list.push({ id:cr[0]?.value??cr[0], username:cr[1]?.value??cr[1], content:cr[2]?.value??cr[2], createdAt:cr[3]?.value??cr[3] });
          }
        }
        return jsonResponse({ ok:true, comments:list });
      }

      // 批量加载多条动态的点赞数
      if (cAction === "load_likes_batch") {
        var ids = cbody.statusIds || [];
        if (!Array.isArray(ids) || ids.length===0) return jsonResponse({ ok:true, likes:{} });
        var likes = {};
        for (var li=0;li<ids.length;li++) {
          var cnQ = await execTurso("SELECT COUNT(*) AS c FROM community_likes WHERE status_id=?",[ids[li]]);
          var cnR = cnQ.data.results?.[0]?.response?.result || cnQ.data.results?.[0]?.response?.results || cnQ.data;
          likes[ids[li]] = cnR && cnR.rows && cnR.rows.length>0 ? parseInt(cnR.rows[0][0]?.value??cnR.rows[0][0]??0) : 0;
        }
        // 同时返回当前用户点了哪些
        var myLikes = [];
        if (csess.username) {
          var myQ = await execTurso("SELECT status_id FROM community_likes WHERE username=?",[csess.username]);
          var myR = myQ.data.results?.[0]?.response?.result || myQ.data.results?.[0]?.response?.results || myQ.data;
          if (myR && myR.rows) {
            for (var mi=0;mi<myR.rows.length;mi++) {
              myLikes.push(myR.rows[mi][0]?.value??myR.rows[mi][0]);
            }
          }
        }
        return jsonResponse({ ok:true, likes:likes, myLikes:myLikes });
      }

      return jsonResponse({ error:"未知社区动作: "+(cAction||"空") }, 400);
    }

    return jsonResponse({ error:"未知路径" }, 404);
  } catch(e) {
    return jsonResponse({ error:e.message }, 500);
  }
}