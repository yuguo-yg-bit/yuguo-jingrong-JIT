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
    document.getElementById("versionWatermark").textContent = "v3.0.7";
  };

  return { init: init };
})();

document.addEventListener("DOMContentLoaded", function() {
  JITCommunity.init();
});