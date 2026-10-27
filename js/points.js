// ============================================================
// 积分系统核心模块 JITPoints
// 存储方案（Turso）：
//   - users 表：积分、签到记录、冻结状态（复用 users.id 作为 username）
//   - points_records 表：积分流水（delta, reason, created_at）
//   - 通过 _tursoCall/_tursoSql 代理调用 Turso 数据库
//   - localStorage 做缓存：jit_points_{username}
// ============================================================
var JITPoints = (function() {
  // ------- 规则常量 -------
  var RULES = {
    ADD_VOUCHER: 15,
    APPROVED: 25,
    LOW_DISCOUNT: 50,
    HIGH_DISCOUNT: 60,
    STREAK_BONUS: 30,
    LUCKY_COST: 45,
    POINTS_PER_YUAN: 10,
    INVITE_REWARD: 50
  };

  var _lowDiscounts = ["0折", "7折", "8折", "9折", "9.5折"];
  var _highDiscounts = ["10折", "11折", "12折", "13折", "14折"];

  // ------- Turso 调用 -------
  var _turso = function(sql, params) {
    if (typeof JITApi === "undefined" || !JITApi.getTursoHelpers) {
      return Promise.reject(new Error("Turso not available"));
    }
    var h = JITApi.getTursoHelpers();
    return h(sql, params);
  };

  var _tursoObjects = function(sql, params) {
    return _turso(sql, params).then(function(result) {
      var columns = result.columns || [];
      var rows = result.rows || [];
      var objs = rows.map(function(row) {
        var obj = {};
        columns.forEach(function(col, i) {
          obj[col] = row[i] !== undefined ? row[i] : "";
        });
        return obj;
      });
      return objs;
    });
  };

  var _todayStr = function() {
    return new Date().toISOString().split("T")[0];
  };

  var _localKey = function(username) {
    return "jit_points_" + username;
  };

  // ------- 本地缓存 -------
  var _loadLocal = function(username) {
    try {
      var s = localStorage.getItem(_localKey(username));
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  };

  var _saveLocal = function(username, data) {
    try {
      localStorage.setItem(_localKey(username), JSON.stringify(data));
    } catch (e) {}
  };

  // ------- 确保账户存在 -------
  // Turso 代理把数值也以字符串返回（points="30"），必须先转成数字，
  // 否则 "30" + 1090 会变成字符串拼接 "301090"，积分被越加越离谱。
  var _num = function(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  };

  var _normalizeAccount = function(acc) {
    acc.points = _num(acc.points);
    acc.streak_days = _num(acc.streak_days);
    acc.frozen = _num(acc.frozen);
    return acc;
  };

  var _ensureAccount = function(username) {
    return _tursoObjects(
      "SELECT id, points, sign_ins, last_sign_in, streak_days, frozen FROM users WHERE id = ?",
      [username]
    ).then(function(rows) {
      if (rows.length > 0) return _normalizeAccount(rows[0]);
      var now = new Date().toISOString();
      return _turso(
        "INSERT INTO users (id, password_hash, points, sign_ins, last_sign_in, streak_days, frozen, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [username, "", 0, "[]", "", 0, 0, now, now]
      ).then(function() {
        return { id: username, points: 0, sign_ins: "[]", last_sign_in: "", streak_days: 0, frozen: 0 };
      });
    });
  };

  var _parseSignIns = function(signInsRaw) {
    try {
      if (Array.isArray(signInsRaw)) return signInsRaw;
      return JSON.parse(signInsRaw || "[]");
    } catch (e) { return []; }
  };

  // ------- 获取积分流水 -------
  var _getLogs = function(username, limit) {
    limit = limit || 100;
    return _tursoObjects(
      "SELECT delta, reason, created_at FROM points_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
      [username, String(limit)]
    ).then(function(rows) {
      return rows.map(function(r) {
        return {
          delta: r.delta || 0,
          reason: r.reason || "",
          time: (r.created_at || "").replace("T", " ").slice(0, 16),
          createdAt: r.created_at || ""
        };
      });
    });
  };

  var _getAllLogs = function(username) {
    return _tursoObjects(
      "SELECT delta, reason, created_at FROM points_records WHERE user_id = ? ORDER BY created_at DESC",
      [username]
    ).then(function(rows) {
      return rows.map(function(r) {
        return {
          delta: r.delta || 0,
          reason: r.reason || "",
          time: (r.created_at || "").replace("T", " ").slice(0, 16),
          createdAt: r.created_at || ""
        };
      });
    });
  };

  // ------- 添加积分流水 -------
  var _addLog = function(username, delta, reason) {
    var now = new Date().toISOString();
    var logId = "plog_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return _turso(
      "INSERT INTO points_records (id, user_id, delta, reason, created_at) VALUES (?,?,?,?,?)",
      [logId, username, delta, reason, now]
    );
  };

  // ------- 对外：获取用户积分（余额走 /balance 只查自己） -------
  var _getUserPoints = function(username, forceCloud) {
    var cached = _loadLocal(username);
    if (cached && !forceCloud) {
      return Promise.resolve(cached);
    }
    return _ensureAccount(username).then(function(account) {
      // 余额走代理 /balance（只能查自己，越权被拒+留痕）
      var helper = (typeof JITApi !== "undefined" && JITApi.getTursoHelpers) ? JITApi.getTursoHelpers() : null;
      var ptsP = (helper && helper.getBalance)
        ? helper.getBalance(username).then(function(r) { return r.points; }).catch(function() { return account.points || 0; })
        : Promise.resolve(account.points || 0);
      return ptsP.then(function(pts) {
        return _getAllLogs(username).then(function(logs) {
          var result = {
            username: username,
            points: pts,
            streakDays: account.streak_days || 0,
            lastSignIn: account.last_sign_in || "",
            signIns: _parseSignIns(account.sign_ins),
            logs: logs,
            frozen: Number(account.frozen) === 1,
            accountId: account.id
          };
          _saveLocal(username, result);
          return result;
        });
      });
    });
  };

  // ------- 积分业务动作（唯一写入口） -------
  // 前端只传动作名称+参数，积分规则由中转层决定
  var _doAction = function(action, username, params, opts) {
    opts = opts || {};
    return _ensureAccount(username).then(function(account) {
      if (!opts.forceAdmin && Number(account.frozen) === 1) {
        throw new Error("积分账户已冻结，暂不可赚取或消耗积分");
      }
      var helper = (typeof JITApi !== "undefined" && JITApi.getTursoHelpers) ? JITApi.getTursoHelpers() : null;
      if (!helper || !helper.postPointsAction) {
        return Promise.reject(new Error("积分动作接口不可用"));
      }
      return helper.postPointsAction(action, username, params).then(function(res) {
        if (!res.ok) throw new Error(res.error || "积分操作失败");
        var amt = Number(res.delta || 0);
        var reason = res.reason || action;
        var newPoints = (res.balance != null && res.balance !== "") ? Number(res.balance) : Math.max(0, _num(account.points) + amt);
        var now = new Date().toISOString();
        // 流水落 points_records 供展示（权威流水在 ledger，幂等跳过时不重复记）
        if (res.inserted !== false) {
          _addLog(username, amt, reason).catch(function() {});
        }
        var cached = _loadLocal(username);
        if (cached) {
          cached.points = newPoints;
          cached.logs = cached.logs || [];
          cached.logs.unshift({
            delta: amt,
            reason: reason,
            time: now.replace("T", " ").slice(0, 16),
            createdAt: now
          });
          _saveLocal(username, cached);
        }
        return newPoints;
      });
    });
  };

  // ------- 对外：签到 -------
  var _signIn = function(username) {
    var today = _todayStr();
    return _ensureAccount(username).then(function(account) {
      var signIns = _parseSignIns(account.sign_ins);
      if (signIns.indexOf(today) !== -1) {
        return { signedIn: false, streakDays: account.streak_days || 0, bonusGranted: false };
      }
      signIns.push(today);
      if (signIns.length > 30) signIns = signIns.slice(-30);

      var streak = 0;
      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      var yStr = yesterday.toISOString().split("T")[0];
      if (account.last_sign_in === yStr) {
        streak = (account.streak_days || 0) + 1;
      } else if (account.last_sign_in === today) {
        streak = account.streak_days || 0;
      } else {
        streak = 1;
      }

      var now = new Date().toISOString();
      return _turso(
        "UPDATE users SET sign_ins = ?, last_sign_in = ?, streak_days = ?, updated_at = ? WHERE id = ?",
        [JSON.stringify(signIns), today, streak, now, username]
      ).then(function() {
        var result = { signedIn: true, streakDays: streak, bonusGranted: false, bonusPoints: 0 };
        if (streak > 0 && streak % 3 === 0) {
          result.bonusGranted = true;
          result.bonusPoints = RULES.STREAK_BONUS;
          return _doAction("streak_bonus", username, { streak: streak }).then(function() {
            var cached = _loadLocal(username);
            if (cached) {
              cached.signIns = signIns.slice();
              cached.streakDays = streak;
              cached.lastSignIn = today;
              _saveLocal(username, cached);
            }
            return result;
          });
        }
        var cached = _loadLocal(username);
        if (cached) {
          cached.signIns = signIns.slice();
          cached.streakDays = streak;
          cached.lastSignIn = today;
          _saveLocal(username, cached);
        }
        return result;
      });
    });
  };

  // ------- 对外：根据折扣获取积分奖励值 -------
  var _getLotteryReward = function(discount) {
    if (!discount) return 0;
    if (_lowDiscounts.indexOf(discount) !== -1) return RULES.LOW_DISCOUNT;
    if (_highDiscounts.indexOf(discount) !== -1) return RULES.HIGH_DISCOUNT;
    return 0;
  };

  // ------- 对外：积分抵消 -------
  var _usePointsForOffset = function(username, amountYuan) {
    if (!amountYuan || amountYuan <= 0) return Promise.resolve({ ok: true, usedPoints: 0, usedYuan: 0 });
    return _getUserPoints(username).then(function(data) {
      var neededPoints = Math.ceil(amountYuan * RULES.POINTS_PER_YUAN);
      var have = data.points || 0;
      if (have <= 0) return { ok: false, usedPoints: 0, usedYuan: 0, remainingYuan: amountYuan, remainingPoints: 0 };
      if (have >= neededPoints) {
        return _doAction("points_offset", username, { amountYuan: amountYuan }).then(function(pts) {
          return { ok: true, usedPoints: neededPoints, usedYuan: amountYuan, remainingYuan: 0, remainingPoints: pts };
        });
      }
      var usePoints = have;
      var useYuan = Math.floor(usePoints / RULES.POINTS_PER_YUAN);
      var remainYuan = amountYuan - useYuan;
      return _doAction("points_offset", username, { amountYuan: useYuan }).then(function(pts) {
        return { ok: true, usedPoints: usePoints, usedYuan: useYuan, remainingYuan: remainYuan, remainingPoints: pts };
      });
    });
  };

  // ------- 对外：兑换幸运抽奖 -------
  var _useLuckyLottery = function(username) {
    return _getUserPoints(username).then(function(data) {
      if ((data.points || 0) < RULES.LUCKY_COST) {
        return { ok: false, reason: "积分不足，需要" + RULES.LUCKY_COST + "积分", remaining: data.points || 0 };
      }
      return _doAction("lucky_lottery_exchange", username).then(function(pts) {
        return { ok: true, remaining: pts, cost: RULES.LUCKY_COST };
      });
    });
  };

  // ------- 管理员：获取所有用户积分 -------
  var _getAllUsersPoints = function() {
    return _tursoObjects(
      "SELECT id, points, sign_ins, last_sign_in, streak_days, frozen FROM users"
    ).then(function(rows) {
      var promises = rows.map(function(account) {
        return _getLogs(account.id, 20).then(function(logs) {
          return {
            username: account.id,
            points: _num(account.points),
            streakDays: _num(account.streak_days),
            lastSignIn: account.last_sign_in || "",
            signIns: _parseSignIns(account.sign_ins),
            logs: logs,
            frozen: Number(account.frozen) === 1
          };
        });
      });
      return Promise.all(promises).then(function(items) {
        var result = {};
        items.forEach(function(item) {
          result[item.username] = item;
        });
        return result;
      });
    });
  };

  // ------- 管理员：冻结/解冻 -------
  var _setFrozen = function(username, frozen) {
    var val = frozen ? 1 : 0;
    var now = new Date().toISOString();
    return _ensureAccount(username).then(function() {
      return _turso(
        "UPDATE users SET frozen = ?, updated_at = ? WHERE id = ?",
        [val, now, username]
      ).then(function() {
        var cached = _loadLocal(username);
        if (cached) {
          cached.frozen = !!frozen;
          _saveLocal(username, cached);
        }
        return !!frozen;
      });
    });
  };

  // ------- 管理员：清零积分（走账务入账） -------
  var _resetPoints = function(username) {
    return _ensureAccount(username).then(function(account) {
      var currentPts = Number(account.points || 0);
      if (currentPts === 0) return 0;
      return _doAction("admin_adjust", username, { delta: -currentPts, reason: "管理员清零积分" }, { forceAdmin: true }).then(function() {
        return 0;
      });
    });
  };

  // ------- 兼容旧接口（无操作） -------
  var _ensurePointsLabel = function() {
    return Promise.resolve();
  };

  // ------- 对外公开：业务动作（推荐） -------
  var _publicDoAction = function(action, username, params) {
    return _doAction(action, username, params);
  };

  // ------- 对外公开：changePoints（兼容旧版，转发到 doAction） -------
  var _publicChangePoints = function(username, delta, reason, opts) {
    if (delta === 0) return Promise.resolve(0);
    // 旧版调用统一转为 admin_adjust（需管理员会话）
    return _doAction("admin_adjust", username, { delta: Math.round(Number(delta)), reason: String(reason || "积分变动") }, opts);
  };

  return {
    RULES: RULES,
    ensureLabel: _ensurePointsLabel,
    getUserPoints: _getUserPoints,
    doAction: _publicDoAction,
    changePoints: _publicChangePoints,
    signIn: _signIn,
    getLotteryReward: _getLotteryReward,
    usePointsForOffset: _usePointsForOffset,
    useLuckyLottery: _useLuckyLottery,
    getAllUsersPoints: _getAllUsersPoints,
    adminAddPoints: function(username, delta, reason) {
      return _doAction("admin_adjust", username, { delta: delta, reason: reason }, { forceAdmin: true });
    },
    adminAdjust: function(username, delta, reason) {
      return _doAction("admin_adjust", username, { delta: delta, reason: reason }, { forceAdmin: true });
    },
    setFrozen: _setFrozen,
    resetPoints: _resetPoints
  };
})();