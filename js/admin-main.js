var JITAdmin = (function() {
  var TOKEN = (JITConfig.getTokenPart1() + JITConfig.getTokenPart3() + JITConfig.getTokenPart4());
  var REPO = JITConfig.getRepoName();
  var OWNER = JITConfig.getRepoOwner();
  var BASE_URL = JITConfig.getApiBase();

  // 管理员密码：SHA-256(盐 + 明文密码)
  // 盐: yuguo-jr-salt-2024
  // 明文: 27015150111
  // 生成方式: sha256("yuguo-jr-salt-2024" + "27015150111") => hash hex
  // 可用 node -e "require('crypto').createHash('sha256').update('yuguo-jr-salt-202427015150111').digest('hex')" 生成
  var ADMIN_SALT = "yuguo-jr-salt-2024";
  var ADMIN_PASSWORD_HASH = "86e1df29a846be596ceb035cec48c0d536c5549aa367722febb77ddb4b9e2556";
  var MAX_ATTEMPTS = 5;
  var LOCKOUT_MINUTES = 15;
  var currentIssue = null;
  var allIssues = [];
  var chatPollTimer = null;
  var currentChatUser = null;
  var _isLoggedIn = false;

  var _attemptsKey = "jit_admin_attempts";
  var _lockoutKey = "jit_admin_lockout";

  // SHA-256 哈希辅助函数（异步）
  var _sha256 = function(text) {
    if (window.crypto && window.crypto.subtle) {
      var encoder = new TextEncoder();
      return crypto.subtle.digest("SHA-256", encoder.encode(text)).then(function(buf) {
        var hex = "";
        var bytes = new Uint8Array(buf);
        for (var i = 0; i < bytes.length; i++) {
          hex += ("00" + bytes[i].toString(16)).slice(-2);
        }
        return hex;
      });
    } else {
      // 回退：同步简单哈希（非安全场景，仅兼容极老浏览器）
      return Promise.resolve(_sha256Fallback(text));
    }
  };
  // 极老浏览器回退（简易非加密哈希，保证不报错）
  var _sha256Fallback = function(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return "fallback_" + (h >>> 0).toString(16);
  };

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
      else if ((match = trimmed.match(/^｜?\s*凭证类型：(.+)/))) data.voucherType = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*购物平台：(.+)/))) data.platform = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*订单号：(.+)/))) data.orderNo = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*支付方式：(.+)/))) data.paymentMethod = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*用户名：(.+)/))) data.username = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*姓名：(.+)/))) data.fullName = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*出生日期：(.+)/))) data.birthdate = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*国家：(.+)/))) data.country = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*省份：(.+)/))) data.province = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*城市：(.+)/))) data.city = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*注册时间：(.+)/))) data.registerTime = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*邀请人：(.+)/))) data.referrer = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*审核状态：(.+)/))) data.reviewStatus = match[1].trim();
      // ===== 大额电器补贴字段 =====
      else if ((match = trimmed.match(/^｜?\s*模式标识：(.+)/))) {
        var s = match[1].trim();
        if (s.indexOf("电器补贴") !== -1) data.electric = true;
      }
      else if ((match = trimmed.match(/^｜?\s*电器分类：(.+)/))) data.electricCategory = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*品牌名称：(.+)/))) data.electricBrand = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*申请基数金额：(.+)/))) data.electricApplyAmount = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*补贴比例：(.+)/))) data.electricSubsidyRate = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*补贴金额：(.+)/))) data.electricSubsidyAmount = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*补贴结果：(.+)/))) data.subsidyResult = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*审核结果：(.+)/))) data.reviewResult = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*最终实付：(.+)/))) {
        data.finalPrice = match[1].trim();
        if (typeof data.discount === "undefined" || !data.discount) {
          data.discount = "补贴模式";
        }
      }
    });
    return data;
  };

  var _getIssueStatus = function(issue) {
    var labels = (issue.labels || []).map(function(l) { return l.name; });
    if (labels.indexOf("completed") > -1) return "completed";
    if (labels.indexOf("paid") > -1) return "paid";
    if (labels.indexOf("approved") > -1) return "approved";
    if (labels.indexOf("rejected") > -1) return "rejected";
    return "pending";
  };

  var _ensureLabels = function() {
    var labels = [
      { name: "pending", color: "ff9800" },
      { name: "approved", color: "4caf50" },
      { name: "rejected", color: "f44336" },
      { name: "paid", color: "00bcd4" },
      { name: "completed", color: "2196f3" },
      { name: "points", color: "ffd54f" },
      { name: "lottery", color: "9c27b0" }
    ];
    var promises = [];
    labels.forEach(function(lb) {
      promises.push(
        fetch(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/labels/" + lb.name, {
          headers: { Authorization: "token " + TOKEN, Accept: "application/vnd.github.v3+json" }
        }).then(function(r) {
          if (r.status === 404) {
            return _apiPost(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/labels", {
              name: lb.name,
              color: lb.color
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
    return issue.body.indexOf("店铺名称") > -1 || issue.body.indexOf("店铺：") > -1 || issue.body.indexOf("中奖打折") > -1 || issue.body.indexOf("【聊天专用】") > -1;
  };

  var renderTable = function() {
    var filter = document.getElementById("filterStatus").value;
    var tbody = document.getElementById("adminTableBody");
    var pendingCount = 0, approvedCount = 0, rejectedCount = 0, completedCount = 0;

    var filtered = allIssues.filter(function(issue) {
      if (issue.body && issue.body.indexOf("【聊天专用】") > -1) return false;
      var status = _getIssueStatus(issue);
      if (status === "pending") pendingCount++;
      if (status === "approved") approvedCount++;
      if (status === "rejected") rejectedCount++;
      if (status === "completed") completedCount++;
      return filter === "all" || status === filter;
    });

    // ===== 加急凭证排到最前面 =====
    filtered.sort(function(a, b) {
      var aUrgent = (a.labels || []).some(function(l) { return l.name === "urgent"; });
      var bUrgent = (b.labels || []).some(function(l) { return l.name === "urgent"; });
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      return 0;
    });

    document.getElementById("statPending").textContent = "待审核: " + pendingCount;
    document.getElementById("statApproved").textContent = "已通过: " + approvedCount;
    document.getElementById("statRejected").textContent = "已拒绝: " + rejectedCount;
    var statCompleted = document.getElementById("statCompleted");
    if (statCompleted) statCompleted.textContent = "已完成: " + completedCount;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">暂无数据</td></tr>';
      return;
    }

    var statusTextMap = {
      pending: "待审核",
      approved: "已通过",
      rejected: "已拒绝",
      paid: "已付款·待确认",
      completed: "已完成交易"
    };

    var html = "";
    filtered.forEach(function(issue) {
      var data = _parseIssueBody(issue.body);
      var status = _getIssueStatus(issue);
      var statusText = statusTextMap[status] || "待审核";
      var isElectric = !!(data.electric || data.voucherType === "电器凭证" || data.electricCategory);
      var isUrgent = (issue.labels || []).some(function(l) { return l.name === "urgent"; });

      // ===== 金额列：电器显示申请基数 =====
      var amtDisplay = data.amount || "—";
      if (isElectric && data.electricApplyAmount) {
        amtDisplay = data.electricApplyAmount + " 元🎁";
      }
      // ===== 折扣/补贴列：电器显示补贴率 =====
      var discountDisplay = data.discount || "未抽奖";
      var discountStyle = "";
      if (isElectric) {
        if (data.electricSubsidyRate) {
          discountDisplay = "补贴 " + data.electricSubsidyRate;
          if (data.electricSubsidyAmount) discountDisplay += " ≈" + data.electricSubsidyAmount;
        } else {
          discountDisplay = "⏳ 待设补贴";
        }
        discountStyle = ' style="background:rgba(255,112,67,0.15);color:#ff7043;border-color:rgba(255,112,67,0.4);"';
      }

      html += '<tr>';
      html += '<td>' + (isUrgent ? '<span style="display:inline-block;font-size:10px;padding:1px 5px;margin-right:4px;border-radius:3px;background:#f44336;color:#fff;font-weight:700;animation:pulse 1.5s infinite;">⚡加急</span>' : '') + _escapeHtml((data.userId || data.title || issue.user.login || "—").substring(0, 15)) + '</td>';
      // 店铺列：电器附小标签
      var shopCell = (data.shopName || "—").substring(0, 12);
      if (isElectric) {
        shopCell = '<span style="display:inline-block;font-size:10px;padding:1px 4px;margin-right:4px;border-radius:3px;background:rgba(255,112,67,0.15);color:#ff7043;">🎁电器</span>' + _escapeHtml(shopCell);
      } else {
        shopCell = _escapeHtml(shopCell);
      }
      html += '<td>' + shopCell + '</td>';
      html += '<td>' + _escapeHtml(data.date || data.createTime || "—") + '</td>';
      html += '<td>' + _escapeHtml(amtDisplay) + '</td>';
      html += '<td><span class="discount-badge"' + discountStyle + '>' + _escapeHtml(discountDisplay) + '</span></td>';
      html += '<td>' + _escapeHtml((data.paymentMethod || "—").substring(0, 15)) + '</td>';
      html += '<td><span class="status-badge ' + status + '">' + statusText + '</span></td>';
      // ===== 操作列：审核 + 加急切换 + 加急黑名单 =====
      var urgentBtn = '';
      if (isUrgent) {
        urgentBtn = '<button class="action-btn urgent-toggle-btn" data-issue="' + issue.number + '" data-urgent="1" title="取消加急标记" style="background:#fff3e0;color:#e65100;border-color:#ffab91;">⚡ 取消加急</button>';
      } else {
        urgentBtn = '<button class="action-btn urgent-toggle-btn" data-issue="' + issue.number + '" data-urgent="0" title="标记为加急凭证" style="background:#ffebee;color:#b71c1c;border-color:#ef9a9a;">⚡ 设为加急</button>';
      }
      var blBtn = '<button class="action-btn urgent-bl-btn" data-issue="' + issue.number + '" data-user="' + _escapeHtml(data.userId || data.title || '') + '" title="将此用户加入加急黑名单" style="background:#f3e5f5;color:#6a1b9a;border-color:#ce93d8;">🚫 加黑</button>';
      html += '<td style="white-space:nowrap;">'
        + '<button class="action-btn" data-issue="' + issue.number + '">审核</button>'
        + urgentBtn
        + blBtn
        + '</td>';
      html += '</tr>';
    });

    tbody.innerHTML = html;
    tbody.querySelectorAll(".action-btn[data-issue]").forEach(function(btn) {
      if (btn.classList.contains("urgent-toggle-btn") || btn.classList.contains("urgent-bl-btn")) return;
      btn.addEventListener("click", function() {
        openReview(parseInt(this.getAttribute("data-issue")));
      });
    });
    // 加急切换
    tbody.querySelectorAll(".urgent-toggle-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var num = parseInt(this.getAttribute("data-issue"));
        var isUrg = this.getAttribute("data-urgent") === "1";
        _toggleUrgentOnRow(num, !isUrg);
      });
    });
    // 列表快捷加黑
    tbody.querySelectorAll(".urgent-bl-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var user = this.getAttribute("data-user");
        if (!user) { _showToast("未能读取用户", "error"); return; }
        _currentUGBanUser = user;
        document.getElementById("urgentBlBanUser").value = user;
        document.getElementById("urgentBlBanReason").value = "管理员从审核列表快捷加入（加急理由不合理）";
        document.getElementById("urgentBlPermBan").checked = true;
        _onUrgBanPermToggle.call(document.getElementById("urgentBlPermBan"));
        document.getElementById("urgentBlacklistOverlay").style.display = "flex";
      });
    });
  };

  // 列表行快捷切换加急状态
  var _toggleUrgentOnRow = function(issueNumber, setUrgent) {
    var issue = allIssues.find(function(i) { return i.number === issueNumber; });
    if (!issue) return;
    if (setUrgent) {
      JITApi.markUrgent(issueNumber, "【管理员手动加急】从列表操作列直接标记", "admin").then(function() {
        _showToast("✅ 已设为加急");
        loadIssues();
      }).catch(function(e) { _showToast("操作失败: " + e.message, "error"); });
    } else {
      JITApi.removeUrgent(issueNumber).then(function() {
        _showToast("已取消加急标记");
        loadIssues();
      }).catch(function(e) { _showToast("操作失败: " + e.message, "error"); });
    }
  };

  var openReview = function(issueNumber) {
    var issue = allIssues.find(function(i) { return i.number === issueNumber; });
    if (!issue) return;
    currentIssue = issue;
    var data = _parseIssueBody(issue.body);
    var status = _getIssueStatus(issue);
    var isElectric = !!(data.electric || data.voucherType === "电器凭证" || data.electricCategory || data.electricBrand);

    var body = document.getElementById("reviewBody");
    var html = '<div class="review-info-row">';
    html += _infoItem("用户", data.userId || data.title || (issue.user && issue.user.login) || "—");
    html += _infoItem("凭证类型", isElectric ? ("🎁 " + (data.voucherType || "电器凭证（大额补贴）")) : (data.voucherType || "普通凭证"));
    html += _infoItem("店铺名称", data.shopName || "—");
    html += _infoItem("消费日期", data.date || data.createTime || "—");
    var applyAmt = data.electricApplyAmount || "";
    var amt = data.amount || applyAmt || "—";
    if (applyAmt) {
      try { var n = parseFloat(applyAmt); if (!isNaN(n)) amt = n.toFixed(2) + " 元（申请基数 ≥ 3000 元）"; } catch(e) {}
    }
    html += _infoItem("消费金额", amt);
    if (isElectric) {
      html += _infoItem("电器分类", data.electricCategory || "—");
      html += _infoItem("品牌", data.electricBrand || "—");
      if (data.electricSubsidyRate) {
        var txt = "补贴 " + data.electricSubsidyRate + "%";
        if (data.electricSubsidyAmount) txt += " （≈ " + data.electricSubsidyAmount + " 元）";
        html += _infoItem("🎁 审核补贴比例", txt, false, "color:#ff7043;font-weight:700;");
      } else {
        html += _infoItem("补贴状态", (status === "pending") ? "待审核设置" : "—", false, "color:#ffb74d;");
      }
      html += _infoItem("最终实付", data.finalPrice || data.originalPrice || "—");
    } else {
      html += _infoItem("中奖折扣", data.discount || "未抽奖");
    }
    html += _infoItem("支付方式", data.paymentMethodText || data.paymentMethod || "—");
    html += _infoItem("定位", data.location || "未提供");
    html += _infoItem("创建时间", data.createTime || "—");
    // 线上购物额外字段
    if (data.voucherType === "线上购物") {
      html += _infoItem("购物平台", data.platform || "—");
      html += _infoItem("订单号", data.orderNo || "—");
    }
    if (data.note || data.remark) html += _infoItem("备注", data.remark || data.note, true);
    if (data.rejectReason && status === "rejected") html += _infoItem("不通过原因", data.rejectReason, true, "color:#f44336;");
    html += '</div>';

    html += '<div class="review-images-section">';
    if (data.voucherType === "线上购物") {
      // 线上购物：商品截图 + 购物截图
      if (data.shopPhoto) {
        html += '<div class="review-images-title">商品截图</div>';
        html += '<div class="review-image-grid"><div class="review-image-wrap"><img src="' + _escapeHtml(encodeURI(data.shopPhoto)) + '" onclick="JITAdmin._previewImage(this.src)" loading="lazy"><div class="review-image-label">商品截图</div></div></div>';
      }
      var orderPhotoStr = data.orderPhotos || "";
      if (orderPhotoStr) {
        var orderUrls = orderPhotoStr.split("|").map(function(s) { return s.trim(); }).filter(Boolean);
        if (orderUrls.length > 0) {
          html += '<div class="review-images-title">购物截图</div><div class="review-image-grid">';
          orderUrls.forEach(function(url, idx) {
            html += '<div class="review-image-wrap"><img src="' + _escapeHtml(encodeURI(url)) + '" onclick="JITAdmin._previewImage(this.src)" loading="lazy"><div class="review-image-label">购物截图 ' + (idx + 1) + '</div></div>';
          });
          html += '</div>';
        }
      }
    } else {
      // 普通 / 电器凭证：店铺照片(或商品实物照) + 订单照片
      var shopLabel = isElectric ? "商品实物照片" : "店铺照片";
      if (data.shopPhoto) {
        html += '<div class="review-images-title">' + shopLabel + '</div>';
        html += '<div class="review-image-grid"><div class="review-image-wrap"><img src="' + _escapeHtml(encodeURI(data.shopPhoto)) + '" onclick="JITAdmin._previewImage(this.src)" loading="lazy"><div class="review-image-label">' + shopLabel + '</div></div></div>';
      }
      var orderPhotoStr2 = data.orderPhotos || "";
      if (orderPhotoStr2) {
        var orderUrls2 = orderPhotoStr2.split("|").map(function(s) { return s.trim(); }).filter(Boolean);
        var orderLabel = isElectric ? "订单 / 付款截图" : "订单照片";
        if (orderUrls2.length > 0) {
          html += '<div class="review-images-title">' + orderLabel + '</div><div class="review-image-grid">';
          orderUrls2.forEach(function(url, idx) {
            html += '<div class="review-image-wrap"><img src="' + _escapeHtml(encodeURI(url)) + '" onclick="JITAdmin._previewImage(this.src)" loading="lazy"><div class="review-image-label">' + orderLabel + ' ' + (idx + 1) + '</div></div>';
          });
          html += '</div>';
        }
      }
    }
    if (data.signature) {
      html += '<div class="review-images-title">用户签字</div>';
      html += '<div class="signature-wrap"><img src="' + _escapeHtml(encodeURI(data.signature)) + '" onclick="JITAdmin._previewImage(this.src)" loading="lazy"></div>';
    }
    html += '</div>';

    body.innerHTML = html;
    document.getElementById("rejectReasonWrap").style.display = "none";
    document.getElementById("rejectReason").value = "";
    document.getElementById("btnApprove").style.display = (status === "pending") ? "inline-block" : "none";
    document.getElementById("btnReject").style.display = (status === "pending") ? "inline-block" : "none";
    document.getElementById("btnDelete").style.display = "inline-block";
    // ===== 加急标识 / 加急理由 / 加入黑名单按钮 =====
    var isUrgentIssue = (issue.labels || []).some(function(l) { return l.name === "urgent"; });
    var banBtn = document.getElementById("btnUrgentBlackBan");
    var userId = (data.userId || data.title || (issue.user && issue.user.login) || "");
    // 存储用于加黑弹窗的上下文
    window.__currentUrgentBanTarget = {
      username: userId,
      issueNumber: issue.number,
      voucherDesc: (data.shopName || "—") + " · " + (data.date || "—")
    };
    if (banBtn) {
      // 只要有用户名就可以加黑（但加急时更显眼）
      banBtn.style.display = userId ? "inline-block" : "none";
    }
    if (isUrgentIssue) {
      // 在 body 最后插入醒目的加急区块
      JITApi.getUrgentReason(issue.number).then(function(reasonInfo) {
        var rHtml = '<div style="margin-top:16px;padding:14px 16px;border-radius:12px;background:linear-gradient(90deg,rgba(244,67,54,0.12),rgba(255,152,0,0.12));border:1.5px solid rgba(244,67,54,0.4);animation:pulse 1.5s infinite;">';
        rHtml += '<div style="font-size:15px;font-weight:800;color:#f44336;margin-bottom:6px;">⚡ 该凭证已申请加急审核，请优先处理</div>';
        if (reasonInfo) {
          rHtml += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">申请人：' + _escapeHtml(reasonInfo.username || "—") + ' · 时间：' + _escapeHtml((reasonInfo.time || "").replace("T"," ").slice(0,16)) + '</div>';
          rHtml += '<div style="padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.04);border:1px solid var(--border-color);font-size:13px;line-height:1.6;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;">💬 ' + _escapeHtml(reasonInfo.reason || "") + '</div>';
        } else {
          rHtml += '<div style="font-size:13px;color:var(--text-secondary);">（未获取到加急理由，可能为旧版申请）</div>';
        }
        rHtml += '</div>';
        var existing = document.getElementById("__urgentBanner");
        if (existing) existing.remove();
        var wrap = document.createElement("div");
        wrap.id = "__urgentBanner";
        wrap.innerHTML = rHtml;
        body.appendChild(wrap.firstChild);
      }).catch(function() {});
    }
    // 电器补贴：打开/关闭补贴比例选择器
    var subWrap = document.getElementById("subsidyRateWrap");
    var subInput = document.getElementById("inputSubsidyRate");
    var subHint = document.getElementById("subsidyAmountHint");
    if (subWrap) {
      if (isElectric && status === "pending") {
        subWrap.style.display = "block";
        // 计算申请金额
        var applyN = parseFloat(applyAmt || (amt || "").replace(/元|,/g, ""));
        if (isNaN(applyN)) applyN = 0;
        // 回填已有比例（如果有）
        subInput.value = data.electricSubsidyRate || "";
        _updateSubsidyHint(applyN);
      } else {
        subWrap.style.display = "none";
        if (subInput) subInput.value = "";
        if (subHint) subHint.textContent = "";
      }
    }
    document.getElementById("reviewOverlay").classList.add("active");
  };

  var _updateSubsidyHint = function(applyN) {
    var input = document.getElementById("inputSubsidyRate");
    var hint = document.getElementById("subsidyAmountHint");
    if (!hint) return;
    if (!applyN) { hint.textContent = "（无法识别申请金额）"; return; }
    var rate = parseFloat(input ? input.value : "");
    if (isNaN(rate) || rate <= 0) { hint.textContent = "申请基数：¥" + applyN.toFixed(2); return; }
    var amount = applyN * rate / 100;
    hint.innerHTML = '¥' + applyN.toFixed(2) + ' × <b style="color:#ff7043;">' + rate.toFixed(1).replace(/\.0$/,"") + '%</b><br>≈ 补贴 <b style="color:#ff7043;">¥' + amount.toFixed(2) + "</b>";
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

  var _openVoucherFromChat = function(issueNum) {
    _apiGet(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues/" + issueNum).then(function(issue) {
      openReview(issue);
    }).catch(function() {
      _showToast("无法加载凭证 #" + issueNum);
    });
  };

  var _updateIssueStatus = function(issue, action, reason, extra) {
    extra = extra || {};
    var labels = (issue.labels || []).map(function(l) { return l.name; });
    labels = labels.filter(function(l) { return l !== "pending" && l !== "approved" && l !== "rejected" && l !== "paid" && l !== "completed"; });
    labels.push(action);
    var newBody = issue.body;
    if (action === "rejected" && reason) {
      if (newBody.indexOf("不通过原因：") === -1) {
        newBody += "\n｜     不通过原因：" + reason;
      }
    }
    // 电器凭证通过 → 写入补贴比例 / 金额 / 结果字段
    if (action === "approved" && extra.isElectric) {
      var rate = extra.subsidyRate || 0;
      var amt = extra.subsidyAmount || 0;
      var rateStr = String(rate);
      var amtStr = amt.toFixed(2) + "元";
      function upsert(key, val) {
        var pat = new RegExp("｜\\s*" + key + "：.*");
        if (pat.test(newBody)) newBody = newBody.replace(pat, "｜     " + key + "：" + val);
        else newBody += "\n｜     " + key + "：" + val;
      }
      upsert("补贴比例", rateStr + "%");
      upsert("补贴金额", amtStr);
      upsert("补贴结果", "补贴 " + rateStr + "%，实得 ¥" + amt.toFixed(2));
      // 同时更新 finalPrice：实付金额 = 原金额 - 补贴金额
      var m = newBody.match(/｜\s*申请基数金额：\s*([0-9.]+)/);
      var applyN = m ? parseFloat(m[1]) : 0;
      if (applyN > 0) {
        var finalN = Math.max(0, applyN - amt);
        upsert("最终实付", finalN.toFixed(2) + "元（已减补贴 ¥" + amt.toFixed(2) + "）");
      }
      upsert("审核结果", "🎁 补贴 " + rateStr + "%，非抽奖模式");
    }
    var statusText = action === "approved" ? "已通过" : (action === "rejected" ? "已拒绝" : (action === "completed" ? "已完成交易" : "待审核"));
    newBody = newBody.replace(/｜\s*状态：.*/, "｜     状态：" + statusText);
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
      var userId = data.userId;
      if (!userId && data.title) {
        userId = data.title.replace(/\d+$/, "");
      }
      if (!userId) userId = issue.user ? issue.user.login : "";
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
    var imgBtn = document.getElementById("btnChatImage");
    if (imgBtn) imgBtn.style.display = "inline-block";
    loadChatMessages();
    loadChatUsers();
  };

  var loadChatMessages = function() {
    if (!currentChatUser) return;
    var userIssues = [];
    allIssues.forEach(function(issue) {
      var data = _parseIssueBody(issue.body);
      var userId = data.userId;
      if (!userId && data.title) userId = data.title.replace(/\d+$/, "");
      if (!userId) userId = issue.user ? issue.user.login : "";
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
        if (c.body.indexOf("[IMG]") === 0) {
          html += '<div><img src="' + _escapeHtml(encodeURI(c.body.replace("[IMG]", ""))) + '" style="max-width:200px;max-height:200px;border-radius:8px;cursor:pointer;" onclick="JITAdmin._previewImage(this.src)"></div>';
        } else if (c.body.indexOf("[VOUCHER]") === 0) {
          var vNum = c.body.replace("[VOUCHER]", "").trim();
          html += '<div><a href="javascript:void(0)" onclick="JITAdmin._openVoucherFromChat(\'' + vNum + '\')" style="color:#0366d6;text-decoration:underline;">📋 查看凭证 #' + vNum + '</a></div>';
        } else {
          html += '<div>' + _escapeHtml(c.body) + '</div>';
        }
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
      var userId = data.userId;
      if (!userId && data.title) userId = data.title.replace(/\d+$/, "");
      if (!userId) userId = issue.user ? issue.user.login : "";
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
      { discount: "7折", value: 0.7, weight: 10 },
      { discount: "8折", value: 0.8, weight: 10 },
      { discount: "9折", value: 0.9, weight: 10 },
      { discount: "9.5折", value: 0.95, weight: 10 },
      { discount: "10折", value: 1.0, weight: 10 },
      { discount: "11折", value: 1.1, weight: 10 },
      { discount: "12折", value: 1.2, weight: 10 },
      { discount: "13折", value: 1.3, weight: 10 },
      { discount: "14折", value: 1.4, weight: 10 },
      { discount: "0折", value: 0.0, weight: 10 }
    ];
    var n = prizes.length;
    var html = "";
    prizes.forEach(function(p, i) {
      html += '<div class="form-group">';
      html += '<label class="form-label">' + _escapeHtml(p.discount) + '（值: ' + p.value + '）权重（%）</label>';
      html += '<input type="range" class="lottery-weight-slider" min="0" max="10" value="' + p.weight + '" data-index="' + i + '" id="lotteryWeight' + i + '">';
      html += '<span class="lottery-weight-value" id="lotteryWeightVal' + i + '">' + p.weight + '</span>';
      html += '</div>';
    });
    html += '<div class="form-group" style="border-top:1px solid var(--border-color);padding-top:12px;margin-top:12px;">';
    html += '<label class="form-label">总百分比</label>';
    html += '<span class="lottery-weight-value" id="lotteryTotalPercent" style="font-size:18px;font-weight:bold;color:var(--accent);">100</span>';
    html += '<span style="color:var(--text-secondary);margin-left:4px;">%</span>';
    html += '</div>';
    document.getElementById("lotteryConfigList").innerHTML = html;
    var _updateTotal = function() {
      var total = 0;
      for (var j = 0; j < n; j++) {
        var s = document.getElementById("lotteryWeight" + j);
        if (s) total += parseInt(s.value, 10) || 0;
      }
      var totalEl = document.getElementById("lotteryTotalPercent");
      if (totalEl) totalEl.textContent = total;
    };
    prizes.forEach(function(p, i) {
      var slider = document.getElementById("lotteryWeight" + i);
      var valEl = document.getElementById("lotteryWeightVal" + i);
      if (slider && valEl) {
        slider.addEventListener("input", function() {
          valEl.textContent = this.value;
          _updateTotal();
        });
      }
    });
    _updateTotal();
  };

  var saveLotteryConfig = function() {
    var prizes = JITLottery.getPrizes && JITLottery.getPrizes() || [];
    if (prizes.length === 0) { _showToast("没有可配置的奖项"); return; }
    var config = [];
    var hasError = false;
    prizes.forEach(function(p, i) {
      var slider = document.getElementById("lotteryWeight" + i);
      var weight = parseInt(slider ? slider.value : p.weight, 10);
      if (isNaN(weight) || weight < 0) {
        hasError = true;
      } else {
        config.push({
          discount: p.discount,
          value: p.value,
          label: p.label || p.discount,
          weight: weight
        });
      }
    });
    if (hasError) {
      _showToast("权重必须为大于等于0的整数！");
      return;
    }
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

  // ========= 黑名单管理 =========
  var _blIssueCache = null;   // 缓存云端黑名单 Issue
  var _blPendingSync = false; // 是否有未同步的更改

  // 黑名单 Issue Body 格式：每行一个用户
  // ｜用户名：xxx
  // ｜原因：xxx
  // ｜时间：xxx
  var _parseBlacklistBody = function(body) {
    var out = {};
    var lines = String(body || "").split(/\r?\n/);
    var cur = null;
    lines.forEach(function(line) {
      var trimmed = line.trim();
      var m;
      if ((m = trimmed.match(/^｜?\s*用户名：(.+)$/))) {
        cur = m[1].trim();
        if (!out[cur]) out[cur] = {};
      } else if (cur && (m = trimmed.match(/^｜?\s*原因：(.+)$/))) {
        out[cur].reason = m[1].trim();
      } else if (cur && (m = trimmed.match(/^｜?\s*时间：(.+)$/))) {
        out[cur].time = m[1].trim();
      }
    });
    return out;
  };

  var _formatBlacklistBody = function(map) {
    var lines = ["【动态黑名单】此文件由系统自动生成，请勿手动编辑。"];
    Object.keys(map || {}).forEach(function(u) {
      lines.push("｜用户名：" + u);
      lines.push("｜原因：" + (map[u].reason || "—"));
      lines.push("｜时间：" + (map[u].time || "—"));
      lines.push("");
    });
    return lines.join("\n");
  };

  var _ensureBlacklistLabel = function() {
    var lb = JITConfig.getBlacklistLabel();
    return fetch(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/labels/" + encodeURIComponent(lb), {
      headers: { Authorization: "token " + TOKEN, Accept: "application/vnd.github.v3+json" }
    }).then(function(r) {
      if (r.status === 404) {
        return _apiPost(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/labels", {
          name: lb, color: "b71c1c"
        }).catch(function() {});
      }
    }).catch(function() {});
  };

  var _findBlacklistIssue = function() {
    var lb = JITConfig.getBlacklistLabel();
    return _apiGet(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues?state=open&labels=" + encodeURIComponent(lb) + "&per_page=10").then(function(issues) {
      if (issues && issues.length > 0) {
        _blIssueCache = issues[0];
        return issues[0];
      }
      // 没找到就创建
      return _ensureBlacklistLabel().then(function() {
        return _apiPost(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues", {
          title: "【系统】动态黑名单",
          body: _formatBlacklistBody(JITConfig.getDynamicBlacklist()),
          labels: [lb]
        }).then(function(issue) {
          _blIssueCache = issue;
          return issue;
        });
      });
    });
  };

  var loadBlacklist = function() {
    var tbody = document.getElementById("blacklistTable");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">加载中...</td></tr>';

    // 先显示本地缓存
    _renderBlacklist();

    // 拉取云端，合并到本地
    _findBlacklistIssue().then(function(issue) {
      if (issue && issue.body) {
        var cloudMap = _parseBlacklistBody(issue.body);
        var localMap = JITConfig.getDynamicBlacklist();
        var merged = {};
        Object.keys(cloudMap).forEach(function(u) { merged[u] = cloudMap[u]; });
        Object.keys(localMap).forEach(function(u) { merged[u] = localMap[u]; });
        // 如果不一致，写回本地 + 下次增删操作会同步云端
        var changed = Object.keys(cloudMap).length !== Object.keys(localMap).length;
        if (!changed) {
          for (var k in merged) {
            if (!cloudMap[k]) { changed = true; break; }
          }
        }
        JITConfig.setDynamicBlacklist(merged);
        _renderBlacklist();
      }
    }).catch(function(e) {
      console.warn("加载云端黑名单失败，使用本地缓存", e);
    });
  };

  var _renderBlacklist = function() {
    var tbody = document.getElementById("blacklistTable");
    if (!tbody) return;
    var list = JITConfig.getAllBlacklistDetailed();
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">黑名单为空</td></tr>';
      return;
    }
    var html = "";
    list.forEach(function(item) {
      var isStatic = item.type === "static";
      html += '<tr>';
      html += '<td>' + (isStatic ? '<span class="status-badge rejected" style="background:rgba(123,31,162,0.2);color:#ce93d8;border-color:rgba(123,31,162,0.4);">静态</span>' : '<span class="status-badge pending">动态</span>') + '</td>';
      html += '<td style="font-weight:600;">' + _escapeHtml(item.username) + '</td>';
      html += '<td>' + _escapeHtml(item.reason || "—") + '</td>';
      html += '<td>' + _escapeHtml(item.time || "—") + '</td>';
      html += '<td>';
      if (isStatic) {
        html += '<span style="color:#9e9e9e;font-size:12px;">config.js内置，改代码移除</span>';
      } else {
        html += '<button class="action-btn bl-remove" data-user="' + _escapeHtml(item.username) + '" style="border-color:#4caf50;color:#4caf50;background:rgba(76,175,80,0.15);">🔓 解除封禁</button>';
      }
      html += '</td></tr>';
    });
    tbody.innerHTML = html;
    tbody.querySelectorAll(".bl-remove").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var username = this.getAttribute("data-user");
        if (!confirm("确定将 " + username + " 移出黑名单？")) return;
        if (JITConfig.removeFromBlacklist(username)) {
          _syncBlacklistToCloud();
          _showToast("已解除 " + username + " 的封禁");
          _renderBlacklist();
        } else {
          _showToast("移除失败（可能是静态黑名单）");
        }
      });
    });
  };

  var _syncBlacklistToCloud = function() {
    var map = JITConfig.getDynamicBlacklist();
    _blPendingSync = true;
    // 使用防抖：合并多次更改到一次请求
    clearTimeout(_syncBlacklistToCloud._t);
    _syncBlacklistToCloud._t = setTimeout(function() {
      _findBlacklistIssue().then(function(issue) {
        if (!issue) return;
        return _apiPatch(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues/" + issue.number, {
          body: _formatBlacklistBody(map)
        });
      }).then(function() {
        _blPendingSync = false;
        console.log("黑名单已同步到云端");
      }).catch(function(e) {
        console.warn("黑名单同步失败：", e);
        _showToast("黑名单同步云端失败，已保存在本地");
      });
    }, 600);
  };

  // ========= 积分管理 =========
  var _pointsListData = {};   // { username: { points, frozen, ... } }
  var _pointsOpTarget = null; // { username, op: 'add'|'reduce'|'clear'|'freeze'|'unfreeze' }

  var loadPointsList = function() {
    var tbody = document.getElementById("pointsList");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">加载中...请稍候</td></tr>';
    if (typeof JITPoints === "undefined" || !JITPoints.getAllUsersPoints) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">积分模块未加载</td></tr>';
      return;
    }
    JITPoints.ensureLabel().catch(function() {});
    JITPoints.getAllUsersPoints().then(function(data) {
      _pointsListData = data || {};
      _renderPointsTable(data);
    }).catch(function(err) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">加载失败: ' + _escapeHtml(err.message || "") + '</td></tr>';
    });
  };

  var _renderPointsTable = function(data) {
    var tbody = document.getElementById("pointsList");
    if (!tbody) return;
    var usernames = Object.keys(data || {});
    if (usernames.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">暂无积分记录（用户添加凭证后自动生成）</td></tr>';
      return;
    }
    // 同时把 config 中的用户也列出来（即使还没积分记录）
    var configUsers = JITConfig.getUsers();
    Object.keys(configUsers).forEach(function(u) {
      if (u !== "admin" && !data[u]) data[u] = { points: 0, frozen: false, streakDays: 0 };
    });
    usernames = Object.keys(data);
    var html = "";
    usernames.forEach(function(username) {
      if (username === "admin") return;
      var d = data[username];
      var pts = d.points || 0;
      var frozen = !!d.frozen;
      var streak = d.streakDays || 0;
      var statusHtml = frozen
        ? '<span class="status-badge rejected" style="background:rgba(33,150,243,0.2);color:#2196f3;border:1px solid rgba(33,150,243,0.4);">🧊 已冻结</span>'
        : '<span class="status-badge approved">正常</span>';
      html += '<tr>';
      html += '<td style="font-weight:600;">' + _escapeHtml(username) + '</td>';
      html += '<td><span style="font-size:16px;font-weight:700;color:#ffd54f;">' + pts + '</span></td>';
      html += '<td>' + statusHtml + '</td>';
      html += '<td>' + (streak > 0 ? streak + ' 天' : '—') + '</td>';
      html += '<td style="white-space:nowrap;">';
      html += '<button class="action-btn pts-btn-add" data-user="' + _escapeHtml(username) + '" style="margin:2px;">➕ 增加</button>';
      html += '<button class="action-btn pts-btn-reduce" data-user="' + _escapeHtml(username) + '" style="margin:2px;">➖ 减少</button>';
      html += '<button class="action-btn pts-btn-clear" data-user="' + _escapeHtml(username) + '" style="margin:2px;border-color:#ff9800;color:#ff9800;background:rgba(255,152,0,0.15);">🗑 清零</button>';
      if (frozen) {
        html += '<button class="action-btn pts-btn-unfreeze" data-user="' + _escapeHtml(username) + '" style="margin:2px;border-color:#4caf50;color:#4caf50;background:rgba(76,175,80,0.15);">🔓 解冻</button>';
      } else {
        html += '<button class="action-btn pts-btn-freeze" data-user="' + _escapeHtml(username) + '" style="margin:2px;border-color:#2196f3;color:#2196f3;background:rgba(33,150,243,0.15);">🧊 冻结</button>';
      }
      html += '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;
    // 绑定按钮
    tbody.querySelectorAll(".pts-btn-add").forEach(function(b) {
      b.addEventListener("click", function() { _openPointsOp(this.getAttribute("data-user"), "add"); });
    });
    tbody.querySelectorAll(".pts-btn-reduce").forEach(function(b) {
      b.addEventListener("click", function() { _openPointsOp(this.getAttribute("data-user"), "reduce"); });
    });
    tbody.querySelectorAll(".pts-btn-clear").forEach(function(b) {
      b.addEventListener("click", function() { _openPointsOp(this.getAttribute("data-user"), "clear"); });
    });
    tbody.querySelectorAll(".pts-btn-freeze").forEach(function(b) {
      b.addEventListener("click", function() { _openPointsOp(this.getAttribute("data-user"), "freeze"); });
    });
    tbody.querySelectorAll(".pts-btn-unfreeze").forEach(function(b) {
      b.addEventListener("click", function() { _openPointsOp(this.getAttribute("data-user"), "unfreeze"); });
    });
  };

  var _openPointsOp = function(username, op) {
    _pointsOpTarget = { username: username, op: op };
    var overlay = document.getElementById("pointsOpOverlay");
    var titleEl = document.getElementById("pointsOpTitle");
    var infoEl = document.getElementById("pointsOpInfo");
    var valueGroup = document.getElementById("pointsOpValueGroup");
    var reasonGroup = document.getElementById("pointsOpReasonGroup");
    var valueInput = document.getElementById("pointsOpValue");
    var reasonInput = document.getElementById("pointsOpReason");
    if (!overlay) return;

    var d = _pointsListData[username] || { points: 0, frozen: false };
    var infoHtml = "用户：<b>" + _escapeHtml(username) + "</b>　当前积分：<b style='color:#ffd54f;'>" + (d.points || 0) + "</b>";
    if (d.frozen) infoHtml += '　<span style="color:#2196f3;">（已冻结）</span>';
    infoEl.innerHTML = infoHtml;
    reasonInput.value = "";

    var titles = {
      add: "➕ 增加积分",
      reduce: "➖ 减少积分",
      clear: "🗑 清零积分",
      freeze: "🧊 冻结积分",
      unfreeze: "🔓 解冻积分"
    };
    titleEl.textContent = titles[op] || "调整积分";

    if (op === "add" || op === "reduce") {
      valueGroup.style.display = "";
      reasonGroup.style.display = "";
      valueInput.value = "";
      valueInput.placeholder = op === "add" ? "要增加的积分数" : "要减少的积分数";
    } else if (op === "clear") {
      valueGroup.style.display = "none";
      reasonGroup.style.display = "";
      reasonInput.placeholder = "清零原因（选填）";
    } else {
      // freeze / unfreeze
      valueGroup.style.display = "none";
      reasonGroup.style.display = "none";
    }
    overlay.classList.add("active");
  };

  var _closePointsOp = function() {
    var overlay = document.getElementById("pointsOpOverlay");
    if (overlay) overlay.classList.remove("active");
    _pointsOpTarget = null;
  };

  var _confirmPointsOp = function() {
    if (!_pointsOpTarget) return;
    var username = _pointsOpTarget.username;
    var op = _pointsOpTarget.op;
    var reasonInput = document.getElementById("pointsOpReason");
    var reason = reasonInput ? reasonInput.value.trim() : "";
    var btn = document.getElementById("btnPointsOpConfirm");
    if (btn) btn.disabled = true;

    var promise;
    if (op === "add") {
      var val = parseInt(document.getElementById("pointsOpValue").value, 10);
      if (!val || val <= 0) { _showToast("请输入正整数"); if (btn) btn.disabled = false; return; }
      promise = JITPoints.adminAdjust(username, val, reason || "管理员增加积分");
    } else if (op === "reduce") {
      var valR = parseInt(document.getElementById("pointsOpValue").value, 10);
      if (!valR || valR <= 0) { _showToast("请输入正整数"); if (btn) btn.disabled = false; return; }
      promise = JITPoints.adminAdjust(username, -valR, reason || "管理员减少积分");
    } else if (op === "clear") {
      promise = JITPoints.resetPoints(username);
    } else if (op === "freeze") {
      promise = JITPoints.setFrozen(username, true);
    } else if (op === "unfreeze") {
      promise = JITPoints.setFrozen(username, false);
    } else {
      if (btn) btn.disabled = false;
      return;
    }

    promise.then(function() {
      var msg = {
        add: "积分增加成功",
        reduce: "积分减少成功",
        clear: "积分已清零",
        freeze: "已冻结 " + username + " 的积分账户",
        unfreeze: "已解冻 " + username + " 的积分账户"
      }[op];
      _showToast(msg);
      _closePointsOp();
      loadPointsList();  // 刷新列表
    }).catch(function(err) {
      _showToast("操作失败: " + (err.message || ""));
    }).finally(function() {
      if (btn) btn.disabled = false;
    });
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
      var btn = document.getElementById("btnAdminLogin");
      btn.disabled = true;
      btn.textContent = "验证中...";
      _sha256(ADMIN_SALT + password).then(function(hash) {
        if (hash === ADMIN_PASSWORD_HASH) {
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
            document.getElementById("adminPassword").disabled = true;
          } else {
            btn.disabled = false;
            btn.textContent = "登录";
          }
          document.getElementById("adminPassword").value = "";
        }
      }).catch(function() {
        errorEl.style.display = "block";
        errorEl.textContent = "验证失败，请重试";
        btn.disabled = false;
        btn.textContent = "登录";
      });
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
      var data = _parseIssueBody(currentIssue.body);
      var isElectric = !!(data.electric || data.voucherType === "电器凭证" || data.electricCategory || data.electricBrand);
      var rateVal = null, amtVal = null;
      if (isElectric) {
        var rateRaw = document.getElementById("inputSubsidyRate").value.trim();
        rateVal = parseFloat(rateRaw);
        if (!rateRaw || isNaN(rateVal) || rateVal <= 0 || rateVal > 100) {
          _showToast("请设置有效的补贴比例（0% ~ 100%）！", "error");
          document.getElementById("subsidyRateWrap").scrollIntoView({behavior:"smooth",block:"center"});
          return;
        }
        var applyN = parseFloat(data.electricApplyAmount || (data.amount || "").replace(/元|,/g, ""));
        if (isNaN(applyN)) applyN = 0;
        amtVal = applyN * rateVal / 100;
      }
      _updateIssueStatus(currentIssue, "approved", null, {
        isElectric: isElectric,
        subsidyRate: rateVal,
        subsidyAmount: amtVal
      }).then(function() {
        _showToast("已通过该凭证" + (isElectric ? ("，补贴 " + rateVal + "% ≈ ¥" + amtVal.toFixed(2)) : ""));
        // 审核通过后给该用户 +25 积分
        var uid = data.userId || data.title || (currentIssue.user && currentIssue.user.login);
        if (uid && typeof JITPoints !== "undefined" && JITPoints.changePoints) {
          JITPoints.ensureLabel().catch(function() {});
          JITPoints.changePoints(uid, 25, "凭证审核通过").then(function() {
            _showToast("已发放审核通过奖励 +25 积分给 " + uid);
          }).catch(function(err) {
            console.warn("发放积分失败", err);
          });
        }
        document.getElementById("reviewOverlay").classList.remove("active");
        document.getElementById("rejectReasonWrap").style.display = "none";
        var subWrap = document.getElementById("subsidyRateWrap");
        if (subWrap) subWrap.style.display = "none";
        loadIssues();
      }).catch(function(e) { _showToast("操作失败: " + e.message); });
    });

    // ===== 补贴比例预设按钮 + 输入框实时换算 =====
    document.querySelectorAll(".subsidy-preset").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var r = this.getAttribute("data-rate");
        var input = document.getElementById("inputSubsidyRate");
        if (input) {
          input.value = r;
          input.dispatchEvent(new Event("input", {bubbles:true}));
        }
        document.querySelectorAll(".subsidy-preset").forEach(function(b){ b.classList.remove("active"); });
        this.classList.add("active");
      });
    });
    var subRateInput = document.getElementById("inputSubsidyRate");
    if (subRateInput) {
      subRateInput.addEventListener("input", function() {
        var data = currentIssue ? _parseIssueBody(currentIssue.body) : {};
        var applyN = parseFloat(data.electricApplyAmount || (data.amount || "").replace(/元|,/g, ""));
        if (isNaN(applyN)) applyN = 0;
        _updateSubsidyHint(applyN);
      });
    }

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

    var btnComplete = document.getElementById("btnComplete");
    if (btnComplete) {
      btnComplete.addEventListener("click", function() {
        if (!currentIssue) return;
        if (!confirm("确认标记此凭证为「已完成交易」？\n（用户已付款给工会 / 工会已返款给用户）")) return;
        _updateIssueStatus(currentIssue, "completed").then(function() {
          _showToast("已标记为已完成交易");
          document.getElementById("reviewOverlay").classList.remove("active");
          loadIssues();
        }).catch(function(e) { _showToast("操作失败: " + e.message); });
      });
    }

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
        if (tab === "registrations") loadRegistrations();
        if (tab === "points") loadPointsList();
        if (tab === "blacklist") loadBlacklist();
        if (tab === "urgentBl") loadUrgentBlacklist();
        if (tab === "notifications") loadNotifications();
        if (tab === "settings") loadSettings();
        if (tab === "developer") loadSystemInfo();
      });
    });

    document.getElementById("btnChatSend").addEventListener("click", sendChatMessage);
    document.getElementById("chatInput").addEventListener("keydown", function(e) {
      if (e.key === "Enter") sendChatMessage();
    });
    var chatImgInput = document.getElementById("chatImageInput");
    if (chatImgInput) {
      chatImgInput.addEventListener("change", function() {
        var file = this.files[0];
        if (!file || !currentChatUser) return;
        this.value = "";
        _showToast("上传图片中...");
        JITApi.uploadChatImage(file, "admin").then(function(url) {
          if (!url) { _showToast("图片上传失败"); return; }
          var userIssues = [];
          allIssues.forEach(function(issue) {
            var data = _parseIssueBody(issue.body);
            var uid = data.userId;
            if (!uid && data.title) uid = data.title.replace(/\d+$/, "");
            if (!uid) uid = issue.user ? issue.user.login : "";
            if (uid === currentChatUser.userId) userIssues.push(issue.number);
          });
          if (userIssues.length === 0) { _showToast("该用户没有凭证"); return; }
          return _addIssueComment(userIssues[0], "｜CHAT｜[IMG]" + url).then(function() {
            loadChatMessages();
          });
        }).catch(function(e) {
          _showToast("发送图片失败: " + e.message);
        });
      });
    }

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

    // 积分管理事件
    var btnRefreshPoints = document.getElementById("btnRefreshPoints");
    if (btnRefreshPoints) btnRefreshPoints.addEventListener("click", loadPointsList);
    var btnPointsOpClose = document.getElementById("btnPointsOpClose");
    if (btnPointsOpClose) btnPointsOpClose.addEventListener("click", _closePointsOp);
    var btnPointsOpConfirm = document.getElementById("btnPointsOpConfirm");
    if (btnPointsOpConfirm) btnPointsOpConfirm.addEventListener("click", _confirmPointsOp);
    var pointsOpOverlay = document.getElementById("pointsOpOverlay");
    if (pointsOpOverlay) {
      pointsOpOverlay.addEventListener("click", function(e) {
        if (e.target === this) _closePointsOp();
      });
    }

    document.getElementById("btnSaveSettings").addEventListener("click", saveSettings);
    document.getElementById("btnClearCache").addEventListener("click", clearCache);
    document.getElementById("btnExportData").addEventListener("click", exportData);

    // 黑名单事件绑定
    var btnBlacklistAdd = document.getElementById("btnBlacklistAdd");
    if (btnBlacklistAdd) {
      btnBlacklistAdd.addEventListener("click", function() {
        var userInput = document.getElementById("blacklistNewUser");
        var reasonInput = document.getElementById("blacklistNewReason");
        var username = userInput ? userInput.value.trim() : "";
        var reason = reasonInput ? reasonInput.value.trim() : "";
        if (!username) { _showToast("请输入用户名"); return; }
        if (username === "admin") { _showToast("不能封禁admin用户"); return; }
        if (JITConfig.isBlacklisted(username)) { _showToast("该用户已在黑名单中"); return; }
        JITConfig.addToBlacklist(username, reason);
        _syncBlacklistToCloud();
        if (userInput) userInput.value = "";
        if (reasonInput) reasonInput.value = "";
        _showToast("已将 " + username + " 加入黑名单");
        loadBlacklist();
      });
    }

    // ===== 通知管理事件 =====
    var btnNewNotif = document.getElementById("btnNewNotification");
    if (btnNewNotif) btnNewNotif.addEventListener("click", function() {
      document.getElementById("inputNotifTitle").value = "";
      document.getElementById("inputNotifContent").value = "";
      document.getElementById("inputNotifTarget").value = "all";
      document.getElementById("notifCustomUsersWrap").style.display = "none";
      document.getElementById("notifSendOverlay").style.display = "flex";
    });
    var btnNotifSendClose = document.getElementById("btnNotifSendClose");
    if (btnNotifSendClose) btnNotifSendClose.addEventListener("click", function() {
      document.getElementById("notifSendOverlay").style.display = "none";
    });
    var notifTargetSel = document.getElementById("inputNotifTarget");
    if (notifTargetSel) notifTargetSel.addEventListener("change", function() {
      document.getElementById("notifCustomUsersWrap").style.display = (this.value === "custom") ? "block" : "none";
    });
    var btnNotifSendConfirm = document.getElementById("btnNotifSendConfirm");
    if (btnNotifSendConfirm) btnNotifSendConfirm.addEventListener("click", _confirmSendNotification);
    var btnNotifDetailClose = document.getElementById("btnNotifDetailClose");
    if (btnNotifDetailClose) btnNotifDetailClose.addEventListener("click", function() {
      document.getElementById("notifDetailOverlay").style.display = "none";
    });

    // ===== 加急黑名单管理事件 =====
    var btnUrgentBlAdd = document.getElementById("btnUrgentBlAdd");
    if (btnUrgentBlAdd) btnUrgentBlAdd.addEventListener("click", _addUrgentBlFromTab);
    var btnRefreshUrgentBl = document.getElementById("btnRefreshUrgentBl");
    if (btnRefreshUrgentBl) btnRefreshUrgentBl.addEventListener("click", loadUrgentBlacklist);

    // 审核弹窗：加入加急黑名单
    var btnUrgentBlackBan = document.getElementById("btnUrgentBlackBan");
    if (btnUrgentBlackBan) btnUrgentBlackBan.addEventListener("click", _openUrgentBlacklistModal);
    var btnUBClose = document.getElementById("btnUrgentBlacklistClose");
    if (btnUBClose) btnUBClose.addEventListener("click", _closeUrgentBlacklistModal);
    var btnUBCancel = document.getElementById("btnUrgentBlacklistCancel");
    if (btnUBCancel) btnUBCancel.addEventListener("click", _closeUrgentBlacklistModal);
    var btnUBConfirm = document.getElementById("btnUrgentBlacklistConfirm");
    if (btnUBConfirm) btnUBConfirm.addEventListener("click", _confirmUrgentBlacklist);
    var ubOverlay = document.getElementById("urgentBlacklistOverlay");
    if (ubOverlay) ubOverlay.addEventListener("click", function(e) {
      if (e.target === ubOverlay) _closeUrgentBlacklistModal();
    });
  };

  init();

  // ======= 注册审核 =======
  var loadRegistrations = function() {
    var tbody = document.getElementById("registrationsList");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#999;">加载中...</td></tr>';
    JITApi.getPendingRegistrations().then(function(list) {
      if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#999;">暂无注册申请</td></tr>';
        return;
      }
      tbody.innerHTML = "";
      list.forEach(function(item) {
        var d = item.data;
        var issueNum = item.issue.number;
        var status = d.reviewStatus || "待审核";
        var statusColor = status === "已通过" ? "#4caf50" : (status === "已拒绝" ? "#f44336" : "#ff9800");
        var location = [d.country, d.province, d.city].filter(Boolean).join(" / ") || "—";
        var tr = document.createElement("tr");
        var actionsHtml = "";
        if (status === "待审核") {
          actionsHtml = '<button class="btn btn-approve" style="padding:4px 10px;font-size:12px;margin-right:4px;" onclick="JITAdmin._approveReg(' + issueNum + ')">通过</button>' +
            '<button class="btn btn-reject" style="padding:4px 10px;font-size:12px;" onclick="JITAdmin._rejectReg(' + issueNum + ')">拒绝</button>';
        } else {
          actionsHtml = '<span style="color:#999;font-size:12px;">已处理</span>';
        }
        tr.innerHTML = '<td>' + _escapeHtml(d.fullName || "—") + '</td>' +
          '<td>' + _escapeHtml(d.username || "—") + '</td>' +
          '<td>' + _escapeHtml(d.birthdate || "—") + '</td>' +
          '<td style="font-size:12px;">' + _escapeHtml(location) + '</td>' +
          '<td>' + _escapeHtml(d.referrer || "—") + '</td>' +
          '<td style="font-size:12px;">' + _escapeHtml(d.registerTime || "—") + '</td>' +
          '<td><span style="color:' + statusColor + ';font-size:12px;font-weight:bold;">' + status + '</span></td>' +
          '<td>' + actionsHtml + '</td>';
        tbody.appendChild(tr);
      });
    }).catch(function(e) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#f44336;">加载失败: ' + _escapeHtml(e.message) + '</td></tr>';
    });
  };

  var _approveReg = function(issueNum) {
    JITApi.approveRegistration(issueNum).then(function() {
      _showToast("已通过注册申请");
      // 发放积分奖励
      return JITApi.getIssue(issueNum).then(function(issue) {
        var bodyData = _parseIssueBody(issue.body);
        var promises = [];
        // 新用户得50积分
        if (bodyData.username) {
          promises.push(JITPoints.changePoints(bodyData.username, JITPoints.RULES.INVITE_REWARD, "注册奖励"));
        }
        // 邀请人得50积分
        if (bodyData.referrer && bodyData.referrer !== bodyData.username) {
          promises.push(JITPoints.changePoints(bodyData.referrer, JITPoints.RULES.INVITE_REWARD, "邀请好友：" + bodyData.username));
        }
        return Promise.all(promises);
      });
    }).then(function() {
      loadRegistrations();
    }).catch(function(e) { _showToast("操作失败: " + e.message); });
  };

  var _rejectReg = function(issueNum) {
    JITApi.rejectRegistration(issueNum).then(function() {
      _showToast("已拒绝注册申请");
      loadRegistrations();
    }).catch(function(e) { _showToast("操作失败: " + e.message); });
  };

  // ======= 通知管理 =======
  var loadNotifications = function() {
    var tbody = document.getElementById("notificationsTable");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">加载中...</td></tr>';
    JITApi.getAllNotifications().then(function(list) {
      if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">暂无通知</td></tr>';
        return;
      }
      var html = "";
      list.forEach(function(n) {
        var targetText = n.targetUsers === "all" ? "全部用户" : n.targetUsers;
        html += '<tr>';
        html += '<td style="font-weight:600;">' + _escapeHtml(n.title) + '</td>';
        html += '<td>' + _escapeHtml(targetText) + '</td>';
        html += '<td style="font-size:12px;">' + _escapeHtml(n.sendTime) + '</td>';
        html += '<td><span class="status-badge pending">' + n.comments + '</span></td>';
        html += '<td><button class="action-btn" data-notif="' + n.issueNumber + '">查看</button></td>';
        html += '</tr>';
      });
      tbody.innerHTML = html;
      tbody.querySelectorAll(".action-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          _viewNotificationDetail(parseInt(this.getAttribute("data-notif")));
        });
      });
    }).catch(function(e) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">加载失败: ' + _escapeHtml(e.message) + '</td></tr>';
    });
  };

  var _confirmSendNotification = function() {
    var title = document.getElementById("inputNotifTitle").value.trim();
    var content = document.getElementById("inputNotifContent").value.trim();
    var target = document.getElementById("inputNotifTarget").value;
    var targetUsers = "all";
    if (target === "custom") {
      var users = document.getElementById("inputNotifUsers").value.trim();
      if (!users) { _showToast("请填写指定用户名"); return; }
      targetUsers = users;
    }
    if (!title) { _showToast("请输入通知标题"); return; }
    if (!content) { _showToast("请输入通知内容"); return; }
    var btn = document.getElementById("btnNotifSendConfirm");
    btn.disabled = true; btn.textContent = "发送中...";
    JITApi.sendNotification(title, content, targetUsers).then(function() {
      _showToast("通知发送成功！");
      document.getElementById("notifSendOverlay").style.display = "none";
      loadNotifications();
    }).catch(function(e) {
      _showToast("发送失败: " + e.message);
    }).finally(function() {
      btn.disabled = false; btn.textContent = "发送通知";
    });
  };

  var _viewNotificationDetail = function(issueNumber) {
    JITApi.getAllNotifications().then(function(list) {
      var n = list.find(function(x) { return x.issueNumber === issueNumber; });
      if (!n) { _showToast("通知不存在"); return; }
      document.getElementById("notifDetailTitle").textContent = "🔔 " + n.title;
      var bodyHtml = '<div style="padding:12px;border-radius:8px;background:rgba(255,255,255,0.05);margin-bottom:12px;">';
      bodyHtml += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">发送时间：' + _escapeHtml(n.sendTime) + ' ｜ 目标：' + _escapeHtml(n.targetUsers === "all" ? "全部用户" : n.targetUsers) + '</div>';
      bodyHtml += '<div style="white-space:pre-wrap;line-height:1.7;">' + _escapeHtml(n.content) + '</div>';
      bodyHtml += '</div>';
      document.getElementById("notifDetailBody").innerHTML = bodyHtml;
      document.getElementById("notifRepliesList").innerHTML = '<div style="text-align:center;color:#999;padding:20px;">加载回复中...</div>';
      document.getElementById("notifDetailOverlay").style.display = "flex";
      // 加载回复
      JITApi.getNotificationReplies(issueNumber).then(function(replies) {
        var listEl = document.getElementById("notifRepliesList");
        if (replies.length === 0) {
          listEl.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无回复</div>';
          return;
        }
        var html = "";
        replies.forEach(function(r) {
          html += '<div style="padding:10px 12px;margin-bottom:8px;border-radius:8px;background:rgba(255,255,255,0.05);">';
          html += '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">';
          html += '<span style="font-weight:600;color:var(--accent);">' + _escapeHtml(r.username) + '</span>';
          html += '<span style="font-size:11px;color:#999;">' + new Date(r.time).toLocaleString("zh-CN") + '</span>';
          html += '</div>';
          html += '<div style="white-space:pre-wrap;">' + _escapeHtml(r.message) + '</div>';
          html += '</div>';
        });
        listEl.innerHTML = html;
      }).catch(function() {
        document.getElementById("notifRepliesList").innerHTML = '<div style="text-align:center;color:#f44336;padding:20px;">加载失败</div>';
      });
    }).catch(function(e) {
      _showToast("加载失败: " + e.message);
    });
  };

  // ========= 加急黑名单管理（GitHub Issues 后端存储） =========
  function _fmtIsoShort(iso) {
    if (!iso) return "—";
    if (iso === "permanent") return "永久";
    try { return iso.replace("T", " ").substring(0, 16); } catch(e) { return iso; }
  }

  var _ubIssueCache = null;
  var _UB_LABEL = "urgent-blacklist";

  var _formatUrgentBlBody = function(map) {
    var lines = ["【加急黑名单】此文件由系统自动生成，请勿手动编辑。"];
    Object.keys(map || {}).forEach(function(u) {
      var e = map[u] || {};
      lines.push("｜用户名：" + u);
      lines.push("｜理由：" + (e.reason || "—"));
      lines.push("｜开始：" + (e.from || "—"));
      lines.push("｜到期：" + (e.until || "permanent"));
      lines.push("｜操作员：" + (e.operator || "admin"));
      lines.push("");
    });
    return lines.join("\n");
  };

  var _parseUrgentBlBody = function(body) {
    var map = {};
    if (!body) return map;
    var blocks = body.split(/\n(?=｜用户名：)/);
    blocks.forEach(function(block) {
      var u = (block.match(/｜用户名：(.+)/) || [])[1];
      if (!u) return;
      u = u.trim();
      map[u] = {
        reason: ((block.match(/｜理由：(.+)/) || [])[1] || "").trim(),
        from: ((block.match(/｜开始：(.+)/) || [])[1] || "").trim(),
        until: ((block.match(/｜到期：(.+)/) || [])[1] || "permanent").trim(),
        operator: ((block.match(/｜操作员：(.+)/) || [])[1] || "admin").trim()
      };
    });
    return map;
  };

  var _ensureUrgentBlLabel = function() {
    return _apiGet(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/labels/" + encodeURIComponent(_UB_LABEL)).catch(function() {
      return _apiPost(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/labels", { name: _UB_LABEL, color: "6a1b9a" }).catch(function(){});
    });
  };

  var _findUrgentBlIssue = function() {
    if (_ubIssueCache) return Promise.resolve(_ubIssueCache);
    return _apiGet(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues?state=open&labels=" + encodeURIComponent(_UB_LABEL) + "&per_page=5").then(function(issues) {
      if (issues && issues.length > 0) {
        _ubIssueCache = issues[0];
        return issues[0];
      }
      return _ensureUrgentBlLabel().then(function() {
        return _apiPost(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues", {
          title: "【系统】加急黑名单",
          body: _formatUrgentBlBody({}),
          labels: [_UB_LABEL]
        }).then(function(issue) {
          _ubIssueCache = issue;
          return issue;
        });
      });
    });
  };

  var _syncUrgentBlToCloud = function() {
    var map = JITConfig.getUrgentBlacklist();
    clearTimeout(_syncUrgentBlToCloud._t);
    _syncUrgentBlToCloud._t = setTimeout(function() {
      _findUrgentBlIssue().then(function(issue) {
        if (!issue) return;
        return _apiPatch(BASE_URL + "/repos/" + OWNER + "/" + REPO + "/issues/" + issue.number, {
          body: _formatUrgentBlBody(map)
        });
      }).then(function() {
        console.log("加急黑名单已同步到云端");
      }).catch(function(e) {
        console.warn("加急黑名单同步失败：", e);
        _showToast("加急黑名单同步云端失败");
      });
    }, 600);
  };

  var loadUrgentBlacklist = function() {
    var tbody = document.getElementById("urgentBlTable");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">加载中...</td></tr>';
    _findUrgentBlIssue().then(function(issue) {
      var cloudMap = {};
      if (issue && issue.body) {
        cloudMap = _parseUrgentBlBody(issue.body);
      }
      // 清理过期
      var nowIso = new Date().toISOString().slice(0,19);
      var changed = false;
      Object.keys(cloudMap).forEach(function(u) {
        var e = cloudMap[u];
        if (e && e.until && e.until !== "permanent" && e.until < nowIso) {
          delete cloudMap[u];
          changed = true;
        }
      });
      JITConfig.setUrgentBlCache(cloudMap);
      if (changed) _syncUrgentBlToCloud();
      _renderUrgentBlTable();
    }).catch(function(e) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">加载失败: ' + _escapeHtml(e.message || "") + '</td></tr>';
    });
  };

  var _renderUrgentBlTable = function() {
    var tbody = document.getElementById("urgentBlTable");
    if (!tbody) return;
    var list = JITConfig.getUrgentBlacklist() || {};
    var usernames = Object.keys(list);
    if (usernames.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">加急黑名单为空</td></tr>';
      return;
    }
    var html = "";
    usernames.forEach(function(u) {
      var e = list[u] || {};
      var isPerm = (e.until === "permanent" || !e.until);
      var expSoon = false;
      if (!isPerm) {
        try {
          var ms = new Date(e.until.replace(" ","T")).getTime() - Date.now();
          expSoon = ms < 86400000;
        } catch(err) {}
      }
      html += '<tr>';
      html += '<td>' + _escapeHtml(u) + '</td>';
      html += '<td>' + _escapeHtml(e.reason || "—") + '</td>';
      html += '<td>' + _fmtIsoShort(e.from) + '</td>';
      var untilStyle = expSoon ? ' style="color:#f44336;font-weight:600;"' : "";
      html += '<td' + untilStyle + '>' + _fmtIsoShort(e.until) + '</td>';
      html += '<td>' + (isPerm ? '<span style="color:#f44336;font-weight:600;">永久封禁</span>' : '<span style="color:#ff9800;">限时</span>') + '</td>';
      html += '<td><button class="action-btn urgentbl-remove" data-user="' + _escapeHtml(u) + '">解除</button></td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;
    tbody.querySelectorAll(".urgentbl-remove").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var u = this.getAttribute("data-user");
        if (!u) return;
        if (!confirm("确认解除用户 [" + u + "] 的加急黑名单吗？")) return;
        if (JITConfig.removeUrgentBlacklist(u)) {
          _syncUrgentBlToCloud();
          _showToast("已解除 " + u + " 的加急黑名单", "success");
          _renderUrgentBlTable();
        } else {
          _showToast("移除失败，该用户可能不在名单中");
        }
      });
    });
  };

  // 加急黑名单tab: 添加按钮
  function _addUrgentBlFromTab() {
    var userEl = document.getElementById("urgentBlNewUser");
    var reasonEl = document.getElementById("urgentBlNewReason");
    var hEl = document.getElementById("urgentBlHours");
    var dEl = document.getElementById("urgentBlDays");
    var mEl = document.getElementById("urgentBlMonths");
    var pEl = document.getElementById("urgentBlPermanent");
    var username = (userEl && userEl.value || "").trim();
    var reason = (reasonEl && reasonEl.value || "").trim();
    if (!username) { _showToast("请填写用户名"); return; }
    var h = hEl ? parseFloat(hEl.value || 0) : 0;
    var d = dEl ? parseFloat(dEl.value || 0) : 0;
    var m = mEl ? parseFloat(mEl.value || 0) : 0;
    var permanent = !!(pEl && pEl.checked);
    var until = JITConfig.addUrgentDurationIso(h, d, m, permanent);
    var ok = JITConfig.addUrgentBlacklist(username, { reason: reason, until: until, operator: "admin" });
    if (ok) {
      _syncUrgentBlToCloud();
      _showToast("已将 [" + username + "] 加入加急黑名单（" + (until === "permanent" ? "永久" : ("至 " + _fmtIsoShort(until))) + "）", "success");
      if (userEl) userEl.value = "";
      if (reasonEl) reasonEl.value = "";
      if (hEl) hEl.value = "";
      if (dEl) dEl.value = "";
      if (mEl) mEl.value = "";
      if (pEl) pEl.checked = false;
      _renderUrgentBlTable();
    } else {
      _showToast("添加失败");
    }
  }

  // 审核页「加入加急黑名单」按钮 -> 打开弹窗
  function _openUrgentBlacklistModal() {
    var t = window.__currentUrgentBanTarget || {};
    if (!t.username) { _showToast("无法获取当前用户"); return; }
    var userEl = document.getElementById("urgentBlacklistUser");
    if (userEl) userEl.textContent = t.username || "—";
    var vEl = document.getElementById("urgentBlacklistVoucher");
    if (vEl) vEl.textContent = t.voucherDesc || "—";
    // 清空输入
    var clearIds = ["ubuHours","ubuDays","ubuMonths","ubuReason"];
    clearIds.forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ""; });
    var p = document.getElementById("ubuPermanent"); if (p) p.checked = false;
    var overlay = document.getElementById("urgentBlacklistOverlay");
    if (overlay) overlay.style.display = "flex";
  }
  function _closeUrgentBlacklistModal() {
    var overlay = document.getElementById("urgentBlacklistOverlay");
    if (overlay) overlay.style.display = "none";
  }
  function _confirmUrgentBlacklist() {
    var t = window.__currentUrgentBanTarget || {};
    if (!t.username) { _showToast("无法获取当前用户"); return; }
    var h = parseFloat((document.getElementById("ubuHours") || {}).value || 0);
    var d = parseFloat((document.getElementById("ubuDays") || {}).value || 0);
    var m = parseFloat((document.getElementById("ubuMonths") || {}).value || 0);
    var permanent = !!(document.getElementById("ubuPermanent") || {}).checked;
    var reason = ((document.getElementById("ubuReason") || {}).value || "").trim();
    if (!permanent && h <= 0 && d <= 0 && m <= 0) {
      _showToast("请选择封禁时长，或勾选「永久」");
      return;
    }
    if (!reason) {
      if (!confirm("未填写封禁理由，确定仍然加入黑名单吗？")) return;
    }
    var until = JITConfig.addUrgentDurationIso(h, d, m, permanent);
    var ok = JITConfig.addUrgentBlacklist(t.username, { reason: reason, until: until, operator: "admin" });
    if (ok) {
      _syncUrgentBlToCloud();
      _showToast("已将 [" + t.username + "] 加入加急黑名单（" + (until === "permanent" ? "永久" : ("至 " + _fmtIsoShort(until))) + "）", "success");
      _closeUrgentBlacklistModal();
    } else {
      _showToast("加入黑名单失败");
    }
  }

  return {
    _previewImage: _previewImage,
    _openVoucherFromChat: _openVoucherFromChat,
    loadIssues: loadIssues,
    loadRegistrations: loadRegistrations,
    _approveReg: _approveReg,
    _rejectReg: _rejectReg
  };
})();