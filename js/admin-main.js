var JITAdmin = (function() {
  var TOKEN = JITConfig.getToken();
  var REPO = JITConfig.getRepo();
  var OWNER = JITConfig.getOwner();
  var BASE_URL = JITConfig.getBaseUrl();

  var ADMIN_PASSWORD = "27015150111";
  var MAX_ATTEMPTS = 5;
  var LOCKOUT_MINUTES = 15;
  var currentIssue = null;
  var allIssues = [];
  var chatPollTimer = null;
  var currentChatUser = null;
  var _isLoggedIn = false;

  var _attemptsKey = "jit_admin_attempts";
  var _lockoutKey = "jit_admin_lockout";

  var _showToast = function(msg) {
    var el = document.getElementById("adminToast");
    if (el) {
      el.textContent = msg;
      el.classList.add("show");
      setTimeout(function() { el.classList.remove("show"); }, 3000);
    }
  };

  var _apiGet = function(url) {
    return fetch(url, {
      headers: { Authorization: "token " + TOKEN, Accept: "application/vnd.github.v3+json" }
    }).then(function(r) {
      if (!r.ok) throw new Error("请求失败: " + r.status);
      return r.json();
    });
  };

  var _apiPatch = function(url, body) {
    return fetch(url, {
      method: "PATCH",
      headers: { Authorization: "token " + TOKEN, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) {
        return r.json().then(function(d) { throw new Error(d.message || "请求失败: " + r.status); });
      }
      return r.json();
    });
  };

  var _apiPost = function(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { Authorization: "token " + TOKEN, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) {
        return r.json().then(function(d) { throw new Error(d.message || "请求失败: " + r.status); });
      }
      return r.json();
    });
  };

  var _escapeHtml = function(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  };

  var _parseIssueBody = function(body) {
    var data = {};
    if (!body) return data;
    var lines = String(body).split(/\r?\n/);
    lines.forEach(function(line) {
      var trimmed = line.trim();
      var match;
      if ((match = trimmed.match(/^｜?\s*用户ID：(.+)/))) data.userId = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*店铺名称：(.+)/))) data.shopName = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*消费日期：(.+)/))) data.date = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*消费金额：(.+)/))) data.amount = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*中奖打折：(.+)/))) data.discount = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*支付方式：(.+)/))) data.paymentMethod = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*备注：(.+)/))) data.note = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*定位：(.+)/))) data.location = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*店铺照片：(.+)/))) data.shopPhoto = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*商品订单照片：(.+)/))) data.orderPhotos = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*(签字|签名)：(.+)/))) data.signature = match[2].trim();
      else if ((match = trimmed.match(/^｜?\s*状态：(.+)/))) data.status = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*不通过原因：(.+)/))) data.rejectReason = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*创建时间：(.+)/))) data.createTime = match[1].trim();
      else if ((match = trimmed.match(/^｜?标题：(.+)/))) data.title = match[1].trim();
      else if ((match = trimmed.match(/^｜?内容：店铺：(.+)/))) data.shopName = data.shopName || match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*中奖打折：(.+)/))) data.discount = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*金额：(.+)/))) data.amount = match[1].trim();
    });
    return data;
  };

  var _getIssueStatus = function(issue) {
    var labels = (issue.labels || []).map(function(l) { return l.name; });
    if (labels.indexOf("approved") > -1) return "approved";
    if (labels.indexOf("rejected") > -1) return "rejected";
    return "pending";
  };

  var _ensureLabels = function() {
    var labels = ["pending", "approved", "rejected"];
    var promises = [];
    labels.forEach(function(label) {
      promises.push(
        fetch(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/labels/" + label, {
          headers: { Authorization: "token " + TOKEN, Accept: "application/vnd.github.v3+json" }
        }).then(function(r) {
          if (r.status === 404) {
            return _apiPost(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/labels", {
              name: label,
              color: label === "approved" ? "4caf50" : (label === "rejected" ? "f44336" : "ff9800")
            });
          }
        }).catch(function() {})
      );
    });
    return Promise.all(promises);
  };

  var loadIssues = function() {
    return _ensureLabels().then(function() {
      return _apiGet(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues?state=all&per_page=100&sort=created&direction=desc");
    }).then(function(issues) {
      allIssues = issues.filter(function(issue) {
        return issue.title && (issue.title.indexOf("凭证") !== -1 || hasVoucherData(issue));
      });
      renderTable();
    });
  };

  var hasVoucherData = function(issue) {
    if (!issue.body) return false;
    return issue.body.indexOf("店铺名称") > -1 || issue.body.indexOf("店铺：") > -1 || issue.body.indexOf("中奖打折") > -1;
  };

  var renderTable = function() {
    var filter = document.getElementById("filterStatus").value;
    var tbody = document.getElementById("adminTableBody");
    var pendingCount = 0, approvedCount = 0, rejectedCount = 0;

    var filtered = allIssues.filter(function(issue) {
      var status = _getIssueStatus(issue);
      if (status === "pending") pendingCount++;
      if (status === "approved") approvedCount++;
      if (status === "rejected") rejectedCount++;
      return filter === "all" || status === filter;
    });

    document.getElementById("statPending").textContent = "待审核: " + pendingCount;
    document.getElementById("statApproved").textContent = "已通过: " + approvedCount;
    document.getElementById("statRejected").textContent = "已拒绝: " + rejectedCount;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">暂无数据</td></tr>';
      return;
    }

    var html = "";
    filtered.forEach(function(issue) {
      var data = _parseIssueBody(issue.body);
      var status = _getIssueStatus(issue);
      var statusText = status === "approved" ? "已通过" : (status === "rejected" ? "已拒绝" : "待审核");
      html += '<tr>';
      html += '<td>' + _escapeHtml((data.userId || data.title || issue.user.login || "—").substring(0, 15)) + '</td>';
      html += '<td>' + _escapeHtml((data.shopName || "—").substring(0, 12)) + '</td>';
      html += '<td>' + _escapeHtml(data.date || data.createTime || "—") + '</td>';
      html += '<td>' + _escapeHtml(data.amount || "—") + '</td>';
      html += '<td><span class="discount-badge">' + _escapeHtml(data.discount || "未抽奖") + '</span></td>';
      html += '<td>' + _escapeHtml((data.paymentMethod || "—").substring(0, 15)) + '</td>';
      html += '<td><span class="status-badge ' + status + '">' + statusText + '</span></td>';
      html += '<td><button class="action-btn" data-issue="' + issue.number + '">审核</button></td>';
      html += '</tr>';
    });

    tbody.innerHTML = html;
    tbody.querySelectorAll(".action-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        openReview(parseInt(this.getAttribute("data-issue")));
      });
    });
  };

  var openReview = function(issueNumber) {
    var issue = allIssues.find(function(i) { return i.number === issueNumber; });
    if (!issue) return;
    currentIssue = issue;
    var data = _parseIssueBody(issue.body);
    var status = _getIssueStatus(issue);

    var body = document.getElementById("reviewBody");
    var html = '<div class="review-info-row">';
    html += _infoItem("用户", data.userId || data.title || issue.user.login);
    html += _infoItem("店铺名称", data.shopName || "—");
    html += _infoItem("消费日期", data.date || data.createTime || "—");
    html += _infoItem("消费金额", data.amount || "—");
    html += _infoItem("中奖折扣", data.discount || "未抽奖");
    html += _infoItem("支付方式", data.paymentMethod || "—");
    html += _infoItem("定位", data.location || "未提供");
    html += _infoItem("创建时间", data.createTime || "—");
    if (data.note) html += _infoItem("备注", data.note, true);
    if (data.rejectReason && status === "rejected") html += _infoItem("不通过原因", data.rejectReason, true, "color:#f44336;");
    html += '</div>';

    html += '<div class="review-images-section">';
    if (data.shopPhoto) {
      html += '<div class="review-images-title">店铺照片</div>';
      html += '<div class="review-image-grid"><div class="review-image-wrap"><img src="' + _escapeHtml(data.shopPhoto) + '" onclick="JITAdmin._previewImage(this.src)" loading="lazy"><div class="review-image-label">店铺照片</div></div></div>';
    }
    var orderPhotoStr = data.orderPhotos || "";
    if (orderPhotoStr) {
      var orderUrls = orderPhotoStr.split("|").map(function(s) { return s.trim(); }).filter(Boolean);
      if (orderUrls.length > 0) {
        html += '<div class="review-images-title">订单照片</div><div class="review-image-grid">';
        orderUrls.forEach(function(url, idx) {
          html += '<div class="review-image-wrap"><img src="' + _escapeHtml(url) + '" onclick="JITAdmin._previewImage(this.src)" loading="lazy"><div class="review-image-label">订单照片 ' + (idx + 1) + '</div></div>';
        });
        html += '</div>';
      }
    }
    if (data.signature) {
      html += '<div class="review-images-title">用户签字</div>';
      html += '<div class="signature-wrap"><img src="' + _escapeHtml(data.signature) + '" onclick="JITAdmin._previewImage(this.src)" loading="lazy"></div>';
    }
    html += '</div>';

    body.innerHTML = html;
    document.getElementById("rejectReasonWrap").style.display = "none";
    document.getElementById("rejectReason").value = "";
    document.getElementById("btnApprove").style.display = (status === "pending") ? "inline-block" : "none";
    document.getElementById("btnReject").style.display = (status === "pending") ? "inline-block" : "none";
    document.getElementById("btnDelete").style.display = "inline-block";
    document.getElementById("reviewOverlay").classList.add("active");
  };

  var _infoItem = function(label, value, fullWidth, style) {
    var col = fullWidth ? ' style="grid-column:1/-1;"' : '';
    var vs = style ? ' style="' + style + '"' : '';
    return '<div class="review-info-item"' + col + '><div class="review-info-label">' + label + '</div><div class="review-info-value"' + vs + '>' + _escapeHtml(value) + '</div></div>';
  };

  var _previewImage = function(src) {
    var overlay = document.getElementById("imagePreviewOverlay");
    overlay.innerHTML = '<img src="' + src + '">';
    overlay.style.display = "flex";
    overlay.onclick = function() { overlay.style.display = "none"; };
  };

  var _updateIssueStatus = function(issue, action, reason) {
    var labels = (issue.labels || []).map(function(l) { return l.name; });
    labels = labels.filter(function(l) { return l !== "pending" && l !== "approved" && l !== "rejected"; });
    labels.push(action);
    var newBody = issue.body;
    if (action === "rejected" && reason) {
      if (newBody.indexOf("不通过原因：") === -1) {
        newBody += "\n｜     不通过原因：" + reason;
      }
    }
    newBody = newBody.replace(/｜\s*状态：.*/, "｜     状态：" + (action === "approved" ? "已通过" : "已拒绝"));
    return _apiPatch(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues/" + issue.number, {
      labels: labels,
      body: newBody
    });
  };

  var _deleteIssue = function(issue) {
    return _apiPatch(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues/" + issue.number, { state: "closed" });
  };

  var _getIssueComments = function(issueNumber) {
    return _apiGet(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues/" + issueNumber + "/comments?per_page=100");
  };

  var _addIssueComment = function(issueNumber, body) {
    return _apiPost(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues/" + issueNumber + "/comments", { body: body });
  };

  var _getChatUsers = function() {
    var users = {};
    allIssues.forEach(function(issue) {
      var data = _parseIssueBody(issue.body);
      var userId = data.userId || data.title || (issue.user ? issue.user.login : "");
      if (userId && !users[userId]) {
        users[userId] = { userId: userId, issues: [] };
      }
      if (userId) {
        users[userId].issues.push(issue.number);
      }
    });
    return Object.values(users);
  };

  var loadChatUsers = function() {
    var users = _getChatUsers();
    var listEl = document.getElementById("chatUsersList");
    if (users.length === 0) {
      listEl.innerHTML = '<div class="chat-user-item" style="color:#9e9e9e;">暂无客户</div>';
      return;
    }
    var html = "";
    users.forEach(function(u) {
      var active = currentChatUser && currentChatUser.userId === u.userId ? " active" : "";
      html += '<div class="chat-user-item' + active + '" data-user="' + _escapeHtml(u.userId) + '">';
      html += '<div class="chat-user-name">' + _escapeHtml(u.userId) + '</div>';
      html += '<div class="chat-user-last">' + u.issues.length + ' 个凭证</div>';
      html += '</div>';
    });
    listEl.innerHTML = html;
    listEl.querySelectorAll(".chat-user-item").forEach(function(item) {
      item.addEventListener("click", function() {
        selectChatUser(this.getAttribute("data-user"));
      });
    });
  };

  var selectChatUser = function(userId) {
    currentChatUser = { userId: userId };
    document.getElementById("chatHeader").textContent = "与 " + userId + " 聊天中";
    document.getElementById("chatInput").disabled = false;
    document.getElementById("btnChatSend").disabled = false;
    loadChatMessages();
    loadChatUsers();
  };

  var loadChatMessages = function() {
    if (!currentChatUser) return;
    var userIssues = [];
    allIssues.forEach(function(issue) {
      var data = _parseIssueBody(issue.body);
      var userId = data.userId || data.title || (issue.user ? issue.user.login : "");
      if (userId === currentChatUser.userId) {
        userIssues.push(issue.number);
      }
    });
    var msgEl = document.getElementById("chatMessages");
    msgEl.innerHTML = '<div style="text-align:center;color:#9e9e9e;">加载中...</div>';
    Promise.all(userIssues.map(function(num) { return _getIssueComments(num); })).then(function(results) {
      var allComments = [];
      results.forEach(function(comments) {
        comments.forEach(function(c) {
          if (c.body && c.body.indexOf("｜CHAT｜") === 0) {
            allComments.push({
              type: c.user.login === "admin" || c.user.login === OWNER ? "admin" : "user",
              body: c.body.replace("｜CHAT｜", ""),
              time: c.created_at,
              user: c.user.login
            });
          }
        });
      });
      allComments.sort(function(a, b) { return new Date(a.time) - new Date(b.time); });
      if (allComments.length === 0) {
        msgEl.innerHTML = '<div style="text-align:center;color:#9e9e9e;padding:40px;">暂无聊天记录</div>';
        return;
      }
      var html = "";
      allComments.forEach(function(c) {
        html += '<div class="chat-message ' + c.type + '">';
        html += '<div>' + _escapeHtml(c.body) + '</div>';
        html += '<div class="chat-time">' + _escapeHtml(c.user) + ' · ' + new Date(c.time).toLocaleString("zh-CN") + '</div>';
        html += '</div>';
      });
      msgEl.innerHTML = html;
      msgEl.scrollTop = msgEl.scrollHeight;
    }).catch(function() {
      msgEl.innerHTML = '<div style="text-align:center;color:#9e9e9e;">加载失败</div>';
    });
  };

  var sendChatMessage = function() {
    var input = document.getElementById("chatInput");
    var msg = input.value.trim();
    if (!msg || !currentChatUser) return;
    var userIssues = [];
    allIssues.forEach(function(issue) {
      var data = _parseIssueBody(issue.body);
      var userId = data.userId || data.title || (issue.user ? issue.user.login : "");
      if (userId === currentChatUser.userId) userIssues.push(issue.number);
    });
    if (userIssues.length === 0) { _showToast("该用户没有凭证"); return; }
    input.value = "";
    input.disabled = true;
    document.getElementById("btnChatSend").disabled = true;
    _addIssueComment(userIssues[0], "｜CHAT｜" + msg).then(function() {
      input.disabled = false;
      document.getElementById("btnChatSend").disabled = false;
      loadChatMessages();
    }).catch(function(e) {
      _showToast("发送失败: " + e.message);
      input.disabled = false;
      document.getElementById("btnChatSend").disabled = false;
    });
  };

  var startChatPoll = function() {
    stopChatPoll();
    chatPollTimer = setInterval(function() {
      if (document.getElementById("tabChat").classList.contains("active") && currentChatUser) {
        loadIssues().then(function() { loadChatMessages(); });
      }
    }, 5000);
  };

  var stopChatPoll = function() {
    if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  };

  var loadLotteryConfig = function() {
    var prizes = JITLottery.getPrizes && JITLottery.getPrizes() || [
      { discount: "7折", value: 0.7, weight: 5 },
      { discount: "8折", value: 0.8, weight: 15 },
      { discount: "9折", value: 0.9, weight: 30 },
      { discount: "9.5折", value: 0.95, weight: 25 },
      { discount: "10折", value: 1.0, weight: 20 },
      { discount: "11折", value: 1.1, weight: 5 }
    ];
    var html = "";
    prizes.forEach(function(p, i) {
      html += '<div class="form-group">';
      html += '<label class="form-label">' + _escapeHtml(p.discount) + '（值: ' + p.value + '）权重</label>';
      html += '<input type="range" class="lottery-weight-slider" min="1" max="50" value="' + p.weight + '" data-index="' + i + '" id="lotteryWeight' + i + '">';
      html += '<span class="lottery-weight-value" id="lotteryWeightVal' + i + '">' + p.weight + '</span>';
      html += '</div>';
    });
    document.getElementById("lotteryConfigList").innerHTML = html;
    prizes.forEach(function(p, i) {
      var slider = document.getElementById("lotteryWeight" + i);
      var valEl = document.getElementById("lotteryWeightVal" + i);
      if (slider && valEl) {
        slider.addEventListener("input", function() { valEl.textContent = this.value; });
      }
    });
  };

  var saveLotteryConfig = function() {
    var prizes = JITLottery.getPrizes && JITLottery.getPrizes() || [];
    var config = [];
    prizes.forEach(function(p, i) {
      var slider = document.getElementById("lotteryWeight" + i);
      config.push({
        discount: p.discount,
        value: p.value,
        label: p.label || p.discount,
        weight: parseInt(slider ? slider.value : p.weight, 10)
      });
    });
    if (JITLottery.updatePrizeConfig) {
      JITLottery.updatePrizeConfig(config);
    }
    localStorage.setItem("jit_lottery_prizes", JSON.stringify(config));
    _showToast("抽奖配置已保存！");
  };

  var loadUsers = function() {
    var users = JITConfig.getUsers();
    var html = "";
    Object.keys(users).forEach(function(username) {
      html += '<tr><td>' + _escapeHtml(username) + '</td>';
      html += '<td><button class="action-btn btn-delete" data-user="' + _escapeHtml(username) + '" style="border-color:#f44336;color:#f44336;background:rgba(244,67,54,0.2);">删除</button></td></tr>';
    });
    document.getElementById("usersList").innerHTML = html || '<tr><td colspan="2" class="loading-cell">暂无用户</td></tr>';
    document.getElementById("usersList").querySelectorAll(".btn-delete").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var username = this.getAttribute("data-user");
        if (username === "admin") { _showToast("不能删除admin用户"); return; }
        if (confirm("确定删除用户 " + username + "？")) {
          deleteUser(username);
        }
      });
    });
  };

  var deleteUser = function(username) {
    var users = JITConfig.getUsers();
    if (users[username]) {
      _showToast("用户删除需在config.js中手动操作（纯前端限制）");
    }
  };

  var addUser = function() {
    var username = document.getElementById("newUsername").value.trim();
    var password = document.getElementById("newPassword").value.trim();
    if (!username || !password) { _showToast("请填写用户名和密码"); return; }
    _showToast("用户添加需在config.js中手动操作，已复制到剪贴板");
    var snippet = '// 在js/config.js的_users对象中添加:\n"' + username + '": "' + password + '",';
    navigator.clipboard.writeText(snippet).catch(function() {});
    document.getElementById("addUserOverlay").classList.remove("active");
  };

  var loadSettings = function() {
    document.getElementById("settingPerPage").value = localStorage.getItem("jit_per_page") || "10";
    document.getElementById("settingRefreshInterval").value = localStorage.getItem("jit_refresh_interval") || "10";
    document.getElementById("settingAllowRepeatLottery").value = localStorage.getItem("jit_allow_repeat_lottery") || "false";
    document.getElementById("settingRevealThreshold").value = localStorage.getItem("jit_reveal_threshold") || "0.4";
  };

  var saveSettings = function() {
    localStorage.setItem("jit_per_page", document.getElementById("settingPerPage").value);
    localStorage.setItem("jit_refresh_interval", document.getElementById("settingRefreshInterval").value);
    localStorage.setItem("jit_allow_repeat_lottery", document.getElementById("settingAllowRepeatLottery").value);
    localStorage.setItem("jit_reveal_threshold", document.getElementById("settingRevealThreshold").value);
    if (JITLottery.setThreshold) {
      JITLottery.setThreshold(parseFloat(document.getElementById("settingRevealThreshold").value));
    }
    _showToast("设置已保存！");
  };

  var loadSystemInfo = function() {
    document.getElementById("systemInfo").innerHTML = 
      '<p>仓库: ' + _escapeHtml(OWNER + "/" + REPO) + '</p>' +
      '<p>API: ' + _escapeHtml(BASE_URL) + '</p>' +
      '<p>凭证总数: ' + allIssues.length + '</p>' +
      '<p>缓存大小: ' + _escapeHtml(String(localStorage.length)) + ' 项</p>' +
      '<p>当前时间: ' + new Date().toLocaleString("zh-CN") + '</p>';
  };

  var clearCache = function() {
    localStorage.clear();
    _showToast("所有缓存已清除！");
    loadIssues();
  };

  var exportData = function() {
    var data = allIssues.map(function(issue) {
      return {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        status: _getIssueStatus(issue),
        parsed: _parseIssueBody(issue.body),
        created: issue.created_at,
        updated: issue.updated_at
      };
    });
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "vouchers_backup_" + new Date().toISOString().split("T")[0] + ".json";
    a.click();
    URL.revokeObjectURL(url);
    _showToast("数据已导出！");
  };

  var checkLoginStatus = function() {
    var lockout = localStorage.getItem(_lockoutKey);
    if (lockout && Date.now() < parseInt(lockout, 10)) {
      var remainMin = Math.ceil((parseInt(lockout, 10) - Date.now()) / 60000);
      document.getElementById("loginError").style.display = "block";
      document.getElementById("loginError").textContent = "已锁定，请 " + remainMin + " 分钟后再试！";
      document.getElementById("btnAdminLogin").disabled = true;
      document.getElementById("adminPassword").disabled = true;
      return false;
    } else {
      localStorage.removeItem(_lockoutKey);
      localStorage.removeItem(_attemptsKey);
    }
    var attempts = parseInt(localStorage.getItem(_attemptsKey) || "0", 10);
    document.getElementById("remainAttempts").textContent = MAX_ATTEMPTS - attempts;
    return true;
  };

  var init = function() {
    if (!checkLoginStatus()) return;

    document.getElementById("btnAdminLogin").addEventListener("click", function() {
      var password = document.getElementById("adminPassword").value.trim();
      var errorEl = document.getElementById("loginError");
      if (password === ADMIN_PASSWORD) {
        _isLoggedIn = true;
        localStorage.removeItem(_attemptsKey);
        localStorage.removeItem(_lockoutKey);
        document.getElementById("loginOverlay").style.opacity = "0";
        document.getElementById("loginOverlay").style.visibility = "hidden";
        document.getElementById("adminUser").textContent = "管理员";
        loadIssues();
      } else {
        var attempts = parseInt(localStorage.getItem(_attemptsKey) || "0", 10) + 1;
        localStorage.setItem(_attemptsKey, String(attempts));
        var remain = MAX_ATTEMPTS - attempts;
        document.getElementById("remainAttempts").textContent = Math.max(0, remain);
        errorEl.style.display = "block";
        errorEl.textContent = "密码错误！还剩 " + Math.max(0, remain) + " 次尝试";
        if (remain <= 0) {
          var lockoutTime = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
          localStorage.setItem(_lockoutKey, String(lockoutTime));
          errorEl.textContent = "已锁定 " + LOCKOUT_MINUTES + " 分钟！";
          document.getElementById("btnAdminLogin").disabled = true;
          document.getElementById("adminPassword").disabled = true;
        }
        document.getElementById("adminPassword").value = "";
      }
    });

    document.getElementById("adminPassword").addEventListener("keydown", function(e) {
      if (e.key === "Enter") document.getElementById("btnAdminLogin").click();
    });

    document.getElementById("filterStatus").addEventListener("change", renderTable);
    document.getElementById("btnRefreshReview").addEventListener("click", function() { loadIssues(); });

    document.getElementById("btnReviewClose").addEventListener("click", function() {
      document.getElementById("reviewOverlay").classList.remove("active");
      document.getElementById("rejectReasonWrap").style.display = "none";
      currentIssue = null;
    });
    document.getElementById("reviewOverlay").addEventListener("click", function(e) {
      if (e.target === this) {
        this.classList.remove("active");
        document.getElementById("rejectReasonWrap").style.display = "none";
        currentIssue = null;
      }
    });

    document.getElementById("btnReject").addEventListener("click", function() {
      var wrap = document.getElementById("rejectReasonWrap");
      if (wrap.style.display === "none") { wrap.style.display = "block"; return; }
      var reason = document.getElementById("rejectReason").value.trim();
      if (!reason) { _showToast("请填写不通过原因！"); return; }
      if (!currentIssue) return;
      _updateIssueStatus(currentIssue, "rejected", reason).then(function() {
        _showToast("已拒绝该凭证");
        document.getElementById("reviewOverlay").classList.remove("active");
        document.getElementById("rejectReasonWrap").style.display = "none";
        loadIssues();
      }).catch(function(e) { _showToast("操作失败: " + e.message); });
    });

    document.getElementById("btnApprove").addEventListener("click", function() {
      if (!currentIssue) return;
      _updateIssueStatus(currentIssue, "approved").then(function() {
        _showToast("已通过该凭证");
        document.getElementById("reviewOverlay").classList.remove("active");
        document.getElementById("rejectReasonWrap").style.display = "none";
        loadIssues();
      }).catch(function(e) { _showToast("操作失败: " + e.message); });
    });

    document.getElementById("btnDelete").addEventListener("click", function() {
      if (!currentIssue) return;
      if (!confirm("确定要删除这个凭证吗？此操作不可撤销！")) return;
      _deleteIssue(currentIssue).then(function() {
        _showToast("凭证已删除");
        document.getElementById("reviewOverlay").classList.remove("active");
        document.getElementById("rejectReasonWrap").style.display = "none";
        loadIssues();
      }).catch(function(e) { _showToast("删除失败: " + e.message); });
    });

    document.getElementById("btnAdminLogout").addEventListener("click", function() {
      _isLoggedIn = false;
      location.reload();
    });

    var navItems = document.querySelectorAll(".admin-nav-item");
    navItems.forEach(function(item) {
      item.addEventListener("click", function() {
        var tab = this.getAttribute("data-tab");
        navItems.forEach(function(n) { n.classList.remove("active"); });
        this.classList.add("active");
        document.querySelectorAll(".admin-tab").forEach(function(t) { t.classList.remove("active"); });
        document.getElementById("tab" + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add("active");
        if (tab === "chat") { loadChatUsers(); startChatPoll(); }
        else { stopChatPoll(); }
        if (tab === "lottery") loadLotteryConfig();
        if (tab === "users") loadUsers();
        if (tab === "settings") loadSettings();
        if (tab === "developer") loadSystemInfo();
      });
    });

    document.getElementById("btnChatSend").addEventListener("click", sendChatMessage);
    document.getElementById("chatInput").addEventListener("keydown", function(e) {
      if (e.key === "Enter") sendChatMessage();
    });

    document.getElementById("btnSaveLotteryConfig").addEventListener("click", saveLotteryConfig);
    document.getElementById("btnAddUser").addEventListener("click", function() {
      document.getElementById("addUserOverlay").classList.add("active");
      document.getElementById("newUsername").value = "";
      document.getElementById("newPassword").value = "";
    });
    document.getElementById("btnAddUserClose").addEventListener("click", function() {
      document.getElementById("addUserOverlay").classList.remove("active");
    });
    document.getElementById("addUserOverlay").addEventListener("click", function(e) {
      if (e.target === this) this.classList.remove("active");
    });
    document.getElementById("btnConfirmAddUser").addEventListener("click", addUser);

    document.getElementById("btnSaveSettings").addEventListener("click", saveSettings);
    document.getElementById("btnClearCache").addEventListener("click", clearCache);
    document.getElementById("btnExportData").addEventListener("click", exportData);
  };

  init();

  return {
    _previewImage: _previewImage,
    loadIssues: loadIssues
  };
})();