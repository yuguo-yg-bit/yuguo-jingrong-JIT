var JITCommunity = (function() {
  var _currentUser = null;
  var _statuses = [];
  var _isPosting = false;
  var _TURSO = null;

  var AVATAR_COLORS = [
    "linear-gradient(135deg, #42a5f5, #1e88e5)",
    "linear-gradient(135deg, #ef5350, #c62828)",
    "linear-gradient(135deg, #66bb6a, #2e7d32)",
    "linear-gradient(135deg, #ffa726, #e65100)",
    "linear-gradient(135deg, #ab47bc, #6a1b9a)",
    "linear-gradient(135deg, #26c6da, #00838f)",
    "linear-gradient(135deg, #ec407a, #ad1457)",
    "linear-gradient(135deg, #7e57c2, #4527a0)"
  ];

  var _getAvatarColor = function(name) {
    var hash = 0;
    for (var i = 0; i < (name || "").length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  };

  var _getInitial = function(name) {
    return (name || "用").charAt(0).toUpperCase();
  };

  var _escapeHtml = function(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  // ===== Toast =====
  var _showToast = function(msg, type) {
    var container = document.getElementById("toastContainer");
    if (!container) return;
    var toast = document.createElement("div");
    toast.className = "toast toast-" + (type || "info");
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add("show"); });
    setTimeout(function() {
      toast.classList.remove("show");
      setTimeout(function() { toast.remove(); }, 300);
    }, 2500);
  };

  // ===== 背景粒子 =====
  var _initParticles = function() {
    var container = document.getElementById("bgParticles");
    if (!container) return;
    for (var i = 0; i < 25; i++) {
      var p = document.createElement("div");
      p.className = "particle";
      var size = Math.random() * 3 + 1;
      p.style.width = size + "px";
      p.style.height = size + "px";
      p.style.left = Math.random() * 100 + "%";
      p.style.bottom = -(Math.random() * 100) + "px";
      p.style.animationDuration = (Math.random() * 15 + 10) + "s";
      p.style.animationDelay = Math.random() * 10 + "s";
      container.appendChild(p);
    }
  };

  // ===== 等级系统 =====
  var LEVEL_CONFIG = [
    { level: 0, name: "消费新人", expNeed: 0 },
    { level: 1, name: "铜牌消费者", expNeed: 100 },
    { level: 2, name: "银牌消费者", expNeed: 300 },
    { level: 3, name: "金牌消费者", expNeed: 600 },
    { level: 4, name: "铂金VIP", expNeed: 1200 },
    { level: 5, name: "钻石VIP", expNeed: 2500 },
    { level: 6, name: "王者VIP", expNeed: 5000 },
    { level: 7, name: "至尊VIP", expNeed: 10000 }
  ];

  var _getUserLevel = function(userId) {
    var key = "jit_user_levels";
    var all = {};
    try { all = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
    return all[userId] || { level: 0, exp: 0, streak: 0 };
  };

  var _getLevelInfo = function(level) {
    return LEVEL_CONFIG[Math.min(level, LEVEL_CONFIG.length - 1)] || LEVEL_CONFIG[0];
  };

  // ===== 徽章 =====
  var _getBadges = function() {
    var levelData = _getUserLevel(_currentUser);
    var badges = [];
    var vouchers = [];
    try { vouchers = JSON.parse(localStorage.getItem("jit_current_data") || "[]"); } catch (e) {}
    var records = [];
    try { records = JSON.parse(localStorage.getItem("jit_slot_records") || "[]"); } catch (e) {}
    var myRecords = records.filter(function(r) { return r.username === _currentUser; });

    if (vouchers.length >= 1) badges.push({ icon: "📜", name: "初次凭证" });
    if (vouchers.length >= 10) badges.push({ icon: "📚", name: "凭证达人" });
    if (myRecords.length >= 5) badges.push({ icon: "🎰", name: "抽奖新手" });
    if (levelData.level >= 3) badges.push({ icon: "🥇", name: "金牌用户" });
    if (levelData.level >= 5) badges.push({ icon: "💎", name: "钻石VIP" });
    if ((levelData.streak || 0) >= 7) badges.push({ icon: "🔥", name: "连续打卡7天" });
    return badges;
  };

  // ===== 渲染我的资料卡 =====
  var _renderMyCard = function() {
    var card = document.getElementById("communityMyCard");
    if (!card) return;

    var levelData = _getUserLevel(_currentUser);
    var levelInfo = _getLevelInfo(levelData.level);
    var nextInfo = _getLevelInfo(levelData.level + 1);
    var expPct = 0;
    if (nextInfo && nextInfo.expNeed > levelInfo.expNeed) {
      expPct = Math.min(100, ((levelData.exp - levelInfo.expNeed) / (nextInfo.expNeed - levelInfo.expNeed)) * 100);
    } else if (!nextInfo) {
      expPct = 100;
    }

    var initial = _getInitial(_currentUser);
    var avatarSaved = localStorage.getItem("jit_avatar_" + _currentUser);
    var avatarHtml = avatarSaved
      ? '<img src="' + avatarSaved + '" alt="avatar">'
      : initial;

    var savedFrame = localStorage.getItem("jit_avatar_frame") || "none";
    var frameClass = (savedFrame && savedFrame !== "none") ? " frame-" + savedFrame : "";
    var avatarColor = avatarSaved ? "" : 'style="background:' + _getAvatarColor(_currentUser) + ';"';

    var tickets = 0;
    try {
      var ticketsData = JSON.parse(localStorage.getItem("jit_user_tickets") || "{}");
      tickets = ticketsData[_currentUser] || 0;
    } catch (e) {}

    var vouchers = [];
    try { vouchers = JSON.parse(localStorage.getItem("jit_current_data") || "[]"); } catch (e) {}
    var myVouchers = vouchers.filter(function(v) { return v.user === _currentUser; });

    var totalReward = 0;
    var slots = [];
    try { slots = JSON.parse(localStorage.getItem("jit_slot_records") || "[]"); } catch (e) {}
    slots.forEach(function(s) {
      if (s.username === _currentUser && s.reward) totalReward += parseFloat(s.reward) || 0;
    });

    var badges = _getBadges();
    var badgesHtml = "";
    if (badges.length > 0) {
      badges.forEach(function(b) {
        badgesHtml += '<span class="community-badge-item earned">' + b.icon + " " + _escapeHtml(b.name) + "</span>";
      });
    }
    if (!badgesHtml) {
      badgesHtml = '<span class="community-badge-item">暂无徽章，继续努力！</span>';
    }

    card.innerHTML =
      '<div class="community-avatar-wrapper">' +
        '<div class="community-avatar' + frameClass + '" ' + avatarColor + '>' + avatarHtml + '</div>' +
        '<button class="community-edit-avatar" id="btnEditProfile" title="编辑资料">✎</button>' +
      '</div>' +
      '<div class="community-name">' + _escapeHtml(_currentUser) + '</div>' +
      '<div class="community-real-name" id="communityRealName">真实姓名: 加载中...</div>' +
      '<div class="community-level-badge">Lv' + levelData.level + " " + levelInfo.name + '</div>' +
      '<div class="community-exp-bar"><div class="community-exp-fill" style="width:' + expPct + '%;"></div></div>' +
      '<div class="community-exp-text">经验值: ' + levelData.exp + " / " + (nextInfo ? nextInfo.expNeed : "MAX") + '</div>' +
      '<div class="community-stats-row">' +
        '<div class="community-stat-item"><span class="community-stat-num">' + myVouchers.length + '</span><span class="community-stat-label">凭证数</span></div>' +
        '<div class="community-stat-item"><span class="community-stat-num">' + (levelData.streak || 0) + '</span><span class="community-stat-label">连续打卡天</span></div>' +
        '<div class="community-stat-item"><span class="community-stat-num">' + tickets + '</span><span class="community-stat-label">抽奖券</span></div>' +
        '<div class="community-stat-item"><span class="community-stat-num">&yen;' + totalReward.toFixed(0) + '</span><span class="community-stat-label">累计返现</span></div>' +
      '</div>' +
      '<div class="community-badges">' + badgesHtml + '</div>';

    JITApi.getUserProfile(_currentUser).then(function(profile) {
      var el = document.getElementById("communityRealName");
      if (el && profile && profile.fullName) {
        el.textContent = "真实姓名: " + profile.fullName;
      } else if (el) {
        el.textContent = "真实姓名: —";
      }
    }).catch(function() {
      var el = document.getElementById("communityRealName");
      if (el) el.textContent = "真实姓名: —";
    });

    var editBtn = document.getElementById("btnEditProfile");
    if (editBtn) editBtn.addEventListener("click", _openEditProfile);

    var composerAvatar = document.getElementById("composerAvatar");
    if (composerAvatar) {
      if (avatarSaved) {
        composerAvatar.innerHTML = '<img src="' + avatarSaved + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
      } else {
        composerAvatar.textContent = initial;
        composerAvatar.style.background = _getAvatarColor(_currentUser);
      }
    }
  };

  // ===== 资料编辑弹窗 =====
  var _openEditProfile = function() {
    var overlay = document.getElementById("editProfileOverlay");
    if (!overlay) return;
    var avatarSaved = localStorage.getItem("jit_avatar_" + _currentUser);
    var preview = document.getElementById("editAvatarPreview");
    if (preview) {
      if (avatarSaved) {
        preview.innerHTML = '<img src="' + avatarSaved + '" alt="avatar">';
      } else {
        preview.textContent = _getInitial(_currentUser);
        preview.style.background = _getAvatarColor(_currentUser);
      }
    }
    overlay.classList.add("active");
  };

  var _closeEditProfile = function() {
    var overlay = document.getElementById("editProfileOverlay");
    if (overlay) overlay.classList.remove("active");
  };

  var _handleAvatarUpload = function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { _showToast("头像文件不能超过500KB", "error"); return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
      var dataUrl = ev.target.result;
      localStorage.setItem("jit_avatar_" + _currentUser, dataUrl);
      _renderMyCard();
      _closeEditProfile();
      _showToast("头像更新成功", "success");
    };
    reader.readAsDataURL(file);
  };

  // ===== 社区状态 CRUD（Turso） =====
  var _loadStatuses = function() {
    var feed = document.getElementById("communityFeed");
    if (feed) feed.innerHTML = '<div class="feed-loading">加载动态中...</div>';

    return _TURSO("SELECT * FROM community_statuses ORDER BY created_at DESC LIMIT 200", []).then(function(result) {
      var rows = _TURSO.rowsToObjects(result);
      _statuses = rows.map(function(r) {
        return {
          username: r.username || "",
          content: r.content || "",
          time: r.created_at || "",
          created_at: r.created_at || ""
        };
      });
      _renderFeed();
    }).catch(function(err) {
      var feed = document.getElementById("communityFeed");
      if (feed) feed.innerHTML = '<div class="feed-loading" style="color:var(--red);">加载失败: ' + _escapeHtml((err && err.message) || "网络错误") + '</div>';
    });
  };

  // ===== 渲染动态流 =====
  var _renderFeed = function() {
    var feed = document.getElementById("communityFeed");
    if (!feed) return;

    if (_statuses.length === 0) {
      feed.innerHTML =
        '<div class="feed-empty">' +
          '<div class="feed-empty-icon">📭</div>' +
          '<div class="feed-empty-text">还没有人发布动态<br>快来分享第一条状态吧！</div>' +
        '</div>';
      return;
    }

    var html = "";
    _statuses.forEach(function(s) {
      var initial = _getInitial(s.username);
      var avatarColor = _getAvatarColor(s.username);
      var timeStr = "";
      try {
        var d = new Date(s.time);
        var now = new Date();
        var diff = now - d;
        if (diff < 60000) {
          timeStr = "刚刚";
        } else if (diff < 3600000) {
          timeStr = Math.floor(diff / 60000) + "分钟前";
        } else if (diff < 86400000) {
          timeStr = Math.floor(diff / 3600000) + "小时前";
        } else if (diff < 604800000) {
          timeStr = Math.floor(diff / 86400000) + "天前";
        } else {
          timeStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        }
      } catch (e) {
        timeStr = s.time || "";
      }

      var avatarSaved = localStorage.getItem("jit_avatar_" + s.username);
      var avatarHtml = avatarSaved
        ? '<img src="' + avatarSaved + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
        : initial;

      html +=
        '<div class="feed-card">' +
          '<div class="feed-card-avatar" style="background:' + avatarColor + ';">' + avatarHtml + '</div>' +
          '<div class="feed-card-body">' +
            '<div class="feed-card-name">' + _escapeHtml(s.username) + '</div>' +
            '<div class="feed-card-time">' + timeStr + '</div>' +
            '<div class="feed-card-content">' + _escapeHtml(s.content) + '</div>' +
          '</div>' +
        '</div>';
    });
    feed.innerHTML = html;
  };

  // ===== 发布状态 =====
  var _postStatus = function() {
    if (_isPosting) return;
    var textarea = document.getElementById("statusTextarea");
    if (!textarea) return;
    var content = textarea.value.trim();
    if (!content) { _showToast("请输入内容", "error"); return; }
    if (content.length > 500) { _showToast("内容不能超过500字", "error"); return; }

    _isPosting = true;
    var btn = document.getElementById("btnPostStatus");
    if (btn) { btn.disabled = true; btn.textContent = "发布中..."; }

    var now = new Date().toISOString();

    _TURSO(
      "INSERT INTO community_statuses (username, content, created_at) VALUES (?,?,?)",
      [_currentUser, content, now]
    ).then(function() {
      textarea.value = "";
      document.getElementById("composerCharCount").textContent = "0/500";
      _showToast("发布成功！", "success");
      return _loadStatuses();
    }).catch(function(err) {
      _showToast("发布失败: " + ((err && err.message) || "网络错误"), "error");
    }).finally(function() {
      _isPosting = false;
      if (btn) { btn.disabled = false; btn.textContent = "发布"; }
    });
  };

  // ===== 绑定事件 =====
  var _bindEvents = function() {
    var btnPost = document.getElementById("btnPostStatus");
    if (btnPost) btnPost.addEventListener("click", _postStatus);

    var textarea = document.getElementById("statusTextarea");
    if (textarea) {
      textarea.addEventListener("input", function() {
        var len = textarea.value.length;
        var counter = document.getElementById("composerCharCount");
        if (counter) counter.textContent = len + "/500";
      });
      textarea.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          _postStatus();
        }
      });
    }

    var btnChangeAvatar = document.getElementById("btnChangeAvatar");
    if (btnChangeAvatar) btnChangeAvatar.addEventListener("click", function() {
      document.getElementById("editAvatarFileInput").click();
    });

    var fileInput = document.getElementById("editAvatarFileInput");
    if (fileInput) fileInput.addEventListener("change", _handleAvatarUpload);

    var btnClose = document.getElementById("btnEditClose");
    if (btnClose) btnClose.addEventListener("click", _closeEditProfile);

    var editOverlay = document.getElementById("editProfileOverlay");
    if (editOverlay) {
      editOverlay.addEventListener("click", function(e) {
        if (e.target === editOverlay) _closeEditProfile();
      });
      document.addEventListener("keydown", function(e) {
        if (e.key === "Escape" && editOverlay.classList.contains("active")) {
          _closeEditProfile();
        }
      });
    }

    // 个人中心
    var btnOpenUC = document.getElementById("btnOpenUserCenter");
    if (btnOpenUC) btnOpenUC.addEventListener("click", _openUserCenter);
    var btnUCClose = document.getElementById("btnUserCenterClose");
    if (btnUCClose) btnUCClose.addEventListener("click", _closeUserCenter);
    var ucOverlay = document.getElementById("userCenterOverlay");
    if (ucOverlay) {
      ucOverlay.addEventListener("click", function(e) { if (e.target === ucOverlay) _closeUserCenter(); });
    }

    // 头像上传（用户中心）
    var btnChgAvatar = document.getElementById("btnChangeAvatarUC");
    if (btnChgAvatar) btnChgAvatar.addEventListener("click", function() {
      var fInput = document.getElementById("avatarFileInputUC");
      if (fInput) fInput.click();
    });
    var avatarFInput = document.getElementById("avatarFileInputUC");
    if (avatarFInput) avatarFInput.addEventListener("change", _handleUCProfileAvatarUpload);

    // 修改密码
    var btnChgPwd = document.getElementById("btnChangePassword");
    if (btnChgPwd) btnChgPwd.addEventListener("click", _doChangePassword);

    // 装扮选择器事件
    _initOutfitEvents();
  };

  // ===== 积分辅助 =====
  var _currentPoints = 0;
  var _refreshLocalPoints = function() {
    if (!_currentUser) return Promise.resolve();
    return JITPoints.getUserPoints(_currentUser, true).then(function(d) {
      _currentPoints = d ? (d.points || 0) : 0;
      return _currentPoints;
    }).catch(function() { return 0; });
  };

  // ===== 获取本地凭证列表 =====
  var _getLocalVouchers = function() {
    try { return JSON.parse(localStorage.getItem("jit_current_data") || "[]"); } catch(e) { return []; }
  };

  // ===== 徽章配置 =====
  var BADGES_CONFIG = [
    { id: "first_voucher", name: "初次凭证", icon: "📜", req: "添加第1张凭证", check: function() { return _getLocalVouchers().length >= 1; } },
    { id: "voucher_10", name: "凭证达人", icon: "📚", req: "累计10张凭证", check: function() { return _getLocalVouchers().length >= 10; } },
    { id: "lottery_5", name: "抽奖新手", icon: "🎰", req: "完成5次抽奖", check: function() { var records = JSON.parse(localStorage.getItem("jit_slot_records") || "[]"); return records.filter(function(r) { return r.username === _currentUser; }).length >= 5; } },
    { id: "level_3", name: "金牌用户", icon: "🥇", req: "达到Lv3", check: function(level) { return level >= 3; } },
    { id: "level_5", name: "钻石VIP", icon: "💎", req: "达到Lv5", check: function(level) { return level >= 5; } },
    { id: "streak_7", name: "连续打卡7天", icon: "🔥", req: "连续打卡7天", check: function(levelData) { return (levelData.streak || 0) >= 7; } }
  ];

  var _renderBadges = function(level) {
    var grid = document.getElementById("badgesGrid");
    if (!grid) return;
    var levelData = _getUserLevel(_currentUser);
    var html = "";
    BADGES_CONFIG.forEach(function(badge) {
      var unlocked;
      if (badge.id === "level_3" || badge.id === "level_5") {
        unlocked = badge.check(level);
      } else if (badge.id === "streak_7") {
        unlocked = badge.check(levelData);
      } else {
        unlocked = badge.check();
      }
      if (unlocked) {
        html += '<span class="badge-item badge-unlocked" style="background:rgba(76,175,80,0.12);border-color:rgba(76,175,80,0.3);">' + badge.icon + ' ' + badge.name + '</span>';
      } else {
        html += '<span class="badge-item badge-locked">🔒 ' + badge.req + '</span>';
      }
    });
    grid.innerHTML = html;
  };

  // ===== 任务 =====
  var _taskRewardsKey = "jit_task_rewards";
  var _renderTaskRefreshing = false;
  var _getTaskRewards = function() { try { return JSON.parse(localStorage.getItem(_taskRewardsKey) || "{}"); } catch(e) { return {}; } };
  var _setTaskRewards = function(rewards) { localStorage.setItem(_taskRewardsKey, JSON.stringify(rewards)); };

  var _renderTasks = function(levelData) {
    var today = new Date().toISOString().split("T")[0];
    var thisMonth = today.substring(0, 7);
    var rewards = _getTaskRewards();
    var userId = _currentUser;
    if (!rewards[userId]) rewards[userId] = {};
    var userRewards = rewards[userId];

    var vouchers = _getLocalVouchers();
    var todayVouchers = vouchers.filter(function(v) { return v.date && v.date.substring(0, 10) === today; }).length;
    var taskVoucher = document.getElementById("taskVoucher");
    if (taskVoucher) {
      taskVoucher.textContent = todayVouchers + "/1";
      if (todayVouchers >= 1) taskVoucher.classList.add("task-done"); else taskVoucher.classList.remove("task-done");
    }
    if (todayVouchers >= 1 && !userRewards["task_voucher_" + today]) {
      userRewards["task_voucher_" + today] = true;
      _addExp(_currentUser, 50);
      if (JITPoints && JITPoints.changePoints) { JITPoints.changePoints(_currentUser, 15, "完成每日「添加凭证」任务").then(function() { _refreshLocalPoints(); }).catch(function() {}); }
      _showToast("✅ 完成任务：添加凭证！+50经验 +15积分", "success");
    }

    var slotRecords = JSON.parse(localStorage.getItem("jit_slot_records") || "[]");
    var todaySlots = slotRecords.filter(function(r) { return r.username === _currentUser && r.date && r.date.substring(0, 10) === today; }).length;
    var taskLottery = document.getElementById("taskLottery");
    if (taskLottery) {
      taskLottery.textContent = todaySlots + "/3";
      if (todaySlots >= 3) taskLottery.classList.add("task-done"); else taskLottery.classList.remove("task-done");
    }
    if (todaySlots >= 3 && !userRewards["task_lottery_" + today]) {
      userRewards["task_lottery_" + today] = true;
      _addExp(_currentUser, 100);
      if (JITPoints && JITPoints.changePoints) { JITPoints.changePoints(_currentUser, 30, "完成每日「完成3次抽奖」任务").then(function() { _refreshLocalPoints(); }).catch(function() {}); }
      _showToast("🔮 完成任务：完成3次抽奖！+100经验 +30积分", "success");
    }

    var streak = levelData.streak || 0;
    var taskStreak = document.getElementById("taskStreak");
    if (taskStreak) { taskStreak.textContent = streak + "天"; }
    if (streak > 0 && !userRewards["task_streak_" + today]) {
      userRewards["task_streak_" + today] = true;
      var streakBonus = Math.min(streak * 5, 50);
      _addExp(_currentUser, streakBonus);
      if (JITPoints && JITPoints.changePoints) { JITPoints.changePoints(_currentUser, 10, "连续打卡" + streak + "天奖励").then(function() { _refreshLocalPoints(); }).catch(function() {}); }
      if (streak >= 7) { _showToast("🔥 连续打卡" + streak + "天！+" + streakBonus + "经验 +10积分", "success"); }
    }

    var monthSpend = vouchers.filter(function(v) { return v.date && v.date.substring(0, 7) === thisMonth; }).reduce(function(sum, v) { return sum + parseFloat(v.amount || 0); }, 0);
    var taskSpend = document.getElementById("taskSpend");
    if (taskSpend) {
      taskSpend.textContent = Math.round(Math.min(monthSpend, 5000)) + "/5000";
      if (monthSpend >= 5000) taskSpend.classList.add("task-done"); else taskSpend.classList.remove("task-done");
    }
    if (monthSpend >= 5000 && !userRewards["task_spend_" + thisMonth]) {
      userRewards["task_spend_" + thisMonth] = true;
      _addExp(_currentUser, 200);
      if (JITPoints && JITPoints.changePoints) { JITPoints.changePoints(_currentUser, 100, "完成「消费达人」任务（月消费≥¥5000）").then(function() { _refreshLocalPoints(); }).catch(function() {}); }
      _showToast("🏆 消费达人！月消费≥¥5000！+200经验 +100积分", "success");
    }
    _setTaskRewards(rewards);

    if (!_renderTaskRefreshing) { _renderTaskRefreshing = true; _refreshUserCenterUI(); _renderTaskRefreshing = false; }
  };

  // ===== 风控 =====
  var _renderRiskStatus = function() {
    var riskRemain = document.getElementById("riskRemain");
    if (!riskRemain) return;
    var budget = parseFloat(localStorage.getItem("jit_risk_budget") || "5000");
    var today = new Date().toISOString().split("T")[0];
    var thisMonth = today.substring(0, 7);
    var slotRecords = JSON.parse(localStorage.getItem("jit_slot_records") || "[]");
    var monthSpent = slotRecords.filter(function(r) { return r.date && r.date.substring(0, 7) === thisMonth; }).reduce(function(sum, r) { return sum + parseFloat(r.totalReward || 0); }, 0);
    monthSpent = Math.round(monthSpent * 100) / 100;
    var remain = Math.max(0, budget - monthSpent);
    var rBudget = document.getElementById("riskBudget");
    var rSpent = document.getElementById("riskSpent");
    if (rBudget) rBudget.textContent = "¥" + budget;
    if (rSpent) rSpent.textContent = "¥" + monthSpent.toFixed(2);
    riskRemain.textContent = "¥" + remain.toFixed(2);
    riskRemain.style.color = remain < budget * 0.2 ? "#f44336" : remain < budget * 0.5 ? "#ff9800" : "#4caf50";
    var rBar = document.getElementById("riskBarFill");
    if (rBar) rBar.style.width = Math.min(100, (monthSpent / budget) * 100) + "%";
  };

  // ===== 抽奖券数量 =====
  var _renderTicketCount = function() {
    var statTickets = document.getElementById("statTickets");
    if (!statTickets) return;
    var tickets = JSON.parse(localStorage.getItem("jit_user_tickets") || "{}");
    statTickets.textContent = String(tickets[_currentUser] || 0);
  };

  // ===== 经验增加 =====
  var _addExp = function(userId, exp) {
    var key = "jit_user_levels";
    var all = {};
    try { all = JSON.parse(localStorage.getItem(key) || "{}"); } catch(e) {}
    if (!all[userId]) all[userId] = { level: 0, exp: 0, streak: 0 };
    all[userId].exp = (all[userId].exp || 0) + exp;
    var result = { levelData: all[userId], leveledUp: false };
    var newLevel = 0;
    for (var i = LEVEL_CONFIG.length - 1; i >= 0; i--) { if (all[userId].exp >= LEVEL_CONFIG[i].expNeed) { newLevel = LEVEL_CONFIG[i].level; break; } }
    if (newLevel > all[userId].level) { all[userId].level = newLevel; result.leveledUp = true; }
    localStorage.setItem(key, JSON.stringify(all));
    return result;
  };

  // ===== 刷新个人中心 UI =====
  var _refreshUserCenterUI = function() {
    if (!_currentUser) return;
    _refreshLocalPoints();

    var levelData = _getUserLevel(_currentUser);
    var levelInfo = _getLevelInfo(levelData.level);
    var nextInfo = _getLevelInfo(levelData.level + 1);
    var expPct = 0;
    if (nextInfo) { expPct = Math.min(100, ((levelData.exp - levelInfo.expNeed) / (nextInfo.expNeed - levelInfo.expNeed)) * 100); } else { expPct = 100; }

    var pn = document.getElementById("profileName");
    var prn = document.getElementById("profileRealName");
    var plb = document.getElementById("profileLevelBadge");
    var plf = document.getElementById("profileLevelFill");
    var pe = document.getElementById("profileExp");
    if (pn) pn.textContent = _currentUser;
    if (prn) prn.textContent = "真实姓名: 加载中...";
    JITApi.getUserProfile(_currentUser).then(function(p) { if (prn) prn.textContent = p && p.fullName ? "真实姓名: " + p.fullName : "真实姓名: —"; }).catch(function() { if (prn) prn.textContent = "真实姓名: —"; });
    if (plb) plb.textContent = "Lv" + levelData.level + " " + levelInfo.name;
    if (plf) plf.style.width = expPct + "%";
    if (pe) pe.textContent = "经验值: " + levelData.exp + " / " + (nextInfo ? nextInfo.expNeed : "MAX");

    var avatarSaved = localStorage.getItem("jit_avatar_" + _currentUser);
    var ac = document.getElementById("avatarCircle");
    var ai = document.getElementById("avatarInitial");
    if (avatarSaved) { if (ac) ac.innerHTML = '<img src="' + avatarSaved + '" alt="avatar">'; } else { if (ai) ai.textContent = (_currentUser || "用").charAt(0).toUpperCase(); }

    var vouchers = _getLocalVouchers();
    var sv = document.getElementById("statVouchers");
    var ss = document.getElementById("statStreak");
    var st = document.getElementById("statTickets");
    var sr = document.getElementById("statRewards");
    if (sv) sv.textContent = vouchers.length;
    if (ss) ss.textContent = levelData.streak || 0;
    var tickets = JSON.parse(localStorage.getItem("jit_user_tickets") || "{}");
    if (st) st.textContent = tickets[_currentUser] || 0;
    var slotRecords = JSON.parse(localStorage.getItem("jit_slot_records") || "[]");
    var totalReward = 0;
    for (var i = 0; i < slotRecords.length; i++) { if (slotRecords[i].username === _currentUser) totalReward += parseFloat(slotRecords[i].totalReward || 0); }
    if (sr) sr.textContent = "¥" + totalReward.toFixed(2);

    var tw = document.getElementById("ticketWall");
    if (tw) {
      var mySlots = slotRecords.filter(function(r) { return r.username === _currentUser; });
      if (mySlots.length === 0) { tw.innerHTML = '<div class="ticket-wall-empty">暂无抽过的凭证</div>'; } else {
        var h = "";
        for (var j = 0; j < mySlots.length; j++) { var rec = mySlots[j]; h += '<div class="ticket-wall-item"><span class="tw-discount">' + _escapeHtml(rec.scratchDiscount || "") + '</span><div class="tw-shop">' + _escapeHtml(rec.shopName || "未知店铺") + '</div><div class="tw-date">' + (rec.date || "").substring(0, 10) + '</div>'; if (parseFloat(rec.totalReward || 0) > 0) h += '<div class="tw-reward">¥' + rec.totalReward + '</div>'; h += '</div>'; }
        tw.innerHTML = h;
      }
    }

    _renderBadges(levelData.level);
    _renderTasks(levelData);
    _renderRiskStatus();
    _renderTicketCount();
    _refreshThemePickerUI();
    _refreshFramePickerUI();
    var savedFrame = localStorage.getItem("jit_avatar_frame") || "none";
    _applyAvatarFrame(savedFrame);
  };

  // ===== 打开/关闭个人中心 =====
  var _openUserCenter = function() {
    if (!_currentUser) { _showToast("请先登录", "error"); return; }
    _refreshUserCenterUI();
    var ov = document.getElementById("userCenterOverlay");
    if (ov) ov.classList.add("active");
  };
  var _closeUserCenter = function() {
    var ov = document.getElementById("userCenterOverlay");
    if (ov) ov.classList.remove("active");
  };

  // ===== 用户中心头像上传 =====
  var _handleUCProfileAvatarUpload = function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { _showToast("头像文件不能超过500KB", "error"); return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
      var dataUrl = ev.target.result;
      localStorage.setItem("jit_avatar_" + _currentUser, dataUrl);
      var ac = document.getElementById("avatarCircle");
      if (ac) ac.innerHTML = '<img src="' + dataUrl + '" alt="avatar">';
      _renderMyCard();
      _showToast("头像更新成功", "success");
    };
    reader.readAsDataURL(file);
  };

  // ===== 修改密码 =====
  var _doChangePassword = function() {
    var inp = document.getElementById("inputNewPassword");
    if (!inp || !inp.value.trim()) { _showToast("请输入新密码", "error"); return; }
    var pwd = inp.value.trim();
    JITApi.updateUserPassword(_currentUser, pwd).then(function() { _showToast("密码修改成功", "success"); inp.value = ""; }).catch(function(err) { _showToast("密码修改失败: " + (err.message || ""), "error"); });
  };

  // ===== 装扮系统 =====
  var _getUnlockedOutfits = function() { try { return JSON.parse(localStorage.getItem("jit_unlocked_outfits") || "[]"); } catch(e) { return []; } };
  var _saveUnlockedOutfits = function(o) { localStorage.setItem("jit_unlocked_outfits", JSON.stringify(o)); };
  var _isOutfitUnlocked = function(type, id) { if (id === "default" || id === "none") return true; return _getUnlockedOutfits().indexOf(type + "_" + id) !== -1; };

  var _unlockOutfit = function(type, id, cost) {
    if (_isOutfitUnlocked(type, id)) return true;
    if (_currentPoints < cost) return false;
    var ul = _getUnlockedOutfits(); ul.push(type + "_" + id); _saveUnlockedOutfits(ul);
    if (JITPoints && JITPoints.changePoints) { JITPoints.changePoints(_currentUser, -cost, "解锁装扮: " + id).then(function() { _refreshLocalPoints(); }).catch(function() {}); } else { _refreshLocalPoints(); }
    return true;
  };

  var _showBuyConfirm = function(type, id, cost, name, onConfirm) {
    var ov = document.getElementById("buyConfirmOverlay");
    var nel = document.getElementById("buyConfirmName");
    var cel = document.getElementById("buyConfirmCost");
    var pel = document.getElementById("buyConfirmPts");
    var btnBuy = document.getElementById("btnBuyConfirm");
    var btnCancel = document.getElementById("btnBuyCancel");
    if (!ov || !nel || !cel) return;
    nel.textContent = name; cel.textContent = String(cost);
    if (pel) pel.textContent = "当前积分：" + String(_currentPoints);
    ov.classList.add("active");
    var doConfirm = function() { ov.classList.remove("active"); btnBuy.removeEventListener("click", doConfirm); btnCancel.removeEventListener("click", doCancel); document.removeEventListener("keydown", onEsc); onConfirm(); };
    var doCancel = function() { ov.classList.remove("active"); btnBuy.removeEventListener("click", doConfirm); btnCancel.removeEventListener("click", doCancel); document.removeEventListener("keydown", onEsc); };
    var onEsc = function(e) { if (e.key === "Escape") doCancel(); };
    btnBuy.addEventListener("click", doConfirm); btnCancel.addEventListener("click", doCancel); document.addEventListener("keydown", onEsc);
    ov.addEventListener("click", function(e) { if (e.target === ov) doCancel(); }, { once: true });
  };

  var _applyTheme = function(theme) {
    var b = document.body;
    b.classList.remove("theme-ocean", "theme-forest", "theme-rose", "theme-sunset", "theme-galaxy");
    if (theme && theme !== "default") b.classList.add("theme-" + theme);
    localStorage.setItem("jit_theme", theme || "default");
    _refreshThemePickerUI();
  };

  var _setTheme = function(theme, cost) {
    if (_isOutfitUnlocked("theme", theme)) { _applyTheme(theme); _showToast("🎨 主题装扮已切换", "success"); _refreshUserCenterUI(); return; }
    if (cost <= 0) { _applyTheme(theme); _showToast("🎨 主题装扮已切换", "success"); _refreshUserCenterUI(); return; }
    if (_currentPoints < cost) { _showToast("积分不足！需要 " + cost + " 积分，当前只有 " + _currentPoints + " 积分", "error"); return; }
    var names = { ocean: "深海蓝主题", forest: "森林绿主题", rose: "玫瑰金主题", sunset: "日落橙主题", galaxy: "星云紫主题" };
    _showBuyConfirm("theme", theme, cost, names[theme] || (theme + "主题"), function() { _unlockOutfit("theme", theme, cost); _applyTheme(theme); _showToast("🎨 已解锁" + (names[theme] || theme) + "！（消耗 " + cost + " 积分）", "success"); _refreshUserCenterUI(); });
  };

  var _applyAvatarFrame = function(frame) {
    var ac = document.getElementById("avatarCircle");
    if (ac) { ac.classList.remove("frame-gold", "frame-diamond", "frame-ruby", "frame-rainbow"); if (frame && frame !== "none") ac.classList.add("frame-" + frame); }
    localStorage.setItem("jit_avatar_frame", frame || "none");
    _refreshFramePickerUI();
  };

  var _setAvatarFrame = function(frame, cost) {
    if (_isOutfitUnlocked("frame", frame)) { _applyAvatarFrame(frame); _showToast("🖼️ 头像框已切换", "success"); _refreshUserCenterUI(); return; }
    if (cost <= 0) { _applyAvatarFrame(frame); _showToast("🖼️ 头像框已切换", "success"); _refreshUserCenterUI(); return; }
    if (_currentPoints < cost) { _showToast("积分不足！需要 " + cost + " 积分，当前只有 " + _currentPoints + " 积分", "error"); return; }
    var names = { gold: "金框头像框", diamond: "钻石头像框", ruby: "红宝石头像框", rainbow: "彩虹头像框" };
    _showBuyConfirm("frame", frame, cost, names[frame] || (frame + "头像框"), function() { _unlockOutfit("frame", frame, cost); _applyAvatarFrame(frame); _showToast("🖼️ 已解锁" + (names[frame] || frame) + "！（消耗 " + cost + " 积分）", "success"); _refreshUserCenterUI(); });
  };

  var _refreshThemePickerUI = function() {
    var cur = localStorage.getItem("jit_theme") || "default";
    var opts = document.querySelectorAll("#themePicker .theme-option");
    opts.forEach(function(opt) {
      var t = opt.getAttribute("data-theme"), c = parseInt(opt.getAttribute("data-cost") || "0");
      opt.classList.toggle("theme-active", t === cur); opt.classList.toggle("theme-locked", !_isOutfitUnlocked("theme", t));
      var cel = opt.querySelector(".theme-cost");
      if (cel) { if (_isOutfitUnlocked("theme", t)) { cel.textContent = "已解锁"; cel.className = "theme-cost unlocked"; } else { cel.textContent = "🛒 " + c + "分"; cel.className = "theme-cost"; } }
    });
    var pe = document.getElementById("outfitPointCount");
    if (pe) pe.textContent = String(_currentPoints);
  };

  var _refreshFramePickerUI = function() {
    var cur = localStorage.getItem("jit_avatar_frame") || "none";
    var opts = document.querySelectorAll("#avatarFramePicker .theme-option");
    opts.forEach(function(opt) {
      var f = opt.getAttribute("data-frame"), c = parseInt(opt.getAttribute("data-cost") || "0");
      opt.classList.toggle("theme-active", f === cur); opt.classList.toggle("theme-locked", !_isOutfitUnlocked("frame", f));
      var cel = opt.querySelector(".theme-cost");
      if (cel) { if (_isOutfitUnlocked("frame", f)) { cel.textContent = "已解锁"; cel.className = "theme-cost unlocked"; } else { cel.textContent = "🛒 " + c + "分"; cel.className = "theme-cost"; } }
    });
  };

  var _initOutfits = function() {
    var st = localStorage.getItem("jit_theme") || "default";
    var sf = localStorage.getItem("jit_avatar_frame") || "none";
    if (st !== "default" && !_isOutfitUnlocked("theme", st)) { st = "default"; localStorage.setItem("jit_theme", "default"); }
    if (sf !== "none" && !_isOutfitUnlocked("frame", sf)) { sf = "none"; localStorage.setItem("jit_avatar_frame", "none"); }
    _applyTheme(st);
    _applyAvatarFrame(sf);
  };

  var _initOutfitEvents = function() {
    document.querySelectorAll("#themePicker .theme-option").forEach(function(opt) {
      opt.addEventListener("click", function() { _setTheme(opt.getAttribute("data-theme"), parseInt(opt.getAttribute("data-cost") || "0")); });
    });
    document.querySelectorAll("#avatarFramePicker .theme-option").forEach(function(opt) {
      opt.addEventListener("click", function() { _setAvatarFrame(opt.getAttribute("data-frame"), parseInt(opt.getAttribute("data-cost") || "0")); });
    });
  };

  // ===== 中奖墙 =====
  var _renderWinWall = function() {
    var inner = document.getElementById("winWallInner");
    if (!inner) return;
    var ww = JSON.parse(localStorage.getItem("jit_winwall") || "[]");
    if (ww.length === 0) { inner.innerHTML = '<span class="win-wall-item" style="color:var(--text-muted);">暂无中奖记录，去工作台抽奖吧~</span>'; return; }
    var h = "";
    ww.forEach(function(item) {
      h += '<span class="win-wall-item">🎉 <b>' + _escapeHtml(item.user) + '</b> 中了 <b style="color:var(--gold);">' + _escapeHtml(String(item.prize)) + '</b>';
      if (item.amount && parseFloat(item.amount) > 0) h += ' 返现 <b style="color:var(--green);">¥' + item.amount + '</b>';
      h += '</span>';
    });
    inner.innerHTML = h;
  };

  // ===== 初始化 =====
  var init = function() {
    _currentUser = localStorage.getItem("jit_current_user");
    if (!_currentUser) {
      window.location.href = "work.html";
      return;
    }

    _TURSO = JITApi.getTursoHelpers();
    if (!_TURSO) {
      _showToast("数据库连接失败，请刷新页面", "error");
      return;
    }

    _initParticles();
    _renderMyCard();
    _bindEvents();
    _loadStatuses();
    _refreshLocalPoints();
    _initOutfits();
    _renderWinWall();
    document.getElementById("versionWatermark").textContent = "v3.0.8";
  };

  return { init: init };
})();

document.addEventListener("DOMContentLoaded", function() {
  JITCommunity.init();
});