var JITApp = (function() {
  window._JIT_TOKEN_TAIL = (function() {
    var _a = "_GIT";
    var _b = "HUB_";
    var _c = "TAIL";
    return _a + _b + _c;
  })();

  var _currentUser = null;
  var _currentPage = 1;
  var _perPage = 10;
  var _totalVouchers = 0;
  var _allVouchers = [];
  var _orderPhotos = [];
  var _orderPhotoFiles = [];
  var _signatureData = null;
  var _editingVoucher = null;
  var _chatIssueNumber = null;

  // 线上购物相关变量
  var _onlineProductFile = null;
  var _onlineShoppingFiles = [];
  var _onlineShoppingPhotoFiles = [];
  var _onlineSignatureData = null;

  // 大额电器补贴相关变量
  var _electricProductFile = null;
  var _electricOrderFiles = [];
  var _electricSignatureData = null;

  var _init = function() {
    _initBackgroundParticles();
    _syncBlacklistFromCloud(); // 启动时先同步云端黑名单（优先级高于自动登录检测）
    _initLogin();
    _bindEvents();
    // 确保积分 label 存在
    if (JITPoints && JITPoints.ensureLabel) JITPoints.ensureLabel().catch(function() {});
    _loadData();
    _refreshPointsDisplay();
    // 每10秒自动刷新
    setInterval(function() {
      _loadData();
    }, 10000);
    // 每 30 秒刷新一下积分显示（防止管理员审核通过后用户端不同步）
    setInterval(function() {
      if (_currentUser) _refreshPointsDisplay(true);
    }, 30000);
    // 每 60 秒拉取一次通知，更新铃铛未读数
    setInterval(function() {
      if (_currentUser) _loadNotifications();
    }, 60000);
  };

  // ========= 积分相关 =========
  var _currentPoints = 0;
  var _pendingPaymentVoucher = null;  // 当前打开支付弹窗的凭证
  var _pointsOffsetUsed = false;      // 该笔是否已用积分抵消

  var _currentFrozen = false;

  var _refreshPointsDisplay = function(forceCloud) {
    if (!_currentUser) return;
    var el = document.getElementById("pointsTotal");
    if (!el) return;
    return JITPoints.getUserPoints(_currentUser, !!forceCloud).then(function(d) {
      _currentPoints = d ? (d.points || 0) : 0;
      _currentFrozen = !!(d && d.frozen);
      el.textContent = _currentPoints;
      // 冻结状态提示
      el.style.color = _currentFrozen ? "#2196f3" : "";
      el.title = _currentFrozen ? "积分账户已冻结" : "";
      // 同步更新幸运抽奖条上的积分显示
      var luckyEl = document.getElementById("luckyCurrentPoints");
      if (luckyEl) luckyEl.textContent = String(_currentPoints);
      var offsetEl = document.getElementById("offsetCurrentPoints");
      if (offsetEl) offsetEl.textContent = String(_currentPoints);
      return d;
    }).catch(function() {
      return null;
    });
  };

  var _openPointsHistory = function() {
    if (!_currentUser) return;
    var overlay = document.getElementById("pointsHistoryOverlay");
    if (!overlay) return;
    overlay.classList.add("active");
    var listEl = document.getElementById("pointsHistoryList");
    var totalEl = document.getElementById("historyTotalPoints");
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">加载中...</div>';
    JITPoints.getUserPoints(_currentUser, true).then(function(d) {
      var total = d ? (d.points || 0) : 0;
      _currentPoints = total;
      if (totalEl) totalEl.textContent = String(total);
      var ptsEl = document.getElementById("pointsTotal");
      if (ptsEl) ptsEl.textContent = String(total);
      var logs = (d && d.logs) ? d.logs : [];
      if (!listEl) return;
      if (logs.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">暂无积分记录<br><br>添加一个凭证即可获得 <b style="color:var(--gold);">15 积分</b>！</div>';
        return;
      }
      var html = "";
      logs.forEach(function(log) {
        var cls = log.delta >= 0 ? "points-plus" : "points-minus";
        var sign = log.delta >= 0 ? "+" : "";
        var color = log.delta >= 0 ? "var(--green)" : "var(--red)";
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px dashed rgba(255,255,255,0.05);'
                + 'gap:8px;">';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="color:var(--text-primary);font-weight:500;">' + _escapeHtml(log.reason || "—") + '</div>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + _escapeHtml(log.time || "") + '</div>';
        html += '</div>';
        html += '<div style="font-weight:700;color:' + color + ';font-size:15px;flex-shrink:0;">' + sign + log.delta + '</div>';
        html += '</div>';
      });
      listEl.innerHTML = html;
    }).catch(function(err) {
      if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);">加载失败: ' + _escapeHtml(err.message || "") + '</div>';
    });
  };

  var _closePointsHistory = function() {
    var overlay = document.getElementById("pointsHistoryOverlay");
    if (overlay) overlay.classList.remove("active");
  };

  var _initBackgroundParticles = function() {
    var container = document.getElementById("bgParticles");
    if (!container) return;
    for (var i = 0; i < 30; i++) {
      var particle = document.createElement("div");
      particle.className = "particle";
      var size = Math.random() * 3 + 1;
      particle.style.width = size + "px";
      particle.style.height = size + "px";
      particle.style.left = Math.random() * 100 + "%";
      particle.style.bottom = -(Math.random() * 100) + "px";
      particle.style.animationDuration = (Math.random() * 15 + 10) + "s";
      particle.style.animationDelay = Math.random() * 10 + "s";
      container.appendChild(particle);
    }
  };

  // 启动时：从云端同步黑名单（GitHub Issue label=blacklist）
  // 和管理员后台写入的同一条 Issue，保持多端一致
  var _syncBlacklistFromCloud = function() {
    try {
      if (typeof JITApi === "undefined" || !JITApi.getLabels) return;
      var TOKEN = JITConfig.getTokenPart1() + JITConfig.getTokenPart3() + JITConfig.getTokenPart4();
      var BASE = JITConfig.getApiBase();
      var REPO = JITConfig.getRepoFull();
      var lb = JITConfig.getBlacklistLabel();
      fetch(BASE + "/repos/" + REPO + "/issues?state=open&labels=" + encodeURIComponent(lb) + "&per_page=10", {
        headers: { Authorization: "token " + TOKEN, Accept: "application/vnd.github.v3+json" }
      }).then(function(r) {
        if (!r.ok) return null;
        return r.json();
      }).then(function(issues) {
        if (!issues || !issues.length) return;
        var body = issues[0].body || "";
        var lines = String(body).split(/\r?\n/);
        var out = {};
        var cur = null;
        lines.forEach(function(line) {
          var t = line.trim();
          var m;
          if ((m = t.match(/^｜?\s*用户名：(.+)$/))) { cur = m[1].trim(); if (!out[cur]) out[cur] = {}; }
          else if (cur && (m = t.match(/^｜?\s*原因：(.+)$/))) { out[cur].reason = m[1].trim(); }
          else if (cur && (m = t.match(/^｜?\s*时间：(.+)$/))) { out[cur].time = m[1].trim(); }
        });
        var localMap = JITConfig.getDynamicBlacklist ? JITConfig.getDynamicBlacklist() : {};
        var merged = {};
        Object.keys(out).forEach(function(u) { merged[u] = out[u]; });
        Object.keys(localMap).forEach(function(u) { merged[u] = localMap[u]; });
        if (JITConfig.setDynamicBlacklist) {
          JITConfig.setDynamicBlacklist(merged);
        }
        // 同步完再检查一次当前登录用户是否被封
        if (_currentUser && JITConfig.isBlacklisted(_currentUser)) {
          localStorage.removeItem("jit_current_user");
          _currentUser = null;
          _showToast("该账户已被管理员列入黑名单，禁止登录", "error");
          _showLoginPrompt();
        }
      }).catch(function() { /* 静默失败，使用本地黑名单即可 */ });
    } catch (e) {}
  };

  var _initLogin = function() {
    // 处理邀请链接 ?ref=USERNAME
    try {
      var params = new URLSearchParams(window.location.search);
      var ref = params.get("ref");
      if (ref) {
        ref = decodeURIComponent(ref);
        localStorage.setItem("jit_referrer", ref);
        // 清除URL中的ref参数，避免重复
        var cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } catch (e) {}

    var savedUser = localStorage.getItem("jit_current_user");
    if (savedUser) {
      // 黑名单/白名单检查（防止被封禁用户自动登录绕过）
      if (JITConfig.isBlacklisted(savedUser)) {
        localStorage.removeItem("jit_current_user");
        _showToast("该账户已被列入黑名单，禁止登录", "error");
        _showLoginPrompt();
        return;
      }
      if (JITConfig.isWhitelistEnabled() && !JITConfig.isWhitelisted(savedUser)) {
        localStorage.removeItem("jit_current_user");
        _showToast("当前为白名单模式，您的账户未在白名单中", "error");
        _showLoginPrompt();
        return;
      }
      _currentUser = savedUser;
      _updateLogoutText();
      var savedChat = localStorage.getItem("jit_chat_issue_" + savedUser);
      if (savedChat) _chatIssueNumber = parseInt(savedChat, 10);
      _refreshPointsDisplay();
      _loadNotifications();
      return;
    }
    _showLoginPrompt();
  };

  var _showLoginPrompt = function() {
    var referrer = localStorage.getItem("jit_referrer") || "";
    var referrerHint = referrer ? '<div style="text-align:center;color:var(--accent);font-size:13px;margin-bottom:8px;">邀请人：' + _escapeHtml(referrer) + '</div>' : '';
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.cssText = "opacity:1;visibility:visible;z-index:2000;";
    overlay.innerHTML = '<div class="modal-container" style="max-width:380px;transform:translateY(0);">' +
      '<div class="modal-header"><h3 class="modal-title">登录玉国金融</h3></div>' +
      '<div class="modal-body">' +
      referrerHint +
      '<div class="form-group"><label class="form-label">用户名</label>' +
      '<input type="text" class="form-input" id="loginUsername" placeholder="请输入用户名"></div>' +
      '<div class="form-group"><label class="form-label">密码</label>' +
      '<input type="password" class="form-input" id="loginPassword" placeholder="请输入密码"></div>' +
      '<div class="form-error" id="loginError" style="display:none;"></div>' +
      '</div>' +
      '<div class="modal-footer" style="flex-direction:column;gap:12px;">' +
      '<button class="btn-submit" id="btnLogin" style="width:100%;">登 录</button>' +
      '<div style="text-align:center;font-size:13px;">还没有账号？<a href="javascript:void(0)" id="linkRegister" style="color:var(--accent);text-decoration:underline;">点击注册</a></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById("btnLogin").addEventListener("click", function() {
      var username = document.getElementById("loginUsername").value.trim();
      var password = document.getElementById("loginPassword").value.trim();
      var errorEl = document.getElementById("loginError");
      var users = JITConfig.getUsers();

      if (!username || !password) {
        errorEl.style.display = "block";
        errorEl.textContent = "请输入用户名和密码";
        return;
      }

      // 黑名单检查
      if (JITConfig.isBlacklisted(username)) {
        errorEl.style.display = "block";
        errorEl.textContent = "该账户已被列入黑名单，禁止登录。如有疑问请联系管理员。";
        return;
      }
      // 白名单模式检查
      if (JITConfig.isWhitelistEnabled() && !JITConfig.isWhitelisted(username)) {
        errorEl.style.display = "block";
        errorEl.textContent = "当前为白名单模式，您的账户未在白名单中，暂时无法登录。";
        return;
      }

      // 先检查内置用户
      if (users[username] && users[username] === password) {
        _currentUser = username;
        localStorage.setItem("jit_current_user", username);
        _updateLogoutText();
        overlay.remove();
        _showToast("登录成功，欢迎 " + username, "success");
        _loadData();
        _refreshPointsDisplay();
        _loadNotifications();
      } else {
        // 再检查注册用户
        errorEl.style.display = "none";
        var btn = document.getElementById("btnLogin");
        btn.disabled = true;
        btn.textContent = "验证中...";
        JITApi.verifyRegisteredUser(username, password).then(function(result) {
          if (result) {
            _currentUser = username;
            localStorage.setItem("jit_current_user", username);
            _updateLogoutText();
            overlay.remove();
            _showToast("登录成功，欢迎 " + username, "success");
            _loadData();
            _refreshPointsDisplay();
            _loadNotifications();
          } else {
            // 检查是否有待审核的注册申请
            return JITApi.findPendingRegistration(username).then(function(pending) {
              if (pending) {
                errorEl.style.display = "block";
                errorEl.textContent = "您的注册申请正在审核中，请耐心等待管理员通过";
              } else {
                errorEl.style.display = "block";
                errorEl.textContent = "用户名或密码错误";
              }
            });
          }
        }).catch(function(err) {
          errorEl.style.display = "block";
          errorEl.textContent = "登录失败: " + err.message;
        }).finally(function() {
          btn.disabled = false;
          btn.textContent = "登 录";
        });
      }
    });

    document.getElementById("loginPassword").addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        document.getElementById("btnLogin").click();
      }
    });

    document.getElementById("linkRegister").addEventListener("click", function() {
      overlay.remove();
      _showRegisterPrompt();
    });
  };

  // ======= 内置常用国家/省份/城市（避免外网API返回对象导致 [object Object]） =======
  var _REGION_DATA = {
    "中国": {
      "北京市": ["东城区","西城区","朝阳区","海淀区","丰台区","石景山区","通州区","昌平区"],
      "上海市": ["黄浦区","徐汇区","长宁区","静安区","普陀区","虹口区","杨浦区","浦东新区"],
      "广东省": ["广州市","深圳市","珠海市","佛山市","东莞市","中山市","惠州市","汕头市"],
      "浙江省": ["杭州市","宁波市","温州市","嘉兴市","湖州市","绍兴市","金华市","台州市"],
      "江苏省": ["南京市","苏州市","无锡市","常州市","镇江市","南通市","扬州市","徐州市"],
      "山东省": ["济南市","青岛市","烟台市","潍坊市","济宁市","临沂市","淄博市","威海市"],
      "四川省": ["成都市","绵阳市","德阳市","宜宾市","南充市","乐山市","泸州市","自贡市"],
      "湖北省": ["武汉市","宜昌市","襄阳市","荆州市","黄冈市","孝感市","十堰市","黄石市"],
      "湖南省": ["长沙市","株洲市","湘潭市","衡阳市","岳阳市","常德市","郴州市","益阳市"],
      "福建省": ["福州市","厦门市","泉州市","漳州市","莆田市","宁德市","龙岩市","南平市"],
      "河南省": ["郑州市","洛阳市","开封市","新乡市","焦作市","安阳市","南阳市","许昌市"],
      "陕西省": ["西安市","咸阳市","宝鸡市","渭南市","延安市","榆林市","汉中市","安康市"],
      "辽宁省": ["沈阳市","大连市","鞍山市","抚顺市","本溪市","丹东市","锦州市","营口市"],
      "重庆市": ["渝中区","江北区","南岸区","九龙坡区","沙坪坝区","渝北区","巴南区","大渡口区"],
      "天津市": ["和平区","河东区","河西区","南开区","河北区","红桥区","东丽区","西青区"],
      "其他省市": ["其他区县"]
    },
    "美国": {
      "California": ["Los Angeles","San Francisco","San Diego","San Jose","Sacramento"],
      "New York": ["New York City","Buffalo","Rochester","Albany","Syracuse"],
      "Texas": ["Houston","Dallas","Austin","San Antonio","Fort Worth"],
      "Florida": ["Miami","Orlando","Tampa","Jacksonville","Fort Lauderdale"],
      "Washington": ["Seattle","Tacoma","Spokane","Bellevue","Vancouver"],
      "Illinois": ["Chicago","Aurora","Naperville","Springfield","Rockford"],
      "Other States": ["Other Cities"]
    },
    "日本": {
      "東京都": ["新宿区","渋谷区","港区","千代田区","中央区","豊島区"],
      "大阪府": ["大阪市","堺市","豊中市","吹田市","枚方市"],
      "神奈川県": ["横浜市","川崎市","相模原市","横須賀市"],
      "北海道": ["札幌市","函館市","旭川市","釧路市"],
      "福岡県": ["福岡市","北九州市","久留米市"],
      "Other": ["Other Cities"]
    },
    "韩国": {
      "首尔特别市": ["江南区","江北区","城东区","钟路区","中区"],
      "釜山广域市": ["海云台区","中区","南区","北区"],
      "仁川广域市": ["中区","南区","北区","西区"],
      "Other": ["Other Cities"]
    },
    "新加坡": {"新加坡": ["中央区","东区","西区","北区","东北区"]},
    "马来西亚": {"Kuala Lumpur": ["Kuala Lumpur","Putrajaya","Selangor","Penang","Johor"]},
    "泰国": {"主要城市": ["Bangkok","Chiang Mai","Phuket","Pattaya","Hua Hin"]},
    "英国": {
      "England": ["London","Manchester","Birmingham","Liverpool","Leeds"],
      "Scotland": ["Edinburgh","Glasgow","Aberdeen"],
      "Other": ["Other Cities"]
    },
    "法国": {"主要城市": ["Paris","Marseille","Lyon","Toulouse","Nice"]},
    "德国": {
      "Bayern": ["München","Nürnberg","Augsburg"],
      "Nordrhein-Westfalen": ["Köln","Düsseldorf","Dortmund","Essen"],
      "Berlin": ["Berlin"]
    },
    "加拿大": {
      "Ontario": ["Toronto","Ottawa","Mississauga"],
      "British Columbia": ["Vancouver","Victoria","Burnaby"],
      "Quebec": ["Montreal","Quebec City"]
    },
    "澳大利亚": {
      "New South Wales": ["Sydney","Newcastle","Wollongong"],
      "Victoria": ["Melbourne","Geelong"],
      "Queensland": ["Brisbane","Gold Coast","Cairns"]
    },
    "中国香港": {"香港": ["香港岛","九龙","新界","离岛"]},
    "中国澳门": {"澳门": ["澳门半岛","氹仔","路环"]},
    "中国台湾": {"台湾省": ["台北市","新北市","高雄市","台中市","台南市"]},
    "越南": {"主要城市": ["Hanoi","Ho Chi Minh City","Da Nang","Hai Phong"]},
    "印度尼西亚": {"主要城市": ["Jakarta","Surabaya","Bandung","Medan"]},
    "菲律宾": {"主要城市": ["Manila","Cebu","Davao","Quezon City"]},
    "印度": {"主要城市": ["Mumbai","Delhi","Bangalore","Chennai","Kolkata"]},
    "俄罗斯": {"主要城市": ["Moscow","Saint Petersburg","Novosibirsk","Yekaterinburg"]},
    "阿联酋": {"主要城市": ["Dubai","Abu Dhabi","Sharjah"]},
    "沙特阿拉伯": {"主要城市": ["Riyadh","Jeddah","Mecca","Medina"]},
    "其他国家": {"其他地区": ["其他城市"]}
  };

  // ======= 滑块人机验证状态 =======
  var _sliderVerified = false;

  var _initSliderCaptcha = function() {
    var track = document.getElementById("sliderTrack");
    var knob = document.getElementById("sliderKnob");
    var filled = document.getElementById("sliderBgFilled");
    var unfilled = document.getElementById("sliderBgUnfilled");
    var text = document.getElementById("sliderText");
    if (!track || !knob) return;

    _sliderVerified = false;
    track.classList.remove("slider-pass", "slider-fail");
    text.textContent = "→ 按住滑块拖到最右侧 →";
    knob.style.left = "0px";
    filled.style.width = "0px";

    var dragging = false;
    var startTime = 0;
    var trajectory = []; // 记录轨迹 [x, y, t]
    var maxX = 0;

    var onStart = function(e) {
      if (_sliderVerified) return;
      dragging = true;
      startTime = Date.now();
      trajectory = [];
      track.classList.add("dragging");
      onMove(e);
    };
    var onMove = function(e) {
      if (!dragging) return;
      var rect = track.getBoundingClientRect();
      var knobW = knob.offsetWidth;
      var clientX = (e.touches && e.touches.length) ? e.touches[0].clientX : e.clientX;
      var clientY = (e.touches && e.touches.length) ? e.touches[0].clientY : e.clientY;
      var x = clientX - rect.left - knobW / 2;
      if (x < 0) x = 0;
      maxX = rect.width - knobW;
      if (x > maxX) x = maxX;
      knob.style.left = x + "px";
      filled.style.width = x + "px";
      if (x > 10 && text.style.opacity !== "0") text.style.opacity = "0";
      trajectory.push([x, clientY - rect.top, Date.now() - startTime]);
      if (e.cancelable) e.preventDefault();
    };
    var onEnd = function() {
      if (!dragging) return;
      dragging = false;
      track.classList.remove("dragging");
      var rect = track.getBoundingClientRect();
      var knobW = knob.offsetWidth;
      maxX = rect.width - knobW;
      var curX = parseFloat(knob.style.left) || 0;
      var tolerance = 2; // 允许2px误差
      var distanceToEnd = maxX - curX;

      // === 人机检测逻辑（能清楚辨别人类 vs 机器人）===
      var pass = true;
      var failReason = "";

      // 1) 必须拖到终点（容忍2px）
      if (distanceToEnd > tolerance) {
        pass = false; failReason = "未拖到终点";
      }
      // 2) 总耗时检测：人类不可能 <150ms 完成（排除代码瞬间设置）
      var totalMs = Date.now() - startTime;
      if (totalMs < 150) {
        pass = false; failReason = "操作过快";
      }
      // 3) 总耗时也不能太慢（>10秒可能异常，不过先放宽松）
      // 4) 轨迹点数不能太少（说明是瞬移，典型脚本行为）
      if (trajectory.length < 5) {
        pass = false; failReason = "轨迹点不足";
      }
      // 5) 轨迹必须有抖动/非匀速（机器通常匀速或瞬移）
      // 计算相邻点dx的方差
      if (trajectory.length >= 5) {
        var dxs = [];
        for (var i = 1; i < trajectory.length; i++) {
          dxs.push(trajectory[i][0] - trajectory[i - 1][0]);
        }
        var meanDx = dxs.reduce(function(s, v) { return s + v; }, 0) / dxs.length;
        var varDx = dxs.reduce(function(s, v) { return s + (v - meanDx) * (v - meanDx); }, 0) / dxs.length;
        // 人类速度变化大、dx 方差大；匀速拖动机器方差非常小
        if (meanDx > 0 && varDx / (meanDx * meanDx + 1) < 0.05) {
          pass = false; failReason = "移动过于平稳";
        }
        // 6) 不能一直严格递增（人类会有轻微回拉/停顿）
        var backCount = dxs.filter(function(d) { return d < 0; }).length;
        var pauseCount = dxs.filter(function(d) { return d === 0; }).length;
        if (backCount === 0 && pauseCount <= 1 && trajectory.length > 15) {
          // 没有任何回拉或停顿 → 高可疑机器，降低一点置信但不直接fail，配合方差使用
        }
      }
      // 7) Y 轴必须有轻微抖动（人类拖动不可能完全平）
      if (trajectory.length >= 5) {
        var ys = trajectory.map(function(t) { return t[1]; });
        var yMax = Math.max.apply(null, ys);
        var yMin = Math.min.apply(null, ys);
        if (yMax - yMin < 1) {
          pass = false; failReason = "Y轴无波动";
        }
      }

      if (pass) {
        _sliderVerified = true;
        track.classList.add("slider-pass");
        text.textContent = "✓ 验证通过";
        text.style.opacity = "1";
        knob.innerHTML = '<svg class="slider-knob-icon" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      } else {
        // 失败：弹回 + 重置
        track.classList.add("slider-fail");
        text.style.opacity = "1";
        text.textContent = "✗ 未通过，请再试一次（" + failReason + "）";
        var knob_ = knob; var filled_ = filled; var track_ = track;
        setTimeout(function() {
          knob_.style.left = "0px";
          filled_.style.width = "0px";
          text.style.opacity = "1";
          text.textContent = "→ 按住滑块拖到最右侧 →";
          track_.classList.remove("slider-fail");
          knob_.innerHTML = '<svg class="slider-knob-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
        }, 500);
      }
    };

    knob.addEventListener("mousedown", onStart);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    knob.addEventListener("touchstart", onStart, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
  };

  // ======= 注册功能（申请-审核制） =======

  var _showRegisterPrompt = function() {
    _sliderVerified = false;
    var referrer = localStorage.getItem("jit_referrer") || "";
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.cssText = "opacity:1;visibility:visible;z-index:2000;overflow-y:auto;";
    overlay.innerHTML = '<div class="modal-container" style="max-width:440px;transform:translateY(0);">' +
      '<div class="modal-header"><h3 class="modal-title">注册申请</h3></div>' +
      '<div class="modal-body">' +
      '<div class="form-group"><label class="form-label">姓名 <span class="required">*</span></label>' +
      '<input type="text" class="form-input" id="regFullName" placeholder="请输入真实姓名"></div>' +
      '<div class="form-group"><label class="form-label">出生日期 <span class="required">*</span></label>' +
      '<input type="date" class="form-input" id="regBirthdate"></div>' +
      '<div class="form-group"><label class="form-label">用户名 <span class="required">*</span></label>' +
      '<input type="text" class="form-input" id="regUsername" placeholder="2-20个字符，用于登录"></div>' +
      '<div class="form-group"><label class="form-label">密码 <span class="required">*</span></label>' +
      '<input type="password" class="form-input" id="regPassword" placeholder="至少6位"></div>' +
      '<div class="form-group"><label class="form-label">确认密码 <span class="required">*</span></label>' +
      '<input type="password" class="form-input" id="regPassword2" placeholder="请再次输入密码"></div>' +
      '<div class="form-group"><label class="form-label">国家 <span class="required">*</span></label>' +
      '<select class="form-input" id="regCountry"><option value="">请选择国家</option></select></div>' +
      '<div class="form-group"><label class="form-label">省份 <span class="required">*</span></label>' +
      '<select class="form-input" id="regProvince" disabled><option value="">请先选择国家</option></select></div>' +
      '<div class="form-group"><label class="form-label">城市 <span class="required">*</span></label>' +
      '<select class="form-input" id="regCity" disabled><option value="">请先选择省份</option></select></div>' +
      (referrer ? '<div class="form-group"><label class="form-label">邀请人</label><input type="text" class="form-input" id="regReferrer" value="' + _escapeHtml(referrer) + '" readonly style="background:rgba(255,255,255,0.05);"></div>' : '<div class="form-group"><label class="form-label">邀请人（选填）</label><input type="text" class="form-input" id="regReferrer" placeholder="输入邀请人用户名"></div>') +
      '<div class="form-group"><label class="form-label">人机验证 <span class="required">*</span></label>' +
      '<div class="slider-captcha" id="sliderCaptcha">' +
      '  <div class="slider-track" id="sliderTrack">' +
      '    <div class="slider-bg-unfilled" id="sliderBgUnfilled"></div>' +
      '    <div class="slider-bg-filled" id="sliderBgFilled"></div>' +
      '    <span class="slider-text" id="sliderText">→ 按住滑块拖到最右侧 →</span>' +
      '    <div class="slider-knob" id="sliderKnob">' +
      '      <svg class="slider-knob-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
      '    </div>' +
      '  </div>' +
      '</div></div>' +
      '<div class="form-error" id="regError" style="display:none;"></div>' +
      '<div style="text-align:center;font-size:12px;color:var(--text-secondary);margin-top:8px;">提交后需等待管理员审核通过方可登录</div>' +
      '</div>' +
      '<div class="modal-footer" style="flex-direction:column;gap:12px;">' +
      '<button class="btn-submit" id="btnRegister" style="width:100%;">提交注册申请</button>' +
      '<button class="btn-submit" id="btnBackLogin" style="width:100%;background:transparent;color:var(--text-secondary);border:1px solid var(--text-secondary);">返回登录</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // ======= 国家/省份/城市级联（内置数据）=======
    var countrySel = document.getElementById("regCountry");
    var provinceSel = document.getElementById("regProvince");
    var citySel = document.getElementById("regCity");
    Object.keys(_REGION_DATA).forEach(function(c) {
      var opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      countrySel.appendChild(opt);
    });
    if (_REGION_DATA["中国"]) {
      countrySel.value = "中国";
      var evt = document.createEvent("HTMLEvents");
      evt.initEvent("change", false, true);
      countrySel.dispatchEvent(evt);
    }
    countrySel.addEventListener("change", function() {
      var country = this.value;
      provinceSel.innerHTML = '<option value="">请选择省份</option>';
      citySel.innerHTML = '<option value="">请先选择省份</option>';
      citySel.disabled = true;
      if (!country || !_REGION_DATA[country]) { provinceSel.disabled = true; return; }
      Object.keys(_REGION_DATA[country]).forEach(function(p) {
        var opt = document.createElement("option");
        opt.value = p; opt.textContent = p;
        provinceSel.appendChild(opt);
      });
      provinceSel.disabled = false;
    });
    provinceSel.addEventListener("change", function() {
      var country = countrySel.value;
      var province = this.value;
      citySel.innerHTML = '<option value="">请选择城市</option>';
      if (!country || !province || !_REGION_DATA[country] || !_REGION_DATA[country][province]) { citySel.disabled = true; return; }
      _REGION_DATA[country][province].forEach(function(c) {
        var opt = document.createElement("option");
        opt.value = c; opt.textContent = c;
        citySel.appendChild(opt);
      });
      citySel.disabled = false;
    });

    // ======= 初始化滑块人机验证 =======
    _initSliderCaptcha();

    document.getElementById("btnBackLogin").addEventListener("click", function() {
      overlay.remove();
      _showLoginPrompt();
    });

    document.getElementById("btnRegister").addEventListener("click", function() {
      var fullName = document.getElementById("regFullName").value.trim();
      var birthdate = document.getElementById("regBirthdate").value;
      var username = document.getElementById("regUsername").value.trim();
      var password = document.getElementById("regPassword").value.trim();
      var password2 = document.getElementById("regPassword2").value.trim();
      var country = document.getElementById("regCountry").value;
      var province = document.getElementById("regProvince").value;
      var city = document.getElementById("regCity").value;
      var referrerInput = document.getElementById("regReferrer");
      var referrerVal = referrerInput ? referrerInput.value.trim() : "";
      var errorEl = document.getElementById("regError");

      if (!fullName) { errorEl.style.display = "block"; errorEl.textContent = "请输入姓名"; return; }
      if (!birthdate) { errorEl.style.display = "block"; errorEl.textContent = "请选择出生日期"; return; }
      if (!username || username.length < 2 || username.length > 20) { errorEl.style.display = "block"; errorEl.textContent = "用户名需2-20个字符"; return; }
      if (!password || password.length < 6) { errorEl.style.display = "block"; errorEl.textContent = "密码至少6位"; return; }
      if (password !== password2) { errorEl.style.display = "block"; errorEl.textContent = "两次密码不一致"; return; }
      if (!country) { errorEl.style.display = "block"; errorEl.textContent = "请选择国家"; return; }
      if (!province) { errorEl.style.display = "block"; errorEl.textContent = "请选择省份"; return; }
      if (!city) { errorEl.style.display = "block"; errorEl.textContent = "请选择城市"; return; }
      if (!_sliderVerified) { errorEl.style.display = "block"; errorEl.textContent = "请完成人机验证（拖动滑块到最右侧）"; return; }

      var btn = document.getElementById("btnRegister");
      btn.disabled = true;
      btn.textContent = "提交中...";

      var regData = {
        username: username,
        password: password,
        fullName: fullName,
        birthdate: birthdate,
        country: country,
        province: province,
        city: city,
        referrer: referrerVal
      };

      JITApi.registerUser(regData).then(function() {
        // 清除邀请人缓存
        localStorage.removeItem("jit_referrer");
        // 显示成功提示弹窗
        overlay.innerHTML = '<div class="modal-container" style="max-width:380px;transform:translateY(0);">' +
          '<div class="modal-body" style="padding:40px 24px;text-align:center;">' +
          '<div style="font-size:48px;margin-bottom:16px;">✓</div>' +
          '<h3 style="font-size:18px;margin-bottom:8px;">已提交信息，等待管理员审核</h3>' +
          '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;">您的注册申请已成功提交，管理员审核通过后即可登录使用。</p>' +
          '</div>' +
          '<div class="modal-footer" style="justify-content:center;">' +
          '<button class="btn-submit" id="btnRegSuccessClose" style="width:100%;">知道了</button></div>' +
          '</div>';
        document.getElementById("btnRegSuccessClose").addEventListener("click", function() {
          overlay.remove();
          _showLoginPrompt();
        });
      }).catch(function(err) {
        errorEl.style.display = "block";
        errorEl.textContent = err.message || "提交失败";
        // 失败后重置滑块，强制重新验证一次
        _sliderVerified = false;
        _initSliderCaptcha();
      }).finally(function() {
        btn.disabled = false;
        btn.textContent = "提交注册申请";
      });
    });
  };

  // ======= 邀请好友 =======
  var _showInviteModal = function() {
    if (!_currentUser) {
      _showToast("请先登录", "error");
      _showLoginPrompt();
      return;
    }
    var baseUrl = window.location.origin + window.location.pathname;
    var inviteLink = baseUrl + "?ref=" + encodeURIComponent(_currentUser);
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.cssText = "opacity:1;visibility:visible;z-index:2000;";
    overlay.innerHTML = '<div class="modal-container" style="max-width:420px;transform:translateY(0);">' +
      '<div class="modal-header"><h3 class="modal-title">邀请好友得积分</h3><button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">&times;</button></div>' +
      '<div class="modal-body">' +
      '<div style="text-align:center;margin-bottom:16px;">' +
      '<div style="font-size:36px;font-weight:bold;color:var(--accent);">+' + JITPoints.RULES.INVITE_REWARD + '</div>' +
      '<div style="font-size:13px;color:var(--text-secondary);">好友注册成功，双方各得' + JITPoints.RULES.INVITE_REWARD + '积分</div>' +
      '</div>' +
      '<div class="form-group"><label class="form-label">我的专属邀请链接</label>' +
      '<div style="display:flex;gap:8px;"><input type="text" class="form-input" id="inviteLinkInput" value="' + _escapeHtml(inviteLink) + '" readonly style="flex:1;">' +
      '<button class="btn-submit" id="btnCopyInvite" style="flex-shrink:0;padding:0 16px;">复制</button></div></div>' +
      '<div class="form-group"><label class="form-label">已邀请好友</label>' +
      '<div id="referralList" style="min-height:40px;"><div style="text-align:center;color:var(--text-secondary);font-size:13px;">加载中...</div></div></div>' +
      '</div>' +
      '<div class="modal-footer" style="justify-content:center;">' +
      '<button class="btn-submit" id="btnInviteClose" style="background:transparent;color:var(--text-secondary);border:1px solid var(--text-secondary);">关 闭</button></div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById("btnInviteClose").addEventListener("click", function() { overlay.remove(); });
    document.getElementById("btnCopyInvite").addEventListener("click", function() {
      var input = document.getElementById("inviteLinkInput");
      input.select();
      try {
        document.execCommand("copy");
        _showToast("邀请链接已复制！", "success");
      } catch (e) {
        _showToast("复制失败，请手动复制", "error");
      }
    });

    // 加载邀请列表
    JITApi.getReferrals(_currentUser).then(function(referrals) {
      var listEl = document.getElementById("referralList");
      if (!referrals || referrals.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;">暂无邀请记录，快去邀请好友吧！</div>';
      } else {
        var html = '<div style="display:flex;flex-direction:column;gap:6px;">';
        referrals.forEach(function(r) {
          html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(255,255,255,0.05);border-radius:6px;">' +
            '<span style="font-size:14px;">' + _escapeHtml(r.username) + '</span>' +
            '<span style="font-size:12px;color:var(--text-secondary);">' + (r.registerTime || "") + '</span></div>';
        });
        html += '</div>';
        listEl.innerHTML = html;
      }
    }).catch(function() {
      document.getElementById("referralList").innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;">加载失败</div>';
    });
  };

  // ======= 积分转盘抽奖 =======
  var _openWheelModal = function() {
    if (!_currentUser) {
      _showToast("请先登录", "error");
      _showLoginPrompt();
      return;
    }
    var overlay = document.getElementById("wheelOverlay");
    if (!overlay) return;
    overlay.classList.add("active");

    // 初始化转盘
    if (JITWheel && JITWheel.init) {
      setTimeout(function() {
        JITWheel.init("wheelCanvas");
        _updateWheelUI();
      }, 200);
    }
  };

  var _closeWheelModal = function() {
    var overlay = document.getElementById("wheelOverlay");
    if (overlay) overlay.classList.remove("active");
    if (JITWheel && JITWheel.reset) JITWheel.reset();
  };

  var _updateWheelUI = function() {
    if (!_currentUser) return;
    var freeBadge = document.getElementById("wheelFreeBadge");
    var freeCountEl = document.getElementById("wheelFreeCount");
    var isFree = JITWheel && JITWheel.checkFreeSpin && JITWheel.checkFreeSpin(_currentUser);
    if (freeBadge) {
      freeBadge.style.display = isFree ? "inline-block" : "none";
    }
    if (freeCountEl) {
      freeCountEl.textContent = isFree ? "今日还有 1 次免费抽奖机会 🎁" : "今日免费已用，每次消耗 10 积分";
    }
  };

  var _doWheelSpin = function() {
    if (!_currentUser) {
      _showToast("请先登录", "error");
      return;
    }
    if (JITWheel && JITWheel.isSpinning && JITWheel.isSpinning()) {
      _showToast("转盘正在旋转中，请稍候...", "");
      return;
    }

    var isFree = JITWheel && JITWheel.checkFreeSpin && JITWheel.checkFreeSpin(_currentUser);
    var cost = JITWheel.getCost ? JITWheel.getCost() : 10;

    // 如果不是免费，检查积分够不够
    if (!isFree) {
      if (_currentPoints < cost) {
        _showToast("积分不足！需要 " + cost + " 积分，当前 " + _currentPoints + " 分。添加凭证可赚积分~", "error");
        return;
      }
    }

    // 冻结检查
    if (_currentFrozen) {
      _showToast("积分账户已冻结，无法参与抽奖", "error");
      return;
    }

    var btn = document.getElementById("btnWheelSpin");
    var spinText = document.getElementById("wheelSpinText");
    if (btn) btn.disabled = true;
    if (spinText) spinText.textContent = "旋转中...";

    // 开始转盘动画
    JITWheel.spin(function(prize) {
      // 转盘停止后的回调
      if (!prize) {
        if (btn) btn.disabled = false;
        if (spinText) spinText.textContent = "🎯 开始抽奖";
        return;
      }

      var delta = prize.delta || 0;
      // 扣除/增加积分
      var ptsPromise;
      if (isFree) {
        // 免费抽奖：不扣积分，只加积分（如果是正的话）
        if (delta >= 0) {
          ptsPromise = JITPoints.changePoints(_currentUser, delta, "转盘抽奖免费获得 " + delta + " 积分");
        } else {
          ptsPromise = Promise.resolve();
        }
        JITWheel.markFreeSpinUsed(_currentUser);
      } else {
        // 付费抽奖：先扣10分，再加/减结果
        if (delta >= 0) {
          ptsPromise = JITPoints.changePoints(_currentUser, delta - cost, "转盘抽奖：消耗" + cost + "积分，获得+" + delta + "积分");
        } else {
          ptsPromise = JITPoints.changePoints(_currentUser, delta - cost, "转盘抽奖：消耗" + cost + "积分，结果" + delta + "积分");
        }
      }

      ptsPromise.then(function() {
        _refreshPointsDisplay(true);
        _updateWheelUI();
        if (btn) btn.disabled = false;
        if (spinText) spinText.textContent = "🎯 开始抽奖";
      }).catch(function(err) {
        _showToast("积分更新失败: " + (err.message || ""), "error");
        if (btn) btn.disabled = false;
        if (spinText) spinText.textContent = "🎯 开始抽奖";
      });
    });
  };

  var _updateLogoutText = function() {
    var el = document.getElementById("logoutUserText");
    if (el && _currentUser) {
      el.textContent = _currentUser + " 退出";
    }
  };

  var _bindEvents = function() {
    var btnAddVoucher = document.getElementById("btnAddVoucher");
    if (btnAddVoucher) {
      btnAddVoucher.addEventListener("click", _openAddVoucherModal);
    }
    var moduleAddVoucher = document.getElementById("moduleAddVoucher");
    if (moduleAddVoucher) {
      moduleAddVoucher.querySelector(".module-btn").addEventListener("click", _openAddVoucherModal);
    }

    var btnWriteVoucher = document.getElementById("btnWriteVoucher");
    if (btnWriteVoucher) {
      btnWriteVoucher.addEventListener("click", function() {
        _showToast("编写凭证功能开发中", "");
      });
    }

    var btnCustomerService = document.getElementById("btnCustomerService");
    if (btnCustomerService) {
      btnCustomerService.addEventListener("click", _openChatModal);
    }

    var btnAddOnlineVoucher = document.getElementById("btnAddOnlineVoucher");
    if (btnAddOnlineVoucher) {
      btnAddOnlineVoucher.addEventListener("click", _openAddOnlineVoucherModal);
    }

    // ===== 大额电器补贴 =====
    var btnAddElectricVoucher = document.getElementById("btnAddElectricVoucher");
    if (btnAddElectricVoucher) {
      btnAddElectricVoucher.addEventListener("click", _openAddElectricModal);
    }
    var _jumpToElectric = function() {
      // 关掉普通添加凭证弹窗，直接开电器补贴弹窗
      var overlay = document.getElementById("modalOverlay");
      if (overlay) overlay.classList.remove("active");
      _openAddElectricModal();
    };
    // 原 body 内的卡片按钮
    var btnJumpElectric = document.getElementById("btnJumpElectric");
    if (btnJumpElectric) btnJumpElectric.addEventListener("click", _jumpToElectric);
    // 新增：弹窗顶部大卡片（打开即可见）
    var jumpTop = document.getElementById("jumpElectricTop");
    if (jumpTop) jumpTop.addEventListener("click", _jumpToElectric);
    // 新增：footer 固定入口条（不随body滚动）
    var jumpFooter = document.getElementById("jumpElectricFooter");
    if (jumpFooter) jumpFooter.addEventListener("click", _jumpToElectric);
    var btnElectricModalClose = document.getElementById("btnElectricModalClose");
    if (btnElectricModalClose) {
      btnElectricModalClose.addEventListener("click", _closeAddElectricModal);
    }
    var modalElectricOverlay = document.getElementById("modalElectricOverlay");
    if (modalElectricOverlay) {
      modalElectricOverlay.addEventListener("click", function(e) {
        if (e.target === modalElectricOverlay) _closeAddElectricModal();
      });
    }
    var btnSubmitElectric = document.getElementById("btnSubmitElectricVoucher");
    if (btnSubmitElectric) {
      btnSubmitElectric.addEventListener("click", _submitElectricVoucherForm);
    }
    // 电器上传 / 签名
    var btnElectricClearSig = document.getElementById("btnElectricClearSignature");
    if (btnElectricClearSig) btnElectricClearSig.addEventListener("click", _clearElectricSignature);
    var uploadElectricProduct = document.getElementById("uploadElectricProduct");
    if (uploadElectricProduct) {
      var f1 = document.getElementById("inputElectricProduct");
      uploadElectricProduct.addEventListener("click", function(e) { if (e.target.tagName !== "INPUT") f1 && f1.click(); });
      if (f1) f1.addEventListener("change", _onElectricProductFileChange);
    }
    var uploadElectricOrder = document.getElementById("uploadElectricOrder");
    if (uploadElectricOrder) {
      var f2 = document.getElementById("inputElectricOrder");
      uploadElectricOrder.addEventListener("click", function(e) { if (e.target.tagName !== "INPUT") f2 && f2.click(); });
      if (f2) f2.addEventListener("change", _onElectricOrderFilesChange);
    }

    var btnInvite = document.getElementById("btnInvite");
    if (btnInvite) {
      btnInvite.addEventListener("click", _showInviteModal);
    }

    var btnWheel = document.getElementById("btnWheelLottery");
    if (btnWheel) {
      btnWheel.addEventListener("click", _openWheelModal);
    }

    var btnJITVip = document.getElementById("btnJITVip");
    if (btnJITVip) {
      btnJITVip.addEventListener("click", function() {
        _showToast("JIT级别会员优惠券：7折、8折、9折、9.5折、10折、11折", "");
      });
    }

    var btnLogout = document.getElementById("btnLogout");
    if (btnLogout) {
      btnLogout.addEventListener("click", function() {
        localStorage.removeItem("jit_current_user");
        _currentUser = null;
        _showToast("已退出登录", "");
        setTimeout(function() {
          location.reload();
        }, 500);
      });
    }

    // ===== 积分相关按钮事件 =====
    var btnPointsHistory = document.getElementById("btnPointsHistory");
    if (btnPointsHistory) btnPointsHistory.addEventListener("click", _openPointsHistory);
    var btnPointsHistoryClose = document.getElementById("btnPointsHistoryClose");
    if (btnPointsHistoryClose) btnPointsHistoryClose.addEventListener("click", _closePointsHistory);
    var pointsHistoryOverlay = document.getElementById("pointsHistoryOverlay");
    if (pointsHistoryOverlay) {
      pointsHistoryOverlay.addEventListener("click", function(e) {
        if (e.target === pointsHistoryOverlay) _closePointsHistory();
      });
    }
    var btnEnableLucky = document.getElementById("btnEnableLucky");
    if (btnEnableLucky) btnEnableLucky.addEventListener("click", _doEnableLucky);
    var btnUsePointsOffset = document.getElementById("btnUsePointsOffset");
    if (btnUsePointsOffset) btnUsePointsOffset.addEventListener("click", _doUsePointsOffset);

    var btnLotteryClose = document.getElementById("btnLotteryClose");
    if (btnLotteryClose) {
      btnLotteryClose.addEventListener("click", _closeLotteryModal);
    }

    var lotteryOverlay = document.getElementById("lotteryOverlay");
    if (lotteryOverlay) {
      lotteryOverlay.addEventListener("click", function(e) {
        if (e.target === lotteryOverlay) {
          _closeLotteryModal();
        }
      });
    }

    // ===== 转盘抽奖按钮事件 =====
    var btnWheelSpin = document.getElementById("btnWheelSpin");
    if (btnWheelSpin) btnWheelSpin.addEventListener("click", _doWheelSpin);
    var btnWheelClose = document.getElementById("btnWheelClose");
    if (btnWheelClose) btnWheelClose.addEventListener("click", _closeWheelModal);
    var wheelOverlay = document.getElementById("wheelOverlay");
    if (wheelOverlay) {
      wheelOverlay.addEventListener("click", function(e) {
        if (e.target === wheelOverlay) _closeWheelModal();
      });
    }

    var btnModalClose = document.getElementById("btnModalClose");
    if (btnModalClose) {
      btnModalClose.addEventListener("click", _closeAddVoucherModal);
    }

    var modalOverlay = document.getElementById("modalOverlay");
    if (modalOverlay) {
      modalOverlay.addEventListener("click", function(e) {
        if (e.target === modalOverlay) {
          _closeAddVoucherModal();
        }
      });
    }

    var btnSubmitVoucher = document.getElementById("btnSubmitVoucher");
    if (btnSubmitVoucher) {
      btnSubmitVoucher.addEventListener("click", _submitVoucherForm);
    }

    var btnGetLocation = document.getElementById("btnGetLocation");
    if (btnGetLocation) {
      btnGetLocation.addEventListener("click", _getLocation);
    }

    var btnClearSignature = document.getElementById("btnClearSignature");
    if (btnClearSignature) {
      btnClearSignature.addEventListener("click", _clearSignature);
    }

    var btnPrevPage = document.getElementById("btnPrevPage");
    if (btnPrevPage) {
      btnPrevPage.addEventListener("click", function() {
        if (_currentPage > 1) {
          _currentPage--;
          _renderOrders();
        }
      });
    }

    var btnNextPage = document.getElementById("btnNextPage");
    if (btnNextPage) {
      btnNextPage.addEventListener("click", function() {
        var maxPage = Math.ceil(_allVouchers.length / _perPage);
        if (_currentPage < maxPage) {
          _currentPage++;
          _renderOrders();
        }
      });
    }

    _initUploadListeners();
    _initOnlineUploadListeners();
    _initSignatureCanvas();
    _initOnlineSignatureCanvas();
    _initAmountInput();
    _initOnlineAmountInput();

    // ===== 通知相关事件 =====
    var btnNotification = document.getElementById("btnNotification");
    if (btnNotification) btnNotification.addEventListener("click", _openNotificationList);
    var btnNotificationClose = document.getElementById("btnNotificationClose");
    if (btnNotificationClose) btnNotificationClose.addEventListener("click", _closeNotificationList);
    var notificationOverlay = document.getElementById("notificationOverlay");
    if (notificationOverlay) {
      notificationOverlay.addEventListener("click", function(e) {
        if (e.target === notificationOverlay) _closeNotificationList();
      });
    }
    var btnNotifDetailClose = document.getElementById("btnNotifDetailClose");
    if (btnNotifDetailClose) btnNotifDetailClose.addEventListener("click", _closeNotificationDetail);
    var notifDetailOverlay = document.getElementById("notificationDetailOverlay");
    if (notifDetailOverlay) {
      notifDetailOverlay.addEventListener("click", function(e) {
        if (e.target === notifDetailOverlay) _closeNotificationDetail();
      });
    }
    var btnSendNotifReply = document.getElementById("btnSendNotifReply");
    if (btnSendNotifReply) btnSendNotifReply.addEventListener("click", _submitNotifReply);

    var ordersTableBody = document.getElementById("ordersTableBody");
    if (ordersTableBody) {
      ordersTableBody.addEventListener("click", function(e) {
        var lotteryBtn = e.target.closest(".lottery-order-btn");
        if (lotteryBtn) {
          var issueNumber = lotteryBtn.getAttribute("data-issue-number");
          var voucher = _allVouchers.find(function(item) {
            return String(item._issueNumber) === String(issueNumber);
          });
          if (voucher) {
            _openLotteryModal(voucher);
          }
          return;
        }
        var payBtn = e.target.closest(".pay-order-btn");
        if (payBtn) {
          var issueNumber = payBtn.getAttribute("data-issue-number");
          var voucher = _allVouchers.find(function(item) {
            return String(item._issueNumber) === String(issueNumber);
          });
          if (voucher) {
            _openPaymentModal(voucher);
          }
          return;
        }
        var editBtn = e.target.closest(".edit-order-btn");
        if (editBtn) {
          var issueNum = editBtn.getAttribute("data-issue-number");
          var v = _allVouchers.find(function(item) {
            return String(item._issueNumber) === String(issueNum);
          });
          if (v) {
            _openEditVoucherModal(v);
          }
          return;
        }
      });
    }

    var btnUserFirstPayClose = document.getElementById("btnUserFirstPayClose");
    if (btnUserFirstPayClose) {
      btnUserFirstPayClose.addEventListener("click", _closeUserFirstPayModal);
    }
    var userFirstPayOverlay = document.getElementById("userFirstPayOverlay");
    if (userFirstPayOverlay) {
      userFirstPayOverlay.addEventListener("click", function(e) {
        if (e.target === userFirstPayOverlay) {
          _closeUserFirstPayModal();
        }
      });
    }

    // 工会先支付弹窗事件
    var btnUnionFirstPayClose = document.getElementById("btnUnionFirstPayClose");
    if (btnUnionFirstPayClose) {
      btnUnionFirstPayClose.addEventListener("click", _closeUnionFirstPayModal);
    }
    var unionFirstPayOverlay = document.getElementById("unionFirstPayOverlay");
    if (unionFirstPayOverlay) {
      unionFirstPayOverlay.addEventListener("click", function(e) {
        if (e.target === unionFirstPayOverlay) {
          _closeUnionFirstPayModal();
        }
      });
    }
    var btnUnionPaid = document.getElementById("btnUnionPaid");
    if (btnUnionPaid) {
      btnUnionPaid.addEventListener("click", _submitUnionPaid);
    }

    // 线上购物弹窗事件
    var btnOnlineModalClose = document.getElementById("btnOnlineModalClose");
    if (btnOnlineModalClose) {
      btnOnlineModalClose.addEventListener("click", _closeOnlineAddVoucherModal);
    }
    var modalOnlineOverlay = document.getElementById("modalOnlineOverlay");
    if (modalOnlineOverlay) {
      modalOnlineOverlay.addEventListener("click", function(e) {
        if (e.target === modalOnlineOverlay) {
          _closeOnlineAddVoucherModal();
        }
      });
    }
    var btnSubmitOnline = document.getElementById("btnSubmitOnlineVoucher");
    if (btnSubmitOnline) {
      btnSubmitOnline.addEventListener("click", _submitOnlineVoucherForm);
    }
  };

  var _initUploadListeners = function() {
    var inputShopPhoto = document.getElementById("inputShopPhoto");
    if (inputShopPhoto) {
      inputShopPhoto.addEventListener("change", function(e) {
        var file = e.target.files[0];
        if (file) {
          if (file.size > 20 * 1024 * 1024) {
            _showToast("图片不能超过20MB！", "error");
            inputShopPhoto.value = "";
            return;
          }
          var reader = new FileReader();
          reader.onload = function(ev) {
            var preview = document.getElementById("previewShopPhoto");
            if (preview) {
              preview.src = ev.target.result;
              preview.style.display = "block";
            }
            var placeholder = document.querySelector("#uploadShopPhoto .upload-placeholder");
            if (placeholder) placeholder.style.display = "none";
          };
          reader.readAsDataURL(file);
        }
      });
    }

    var uploadShopPhoto = document.getElementById("uploadShopPhoto");
    if (uploadShopPhoto) {
      uploadShopPhoto.addEventListener("click", function(e) {
        if (e.target === uploadShopPhoto || e.target.closest(".upload-placeholder") || e.target.closest(".upload-preview")) {
          document.getElementById("inputShopPhoto").click();
        }
      });
    }

    var inputOrderPhoto = document.getElementById("inputOrderPhoto");
    if (inputOrderPhoto) {
      inputOrderPhoto.addEventListener("change", function(e) {
        var files = Array.from(e.target.files);
        _orderPhotos = [];
        _orderPhotoFiles = [];
        var previewList = document.getElementById("previewOrderPhotos");
        if (previewList) previewList.innerHTML = "";
        var oversizedCount = 0;
        files.forEach(function(file, index) {
          if (file.size > 20 * 1024 * 1024) {
            oversizedCount++;
            return;
          }
          _orderPhotoFiles.push(file);
          var reader = new FileReader();
          reader.onload = function(ev) {
            _orderPhotos.push({ name: file.name, data: ev.target.result });
            var item = document.createElement("div");
            item.className = "upload-preview-item";
            item.innerHTML = '<img src="' + ev.target.result + '" alt="订单图片">' +
              '<button class="remove-preview" data-index="' + index + '">&times;</button>';
            if (previewList) previewList.appendChild(item);
          };
          reader.readAsDataURL(file);
        });
        if (oversizedCount > 0) {
          _showToast("已跳过" + oversizedCount + "张超过20MB的图片！", "error");
        }
      });
    }

    var uploadOrderPhoto = document.getElementById("uploadOrderPhoto");
    if (uploadOrderPhoto) {
      uploadOrderPhoto.addEventListener("click", function(e) {
        if (e.target === uploadOrderPhoto || e.target.closest(".upload-placeholder") || e.target.closest(".upload-preview-list")) {
          document.getElementById("inputOrderPhoto").click();
        }
      });
    }

    document.addEventListener("click", function(e) {
      if (e.target.classList.contains("remove-preview")) {
        var index = parseInt(e.target.getAttribute("data-index"));
        if (!isNaN(index) && index < _orderPhotos.length) {
          _orderPhotos.splice(index, 1);
          e.target.parentElement.remove();
          _refreshOrderPreviewIndices();
        }
      }
    });
  };

  var _refreshOrderPreviewIndices = function() {
    var items = document.querySelectorAll("#previewOrderPhotos .remove-preview");
    items.forEach(function(item, i) {
      item.setAttribute("data-index", i);
    });
  };

  // ========= 线上购物图片上传监听 =========
  var _initOnlineUploadListeners = function() {
    var inputOnlineProduct = document.getElementById("inputOnlineProduct");
    if (inputOnlineProduct) {
      inputOnlineProduct.addEventListener("change", function(e) {
        var file = e.target.files[0];
        if (file) {
          if (file.size > 20 * 1024 * 1024) {
            _showToast("图片不能超过20MB！", "error");
            inputOnlineProduct.value = "";
            return;
          }
          _onlineProductFile = file;
          var reader = new FileReader();
          reader.onload = function(ev) {
            var preview = document.getElementById("previewOnlineProduct");
            if (preview) {
              preview.src = ev.target.result;
              preview.style.display = "block";
            }
            var placeholder = document.querySelector("#uploadOnlineProduct .upload-placeholder");
            if (placeholder) placeholder.style.display = "none";
          };
          reader.readAsDataURL(file);
        }
      });
    }
    var uploadOnlineProduct = document.getElementById("uploadOnlineProduct");
    if (uploadOnlineProduct) {
      uploadOnlineProduct.addEventListener("click", function(e) {
        if (e.target === uploadOnlineProduct || e.target.closest(".upload-placeholder") || e.target.closest(".upload-preview")) {
          document.getElementById("inputOnlineProduct").click();
        }
      });
    }

    var inputOnlineShopping = document.getElementById("inputOnlineShopping");
    if (inputOnlineShopping) {
      inputOnlineShopping.addEventListener("change", function(e) {
        var files = Array.from(e.target.files);
        _onlineShoppingFiles = [];
        _onlineShoppingPhotoFiles = [];
        var previewList = document.getElementById("previewOnlineShopping");
        if (previewList) previewList.innerHTML = "";
        var oversizedCount = 0;
        files.forEach(function(file, index) {
          if (file.size > 20 * 1024 * 1024) {
            oversizedCount++;
            return;
          }
          _onlineShoppingPhotoFiles.push(file);
          var reader = new FileReader();
          reader.onload = function(ev) {
            _onlineShoppingFiles.push({ name: file.name, data: ev.target.result });
            var item = document.createElement("div");
            item.className = "upload-preview-item";
            item.innerHTML = '<img src="' + ev.target.result + '" alt="购物截图">' +
              '<button class="remove-online-preview" data-index="' + index + '">&times;</button>';
            if (previewList) previewList.appendChild(item);
          };
          reader.readAsDataURL(file);
        });
        if (oversizedCount > 0) {
          _showToast("已跳过" + oversizedCount + "张超过20MB的图片！", "error");
        }
      });
    }
    var uploadOnlineShopping = document.getElementById("uploadOnlineShopping");
    if (uploadOnlineShopping) {
      uploadOnlineShopping.addEventListener("click", function(e) {
        if (e.target === uploadOnlineShopping || e.target.closest(".upload-placeholder") || e.target.closest(".upload-preview-list")) {
          document.getElementById("inputOnlineShopping").click();
        }
      });
    }
    document.addEventListener("click", function(e) {
      if (e.target.classList.contains("remove-online-preview")) {
        var index = parseInt(e.target.getAttribute("data-index"));
        if (!isNaN(index) && index < _onlineShoppingFiles.length) {
          _onlineShoppingFiles.splice(index, 1);
          e.target.parentElement.remove();
          _refreshOnlinePreviewIndices();
        }
      }
    });
  };

  var _refreshOnlinePreviewIndices = function() {
    var items = document.querySelectorAll("#previewOnlineShopping .remove-online-preview");
    items.forEach(function(item, i) {
      item.setAttribute("data-index", i);
    });
  };

  var _initSignatureCanvas = function() {
    var canvas = document.getElementById("signatureCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var isDrawing = false;
    var lastX = 0;
    var lastY = 0;

    var resizeCanvas = function() {
      var container = canvas.parentElement;
      var rect = container.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var width = rect.width;
      var height = 150;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = "#42a5f5";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };

    resizeCanvas();
    window.addEventListener("resize", function() {
      var savedData = canvas.toDataURL();
      resizeCanvas();
      var img = new Image();
      img.onload = function() {
        ctx.drawImage(img, 0, 0);
      };
      img.src = savedData;
    });

    var getPos = function(e) {
      var rect = canvas.getBoundingClientRect();
      var clientX, clientY;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    canvas.addEventListener("mousedown", function(e) {
      isDrawing = true;
      var pos = getPos(e);
      lastX = pos.x;
      lastY = pos.y;
    });
    canvas.addEventListener("mousemove", function(e) {
      if (!isDrawing) return;
      var pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastX = pos.x;
      lastY = pos.y;
    });
    canvas.addEventListener("mouseup", function() {
      isDrawing = false;
      _signatureData = canvas.toDataURL("image/png");
    });
    canvas.addEventListener("mouseleave", function() {
      isDrawing = false;
      _signatureData = canvas.toDataURL("image/png");
    });
    canvas.addEventListener("touchstart", function(e) {
      e.preventDefault();
      isDrawing = true;
      var pos = getPos(e);
      lastX = pos.x;
      lastY = pos.y;
    });
    canvas.addEventListener("touchmove", function(e) {
      e.preventDefault();
      if (!isDrawing) return;
      var pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastX = pos.x;
      lastY = pos.y;
    });
    canvas.addEventListener("touchend", function() {
      isDrawing = false;
      _signatureData = canvas.toDataURL("image/png");
    });
  };

  var _clearSignature = function() {
    var canvas = document.getElementById("signatureCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    _signatureData = null;
  };

  // ========= 线上购物签名 =========
  var _initOnlineSignatureCanvas = function() {
    var canvas = document.getElementById("onlineSignatureCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var isDrawing = false;
    var lastX = 0;
    var lastY = 0;

    var resizeCanvas = function() {
      var container = canvas.parentElement;
      var rect = container.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var width = rect.width;
      var height = 150;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = "#42a5f5";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };

    resizeCanvas();
    window.addEventListener("resize", function() {
      var savedData = canvas.toDataURL();
      resizeCanvas();
      var img = new Image();
      img.onload = function() {
        ctx.drawImage(img, 0, 0);
      };
      img.src = savedData;
    });

    var getPos = function(e) {
      var rect = canvas.getBoundingClientRect();
      var clientX, clientY;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    var startDraw = function(e) {
      e.preventDefault();
      isDrawing = true;
      var pos = getPos(e);
      lastX = pos.x;
      lastY = pos.y;
    };
    var draw = function(e) {
      e.preventDefault();
      if (!isDrawing) return;
      var pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastX = pos.x;
      lastY = pos.y;
    };
    var endDraw = function(e) {
      e.preventDefault();
      isDrawing = false;
      _onlineSignatureData = canvas.toDataURL();
    };

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", endDraw);
    canvas.addEventListener("mouseleave", endDraw);
    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", endDraw, { passive: false });

    // 清除按钮
    var btnClear = document.getElementById("btnOnlineClearSignature");
    if (btnClear) {
      btnClear.addEventListener("click", function() {
        var dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        _onlineSignatureData = null;
      });
    }

    };

  var _initAmountInput = function() {
    var input = document.getElementById("inputAmount");
    if (!input) return;
    input.addEventListener("input", function(e) {
      var val = e.target.value.replace(/[^\d.]/g, "");
      var parts = val.split(".");
      if (parts.length > 2) {
        val = parts[0] + "." + parts.slice(1).join("");
      }
      if (parts.length === 2 && parts[1].length > 2) {
        parts[1] = parts[1].substring(0, 2);
        val = parts[0] + "." + parts[1];
      }
      e.target.value = val;
    });
    input.addEventListener("blur", function(e) {
      var val = e.target.value.trim();
      if (val && !val.endsWith("元")) {
        if (val && val.indexOf(".") === -1) {
          val += ".00";
        }
        if (val && val.split(".")[1] && val.split(".")[1].length === 1) {
          val += "0";
        }
        e.target.value = val + "元";
      }
    });
    input.addEventListener("focus", function(e) {
      e.target.value = e.target.value.replace("元", "");
    });
  };

  var _initOnlineAmountInput = function() {
    var input = document.getElementById("inputOnlineAmount");
    if (!input) return;
    input.addEventListener("input", function(e) {
      var val = e.target.value.replace(/[^\d.]/g, "");
      var parts = val.split(".");
      if (parts.length > 2) {
        val = parts[0] + "." + parts.slice(1).join("");
      }
      if (parts.length === 2 && parts[1].length > 2) {
        parts[1] = parts[1].substring(0, 2);
        val = parts[0] + "." + parts[1];
      }
      e.target.value = val;
    });
    input.addEventListener("blur", function(e) {
      var val = e.target.value.trim();
      if (val && !val.endsWith("元")) {
        if (val && val.indexOf(".") === -1) {
          val += ".00";
        }
        if (val && val.split(".")[1] && val.split(".")[1].length === 1) {
          val += "0";
        }
        e.target.value = val + "元";
      }
    });
    input.addEventListener("focus", function(e) {
      e.target.value = e.target.value.replace("元", "");
    });
  };

  var _loadData = function() {
    if (!_currentUser) return Promise.resolve();
    return _loadOrders();
  };

  var _loadOrders = function() {
    return JITApi.getAllVouchers().then(function(vouchers) {
      if (_currentUser) {
        vouchers = vouchers.filter(function(v) {
          return v.username === _currentUser;
        });
      }
      // 过滤掉聊天专用凭证，不显示在订单列表中
      vouchers = vouchers.filter(function(v) {
        return v.shopName !== "【聊天专用】" && v.paymentMethod !== "chat";
      });
      _allVouchers = vouchers;
      _totalVouchers = vouchers.length;
      _currentPage = 1;
      _renderOrders();
      _renderHistory(vouchers);
      _updateProgressFromVouchers(vouchers);
    }).catch(function(err) {
      console.error("加载订单失败:", err.message);
      _allVouchers = [];
      _totalVouchers = 0;
      _currentPage = 1;
      _renderOrders();
      _renderHistory([]);
      _updateProgressFromVouchers([]);
    });
  };

  var _renderOrders = function() {
    var tbody = document.getElementById("ordersTableBody");
    if (!tbody) return;

    var start = (_currentPage - 1) * _perPage;
    var end = start + _perPage;
    var pageVouchers = _allVouchers.slice(start, end);

    if (pageVouchers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="table-loading">暂无订单数据</div></td></tr>';
      _updatePagination();
      return;
    }

    var html = "";
    pageVouchers.forEach(function(v) {
      var statusClass = v.statusType || "pending";
      var statusText = v.status || "待审核";
      if (v.statusType === "completed") statusText = "已完成交易";
      if (v.statusType === "paid") statusText = "已付款·待确认";
      var isElectric = !!(v.electric || v.voucherType === "电器凭证");
      var discount = v.discount || "-";
      var paymentNote = v.paymentNote || v.paymentMethod || "-";
      var originalPrice = v.originalPrice || "-";
      var finalPrice = v.finalPrice || "-";

      html += "<tr>";
      // ===== 类型标签：普通 / 线上 / 电器 =====
      var typeLabel = "普通凭证";
      var typeBg = "rgba(158,158,158,0.15);color:#999";
      if (v.voucherType === "线上购物") {
        typeLabel = "线上购物";
        typeBg = "rgba(33,150,243,0.15);color:#2196f3";
      } else if (isElectric) {
        typeLabel = "🎁 大额电器补贴";
        typeBg = "rgba(255,112,67,0.15);color:#ff7043;border:1px solid rgba(255,112,67,0.3);";
      }
      html += "<td><span style=\"font-size:12px;padding:2px 6px;border-radius:4px;background:" + typeBg + "\">" + typeLabel + "</span></td>";
      html += "<td>" + _escapeHtml(v.shopName || "-") + "</td>";
      html += "<td>" + _escapeHtml(v.date || "-") + "</td>";
      html += "<td><span class=\"discount-badge\"" + (isElectric ? " style=\"background:rgba(255,112,67,0.15);color:#ff7043;border-color:rgba(255,112,67,0.4);\"" : "") + ">" + _escapeHtml(discount) + "</span></td>";
      html += "<td>" + _escapeHtml(paymentNote) + "</td>";
      html += "<td>" + _escapeHtml(originalPrice) + "</td>";
      html += "<td>" + _escapeHtml(finalPrice) + "</td>";
      html += "<td><span class=\"status-badge " + statusClass + "\">" + _escapeHtml(statusText) + "</span>";
      if (v.statusType === "rejected" && v.rejectReason) {
        html += "<div style=\"color:#f44336;font-size:12px;margin-top:4px;\">" + _escapeHtml(v.rejectReason) + "</div>";
      }
      html += "</td>";
      var actions = "";
      if (v.statusType === "pending") {
        actions += "<button class=\"edit-order-btn\" data-issue-number=\"" + _escapeHtml(v._issueNumber || "") + "\">编辑</button>";
      }
      // ===== 电器凭证不显示抽奖按钮（非抽奖模式）=====
      if (!isElectric && !v.discount) {
        actions += "<button class=\"lottery-order-btn\" data-issue-number=\"" + _escapeHtml(v._issueNumber || "") + "\">🎰 抽奖</button>";
      }
      // 审核通过且未完成交易时显示去支付
      if (v.statusType === "approved") {
        actions += "<button class=\"pay-order-btn\" data-issue-number=\"" + _escapeHtml(v._issueNumber || "") + "\">去支付</button>";
      }
      html += "<td>" + actions + "</td>";
      html += "</tr>";
    });

    tbody.innerHTML = html;
    _updatePagination();
  };

  var _updatePagination = function() {
    var maxPage = Math.ceil(_allVouchers.length / _perPage) || 1;
    var pageInfo = document.getElementById("pageInfo");
    var btnPrev = document.getElementById("btnPrevPage");
    var btnNext = document.getElementById("btnNextPage");
    var noMore = document.getElementById("noMoreOrders");

    if (pageInfo) pageInfo.textContent = "第 " + _currentPage + " / " + maxPage + " 页";
    if (btnPrev) btnPrev.disabled = _currentPage <= 1;
    if (btnNext) btnNext.disabled = _currentPage >= maxPage;

    if (noMore) {
      if (_currentPage >= maxPage && _allVouchers.length > 0) {
        noMore.style.display = "block";
      } else {
        noMore.style.display = "none";
      }
    }
  };

  var _updateProgressFromVouchers = function(vouchers) {
    var total = vouchers.length;
    var approved = vouchers.filter(function(v) { return v.statusType === "approved"; }).length;
    _updateProgress(total, approved);
  };

  var _renderHistory = function(vouchers) {
    var list = document.getElementById("sidebarHistoryList");
    if (!list) return;

    if (vouchers.length === 0) {
      list.innerHTML = '<div class="sidebar-loading">暂无历史单据</div>';
      return;
    }

    var html = "";
    vouchers.forEach(function(v) {
      var statusClass = v.statusType || "pending";
      var statusText = v.status || "待审核";
      html += '<div class="sidebar-item">';
      html += '<div class="sidebar-item-shop">' + _escapeHtml(v.shopName || "未知店铺") + '</div>';
      html += '<div class="sidebar-item-date">' + _escapeHtml(v.date || "-") + '</div>';
      html += '<span class="sidebar-item-status ' + statusClass + '">' + _escapeHtml(statusText) + '</span>';
      html += '</div>';
    });
    list.innerHTML = html;
  };

  var _updateProgress = function(total, approved) {
    var progressText = document.getElementById("progressText");
    var progressBarFill = document.getElementById("progressBarFill");

    if (progressText) {
      progressText.textContent = "您已经申请了" + total + "个凭证优惠！";
    }

    if (progressBarFill) {
      var maxLevel = 50;
      var percentage = Math.min((total / maxLevel) * 100, 100);
      progressBarFill.style.width = percentage + "%";
    }
  };

  var _openAddVoucherModal = function() {
    if (!_currentUser) {
      _showToast("请先登录", "error");
      _showLoginPrompt();
      return;
    }
    _editingVoucher = null;
    var overlay = document.getElementById("modalOverlay");
    if (overlay) {
      overlay.classList.add("active");
      _resetForm();
    }
  };

  var _openEditVoucherModal = function(voucher) {
    if (!_currentUser) {
      _showToast("请先登录", "error");
      return;
    }
    if (!voucher || voucher.statusType !== "pending") {
      _showToast("只能编辑未审核的凭证", "error");
      return;
    }
    _editingVoucher = voucher;
    var overlay = document.getElementById("modalOverlay");
    if (overlay) {
      overlay.classList.add("active");
      _resetForm();
    }
  };

  var _closeAddVoucherModal = function() {
    var overlay = document.getElementById("modalOverlay");
    if (overlay) {
      overlay.classList.remove("active");
    }
  };

  var _openLotteryModal = function(voucher) {
    if (!_currentUser) {
      _showToast("请先登录", "error");
      return;
    }
    if (!voucher) {
      _showToast("请先选择要抽奖的凭证", "error");
      return;
    }
    // ===== 电器凭证（非抽奖模式）禁止抽奖 =====
    var isElectric = !!(voucher.electric || voucher.voucherType === "电器凭证");
    if (isElectric) {
      _showToast("🎁 大额电器补贴为非抽奖模式，请等待管理员审核补贴比例~", "");
      return;
    }
    // 如果已抽过奖，提示不能重复抽
    if (voucher.discount) {
      _showToast("该订单已抽过奖（" + voucher.discount + "），不能重复抽奖！", "error");
      return;
    }
    var overlay = document.getElementById("lotteryOverlay");
    if (overlay) {
      // 初始化幸运抽奖 UI：若已开启则显示已开启，否则显示兑换入口
      JITLottery.disableLuckyMode(); // 新一轮开始时重置幸运模式，避免上次残留
      var bar = document.getElementById("luckyLotteryBar");
      var hint = document.getElementById("luckyModeHint");
      var luckyBtn = document.getElementById("btnEnableLucky");
      var luckyPts = document.getElementById("luckyCurrentPoints");
      if (bar) bar.style.display = "flex";
      if (hint) hint.style.display = "none";
      if (luckyBtn) luckyBtn.disabled = false;
      if (luckyPts) luckyPts.textContent = String(_currentPoints);

      overlay.classList.add("active");
      var targetVoucher = voucher;
      setTimeout(function() {
        JITLottery.start("lotteryCanvas", function(prize) {
          // 刮开后显示匹配结果
          var matched = JITLottery.getMatchedCount();
          if (matched > 0) {
            _showToast("🎉 匹配" + matched + "个号码！获得 " + prize.discount, "success");
          } else {
            _showToast("😅 未中奖，下次好运！", "");
          }
          // 抽奖结果确定后，本轮幸运模式自动失效
          JITLottery.disableLuckyMode();
        });
        // 随机后立刻保存折数，不等用户刮！
        var prize = JITLottery.getCurrentPrize();
        if (prize) {
          _saveLotteryResult(prize, targetVoucher);
        }
      }, 300);
    }
  };

  var _closeLotteryModal = function() {
    var overlay = document.getElementById("lotteryOverlay");
    if (overlay) {
      overlay.classList.remove("active");
    }
    // 关闭弹窗时也清理幸运模式状态
    JITLottery.disableLuckyMode();
  };

  var _resetForm = function() {
    var isEdit = !!_editingVoucher;
    var title = document.querySelector("#modalAddVoucher .modal-title");
    var btn = document.getElementById("btnSubmitVoucher");
    if (title) title.textContent = isEdit ? "编辑凭证" : "添加凭证";
    if (btn) btn.textContent = isEdit ? "保存修改" : "添加凭证并提交审核";

    var paymentInputs = document.querySelectorAll('input[name="paymentMethod"]');
    paymentInputs.forEach(function(input) {
      input.checked = false;
    });
    document.getElementById("inputShopName").value = "";
    document.getElementById("previewShopPhoto").style.display = "none";
    document.getElementById("previewShopPhoto").src = "";
    document.querySelector("#uploadShopPhoto .upload-placeholder").style.display = "";
    document.getElementById("inputShopPhoto").value = "";
    document.getElementById("previewOrderPhotos").innerHTML = "";
    document.getElementById("inputOrderPhoto").value = "";
    _orderPhotos = [];
    _orderPhotoFiles = [];
    document.getElementById("inputAmount").value = "";
    document.getElementById("inputRemark").value = "";
    document.getElementById("locationInfo").textContent = "未获取定位";
    document.getElementById("inputLatitude").value = "";
    document.getElementById("inputLongitude").value = "";
    _clearSignature();
    _signatureData = null;
    _hideAllErrors();

    if (isEdit && _editingVoucher) {
      var v = _editingVoucher;
      if (v.paymentMethodType) {
        var radio = document.querySelector('input[name="paymentMethod"][value="' + v.paymentMethodType + '"]');
        if (radio) radio.checked = true;
      }
      document.getElementById("inputShopName").value = v.shopName || "";
      document.getElementById("inputAmount").value = v.originalPrice || v.amount || "";
      document.getElementById("inputRemark").value = v.remark || "";
      if (v.latitude) document.getElementById("inputLatitude").value = v.latitude;
      if (v.longitude) document.getElementById("inputLongitude").value = v.longitude;
      if (v.latitude || v.longitude) {
        document.getElementById("locationInfo").textContent = (v.latitude || v.longitude) ? "已定位" : "未获取定位";
      }
      if (v.signature) {
        _signatureData = v.signature;
      }
    }
  };

  var _hideAllErrors = function() {
    var errors = document.querySelectorAll(".form-error");
    errors.forEach(function(el) {
      el.classList.remove("visible");
    });
  };

  var _showError = function(id, msg) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = msg;
      el.classList.add("visible");
    }
  };

  var _getLocation = function() {
    var btn = document.getElementById("btnGetLocation");
    var info = document.getElementById("locationInfo");
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = "获取中...";

    if (!navigator.geolocation) {
      _showToast("您的设备不支持定位功能", "error");
      btn.disabled = false;
      btn.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>获取定位';
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function(position) {
        var lat = position.coords.latitude;
        var lng = position.coords.longitude;
        document.getElementById("inputLatitude").value = lat;
        document.getElementById("inputLongitude").value = lng;
        if (info) {
          info.textContent = "经度: " + lng.toFixed(6) + "  纬度: " + lat.toFixed(6);
        }
        btn.disabled = false;
        btn.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>已定位';
        _showToast("定位成功", "success");
      },
      function(err) {
        var msg = "定位失败: ";
        switch (err.code) {
          case err.PERMISSION_DENIED: msg += "用户拒绝定位请求"; break;
          case err.POSITION_UNAVAILABLE: msg += "位置信息不可用"; break;
          case err.TIMEOUT: msg += "定位请求超时"; break;
          default: msg += "未知错误"; break;
        }
        _showToast(msg, "error");
        btn.disabled = false;
        btn.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>获取定位';
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  var _submitVoucherForm = function() {
    var paymentMethodInput = document.querySelector('input[name="paymentMethod"]:checked');
    var paymentMethodValue = paymentMethodInput ? paymentMethodInput.value : "";
    var paymentMethodText = paymentMethodValue === "unionFirst" ? "工会先代替支付，再让用户支付优惠差价" : (paymentMethodValue === "userFirst" ? "用户先支付全额，工会再给用户差价" : "");
    var shopName = document.getElementById("inputShopName").value.trim();
    var shopPhotoFile = document.getElementById("inputShopPhoto").files[0];
    var orderPhotoFiles = document.getElementById("inputOrderPhoto").files;
    var latitude = document.getElementById("inputLatitude").value;
    var longitude = document.getElementById("inputLongitude").value;
    var amount = document.getElementById("inputAmount").value.trim();
    var remark = document.getElementById("inputRemark").value.trim();

    _hideAllErrors();
    var hasError = false;

    if (!paymentMethodValue) {
      _showError("errorPaymentMethod", "请选择支付方式");
      hasError = true;
    }
    if (!shopName) {
      _showError("errorShopName", "请输入店铺名称");
      hasError = true;
    }
    if (!_editingVoucher) {
      if (!shopPhotoFile) {
        _showError("errorShopPhoto", "请上传店铺照片");
        hasError = true;
      }
      if (!orderPhotoFiles || orderPhotoFiles.length === 0) {
        _showError("errorOrderPhoto", "请上传商品订单截图");
        hasError = true;
      }
    }
    if (!amount) {
      _showError("errorAmount", "请输入余额金额");
      hasError = true;
    }
    if (!_signatureData) {
      _showError("errorSignature", "请手写签名");
      hasError = true;
    }

    if (hasError) return;

    var btn = document.getElementById("btnSubmitVoucher");
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.classList.add("btn-loading");
    btn.textContent = _editingVoucher ? "保存中..." : "提交中...";

    var voucherData = {
      shopName: shopName,
      date: new Date().toISOString().split("T")[0],
      shopPhoto: "",
      orderPhotos: [],
      latitude: latitude,
      longitude: longitude,
      amount: amount.replace("元", ""),
      signature: _signatureData,
      remark: remark || "",
      username: _currentUser,
      status: "待审核",
      statusType: "pending",
      discount: _editingVoucher ? _editingVoucher.discount : "",
      discountValue: _editingVoucher ? _editingVoucher.discountValue : 0,
      originalPrice: amount,
      finalPrice: amount,
      paymentMethod: paymentMethodValue,
      paymentMethodText: paymentMethodText,
      paymentNote: paymentMethodText,
      _issueNumber: _editingVoucher ? _editingVoucher._issueNumber : null,
      _createdAt: _editingVoucher ? _editingVoucher._createdAt : Date.now()
    };

    if (_editingVoucher) {
      voucherData.discount = _editingVoucher.discount;
      voucherData.discountValue = _editingVoucher.discountValue;
    }

    if (_editingVoucher && _editingVoucher._issueNumber) {
      var isNewShopPhoto = !!shopPhotoFile;
      var anyNewOrderPhotos = _orderPhotoFiles && _orderPhotoFiles.length > 0;
      if (!isNewShopPhoto && !anyNewOrderPhotos) {
        voucherData.shopPhoto = _editingVoucher.shopPhoto || "";
        voucherData.orderPhotos = (_editingVoucher.orderPhotos || []).slice();
        JITApi.updateVoucherIssue(voucherData).then(function() {
          _showToast("凭证修改成功！", "success");
          _closeAddVoucherModal();
          JITApi.invalidateCache("allVouchers");
          _loadData();
        }).catch(function(err) {
          _showToast("保存失败: " + err.message, "error");
          console.error("保存修改失败:", err);
        }).finally(function() {
          btn.disabled = false;
          btn.classList.remove("btn-loading");
          btn.textContent = originalText;
        });
      } else {
        voucherData.shopPhoto = _editingVoucher.shopPhoto || "";
        voucherData.orderPhotos = (_editingVoucher.orderPhotos || []).slice();
        JITApi.submitVoucherWithImages(voucherData, shopPhotoFile, _orderPhotoFiles, isNewShopPhoto, anyNewOrderPhotos).then(function(result) {
          _showToast("凭证修改成功！", "success");
          _closeAddVoucherModal();
          JITApi.invalidateCache("allVouchers");
          _loadData();
        }).catch(function(err) {
          _showToast("保存失败: " + err.message, "error");
          console.error("保存修改失败:", err);
        }).finally(function() {
          btn.disabled = false;
          btn.classList.remove("btn-loading");
          btn.textContent = originalText;
        });
      }
    } else {
      JITApi.getNextVoucherId().then(function(nextId) {
        voucherData.voucherId = nextId;
        return JITApi.ensureLabels();
      }).then(function() {
        return JITApi.submitVoucherWithImages(voucherData, shopPhotoFile, _orderPhotoFiles, !!shopPhotoFile, _orderPhotoFiles && _orderPhotoFiles.length > 0);
      }).then(function(result) {
        _showToast("凭证提交成功！", "success");
        _closeAddVoucherModal();
        JITApi.invalidateCache("allVouchers");
        JITApi.invalidateCache("allVouchersForId");
        var newIssueNumber = result.number;
        var newVoucher = JITApi.parseVoucherData(result);

        // ===== 积分：添加凭证 +15，签到，连续 3 天再 +30 =====
        var bonusMsg = [];
        var awardPromises = [];
        try {
          if (JITPoints && JITPoints.changePoints) {
            awardPromises.push(
              JITPoints.changePoints(_currentUser, 15, "添加凭证").then(function() {
                bonusMsg.push("+15 积分");
              }).catch(function() {})
            );
          }
          if (JITPoints && JITPoints.signIn) {
            awardPromises.push(
              JITPoints.signIn(_currentUser).then(function(signResult) {
                if (signResult && signResult.bonusEarned) {
                  bonusMsg.push("连续3天添加凭证 +30 积分！");
                }
              }).catch(function() {})
            );
          }
        } catch(e) {}
        // 积分逻辑走完再刷新显示，不阻塞主流程
        Promise.all(awardPromises).then(function() {
          if (bonusMsg.length > 0) _showToast("获得奖励：" + bonusMsg.join("，"), "success");
          _refreshPointsDisplay(true);
        });

        if (newVoucher) {
          newVoucher._issueNumber = newIssueNumber;
          _allVouchers.unshift(newVoucher);
          _renderOrders();
          _renderHistory(_allVouchers);
          _updateProgressFromVouchers(_allVouchers);
          setTimeout(function() {
            _openLotteryModal(newVoucher);
          }, 400);
        }
        _loadData();
    }).catch(function(err) {
      _showToast("提交失败: " + err.message, "error");
      console.error("提交凭证失败:", err);
    }).finally(function() {
      btn.disabled = false;
      btn.classList.remove("btn-loading");
      btn.textContent = originalText;
    });
    }
  };

  // ========= 线上购物凭证 =========
  var _openAddOnlineVoucherModal = function() {
    if (!_currentUser) {
      _showToast("请先登录", "error");
      _showLoginPrompt();
      return;
    }
    var overlay = document.getElementById("modalOnlineOverlay");
    if (overlay) {
      overlay.classList.add("active");
      _resetOnlineForm();
    }
  };

  var _closeOnlineAddVoucherModal = function() {
    var overlay = document.getElementById("modalOnlineOverlay");
    if (overlay) {
      overlay.classList.remove("active");
    }
  };

  var _resetOnlineForm = function() {
    document.getElementById("inputOnlineShopName").value = "";
    document.getElementById("inputOnlinePlatform").value = "";
    document.getElementById("inputOnlineOrderNo").value = "";
    _onlineProductFile = null;
    _onlineShoppingFiles = [];
    _onlineShoppingPhotoFiles = [];
    var previewProduct = document.getElementById("previewOnlineProduct");
    if (previewProduct) { previewProduct.src = ""; previewProduct.style.display = "none"; }
    var placeholderProduct = document.querySelector("#uploadOnlineProduct .upload-placeholder");
    if (placeholderProduct) placeholderProduct.style.display = "";
    document.getElementById("inputOnlineProduct").value = "";
    document.getElementById("previewOnlineShopping").innerHTML = "";
    document.getElementById("inputOnlineShopping").value = "";
    document.getElementById("inputOnlineAmount").value = "";
    document.getElementById("inputOnlineRemark").value = "";
    var canvas = document.getElementById("onlineSignatureCanvas");
    if (canvas) {
      var ctx = canvas.getContext("2d");
      var dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }
    _onlineSignatureData = null;
    // 清除错误提示
    var errors = document.querySelectorAll("#modalOnlineOverlay .form-error");
    errors.forEach(function(el) { el.classList.remove("visible"); });
  };

  var _submitOnlineVoucherForm = function() {
    var paymentMethodInput = document.querySelector('input[name="onlinePaymentMethod"]:checked');
    var paymentMethodValue = paymentMethodInput ? paymentMethodInput.value : "";
    var paymentMethodText = paymentMethodValue === "unionFirst" ? "工会先代替支付，再让用户支付优惠差价" : (paymentMethodValue === "userFirst" ? "用户先支付全额，工会再给用户差价" : "");
    var shopName = document.getElementById("inputOnlineShopName").value.trim();
    var platform = document.getElementById("inputOnlinePlatform").value;
    var orderNo = document.getElementById("inputOnlineOrderNo").value.trim();
    var productFile = _onlineProductFile;
    var shoppingFiles = _onlineShoppingPhotoFiles.slice();
    var amount = document.getElementById("inputOnlineAmount").value.trim();
    var remark = document.getElementById("inputOnlineRemark").value.trim();

    // 隐藏之前错误
    var errorEls = document.querySelectorAll("#modalOnlineOverlay .form-error");
    errorEls.forEach(function(el) { el.classList.remove("visible"); });
    var hasError = false;

    if (!paymentMethodValue) { _showError("errorOnlinePaymentMethod", "请选择支付方式"); hasError = true; }
    if (!shopName) { _showError("errorOnlineShopName", "请输入店铺名称"); hasError = true; }
    if (!platform) { _showError("errorOnlinePlatform", "请选择购物平台"); hasError = true; }
    if (!orderNo) { _showError("errorOnlineOrderNo", "请输入订单号"); hasError = true; }
    if (!productFile) { _showError("errorOnlineProduct", "请上传商品截图"); hasError = true; }
    if (!shoppingFiles || shoppingFiles.length === 0) { _showError("errorOnlineShopping", "请上传购物截图"); hasError = true; }
    if (!amount) { _showError("errorOnlineAmount", "请输入余额金额"); hasError = true; }
    if (!_onlineSignatureData) { _showError("errorOnlineSignature", "请手写签名"); hasError = true; }

    if (hasError) return;

    var btn = document.getElementById("btnSubmitOnlineVoucher");
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.classList.add("btn-loading");
    btn.textContent = "提交中...";

    var voucherData = {
      voucherType: "线上购物",
      platform: platform,
      orderNo: orderNo,
      shopName: shopName,
      date: new Date().toISOString().split("T")[0],
      shopPhoto: "", // 线上购物不用店铺照片，复用 shopPhoto 字段存商品截图
      orderPhotos: [], // 复用 orderPhotos 字段存购物截图
      productPhoto: "",
      shoppingPhotos: [],
      amount: amount.replace("元", ""),
      signature: _onlineSignatureData,
      remark: remark || "",
      username: _currentUser,
      status: "待审核",
      statusType: "pending",
      discount: "",
      discountValue: 0,
      originalPrice: amount,
      finalPrice: amount,
      paymentMethod: paymentMethodValue,
      paymentMethodText: paymentMethodText,
      paymentNote: paymentMethodText,
      _issueNumber: null,
      _createdAt: Date.now()
    };

    JITApi.getNextVoucherId().then(function(nextId) {
      voucherData.voucherId = nextId;
      return JITApi.ensureLabels();
    }).then(function() {
      // 使用 submitVoucherWithImages 处理上传 + 创建 Issue
      return JITApi.submitVoucherWithImages(
        voucherData,
        productFile,           // 商品截图（作为 shopPhoto 上传）
        shoppingFiles,         // 购物截图（作为 orderPhotos 上传）
        !!productFile,
        shoppingFiles.length > 0
      );
    }).then(function(result) {
      _showToast("线上购物凭证提交成功！", "success");
      _closeOnlineAddVoucherModal();
      JITApi.invalidateCache("allVouchers");
      JITApi.invalidateCache("allVouchersForId");
      // 积分奖励
      var awardPromises = [];
      try {
        if (JITPoints && JITPoints.changePoints) {
          awardPromises.push(
            JITPoints.changePoints(_currentUser, 15, "添加线上购物凭证").catch(function() {})
          );
        }
        if (JITPoints && JITPoints.signIn) {
          awardPromises.push(
            JITPoints.signIn(_currentUser).then(function(signResult) {
              if (signResult && signResult.bonusEarned) {
                _showToast("连续3天添加凭证 +30 积分！", "success");
              }
            }).catch(function() {})
          );
        }
      } catch(e) {}
      Promise.all(awardPromises).then(function() {
        _refreshPointsDisplay(true);
      });
      _loadData();
    }).catch(function(err) {
      console.error("提交线上购物凭证失败:", err);
      _showToast("提交失败: " + err.message, "error");
    }).finally(function() {
      btn.disabled = false;
      btn.classList.remove("btn-loading");
      btn.textContent = originalText;
    });
  };

  // ========= 大额电器补贴 =========
  var _openAddElectricModal = function() {
    if (!_currentUser) { _showToast("请先登录","error"); _showLoginPrompt(); return; }
    var overlay = document.getElementById("modalElectricOverlay");
    if (!overlay) return;
    overlay.classList.add("active");
    _resetElectricForm();
    setTimeout(function() { _initElectricSignatureCanvas(); }, 200);
  };

  var _closeAddElectricModal = function() {
    var overlay = document.getElementById("modalElectricOverlay");
    if (overlay) overlay.classList.remove("active");
  };

  var _resetElectricForm = function() {
    var fields = ["inputElectricOrderType","inputElectricShop","inputElectricCategory","inputElectricBrand","inputElectricAmount","inputElectricRemark"];
    fields.forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ""; });
    document.querySelectorAll('input[name="electricPaymentMethod"]').forEach(function(r) { r.checked = false; });
    // 清空上传
    _electricProductFile = null;
    _electricOrderFiles = [];
    var pimg = document.getElementById("previewElectricProduct");
    if (pimg) { pimg.src = ""; pimg.style.display = "none"; }
    var olist = document.getElementById("previewElectricOrder");
    if (olist) olist.innerHTML = "";
    // 清空签名
    _electricSignatureData = null;
    setTimeout(function() { _clearElectricSignature(); }, 50);
  };

  var _initElectricSignatureCanvas = function() {
    var canvas = document.getElementById("electricSignatureCanvas");
    if (!canvas) return;
    var parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    var ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    var drawing = false, lastX = 0, lastY = 0;
    function pos(e) {
      var rect = canvas.getBoundingClientRect();
      var t = e.touches && e.touches[0] ? e.touches[0] : e;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    function start(e) { e.preventDefault(); drawing = true; var p = pos(e); lastX = p.x; lastY = p.y; }
    function move(e) {
      if (!drawing) return; e.preventDefault();
      var p = pos(e);
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
      lastX = p.x; lastY = p.y;
    }
    function end(e) { if (drawing) { drawing = false; _electricSignatureData = canvas.toDataURL(); } }
    canvas.onmousedown = start; canvas.onmousemove = move; canvas.onmouseup = end; canvas.onmouseleave = end;
    canvas.ontouchstart = start; canvas.ontouchmove = move; canvas.ontouchend = end;
  };

  var _clearElectricSignature = function() {
    var canvas = document.getElementById("electricSignatureCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _electricSignatureData = null;
  };

  var _onElectricProductFileChange = function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    _electricProductFile = file;
    var preview = document.getElementById("previewElectricProduct");
    if (!preview) return;
    var reader = new FileReader();
    reader.onload = function(ev) { preview.src = ev.target.result; preview.style.display = "block"; };
    reader.readAsDataURL(file);
  };

  var _onElectricOrderFilesChange = function(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    _electricOrderFiles = _electricOrderFiles.concat(files);
    var list = document.getElementById("previewElectricOrder");
    if (!list) return;
    files.forEach(function(f) {
      var reader = new FileReader();
      reader.onload = function(ev) {
        var wrap = document.createElement("div");
        wrap.className = "upload-preview-item";
        var img = document.createElement("img"); img.src = ev.target.result;
        var rm = document.createElement("button");
        rm.className = "upload-preview-remove"; rm.textContent = "×";
        rm.addEventListener("click", function() {
          var i = _electricOrderFiles.indexOf(f);
          if (i >= 0) _electricOrderFiles.splice(i, 1);
          wrap.remove();
        });
        wrap.appendChild(img); wrap.appendChild(rm);
        list.appendChild(wrap);
      };
      reader.readAsDataURL(f);
    });
  };

  var _submitElectricVoucherForm = function() {
    if (!_currentUser) { _showToast("请先登录","error"); return; }
    var orderType = document.getElementById("inputElectricOrderType").value;
    var payRadio = document.querySelector('input[name="electricPaymentMethod"]:checked');
    var payVal = payRadio ? payRadio.value : "";
    var payText = payVal === "unionFirst" ? "工会先代替支付，再让用户支付优惠差价" : (payVal === "userFirst" ? "用户先支付全额，工会再给用户差价" : "");
    var shop = document.getElementById("inputElectricShop").value.trim();
    var cat = document.getElementById("inputElectricCategory").value;
    var brand = document.getElementById("inputElectricBrand").value.trim();
    var amountRaw = document.getElementById("inputElectricAmount").value.trim();
    var remark = document.getElementById("inputElectricRemark").value.trim();

    // 错误提示初始化隐藏
    var errorMap = {
      errorElectricOrderType: orderType ? "" : "请选择订单类型",
      errorElectricPaymentMethod: payVal ? "" : "请选择支付方式",
      errorElectricShop: shop ? "" : "请填写店铺 / 平台名称",
      errorElectricCategory: cat ? "" : "请选择电器分类",
      errorElectricBrand: brand ? "" : "请填写品牌名称",
      errorElectricProduct: _electricProductFile ? "" : "请上传商品实物照片",
      errorElectricOrder: _electricOrderFiles.length ? "" : "请上传订单 / 付款截图",
      errorElectricSignature: _electricSignatureData ? "" : "请手写签名"
    };
    var hasError = false;
    Object.keys(errorMap).forEach(function(k) {
      var el = document.getElementById(k);
      if (!el) return;
      if (errorMap[k]) { el.textContent = errorMap[k]; el.classList.add("visible"); hasError = true; }
      else { el.textContent = ""; el.classList.remove("visible"); }
    });
    // 金额校验
    var amtEl = document.getElementById("errorElectricAmount");
    var amtNum = parseFloat((amountRaw || "").replace(/元|,/g, ""));
    if (!amountRaw) {
      if (amtEl) { amtEl.textContent = "请输入消费金额"; amtEl.classList.add("visible"); hasError = true; }
    } else if (isNaN(amtNum) || amtNum <= 0) {
      if (amtEl) { amtEl.textContent = "消费金额格式不正确"; amtEl.classList.add("visible"); hasError = true; }
    } else if (amtNum < 3000) {
      if (amtEl) { amtEl.textContent = "大额电器补贴仅支持金额 ≥ 3000 元，当前：" + amtNum + " 元"; amtEl.classList.add("visible"); hasError = true; }
    } else {
      if (amtEl) { amtEl.textContent = ""; amtEl.classList.remove("visible"); }
    }
    if (hasError) return;

    var btn = document.getElementById("btnSubmitElectricVoucher");
    var originalText = btn.textContent;
    btn.disabled = true; btn.classList.add("btn-loading"); btn.textContent = "提交中...";

    var voucherData = {
      voucherType: "电器凭证",
      electric: true,                   // 大字段，用来识别这是大额电器补贴
      electricCategory: cat,            // 18 类之一
      electricBrand: brand,
      electricApplyAmount: amtNum.toFixed(2),   // 申请基数
      electricSubsidyRate: "",          // 留空，管理员审核填写（%）
      electricSubsidyAmount: "",        // 留空，管理员审核时算
      shopName: shop,
      date: new Date().toISOString().split("T")[0],
      shopPhoto: "",
      orderPhotos: [],
      amount: amtNum.toFixed(2) + "元",
      signature: _electricSignatureData,
      remark: remark || "",
      username: _currentUser,
      status: "待审核",
      statusType: "pending",
      discount: "",
      discountValue: 0,
      originalPrice: amtNum.toFixed(2) + "元",
      finalPrice: amtNum.toFixed(2) + "元",
      paymentMethod: payVal,
      paymentMethodText: payText,
      paymentNote: payText,
      _issueNumber: null,
      _createdAt: Date.now()
    };

    JITApi.getNextVoucherId().then(function(nextId) {
      voucherData.voucherId = nextId;
      return JITApi.ensureLabels();
    }).then(function() {
      return JITApi.submitVoucherWithImages(
        voucherData,
        _electricProductFile,
        _electricOrderFiles,
        !!_electricProductFile,
        _electricOrderFiles.length > 0
      );
    }).then(function(result) {
      _showToast("电器补贴凭证提交成功！等待管理员审核补贴比例", "success");
      _closeAddElectricModal();
      JITApi.invalidateCache("allVouchers");
      JITApi.invalidateCache("allVouchersForId");
      // 添加凭证 + 连续签到 积分
      var awardPromises = [];
      try {
        if (JITPoints && JITPoints.changePoints) {
          awardPromises.push(JITPoints.changePoints(_currentUser, 15, "添加电器补贴凭证").catch(function() {}));
        }
        if (JITPoints && JITPoints.signIn) {
          awardPromises.push(JITPoints.signIn(_currentUser).then(function(r){ if(r && r.bonusEarned) _showToast("连续3天添加凭证 +30 积分！","success"); }).catch(function() {}));
        }
      } catch(e) {}
      Promise.all(awardPromises).then(function(){ _refreshPointsDisplay(true); });
      _loadData();
    }).catch(function(err) {
      console.error("提交电器补贴凭证失败:", err);
      _showToast("提交失败: " + err.message, "error");
    }).finally(function() {
      btn.disabled = false; btn.classList.remove("btn-loading"); btn.textContent = originalText;
    });
  };

  var _saveLotteryResult = function(prize, targetVoucher) {
    var lotteryResults = JSON.parse(localStorage.getItem("jit_lottery_results") || "[]");
    lotteryResults.push({
      discount: prize.discount,
      value: prize.value,
      label: prize.label,
      date: new Date().toISOString().split("T")[0],
      username: _currentUser
    });
    localStorage.setItem("jit_lottery_results", JSON.stringify(lotteryResults));

    // ===== 积分：根据折扣发放 =====
    var lowDiscountIds = ["0折", "7折", "8折", "9折", "9.5折"];
    var highDiscountIds = ["10折", "11折", "12折", "13折", "14折"];
    var delta = 0;
    var reason = "";
    if (lowDiscountIds.indexOf(prize.discount) !== -1) {
      delta = 50;
      reason = "抽到 " + prize.discount + "（免单/7-9.5折）奖励";
    } else if (highDiscountIds.indexOf(prize.discount) !== -1) {
      delta = 60;
      reason = "抽到 " + prize.discount + "（10折及以上）奖励";
    }
    var ptsPromise = Promise.resolve();
    if (delta > 0 && JITPoints && JITPoints.changePoints) {
      ptsPromise = JITPoints.changePoints(_currentUser, delta, reason).then(function() {
        _refreshPointsDisplay(true);
        _showToast("抽奖积分奖励 +" + delta + " 分", "success");
      }).catch(function() {});
    }

    if (targetVoucher && targetVoucher._issueNumber) {
      var updatedVoucher = Object.assign({}, targetVoucher);
      updatedVoucher.discount = prize.discount;
      updatedVoucher.discountValue = prize.value;
      var amountValue = parseFloat(updatedVoucher.amount || updatedVoucher.originalPrice || 0);
      if (!isNaN(amountValue)) {
        updatedVoucher.finalPrice = (amountValue * prize.value).toFixed(2) + "元";
      }
      // 等待更新完成后再刷新数据
      JITApi.updateVoucherWithLottery(targetVoucher._issueNumber, updatedVoucher).then(function() {
        JITApi.invalidateCache("allVouchers");
        JITApi.invalidateCache("allVouchersForId");
        _loadData();
        return ptsPromise;
      }).then(function() {
        _showToast("保存成功！", "success");
      }).catch(function(err) {
        console.error("更新抽奖结果失败:", err);
        _showToast("抽奖结果保存失败，请重试", "error");
      });
    } else {
      ptsPromise.then(function() {
        _showToast("保存成功！", "success");
      });
    }
  };

  var _openPaymentModal = function(voucher) {
    if (!voucher) return;
    // 根据支付方式分流：工会先支付 → 二维码弹窗；用户先支付 → 原返还弹窗
    if (voucher.paymentMethodType === "unionFirst") {
      _openUnionFirstPayModal(voucher);
    } else {
      _openUserFirstPayModal(voucher);
    }
  };

  // 工会先支付弹窗：展示二维码 + 金额 + 「我已付款」按钮
  var _openUnionFirstPayModal = function(voucher) {
    var originalAmount = parseFloat(voucher.originalPrice || voucher.amount || 0);
    var discountValue = parseFloat(voucher.discountValue || 1);
    var finalAmount = isNaN(originalAmount) ? 0 : (originalAmount * discountValue);
    // 工会先支付：用户需向工会支付「优惠后金额」
    var payAmount = finalAmount;

    _pendingPaymentVoucher = voucher;
    _pointsOffsetUsed = false;

    var overlay = document.getElementById("unionFirstPayOverlay");
    if (!overlay) return;
    var subEl = document.getElementById("unionPaySub");
    var amountEl = document.getElementById("unionPayAmount");
    var qrEl = document.getElementById("unionPayQrCode");

    if (subEl) {
      subEl.innerHTML = "原价：¥" + originalAmount.toFixed(2) + "<br>折扣：" + (voucher.discount || "10折") + "<br>工会已代付：¥" + originalAmount.toFixed(2) + "<br>您需向工会支付：¥" + payAmount.toFixed(2);
    }
    if (amountEl) amountEl.textContent = "¥" + payAmount.toFixed(2);
    if (qrEl && JITConfig.getUnionPayQrUrl) qrEl.src = JITConfig.getUnionPayQrUrl();

    overlay.classList.add("active");
  };

  var _closeUnionFirstPayModal = function() {
    var overlay = document.getElementById("unionFirstPayOverlay");
    if (overlay) overlay.classList.remove("active");
    _pendingPaymentVoucher = null;
    _pointsOffsetUsed = false;
  };

  // 工会先支付：用户点击「我已付款」→ 提交审核（更新状态为「已付款·待确认」，加 paid label）
  var _submitUnionPaid = function() {
    if (!_pendingPaymentVoucher) return;
    var issueNum = _pendingPaymentVoucher._issueNumber;
    if (!issueNum) {
      _showToast("凭证信息缺失，无法提交", "error");
      return;
    }
    var btn = document.getElementById("btnUnionPaid");
    if (btn) { btn.disabled = true; btn.textContent = "提交中..."; }
    if (JITApi.markVoucherPaid) {
      JITApi.markVoucherPaid(issueNum).then(function() {
        _showToast("已提交，等待管理员确认付款", "success");
        _closeUnionFirstPayModal();
        JITApi.invalidateCache("allVouchers");
        JITApi.invalidateCache("allVouchersForId");
        _loadData();
      }).catch(function(err) {
        if (btn) { btn.disabled = false; btn.textContent = "我已付款"; }
        _showToast("提交失败: " + (err.message || ""), "error");
      });
    } else {
      if (btn) { btn.disabled = false; btn.textContent = "我已付款"; }
      _showToast("提交失败: 接口缺失", "error");
    }
  };

  // 用户先支付弹窗：展示返还/补差信息 + 积分抵消入口
  var _openUserFirstPayModal = function(voucher) {
    var originalAmount = parseFloat(voucher.originalPrice || voucher.amount || 0);
    var discountValue = parseFloat(voucher.discountValue || 1);
    var finalAmount = isNaN(originalAmount) ? 0 : (originalAmount * discountValue);
    var discountAmount = originalAmount - finalAmount;

    _pendingPaymentVoucher = voucher;
    _pointsOffsetUsed = false;

    var overlay2 = document.getElementById("userFirstPayOverlay");
    var subEl = document.getElementById("userFirstPaySub");
    var offsetBox = document.getElementById("pointsOffsetBox");
    var offsetResultEl = document.getElementById("offsetResult");
    if (offsetResultEl) offsetResultEl.textContent = "";
    var btn = document.getElementById("btnUsePointsOffset");
    if (btn) btn.disabled = false;

    // 积分抵消需审核通过后才能用
    var isApproved = (voucher.statusType === "approved" || voucher.statusType === "completed");

    if (overlay2) {
      if (subEl) {
        var amountLabel, amountText;
        if (discountAmount > 0) {
          // 低折扣（7/8/9折）：用户省钱，工会返钱
          amountLabel = "工会返还";
          amountText = "¥" + discountAmount.toFixed(2) + "（工会额外给您）";
        } else if (discountAmount < 0) {
          // 高折扣（11/12/13/14折）：用户需补差额
          amountLabel = "您需补差额";
          amountText = "¥" + Math.abs(discountAmount).toFixed(2) + "（需额外支付）";
        } else {
          // 10折：持平
          amountLabel = "工会返还";
          amountText = "¥0.00";
        }
        subEl.innerHTML = "原价：¥" + originalAmount.toFixed(2) + "<br>折扣：" + (voucher.discount || "10折") + "<br>您先支付：¥" + originalAmount.toFixed(2) + "<br>" + amountLabel + "：" + amountText;
      }

      // 当 discountValue > 1（10 折以上）时，用户需要补钱，显示积分抵消入口
      var needPayYuan = Math.max(0, -discountAmount);  // 用户需要补的金额（元）
      if (offsetBox) {
        if (needPayYuan > 0.001 && isApproved) {
          // 审核通过 + 需补差额：显示积分抵消
          offsetBox.style.display = "block";
          var needPayEl = document.getElementById("offsetNeedPay");
          if (needPayEl) needPayEl.textContent = "¥" + needPayYuan.toFixed(2);
          var canPayEl = document.getElementById("offsetCanPay");
          var canPayYuan = Math.floor(_currentPoints / 10) * 1.0;
          if (canPayEl) canPayEl.textContent = "¥" + (Math.min(canPayYuan, needPayYuan)).toFixed(2);
          var curPtsEl = document.getElementById("offsetCurrentPoints");
          if (curPtsEl) curPtsEl.textContent = String(_currentPoints);
        } else if (needPayYuan > 0.001 && !isApproved) {
          // 未审核通过：提示需先等审核
          offsetBox.style.display = "block";
          offsetBox.innerHTML = '<div style="font-size:13px;color:var(--orange);text-align:center;padding:8px;">⏳ 凭证审核通过后即可使用积分抵消差额</div>';
        } else {
          offsetBox.style.display = "none";
        }
      }

      overlay2.classList.add("active");
    }
  };

  // 使用积分抵消差额（审核通过后可用，抵消完自动标记已完成交易）
  var _doUsePointsOffset = function() {
    if (!_pendingPaymentVoucher) return;
    if (_pointsOffsetUsed) {
      _showToast("本笔已使用积分抵消", "");
      return;
    }
    // 必须审核通过后才能抵消
    var st = _pendingPaymentVoucher.statusType;
    if (st !== "approved" && st !== "completed") {
      _showToast("凭证审核通过后才能使用积分抵消", "error");
      return;
    }
    var originalAmount = parseFloat(_pendingPaymentVoucher.originalPrice || _pendingPaymentVoucher.amount || 0);
    var discountValue = parseFloat(_pendingPaymentVoucher.discountValue || 1);
    var finalAmount = isNaN(originalAmount) ? 0 : (originalAmount * discountValue);
    var discountAmount = originalAmount - finalAmount;
    var needPayYuan = Math.max(0, -discountAmount);
    if (needPayYuan < 0.001) {
      _showToast("本笔无需抵消（抽奖结果是您赚钱）", "");
      return;
    }
    var needPoints = Math.ceil(needPayYuan * 10);  // 10 积分=1元，向上取整
    var usePoints = Math.min(needPoints, _currentPoints);
    if (usePoints <= 0) {
      _showToast("积分不足（10 积分 = 1 元），请先赚取积分", "error");
      return;
    }
    var btn = document.getElementById("btnUsePointsOffset");
    if (btn) { btn.disabled = true; }
    var offsetResultEl = document.getElementById("offsetResult");
    if (offsetResultEl) offsetResultEl.textContent = "抵消中...";
    var actualOffsetYuan = usePoints / 10;
    var issueNum = _pendingPaymentVoucher._issueNumber;
    JITPoints.changePoints(_currentUser, -usePoints, "用积分抵消 ¥" + actualOffsetYuan.toFixed(2) + " 支付差额").then(function() {
      _pointsOffsetUsed = true;
      if (offsetResultEl) offsetResultEl.textContent = "✅ 已抵消 ¥" + actualOffsetYuan.toFixed(2);
      _showToast("成功使用 " + usePoints + " 积分抵消 ¥" + actualOffsetYuan.toFixed(2), "success");
      // 抵消完毕 → 自动标记为已完成交易
      if (issueNum && JITApi.markVoucherCompleted) {
        return JITApi.markVoucherCompleted(issueNum).then(function() {
          _showToast("交易已完成", "success");
          JITApi.invalidateCache("allVouchers");
          JITApi.invalidateCache("allVouchersForId");
          _loadData();
        });
      }
      return _refreshPointsDisplay(true);
    }).then(function() {
      return _refreshPointsDisplay(true);
    }).catch(function(err) {
      if (offsetResultEl) offsetResultEl.textContent = "";
      if (btn) btn.disabled = false;
      _showToast("抵消失败: " + (err.message || ""), "error");
    });
  };

  // 兑换幸运抽奖
  var _doEnableLucky = function() {
    if (!_currentUser) return;
    // 先检查积分够不够
    var cost = 45;
    if (_currentPoints < cost) {
      _showToast("积分不足！需要 " + cost + " 积分，当前 " + _currentPoints + " 分。添加凭证可赚积分~", "error");
      return;
    }
    // 如果已经启用，无需重复
    if (JITLottery.isLuckyMode()) {
      _showToast("本轮幸运抽奖模式已开启", "");
      return;
    }
    var btn = document.getElementById("btnEnableLucky");
    if (btn) btn.disabled = true;
    JITPoints.changePoints(_currentUser, -cost, "兑换幸运抽奖 1 次").then(function() {
      var ok = JITLottery.enableLuckyMode();
      if (ok) {
        var hint = document.getElementById("luckyModeHint");
        if (hint) hint.style.display = "block";
        var bar = document.getElementById("luckyLotteryBar");
        if (bar) bar.style.display = "none"; // 已开启就隐藏入口
        _showToast("🍀 已兑换幸运抽奖！9.5折及以下概率提高", "success");
      } else {
        _showToast("幸运抽奖启用失败", "error");
      }
      return _refreshPointsDisplay(true);
    }).catch(function(err) {
      if (btn) btn.disabled = false;
      _showToast("兑换失败: " + (err.message || ""), "error");
    });
  };

  var _closeUserFirstPayModal = function() {
    var overlay = document.getElementById("userFirstPayOverlay");
    if (overlay) overlay.classList.remove("active");
    _pendingPaymentVoucher = null;
    _pointsOffsetUsed = false;
  };

  var _showToast = function(msg, type) {
    var toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.className = "toast " + (type || "");
    toast.classList.add("show");
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(function() {
      toast.classList.remove("show");
    }, 3000);
  };

  var _escapeHtml = function(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  };

  var _openChatModal = function() {
    var overlay = document.getElementById("chatOverlay");
    if (!overlay || !_currentUser) return;
    overlay.classList.add("active");
    _loadChatMessages();
  };

  var _closeChatModal = function() {
    var overlay = document.getElementById("chatOverlay");
    if (overlay) overlay.classList.remove("active");
  };

  var _getUserIssues = function() {
    var userIssues = [];
    _allVouchers.forEach(function(v) {
      if (v.username === _currentUser || v._username === _currentUser) {
        userIssues.push(v._issueNumber);
      }
    });
    if (_chatIssueNumber && userIssues.indexOf(_chatIssueNumber) === -1) {
      userIssues.push(_chatIssueNumber);
    }
    return userIssues;
  };

  var _getOrCreateChatIssue = function() {
    if (_chatIssueNumber) return Promise.resolve(_chatIssueNumber);
    var issues = _getUserIssues();
    if (issues.length > 0) {
      _chatIssueNumber = issues[0];
      localStorage.setItem("jit_chat_issue_" + _currentUser, String(_chatIssueNumber));
      return Promise.resolve(_chatIssueNumber);
    }
    return JITApi.submitVoucher({
      username: _currentUser,
      shopName: "【聊天专用】",
      amount: "0",
      date: new Date().toISOString().split("T")[0],
      paymentMethod: "chat",
      remark: "聊天专用凭证"
    }).then(function(result) {
      _chatIssueNumber = result.number;
      localStorage.setItem("jit_chat_issue_" + _currentUser, String(_chatIssueNumber));
      return _chatIssueNumber;
    });
  };

  var _loadChatMessages = function() {
    var container = document.getElementById("chatMessages");
    if (!container) return;
    container.innerHTML = '<div class="chat-loading">加载中...</div>';
    if (!_currentUser) return;
    var issues = _getUserIssues();
    if (issues.length === 0) {
      container.innerHTML = '<div class="chat-empty">欢迎！有问题随时提问～</div>';
      return;
    }
    var promises = issues.map(function(num) {
      return JITApi.getIssueComments(num);
    });
    Promise.all(promises).then(function(results) {
      var allMsgs = [];
      results.forEach(function(comments) {
        comments.forEach(function(c) {
          if (c.body && c.body.indexOf("｜CHAT｜") === 0) {
            allMsgs.push({
              type: c.user.login === JITConfig.getRepoOwner() ? "admin" : "user",
              body: c.body.replace("｜CHAT｜", ""),
              time: c.created_at,
              user: c.user.login
            });
          }
        });
      });
      allMsgs.sort(function(a, b) { return new Date(a.time) - new Date(b.time); });
      if (allMsgs.length === 0) {
        container.innerHTML = '<div class="chat-empty">暂无消息，给客服发一条吧！</div>';
      } else {
        var html = "";
        allMsgs.forEach(function(msg) {
          html += '<div class="chat-message ' + msg.type + '">';
          if (msg.body.indexOf("[IMG]") === 0) {
            html += '<div><img src="' + _escapeHtml(encodeURI(msg.body.replace("[IMG]", ""))) + '" style="max-width:200px;max-height:200px;border-radius:8px;cursor:pointer;" onclick="window.open(this.src)"></div>';
          } else if (msg.body.indexOf("[VOUCHER]") === 0) {
            var vNum = msg.body.replace("[VOUCHER]", "").trim();
            html += '<div><a href="javascript:void(0)" onclick="JITApp._openVoucherDetail(' + vNum + ')" style="color:#0366d6;text-decoration:underline;">📋 查看凭证 #' + vNum + '</a></div>';
          } else {
            html += '<div>' + _escapeHtml(msg.body) + '</div>';
          }
          html += '<div class="chat-time">' + new Date(msg.time).toLocaleString("zh-CN") + '</div>';
          html += '</div>';
        });
        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
      }
      setTimeout(function() {
        container.scrollTop = container.scrollHeight;
      }, 100);
    }).catch(function(err) {
      container.innerHTML = '<div class="chat-loading" style="color:#f44336;">加载失败: ' + _escapeHtml(err.message) + '</div>';
    });
  };

  var _sendChatMessage = function() {
    var input = document.getElementById("chatInput");
    if (!input) return;
    var msg = input.value.trim();
    if (!msg) return;
    if (!_currentUser) return;
    input.value = "";
    input.disabled = true;
    document.getElementById("btnChatSend").disabled = true;
    _getOrCreateChatIssue().then(function(issueNum) {
      return JITApi.addIssueComment(issueNum, "｜CHAT｜" + msg);
    }).then(function() {
      _loadChatMessages();
      input.disabled = false;
      document.getElementById("btnChatSend").disabled = false;
      input.focus();
    }).catch(function(err) {
      _showToast("发送失败: " + err.message, "error");
      input.disabled = false;
      document.getElementById("btnChatSend").disabled = false;
    });
  };

  var _sendChatImage = function(file) {
    if (!file || !_currentUser) return;
    _showToast("上传图片中...", "");
    var sendBtn = document.getElementById("btnChatSend");
    if (sendBtn) sendBtn.disabled = true;
    _getOrCreateChatIssue().then(function(issueNum) {
      return JITApi.uploadChatImage(file, _currentUser);
    }).then(function(url) {
      if (!url) { _showToast("图片上传失败", "error"); return; }
      return _getOrCreateChatIssue().then(function(issueNum) {
        return JITApi.addIssueComment(issueNum, "｜CHAT｜[IMG]" + url);
      });
    }).then(function() {
      _loadChatMessages();
    }).catch(function(err) {
      _showToast("发送图片失败: " + err.message, "error");
    }).finally(function() {
      if (sendBtn) sendBtn.disabled = false;
    });
  };

  var _attachVoucher = function() {
    if (!_currentUser) return;
    var vouchers = _allVouchers.filter(function(v) {
      return v.username === _currentUser && v.shopName !== "【聊天专用】";
    });
    if (vouchers.length === 0) {
      _showToast("您还没有凭证可指定", "error");
      return;
    }
    var html = "";
    vouchers.forEach(function(v) {
      html += '<div class="chat-voucher-pick" data-issue="' + v._issueNumber + '" style="padding:10px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:8px;cursor:pointer;">';
      html += '<div style="font-weight:bold;">' + _escapeHtml(v.shopName || "未知") + '</div>';
      html += '<div style="font-size:12px;color:var(--text-secondary);">日期: ' + _escapeHtml(v.date || "-") + ' · 金额: ' + _escapeHtml(v.originalPrice || "-") + ' · 折扣: ' + _escapeHtml(v.discount || "未抽奖") + '</div>';
      html += '</div>';
    });
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;";
    var box = document.createElement("div");
    box.style.cssText = "background:var(--bg-panel);border-radius:12px;padding:20px;max-width:400px;width:90%;max-height:60vh;overflow-y:auto;";
    box.innerHTML = '<h3 style="margin:0 0 12px;">选择要发送的凭证</h3>' + html + '<button id="btnCloseVoucherPick" style="margin-top:8px;width:100%;padding:8px;border:none;border-radius:8px;background:var(--bg-card);color:var(--text-primary);cursor:pointer;">取消</button>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.querySelectorAll(".chat-voucher-pick").forEach(function(item) {
      item.addEventListener("click", function() {
        var issueNum = this.getAttribute("data-issue");
        document.body.removeChild(overlay);
        _getOrCreateChatIssue().then(function(chatIssueNum) {
          return JITApi.addIssueComment(chatIssueNum, "｜CHAT｜[VOUCHER]" + issueNum);
        }).then(function() {
          _showToast("凭证已发送", "success");
          _loadChatMessages();
        }).catch(function(err) {
          _showToast("发送失败: " + err.message, "error");
        });
      });
    });
    document.getElementById("btnCloseVoucherPick").addEventListener("click", function() {
      document.body.removeChild(overlay);
    });
  };

  var _openVoucherDetail = function(issueNum) {
    JITApi.getIssue(issueNum).then(function(issue) {
      var v = JITApi.parseVoucherData(issue);
      if (!v) { _showToast("无法加载凭证", "error"); return; }
      var overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;";
      var box = document.createElement("div");
      box.style.cssText = "background:var(--bg-panel);border-radius:12px;padding:20px;max-width:400px;width:90%;max-height:70vh;overflow-y:auto;";
      var html = '<h3 style="margin:0 0 12px;">凭证详情 #' + issueNum + '</h3>';
      html += '<div style="margin-bottom:6px;"><strong>店铺：</strong>' + _escapeHtml(v.shopName || "-") + '</div>';
      html += '<div style="margin-bottom:6px;"><strong>日期：</strong>' + _escapeHtml(v.date || "-") + '</div>';
      html += '<div style="margin-bottom:6px;"><strong>金额：</strong>' + _escapeHtml(v.originalPrice || "-") + '</div>';
      html += '<div style="margin-bottom:6px;"><strong>折扣：</strong>' + _escapeHtml(v.discount || "未抽奖") + '</div>';
      html += '<div style="margin-bottom:6px;"><strong>状态：</strong>' + _escapeHtml(v.status || "-") + '</div>';
      if (v.remark) html += '<div style="margin-bottom:6px;"><strong>备注：</strong>' + _escapeHtml(v.remark) + '</div>';
      if (v.rejectReason) html += '<div style="margin-bottom:6px;color:#f44336;"><strong>拒绝原因：</strong>' + _escapeHtml(v.rejectReason) + '</div>';
      if (v.shopPhoto) html += '<div style="margin:8px 0;"><strong>店铺照片</strong><br><img src="' + encodeURI(v.shopPhoto) + '" style="max-width:100%;border-radius:8px;margin-top:4px;"></div>';
      if (v.orderPhotos) {
        var urls = v.orderPhotos.split("|").map(function(s) { return s.trim(); }).filter(Boolean);
        if (urls.length > 0) {
          html += '<div style="margin:8px 0;"><strong>订单照片</strong><br>';
          urls.forEach(function(u) { html += '<img src="' + encodeURI(u) + '" style="max-width:100%;border-radius:8px;margin-top:4px;">'; });
          html += '</div>';
        }
      }
      if (v.signature) html += '<div style="margin:8px 0;"><strong>签名</strong><br><img src="' + encodeURI(v.signature) + '" style="max-width:200px;border-radius:8px;margin-top:4px;"></div>';
      // ===== 加急审核按钮（仅未审核且未加急时显示）=====
      var isUrgent = (v._labels || []).indexOf("urgent") > -1;
      if (v.statusType === "pending") {
        if (isUrgent) {
          html += '<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:rgba(244,67,54,0.1);border:1px solid rgba(244,67,54,0.3);text-align:center;font-size:13px;color:#f44336;font-weight:600;">⚡ 已申请加急，管理员将优先处理</div>';
        } else {
          html += '<button id="btnApplyUrgent" style="margin-top:12px;width:100%;padding:10px;border:none;border-radius:8px;background:linear-gradient(135deg,#ff7043,#f44336);color:#fff;font-weight:600;cursor:pointer;font-size:13px;">⚡ 申请加急审核</button>';
        }
      }
      html += '<button id="btnCloseVoucherDetail" style="margin-top:8px;width:100%;padding:8px;border:none;border-radius:8px;background:var(--bg-card);color:var(--text-primary);cursor:pointer;">关闭</button>';
      box.innerHTML = html;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      var urgentBtn = document.getElementById("btnApplyUrgent");
      if (urgentBtn) {
        urgentBtn.addEventListener("click", function() {
          _applyUrgentReview(v);
        });
      }
      document.getElementById("btnCloseVoucherDetail").addEventListener("click", function() {
        document.body.removeChild(overlay);
      });
      overlay.addEventListener("click", function(e) {
        if (e.target === overlay) document.body.removeChild(overlay);
      });
    }).catch(function(err) {
      _showToast("加载凭证失败: " + err.message, "error");
    });
  };

  // ========= 通知系统 =========
  var _currentNotifDetailIssue = null;

  var _loadNotifications = function() {
    if (!_currentUser) return Promise.resolve();
    return JITApi.getUserNotifications(_currentUser).then(function(list) {
      var badge = document.getElementById("notificationBadge");
      if (badge) {
        if (list && list.length > 0) {
          badge.textContent = list.length > 99 ? "99+" : String(list.length);
          badge.style.display = "block";
        } else {
          badge.style.display = "none";
        }
      }
      // 若通知列表弹窗打开，则同步刷新
      var overlay = document.getElementById("notificationOverlay");
      if (overlay && overlay.classList.contains("active")) {
        _renderNotifications(list || []);
      }
      return list || [];
    }).catch(function() {
      return [];
    });
  };

  var _openNotificationList = function() {
    var overlay = document.getElementById("notificationOverlay");
    if (!overlay) return;
    overlay.classList.add("active");
    var listEl = document.getElementById("notificationList");
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">加载中...</div>';
    if (!_currentUser) {
      if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">请先登录</div>';
      return;
    }
    JITApi.getUserNotifications(_currentUser).then(function(list) {
      _renderNotifications(list || []);
    }).catch(function(err) {
      if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#f44336;">加载失败: ' + _escapeHtml(err.message) + '</div>';
    });
  };

  var _closeNotificationList = function() {
    var overlay = document.getElementById("notificationOverlay");
    if (overlay) overlay.classList.remove("active");
  };

  var _renderNotifications = function(list) {
    var listEl = document.getElementById("notificationList");
    if (!listEl) return;
    if (!list || list.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">暂无通知</div>';
      return;
    }
    var html = "";
    list.forEach(function(n) {
      var targetTag = (n.targetUsers === "all") ? '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(76,175,80,0.15);color:#4caf50;margin-right:6px;">全体</span>' : '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(33,150,243,0.15);color:#2196f3;margin-right:6px;">定向</span>';
      html += '<div class="notification-item" data-notif="' + n.issueNumber + '" style="padding:12px 14px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:10px;cursor:pointer;transition:all .2s ease;">';
      html += '<div style="font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:4px;">' + targetTag + _escapeHtml(n.title) + '</div>';
      html += '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _escapeHtml(n.content) + '</div>';
      html += '<div style="font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center;">';
      html += '<span>' + _escapeHtml(n.sendTime || "") + '</span>';
      if (n.comments && n.comments > 0) {
        html += '<span style="color:var(--accent);">💬 ' + n.comments + ' 条回复</span>';
      }
      html += '</div>';
      html += '</div>';
    });
    listEl.innerHTML = html;
    listEl.querySelectorAll(".notification-item").forEach(function(item) {
      item.addEventListener("click", function() {
        _openNotificationDetail(parseInt(this.getAttribute("data-notif")));
      });
    });
  };

  var _openNotificationDetail = function(issueNumber) {
    var overlay = document.getElementById("notificationDetailOverlay");
    if (!overlay) return;
    _currentNotifDetailIssue = issueNumber;
    overlay.classList.add("active");
    var titleEl = document.getElementById("notifDetailTitle");
    var contentEl = document.getElementById("notifDetailContent");
    var repliesEl = document.getElementById("notifMyReplies");
    var inputEl = document.getElementById("inputNotifReply");
    if (inputEl) inputEl.value = "";
    if (titleEl) titleEl.textContent = "通知详情";
    if (contentEl) contentEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">加载中...</div>';
    if (repliesEl) repliesEl.innerHTML = "";

    JITApi.getAllNotifications().then(function(list) {
      var n = list.find(function(x) { return x.issueNumber === issueNumber; });
      if (titleEl) titleEl.textContent = n ? ("🔔 " + n.title) : "通知详情";
      if (contentEl) {
        if (!n) {
          contentEl.innerHTML = '<div style="color:#f44336;">通知不存在或已被删除</div>';
        } else {
          var html = '<div style="padding:12px 14px;border-radius:10px;background:rgba(33,150,243,0.06);border:1px solid rgba(33,150,243,0.2);margin-bottom:8px;">';
          html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">发送者：管理员 · ' + _escapeHtml(n.sendTime || "") + '</div>';
          html += '<div style="font-size:14px;line-height:1.6;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;">' + _escapeHtml(n.content) + '</div>';
          html += '</div>';
          contentEl.innerHTML = html;
        }
      }
      // 拉取该通知的所有回复（含其他用户）
      return JITApi.getNotificationReplies(issueNumber);
    }).then(function(replies) {
      _renderNotifReplies(replies || []);
    }).catch(function(err) {
      if (contentEl) contentEl.innerHTML = '<div style="color:#f44336;">加载失败: ' + _escapeHtml(err.message) + '</div>';
    });
  };

  var _closeNotificationDetail = function() {
    var overlay = document.getElementById("notificationDetailOverlay");
    if (overlay) overlay.classList.remove("active");
    _currentNotifDetailIssue = null;
  };

  var _renderNotifReplies = function(replies) {
    var repliesEl = document.getElementById("notifMyReplies");
    if (!repliesEl) return;
    if (!replies || replies.length === 0) {
      repliesEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">暂无回复，快来抢沙发~</div>';
      return;
    }
    var html = "";
    replies.forEach(function(r) {
      var isMe = (r.username === _currentUser);
      var alignStyle = isMe ? "text-align:right;" : "text-align:left;";
      var bgStyle = isMe ? "background:rgba(76,175,80,0.12);border:1px solid rgba(76,175,80,0.3);" : "background:var(--bg-card);border:1px solid var(--border-color);";
      html += '<div style="margin-bottom:8px;' + alignStyle + '">';
      html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">' + _escapeHtml(r.username) + (isMe ? '（我）' : '') + ' · ' + _escapeHtml((r.time || "").replace("T", " ").slice(0, 16)) + '</div>';
      html += '<div style="display:inline-block;max-width:80%;padding:8px 12px;border-radius:10px;font-size:13px;word-break:break-word;' + bgStyle + '">' + _escapeHtml(r.message) + '</div>';
      html += '</div>';
    });
    repliesEl.innerHTML = html;
    repliesEl.scrollTop = repliesEl.scrollHeight;
  };

  var _submitNotifReply = function() {
    if (!_currentUser) { _showToast("请先登录", "error"); return; }
    if (!_currentNotifDetailIssue) { _showToast("未选中通知", "error"); return; }
    var inputEl = document.getElementById("inputNotifReply");
    if (!inputEl) return;
    var msg = (inputEl.value || "").trim();
    if (!msg) { _showToast("请输入回复内容", "error"); return; }
    if (msg.length > 500) { _showToast("回复内容不能超过500字", "error"); return; }
    var btn = document.getElementById("btnSendNotifReply");
    if (btn) btn.disabled = true;
    JITApi.replyNotification(_currentNotifDetailIssue, _currentUser, msg).then(function() {
      inputEl.value = "";
      _showToast("回复成功", "success");
      // 刷新回复列表
      return JITApi.getNotificationReplies(_currentNotifDetailIssue).then(function(replies) {
        _renderNotifReplies(replies || []);
      });
    }).catch(function(err) {
      _showToast("回复失败: " + err.message, "error");
    }).finally(function() {
      if (btn) btn.disabled = false;
    });
  };

  // ========= 申请加急审核 =========
  var _applyUrgentReview = function(voucher) {
    if (!voucher) return;
    if (voucher.statusType && voucher.statusType !== "pending") {
      _showToast("只能对未审核的凭证申请加急", "error");
      return;
    }
    var alreadyUrgent = (voucher._labels || []).indexOf("urgent") > -1;
    if (alreadyUrgent) {
      _showToast("该凭证已申请过加急，请耐心等待管理员审核", "");
      return;
    }
    if (!confirm("确定申请加急审核吗？\n\n加急后管理员将优先处理此凭证。\n（请勿滥用，恶意加急可能影响后续审核）")) return;
    JITApi.markUrgent(voucher._issueNumber).then(function() {
      _showToast("⚡ 加急申请已提交，管理员将优先审核", "success");
      // 关闭详情弹窗
      var overlays = document.querySelectorAll('.modal-overlay[style*="z-index:9999"]');
      overlays.forEach(function(o) {
        if (o.parentNode) o.parentNode.removeChild(o);
      });
      // 刷新本地数据
      if (voucher._labels) voucher._labels.push("urgent");
      _loadData();
    }).catch(function(err) {
      _showToast("申请失败: " + err.message, "error");
    });
  };

  var _initChatEvents = function() {
    var closeBtn = document.getElementById("btnChatClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", _closeChatModal);
    }
    var overlay = document.getElementById("chatOverlay");
    if (overlay) {
      overlay.addEventListener("click", function(e) {
        if (e.target === overlay) _closeChatModal();
      });
    }
    var sendBtn = document.getElementById("btnChatSend");
    if (sendBtn) {
      sendBtn.addEventListener("click", _sendChatMessage);
    }
    var input = document.getElementById("chatInput");
    if (input) {
      input.addEventListener("keydown", function(e) {
        if (e.key === "Enter") _sendChatMessage();
      });
    }
    var plusBtn = document.getElementById("btnChatPlus");
    var extraMenu = document.getElementById("chatExtraMenu");
    if (plusBtn && extraMenu) {
      plusBtn.addEventListener("click", function() {
        extraMenu.style.display = extraMenu.style.display === "none" ? "block" : "none";
      });
    }
    var attachVoucherBtn = document.getElementById("btnChatAttachVoucher");
    if (attachVoucherBtn) {
      attachVoucherBtn.addEventListener("click", function() {
        if (extraMenu) extraMenu.style.display = "none";
        _attachVoucher();
      });
    }
    var chatImgInput = document.getElementById("chatImageInput");
    if (chatImgInput) {
      chatImgInput.addEventListener("change", function() {
        var file = this.files[0];
        if (!file) return;
        this.value = "";
        _sendChatImage(file);
      });
    }
  };

  _initChatEvents();

  return {
    init: _init,
    _openVoucherDetail: _openVoucherDetail,
    // 暴露给 work.html 内嵌 onclick 调用（顶部大卡片 / footer 固定入口点击跳转到电器补贴弹窗）
    jumpToElectric: function() {
      var overlay = document.getElementById("modalOverlay");
      if (overlay) overlay.classList.remove("active");
      if (typeof _openAddElectricModal === "function") _openAddElectricModal();
    }
  };
})();

document.addEventListener("DOMContentLoaded", function() {
  JITApp.init();
});