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

  var _init = function() {
    _initBackgroundParticles();
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
      _currentUser = savedUser;
      _updateLogoutText();
      var savedChat = localStorage.getItem("jit_chat_issue_" + savedUser);
      if (savedChat) _chatIssueNumber = parseInt(savedChat, 10);
      _refreshPointsDisplay();
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
      '<div class="modal-footer" style="justify-content:space-between;">' +
      '<button class="btn-submit" id="btnLogin" style="flex:1;margin-right:8px;">登 录</button>' +
      '<button class="btn-submit" id="btnShowRegister" style="flex:1;margin-left:8px;background:transparent;color:var(--accent);border:1px solid var(--accent);">注 册</button></div>' +
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

      // 先检查内置用户
      if (users[username] && users[username] === password) {
        _currentUser = username;
        localStorage.setItem("jit_current_user", username);
        _updateLogoutText();
        overlay.remove();
        _showToast("登录成功，欢迎 " + username, "success");
        _loadData();
        _refreshPointsDisplay();
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
          } else {
            errorEl.style.display = "block";
            errorEl.textContent = "用户名或密码错误";
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

    document.getElementById("btnShowRegister").addEventListener("click", function() {
      overlay.remove();
      _showRegisterPrompt();
    });
  };

  // ======= 注册功能 =======
  var _showRegisterPrompt = function() {
    var referrer = localStorage.getItem("jit_referrer") || "";
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.cssText = "opacity:1;visibility:visible;z-index:2000;";
    overlay.innerHTML = '<div class="modal-container" style="max-width:380px;transform:translateY(0);">' +
      '<div class="modal-header"><h3 class="modal-title">注册玉国金融</h3></div>' +
      '<div class="modal-body">' +
      '<div class="form-group"><label class="form-label">用户名</label>' +
      '<input type="text" class="form-input" id="regUsername" placeholder="请输入用户名（2-20个字符）"></div>' +
      '<div class="form-group"><label class="form-label">密码</label>' +
      '<input type="password" class="form-input" id="regPassword" placeholder="请输入密码（至少6位）"></div>' +
      '<div class="form-group"><label class="form-label">确认密码</label>' +
      '<input type="password" class="form-input" id="regPassword2" placeholder="请再次输入密码"></div>' +
      (referrer ? '<div class="form-group"><label class="form-label">邀请人</label><input type="text" class="form-input" id="regReferrer" value="' + _escapeHtml(referrer) + '" readonly style="background:rgba(255,255,255,0.05);"></div>' : '<div class="form-group"><label class="form-label">邀请人（选填）</label><input type="text" class="form-input" id="regReferrer" placeholder="输入邀请人用户名"></div>') +
      '<div class="form-error" id="regError" style="display:none;"></div>' +
      '<div style="text-align:center;font-size:12px;color:var(--text-secondary);margin-top:8px;">注册成功即送' + JITPoints.RULES.INVITE_REWARD + '积分，邀请人也得' + JITPoints.RULES.INVITE_REWARD + '积分</div>' +
      '</div>' +
      '<div class="modal-footer" style="justify-content:space-between;">' +
      '<button class="btn-submit" id="btnBackLogin" style="flex:1;margin-right:8px;background:transparent;color:var(--text-secondary);border:1px solid var(--text-secondary);">返回登录</button>' +
      '<button class="btn-submit" id="btnRegister" style="flex:1;margin-left:8px;">注 册</button></div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById("btnBackLogin").addEventListener("click", function() {
      overlay.remove();
      _showLoginPrompt();
    });

    document.getElementById("btnRegister").addEventListener("click", function() {
      var username = document.getElementById("regUsername").value.trim();
      var password = document.getElementById("regPassword").value.trim();
      var password2 = document.getElementById("regPassword2").value.trim();
      var referrerInput = document.getElementById("regReferrer");
      var referrerVal = referrerInput ? referrerInput.value.trim() : "";
      var errorEl = document.getElementById("regError");

      if (!username || username.length < 2 || username.length > 20) {
        errorEl.style.display = "block";
        errorEl.textContent = "用户名需2-20个字符";
        return;
      }
      if (!password || password.length < 6) {
        errorEl.style.display = "block";
        errorEl.textContent = "密码至少6位";
        return;
      }
      if (password !== password2) {
        errorEl.style.display = "block";
        errorEl.textContent = "两次密码不一致";
        return;
      }

      var btn = document.getElementById("btnRegister");
      btn.disabled = true;
      btn.textContent = "注册中...";

      JITApi.registerUser(username, password, referrerVal).then(function() {
        // 注册成功，发放积分
        var promises = [];
        // 新用户得50积分
        promises.push(JITPoints.changePoints(username, JITPoints.RULES.INVITE_REWARD, "注册奖励"));
        // 邀请人得50积分
        if (referrerVal && referrerVal !== username) {
          promises.push(JITPoints.changePoints(referrerVal, JITPoints.RULES.INVITE_REWARD, "邀请好友：" + username));
        }
        return Promise.all(promises);
      }).then(function() {
        _showToast("注册成功！获得" + JITPoints.RULES.INVITE_REWARD + "积分", "success");
        overlay.remove();
        // 清除邀请人缓存
        localStorage.removeItem("jit_referrer");
        // 自动填充用户名，跳转到登录
        _showLoginPrompt();
        setTimeout(function() {
          var u = document.getElementById("loginUsername");
          if (u) u.value = username;
        }, 100);
      }).catch(function(err) {
        errorEl.style.display = "block";
        errorEl.textContent = err.message || "注册失败";
      }).finally(function() {
        btn.disabled = false;
        btn.textContent = "注 册";
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

    var btnInvite = document.getElementById("btnInvite");
    if (btnInvite) {
      btnInvite.addEventListener("click", _showInviteModal);
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
      var discount = v.discount || "-";
      var paymentNote = v.paymentNote || v.paymentMethod || "-";
      var originalPrice = v.originalPrice || "-";
      var finalPrice = v.finalPrice || "-";

      html += "<tr>";
      var typeLabel = (v.voucherType === "线上购物") ? "线上购物" : "普通凭证";
      html += "<td><span style=\"font-size:12px;padding:2px 6px;border-radius:4px;background:" + (typeLabel === "线上购物" ? "rgba(33,150,243,0.15);color:#2196f3" : "rgba(158,158,158,0.15);color:#999") + ";\">" + typeLabel + "</span></td>";
      html += "<td>" + _escapeHtml(v.shopName || "-") + "</td>";
      html += "<td>" + _escapeHtml(v.date || "-") + "</td>";
      html += "<td><span class=\"discount-badge\">" + _escapeHtml(discount) + "</span></td>";
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
      // 未抽奖的凭证才显示抽奖按钮
      if (!v.discount) {
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
      html += '<button id="btnCloseVoucherDetail" style="margin-top:12px;width:100%;padding:8px;border:none;border-radius:8px;background:var(--bg-card);color:var(--text-primary);cursor:pointer;">关闭</button>';
      box.innerHTML = html;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
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
    _openVoucherDetail: _openVoucherDetail
  };
})();

document.addEventListener("DOMContentLoaded", function() {
  JITApp.init();
});