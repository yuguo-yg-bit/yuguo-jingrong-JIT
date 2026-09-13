// ============================================================
// 玉国金融 - 积分系统（Worker + D1 版本）
// ============================================================

var Points = (function() {
  var RULES = {
    SIGN_IN: SIGN_IN_POINTS,
    REGISTER: REGISTER_POINTS,
    REFERRAL: REFERRAL_POINTS,
    STREAK_BONUS: 5,
    HIGH_DISCOUNT: 3,
    LOW_DISCOUNT: 5,
    LUCKY_COST: 50,
    POINTS_PER_YUAN: 10
  };

  var _lowDiscounts = ["2折", "3折", "4折", "5折", "6折", "7折", "8折", "9折"];
  var _highDiscounts = ["10折", "11折", "12折", "13折", "14折", "15折"];

  var _loadLocal = function(username) {
    try {
      var raw = localStorage.getItem("points_" + username);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  var _saveLocal = function(username, data) {
    try {
      localStorage.setItem("points_" + username, JSON.stringify(data));
    } catch (e) {}
  };

  var _getUserPoints = function(username) {
    return Api.getUser(username).then(function(user) {
      if (!user) return { points: 0, frozen: false, streakDays: 0, lastSignIn: "", signIns: [], issueNumber: null, logs: [] };
      return Api.getPointsRecords(username, 50).then(function(records) {
        return {
          points: user.points || 0,
          frozen: user.frozen === 1,
          streakDays: user.streak_days || 0,
          lastSignIn: user.last_sign_in || "",
          signIns: JSON.parse(user.sign_ins || "[]"),
          issueNumber: null,
          logs: records
        };
      });
    });
  };

  var _changePoints = function(username, delta, reason, opts) {
    opts = opts || {};
    return _getUserPoints(username).then(function(data) {
      if (data.frozen && !opts.forceAdmin) {
        throw new Error("账户已被冻结，无法操作积分");
      }
      if (data.frozen && delta < 0) {
        throw new Error("账户已被冻结，无法扣除积分");
      }
      return Api.addPointsRecord(username, delta, reason, opts.voucherId || null).then(function() {
        return Api.getUserPoints(username);
      }).then(function(newTotal) {
        var cached = _loadLocal(username);
        if (cached) {
          cached.points = newTotal;
          cached.logs = cached.logs || [];
          cached.logs.unshift({
            delta: delta,
            reason: reason,
            time: new Date().toISOString().replace("T", " ").slice(0, 16),
            createdAt: new Date().toISOString()
          });
          _saveLocal(username, cached);
        }
        return newTotal;
      });
    });
  };

  var _signIn = function(username) {
    return Api.signIn(username).then(function(result) {
      return {
        signedIn: true,
        streakDays: result.streakDays,
        bonusGranted: result.bonus > 0,
        bonusPoints: result.bonus
      };
    }).catch(function(e) {
      if (e.message === "今日已签到") {
        return Api.getUser(username).then(function(user) {
          return {
            signedIn: false,
            alreadySignedIn: true,
            streakDays: user ? user.streak_days : 0,
            bonusGranted: false,
            bonusPoints: 0
          };
        });
      }
      throw e;
    });
  };

  var _getLotteryReward = function(discount) {
    if (!discount) return 0;
    if (_lowDiscounts.indexOf(discount) !== -1) return RULES.LOW_DISCOUNT;
    if (_highDiscounts.indexOf(discount) !== -1) return RULES.HIGH_DISCOUNT;
    return 0;
  };

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
      var usePoints = have;
      var useYuan = Math.floor(usePoints / RULES.POINTS_PER_YUAN);
      var remainYuan = amountYuan - useYuan;
      return _changePoints(username, -usePoints, "积分抵消¥" + useYuan.toFixed(2)).then(function(pts) {
        return { ok: true, usedPoints: usePoints, usedYuan: useYuan, remainingYuan: remainYuan, remainingPoints: pts };
      });
    });
  };

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

  var _getAllUsersPoints = function() {
    return Api.getAllUsers().then(function(users) {
      var result = {};
      var promises = users.map(function(user) {
        return Api.getPointsRecords(user.id, 20).then(function(records) {
          result[user.id] = {
            points: user.points || 0,
            streakDays: user.streak_days || 0,
            lastSignIn: user.last_sign_in || "",
            signIns: JSON.parse(user.sign_ins || "[]"),
            logs: records,
            frozen: user.frozen === 1
          };
        });
      });
      return Promise.all(promises).then(function() { return result; });
    });
  };

  var _setFrozen = function(username, frozen) {
    return (frozen ? Api.freezeUser(username) : Api.unfreezeUser(username)).then(function() {
      var cached = _loadLocal(username);
      if (cached) {
        cached.frozen = !!frozen;
        _saveLocal(username, cached);
      }
      return !!frozen;
    });
  };

  var _resetPoints = function(username) {
    return _getUserPoints(username).then(function(data) {
      var currentPts = data.points || 0;
      if (currentPts === 0) return 0;
      return _changePoints(username, -currentPts, "管理员清零积分", { forceAdmin: true });
    });
  };

  var _adminAdjust = function(username, delta, reason) {
    return _changePoints(username, delta, reason, { forceAdmin: true });
  };

  return {
    RULES: RULES,
    getUserPoints: _getUserPoints,
    changePoints: _changePoints,
    signIn: _signIn,
    getLotteryReward: _getLotteryReward,
    usePointsForOffset: _usePointsForOffset,
    useLuckyLottery: _useLuckyLottery,
    getAllUsersPoints: _getAllUsersPoints,
    adminAddPoints: function(username, delta, reason) {
      return _changePoints(username, delta, reason, { forceAdmin: true });
    },
    setFrozen: _setFrozen,
    resetPoints: _resetPoints,
    adminAdjust: _adminAdjust
  };
})();