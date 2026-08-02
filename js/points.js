// ============================================================
// 积分系统核心模块 JITPoints
// 存储方案：
//   - 每个用户一个独立 Issue（label=points）存积分数据
//   - Issue body 用纯文本 ｜ 前缀格式存储积分、签到记录
//   - Issue comments 存积分流水（｜POINTS｜+15|添加凭证|时间）
//   - localStorage 做缓存：jit_points_{username}
// ============================================================
var JITPoints = (function() {
  var _token = JITConfig.getTokenPart1() + JITConfig.getTokenPart3() + JITConfig.getTokenPart4();
  var _apiBase = JITConfig.getApiBase();
  var _repoFull = JITConfig.getRepoFull();

  // ------- 规则常量 -------
  var RULES = {
    ADD_VOUCHER: 15,           // 添加凭证
    APPROVED: 25,              // 审核通过
    LOW_DISCOUNT: 50,          // 抽到 免单/7/8/9/9.5 折
    HIGH_DISCOUNT: 60,         // 抽到 10/11/12/13/14 折
    STREAK_BONUS: 30,          // 连续3天添加凭证奖励
    LUCKY_COST: 45,            // 幸运抽奖一次消耗
    POINTS_PER_YUAN: 10        // 10 积分 = 1 元（抵消规则）
  };

  var _lowDiscounts = ["0折", "7折", "8折", "9折", "9.5折"];
  var _highDiscounts = ["10折", "11折", "12折", "13折", "14折"];

  // ------- 工具函数 -------
  var _headers = function() {
    return {
      "Authorization": "token " + _token,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    };
  };

  var _req = function(url, opts) {
    return fetch(url, opts).then(function(r) {
      if (!r.ok) {
        return r.json().then(function(e) { throw new Error(e.message || "HTTP " + r.status); });
      }
      return r.status === 204 ? null : r.json();
    });
  };

  var _todayStr = function() {
    return new Date().toISOString().split("T")[0];
  };

  var _localKey = function(username) {
    return "jit_points_" + username;
  };

  // ------- Issue body 格式 -------
  // ｜用户名：xxx
  // ｜当前积分：xxx
  // ｜签到记录：yyyy-mm-dd,yyyy-mm-dd
  // ｜最后签到：yyyy-mm-dd
  // ｜连续天数：x
  var _formatPointsBody = function(data) {
    return [
      "｜用户名：" + (data.username || ""),
      "｜当前积分：" + (data.points || 0),
      "｜签到记录：" + ((data.signIns || []).join(",")),
      "｜最后签到：" + (data.lastSignIn || ""),
      "｜连续天数：" + (data.streakDays || 0)
    ].join("\n");
  };

  var _parsePointsBody = function(body) {
    var data = {
      username: "",
      points: 0,
      signIns: [],
      lastSignIn: "",
      streakDays: 0
    };
    var lines = String(body || "").split(/\r?\n/);
    lines.forEach(function(line) {
      var trimmed = line.trim();
      var match;
      if ((match = trimmed.match(/^｜?\s*用户名：(.+)$/))) data.username = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*当前积分：(.+)$/))) data.points = parseInt(match[1].trim(), 10) || 0;
      else if ((match = trimmed.match(/^｜?\s*签到记录：(.+)$/))) {
        var s = match[1].trim();
        data.signIns = s ? s.split(",").map(function(x) { return x.trim(); }).filter(Boolean) : [];
      }
      else if ((match = trimmed.match(/^｜?\s*最后签到：(.+)$/))) data.lastSignIn = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*连续天数：(.+)$/))) data.streakDays = parseInt(match[1].trim(), 10) || 0;
    });
    return data;
  };

  // ------- 积分流水 comment 格式 -------
  // ｜POINTS｜+15|添加凭证|2026-08-02 12:00
  var _parsePointsFromComments = function(comments) {
    var total = 0;
    var logs = [];
    (comments || []).forEach(function(c) {
      if (c.body && c.body.indexOf("｜POINTS｜") === 0) {
        var parts = c.body.replace("｜POINTS｜", "").split("|");
        var delta = parseInt(parts[0] || "0", 10) || 0;
        total += delta;
        logs.push({
          delta: delta,
          reason: parts[1] || "",
          time: parts[2] || c.created_at,
          createdAt: c.created_at,
          raw: c.body
        });
      }
    });
    return { total: total, logs: logs.sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); }) };
  };

  // ------- 云端：获取/创建用户积分 Issue -------
  var _findPointsIssue = function(username) {
    var label = JITConfig.getLabels().points || "points";
    var url = _apiBase + "/repos/" + _repoFull + "/issues?state=open&labels=" + encodeURIComponent(label) + "&per_page=100";
    return _req(url, { method: "GET", headers: _headers() }).then(function(issues) {
      if (!issues || issues.length === 0) return null;
      for (var i = 0; i < issues.length; i++) {
        var data = _parsePointsBody(issues[i].body);
        if (data.username === username) return issues[i];
      }
      return null;
    });
  };

  var _createPointsIssue = function(username, initialPoints) {
    var label = JITConfig.getLabels().points || "points";
    var data = {
      username: username,
      points: initialPoints || 0,
      signIns: [],
      lastSignIn: "",
      streakDays: 0
    };
    var title = "【积分】" + username;
    var url = _apiBase + "/repos/" + _repoFull + "/issues";
    return _req(url, {
      method: "POST",
      headers: _headers(),
      body: JSON.stringify({
        title: title,
        body: _formatPointsBody(data),
        labels: ["voucher", label]
      })
    });
  };

  var _getOrCreatePointsIssue = function(username) {
    return _findPointsIssue(username).then(function(issue) {
      if (issue) return issue;
      return _createPointsIssue(username, 0);
    });
  };

  var _loadPointsFromComments = function(issueNumber) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber + "/comments?per_page=100";
    return _req(url, { method: "GET", headers: _headers() }).then(function(comments) {
      return _parsePointsFromComments(comments);
    });
  };

  // 递归加载所有 comments（超过 100 条时）
  var _loadAllComments = function(issueNumber) {
    var all = [];
    var page = 1;
    var perPage = 100;
    var fetch = function() {
      var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber + "/comments?per_page=" + perPage + "&page=" + page;
      return _req(url, { method: "GET", headers: _headers() }).then(function(cs) {
        if (!cs || cs.length === 0) return all;
        all = all.concat(cs);
        if (cs.length < perPage) return all;
        page++;
        return fetch();
      });
    };
    return fetch().then(_parsePointsFromComments);
  };

  var _addPointsComment = function(issueNumber, delta, reason) {
    var now = new Date();
    var timeStr = now.toISOString().replace("T", " ").slice(0, 16);
    var prefix = delta >= 0 ? "+" : "";
    var body = "｜POINTS｜" + prefix + delta + "|" + reason + "|" + timeStr;
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber + "/comments";
    return _req(url, {
      method: "POST",
      headers: _headers(),
      body: JSON.stringify({ body: body })
    });
  };

  var _updatePointsIssueBody = function(issueNumber, data) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber;
    return _req(url, {
      method: "PATCH",
      headers: _headers(),
      body: JSON.stringify({ body: _formatPointsBody(data) })
    });
  };

  // ------- 本地缓存：快速读取 -------
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

  // ------- 对外：获取用户积分 -------
  // 返回：{ points: number, streakDays: number, lastSignIn: string, signIns: [], logs: [], issueNumber: number }
  var _getUserPoints = function(username, forceCloud) {
    var cached = _loadLocal(username);
    if (cached && !forceCloud) {
      return Promise.resolve(cached);
    }
    return _getOrCreatePointsIssue(username).then(function(issue) {
      var bodyData = _parsePointsBody(issue.body);
      return _loadAllComments(issue.number).then(function(parsed) {
        // 以评论累加积分为准，同时保留 body 中的 signIn/streak 数据
        var points = Math.max(parsed.total, bodyData.points || 0);
        var result = {
          username: username,
          points: points,
          streakDays: bodyData.streakDays || 0,
          lastSignIn: bodyData.lastSignIn || "",
          signIns: bodyData.signIns || [],
          logs: parsed.logs,
          issueNumber: issue.number
        };
        _saveLocal(username, result);
        return result;
      });
    });
  };

  // ------- 对外：修改积分（+/-）-------
  // options: { silent: false } silent = true 时不刷新缓存/UI
  var _changePoints = function(username, delta, reason) {
    if (delta === 0) return Promise.resolve(0);
    return _getOrCreatePointsIssue(username).then(function(issue) {
      return _addPointsComment(issue.number, delta, reason).then(function() {
        // 更新 Issue body 中的积分总计 + 刷新本地缓存
        var bodyData = _parsePointsBody(issue.body);
        bodyData.points = (bodyData.points || 0) + delta;
        return _updatePointsIssueBody(issue.number, bodyData).then(function() {
          // 本地缓存也更新
          var cached = _loadLocal(username);
          if (cached) {
            cached.points = Math.max(0, (cached.points || 0) + delta);
            cached.logs = cached.logs || [];
            cached.logs.unshift({
              delta: delta,
              reason: reason,
              time: new Date().toISOString().replace("T", " ").slice(0, 16),
              createdAt: new Date().toISOString()
            });
            _saveLocal(username, cached);
          }
          return cached ? cached.points : 0;
        });
      });
    });
  };

  // ------- 对外：签到（添加凭证即签到） -------
  // 返回：{ signedIn: true, streakDays: 3, bonusGranted: true, bonusPoints: 30 } or similar
  var _signIn = function(username) {
    var today = _todayStr();
    return _getOrCreatePointsIssue(username).then(function(issue) {
      var data = _parsePointsBody(issue.body);
      // 今天已签到？
      if (data.signIns.indexOf(today) !== -1) {
        return Promise.resolve({ signedIn: false, streakDays: data.streakDays, bonusGranted: false });
      }
      data.signIns = data.signIns || [];
      data.signIns.push(today);
      // 限制签到记录保留最近 30 天
      if (data.signIns.length > 30) data.signIns = data.signIns.slice(-30);

      // 计算连续天数
      var streak = 0;
      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      var yStr = yesterday.toISOString().split("T")[0];
      if (data.lastSignIn === yStr) {
        streak = (data.streakDays || 0) + 1;
      } else if (data.lastSignIn === today) {
        streak = data.streakDays || 0;
      } else {
        streak = 1;
      }
      data.lastSignIn = today;
      data.streakDays = streak;

      return _updatePointsIssueBody(issue.number, data).then(function() {
        var result = { signedIn: true, streakDays: streak, bonusGranted: false, bonusPoints: 0 };
        // 连续3天奖励
        if (streak > 0 && streak % 3 === 0) {
          result.bonusGranted = true;
          result.bonusPoints = RULES.STREAK_BONUS;
          return _changePoints(username, RULES.STREAK_BONUS, "连续" + streak + "天添加凭证奖励").then(function() {
            // 本地缓存同步签到数据
            var cached = _loadLocal(username);
            if (cached) {
              cached.signIns = data.signIns.slice();
              cached.streakDays = streak;
              cached.lastSignIn = today;
              _saveLocal(username, cached);
            }
            return result;
          });
        }
        // 本地缓存同步签到数据
        var cached = _loadLocal(username);
        if (cached) {
          cached.signIns = data.signIns.slice();
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
  // amountYuan：需要抵消的人民币元数（比如 11 折 100 元，需要用户倒贴 10 元，amountYuan = 10）
  // 返回：{ ok: bool, usedPoints: number, usedYuan: number, remainingPoints: number, remainingYuan: number }
  var _usePointsForOffset = function(username, amountYuan) {
    if (!amountYuan || amountYuan <= 0) return Promise.resolve({ ok: true, usedPoints: 0, usedYuan: 0 });
    return _getUserPoints(username).then(function(data) {
      var neededPoints = Math.ceil(amountYuan * RULES.POINTS_PER_YUAN);
      var have = data.points || 0;
      if (have <= 0) return { ok: false, usedPoints: 0, usedYuan: 0, remainingYuan: amountYuan, remainingPoints: 0 };
      if (have >= neededPoints) {
        return _changePoints(username, -neededPoints, "积分抵消¥" + amountYuan.toFixed(2)).then(function(pts) {
          return { ok: true, usedPoints: neededPoints, usedYuan: amountYuan, remainingYuan: 0, remainingPoints: pts };
        });
      }
      // 积分不够全部抵消，尽量用
      var usePoints = have;
      var useYuan = Math.floor(usePoints / RULES.POINTS_PER_YUAN);
      var remainYuan = amountYuan - useYuan;
      return _changePoints(username, -usePoints, "积分抵消¥" + useYuan.toFixed(2)).then(function(pts) {
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
      return _changePoints(username, -RULES.LUCKY_COST, "兑换幸运抽奖1次").then(function(pts) {
        return { ok: true, remaining: pts, cost: RULES.LUCKY_COST };
      });
    });
  };

  // ------- 管理员端：快速获取所有用户积分（云端同步计算） -------
  var _getAllUsersPoints = function() {
    var label = JITConfig.getLabels().points || "points";
    var url = _apiBase + "/repos/" + _repoFull + "/issues?state=open&labels=" + encodeURIComponent(label) + "&per_page=100";
    return _req(url, { method: "GET", headers: _headers() }).then(function(issues) {
      var result = {};
      if (!issues || issues.length === 0) return result;
      var promises = issues.map(function(issue) {
        var bodyData = _parsePointsBody(issue.body);
        if (!bodyData.username) return Promise.resolve();
        return _loadAllComments(issue.number).then(function(parsed) {
          var pts = Math.max(parsed.total, bodyData.points || 0);
          result[bodyData.username] = {
            points: pts,
            streakDays: bodyData.streakDays || 0,
            lastSignIn: bodyData.lastSignIn || "",
            issueNumber: issue.number,
            signIns: bodyData.signIns || [],
            logs: parsed.logs.slice(0, 20)
          };
        });
      });
      return Promise.all(promises).then(function() { return result; });
    });
  };

  // ------- 初始化：确保 points label 存在 -------
  var _ensurePointsLabel = function() {
    var labelName = JITConfig.getLabels().points || "points";
    var url = _apiBase + "/repos/" + _repoFull + "/labels/" + encodeURIComponent(labelName);
    return _req(url, { method: "GET", headers: _headers() }).catch(function() {
      return _req(_apiBase + "/repos/" + _repoFull + "/labels", {
        method: "POST",
        headers: _headers(),
        body: JSON.stringify({ name: labelName, color: "ffd700", description: "用户积分记录" })
      }).catch(function() {});
    });
  };

  return {
    RULES: RULES,
    ensureLabel: _ensurePointsLabel,
    getUserPoints: _getUserPoints,
    changePoints: _changePoints,
    signIn: _signIn,
    getLotteryReward: _getLotteryReward,
    usePointsForOffset: _usePointsForOffset,
    useLuckyLottery: _useLuckyLottery,
    getAllUsersPoints: _getAllUsersPoints,
    // 给管理员发审核通过奖励用（无需登录）
    adminAddPoints: function(username, delta, reason) {
      return _changePoints(username, delta, reason);
    }
  };
})();
