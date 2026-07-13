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
  var _signatureData = null;

  var _init = function() {
    _initBackgroundParticles();
    _initLogin();
    _bindEvents();
    _loadData();
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
    var savedUser = localStorage.getItem("jit_current_user");
    if (savedUser) {
      _currentUser = savedUser;
      _updateLogoutText();
      return;
    }
    _showLoginPrompt();
  };

  var _showLoginPrompt = function() {
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.cssText = "opacity:1;visibility:visible;z-index:2000;";
    overlay.innerHTML = '<div class="modal-container" style="max-width:380px;transform:translateY(0);">' +
      '<div class="modal-header"><h3 class="modal-title">登录玉国金融</h3></div>' +
      '<div class="modal-body">' +
      '<div class="form-group"><label class="form-label">用户名</label>' +
      '<input type="text" class="form-input" id="loginUsername" placeholder="请输入用户名"></div>' +
      '<div class="form-group"><label class="form-label">密码</label>' +
      '<input type="password" class="form-input" id="loginPassword" placeholder="请输入密码"></div>' +
      '<div class="form-error" id="loginError" style="display:none;"></div>' +
      '</div>' +
      '<div class="modal-footer" style="justify-content:center;">' +
      '<button class="btn-submit" id="btnLogin">登 录</button></div>' +
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

      if (users[username] && users[username] === password) {
        _currentUser = username;
        localStorage.setItem("jit_current_user", username);
        _updateLogoutText();
        overlay.remove();
        _showToast("登录成功，欢迎 " + username, "success");
        _loadData();
      } else {
        errorEl.style.display = "block";
        errorEl.textContent = "用户名或密码错误";
      }
    });

    document.getElementById("loginPassword").addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        document.getElementById("btnLogin").click();
      }
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

    var btnViewMode = document.getElementById("btnViewMode");
    if (btnViewMode) {
      btnViewMode.addEventListener("click", function() {
        _showToast("已切换至列表查看式 分页模式", "");
      });
    }

    var btnCustomerService = document.getElementById("btnCustomerService");
    if (btnCustomerService) {
      btnCustomerService.addEventListener("click", function() {
        _showToast("客服功能开发中，请稍候", "");
      });
    }

    var btnQuickPay = document.getElementById("btnQuickPay");
    if (btnQuickPay) {
      btnQuickPay.addEventListener("click", function() {
        _showToast("一键支付功能开发中", "");
      });
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

    var btnLotteryNew = document.getElementById("btnLotteryNew");
    if (btnLotteryNew) {
      btnLotteryNew.addEventListener("click", function() {
        JITLottery.reset("lotteryCanvas");
      });
    }

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
    _initSignatureCanvas();
    _initAmountInput();

    var ordersTableBody = document.getElementById("ordersTableBody");
    if (ordersTableBody) {
      ordersTableBody.addEventListener("click", function(e) {
        var btn = e.target.closest(".pay-order-btn");
        if (!btn) return;
        var issueNumber = btn.getAttribute("data-issue-number");
        var voucher = _allVouchers.find(function(item) {
          return String(item._issueNumber) === String(issueNumber);
        });
        if (voucher) {
          _openPaymentModal(voucher);
        }
      });
    }

    var btnWechatPayClose = document.getElementById("btnWechatPayClose");
    if (btnWechatPayClose) {
      btnWechatPayClose.addEventListener("click", _closeWechatPayModal);
    }
    var wechatPayOverlay = document.getElementById("wechatPayOverlay");
    if (wechatPayOverlay) {
      wechatPayOverlay.addEventListener("click", function(e) {
        if (e.target === wechatPayOverlay) {
          _closeWechatPayModal();
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
  };

  var _initUploadListeners = function() {
    var inputShopPhoto = document.getElementById("inputShopPhoto");
    if (inputShopPhoto) {
      inputShopPhoto.addEventListener("change", function(e) {
        var file = e.target.files[0];
        if (file) {
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
        var previewList = document.getElementById("previewOrderPhotos");
        if (previewList) previewList.innerHTML = "";
        files.forEach(function(file, index) {
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

  var _loadData = function() {
    if (!_currentUser) return;
    _loadOrders();
    _loadHistory();
    _loadProgress();
  };

  var _loadOrders = function() {
    JITApi.getAllVouchers().then(function(vouchers) {
      _allVouchers = vouchers;
      _totalVouchers = vouchers.length;
      _currentPage = 1;
      _renderOrders();
    }).catch(function(err) {
      console.error("加载订单失败:", err.message);
      _allVouchers = [];
      _totalVouchers = 0;
      _currentPage = 1;
      _renderOrders();
    });
  };

  var _renderOrders = function() {
    var tbody = document.getElementById("ordersTableBody");
    if (!tbody) return;

    var start = (_currentPage - 1) * _perPage;
    var end = start + _perPage;
    var pageVouchers = _allVouchers.slice(start, end);

    if (pageVouchers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="table-loading">暂无订单数据</div></td></tr>';
      _updatePagination();
      return;
    }

    var html = "";
    pageVouchers.forEach(function(v) {
      var statusClass = v.statusType || "pending";
      var statusText = v.status || "待审核";
      var discount = v.discount || "-";
      var paymentNote = v.paymentNote || v.paymentMethod || "-";
      var originalPrice = v.originalPrice || "-";
      var finalPrice = v.finalPrice || "-";

      html += "<tr>";
      html += "<td>" + _escapeHtml(v.shopName || "-") + "</td>";
      html += "<td>" + _escapeHtml(v.date || "-") + "</td>";
      html += "<td><span class=\"discount-badge\">" + _escapeHtml(discount) + "</span></td>";
      html += "<td>" + _escapeHtml(paymentNote) + "</td>";
      html += "<td>" + _escapeHtml(originalPrice) + "</td>";
      html += "<td>" + _escapeHtml(finalPrice) + "</td>";
      html += "<td><span class=\"status-badge " + statusClass + "\">" + _escapeHtml(statusText) + "</span></td>";
      html += "<td><button class=\"pay-order-btn\" data-issue-number=\"" + _escapeHtml(v._issueNumber || "") + "\">去支付</button></td>";
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

  var _loadHistory = function() {
    var list = document.getElementById("sidebarHistoryList");
    if (!list) return;

    JITApi.getAllVouchers().then(function(vouchers) {
      _renderHistory(vouchers);
    }).catch(function(err) {
      console.error("加载历史单据失败:", err.message);
      _renderHistory([]);
    });
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

  var _loadProgress = function() {
    JITApi.getVoucherCount().then(function(count) {
      JITApi.getApprovedCount().then(function(approved) {
        _updateProgress(count, approved);
      }).catch(function() {
        _updateProgress(count, 0);
      });
    }).catch(function(err) {
      console.error("加载进度失败:", err.message);
      _updateProgress(0, 0);
    });
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

  var _openLotteryModal = function() {
    if (!_currentUser) {
      _showToast("请先登录", "error");
      return;
    }
    if (_allVouchers.length === 0) {
      _showToast("请先添加凭证并等待审核通过后再参与抽奖", "error");
      return;
    }
    var overlay = document.getElementById("lotteryOverlay");
    if (overlay) {
      overlay.classList.add("active");
      setTimeout(function() {
        JITLottery.start("lotteryCanvas", function(prize) {
          _showToast("恭喜获得 " + prize.discount + "！" + prize.label, "success");
          _saveLotteryResult(prize);
        });
      }, 300);
    }
  };

  var _closeLotteryModal = function() {
    var overlay = document.getElementById("lotteryOverlay");
    if (overlay) {
      overlay.classList.remove("active");
    }
  };

  var _resetForm = function() {
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
    document.getElementById("inputAmount").value = "";
    document.getElementById("inputRemark").value = "";
    document.getElementById("locationInfo").textContent = "未获取定位";
    document.getElementById("inputLatitude").value = "";
    document.getElementById("inputLongitude").value = "";
    _clearSignature();
    _hideAllErrors();
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
    if (!shopPhotoFile) {
      _showError("errorShopPhoto", "请上传店铺照片");
      hasError = true;
    }
    if (!orderPhotoFiles || orderPhotoFiles.length === 0) {
      _showError("errorOrderPhoto", "请上传商品订单截图");
      hasError = true;
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
    btn.textContent = "提交中...";

    var processImages = function() {
      var promises = [];
      if (shopPhotoFile) {
        promises.push(JITApi.uploadImage(shopPhotoFile));
      }
      for (var i = 0; i < _orderPhotos.length; i++) {
        promises.push(Promise.resolve(_orderPhotos[i].data));
      }
      return Promise.all(promises);
    };

    processImages().then(function(images) {
      var shopPhotoData = images[0] || "";
      var orderPhotosData = images.slice(shopPhotoFile ? 1 : 0);

      var voucherData = {
        shopName: shopName,
        date: new Date().toISOString().split("T")[0],
        shopPhoto: shopPhotoData,
        orderPhotos: orderPhotosData,
        latitude: latitude,
        longitude: longitude,
        amount: amount.replace("元", ""),
        signature: _signatureData,
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
        paymentNote: paymentMethodText
      };

      return JITApi.getNextVoucherId().then(function(nextId) {
        voucherData.voucherId = nextId;
        return JITApi.submitVoucher(voucherData);
      });
    }).then(function(result) {
      _showToast("凭证提交成功！现在开始抽奖！", "success");
      _closeAddVoucherModal();
      _loadData();
      setTimeout(function() {
        _openLotteryModal();
      }, 500);
    }).catch(function(err) {
      _showToast("提交失败: " + err.message, "error");
      console.error("提交凭证失败:", err);
    }).finally(function() {
      btn.disabled = false;
      btn.classList.remove("btn-loading");
      btn.textContent = originalText;
    });
  };

  var _saveLotteryResult = function(prize) {
    var lotteryResults = JSON.parse(localStorage.getItem("jit_lottery_results") || "[]");
    lotteryResults.push({
      discount: prize.discount,
      value: prize.value,
      label: prize.label,
      date: new Date().toISOString().split("T")[0],
      username: _currentUser
    });
    localStorage.setItem("jit_lottery_results", JSON.stringify(lotteryResults));

    var targetVoucher = null;
    _allVouchers.forEach(function(voucher) {
      var sameUser = String(voucher.username || "").toLowerCase() === String(_currentUser || "").toLowerCase();
      if (!sameUser) return;
      if (!targetVoucher) {
        targetVoucher = voucher;
      } else if ((voucher._createdAt || "") > (targetVoucher._createdAt || "")) {
        targetVoucher = voucher;
      }
    });

    if (!targetVoucher && _allVouchers.length > 0) {
      targetVoucher = _allVouchers[0];
    }

    if (targetVoucher && targetVoucher._issueNumber) {
      var updatedVoucher = Object.assign({}, targetVoucher);
      updatedVoucher.discount = prize.discount;
      updatedVoucher.discountValue = prize.value;
      var amountValue = parseFloat(updatedVoucher.amount || updatedVoucher.originalPrice || 0);
      if (!isNaN(amountValue)) {
        updatedVoucher.finalPrice = (amountValue * prize.value).toFixed(2) + "元";
      }
      JITApi.updateVoucherWithLottery(targetVoucher._issueNumber, updatedVoucher).catch(function(err) {
        console.error("更新抽奖结果失败:", err);
      });
    }
  };

  var _openPaymentModal = function(voucher) {
    if (!voucher) return;
    var paymentType = voucher.paymentMethodType || "userFirst";
    var amount = voucher.finalPrice || voucher.originalPrice || voucher.amount || "0";

    if (paymentType === "unionFirst") {
      var overlay = document.getElementById("wechatPayOverlay");
      var amountEl = document.getElementById("wechatPayAmount");
      if (overlay) {
        if (amountEl) amountEl.textContent = "支付金额：" + amount;
        overlay.classList.add("active");
      }
    } else {
      var overlay2 = document.getElementById("userFirstPayOverlay");
      var subEl = document.getElementById("userFirstPaySub");
      if (overlay2) {
        if (subEl) subEl.textContent = "优惠金额：" + amount;
        overlay2.classList.add("active");
      }
    }
  };

  var _closeWechatPayModal = function() {
    var overlay = document.getElementById("wechatPayOverlay");
    if (overlay) overlay.classList.remove("active");
  };

  var _closeUserFirstPayModal = function() {
    var overlay = document.getElementById("userFirstPayOverlay");
    if (overlay) overlay.classList.remove("active");
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

  return {
    init: _init
  };
})();

document.addEventListener("DOMContentLoaded", function() {
  JITApp.init();
});