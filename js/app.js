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
  };

  var _loadOrders = function() {
    JITApi.getAllVouchers().then(function(vouchers) {
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
      var actions = "";
      if (v.statusType === "pending") {
        actions += "<button class=\"edit-order-btn\" data-issue-number=\"" + _escapeHtml(v._issueNumber || "") + "\">编辑</button>";
      }
      // 未抽奖的凭证才显示抽奖按钮
      if (!v.discount) {
        actions += "<button class=\"lottery-order-btn\" data-issue-number=\"" + _escapeHtml(v._issueNumber || "") + "\">🎰 抽奖</button>";
      }
      actions += "<button class=\"pay-order-btn\" data-issue-number=\"" + _escapeHtml(v._issueNumber || "") + "\">去支付</button>";
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
        return JITApi.submitVoucherWithImages(voucherData, shopPhotoFile, _orderPhotoFiles, false, false);
      }).then(function(result) {
        _showToast("凭证提交成功！", "success");
        _closeAddVoucherModal();
        JITApi.invalidateCache("allVouchers");
        JITApi.invalidateCache("allVouchersForId");
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
        _showToast("✅ 抽奖结果已保存：" + prize.discount, "success");
      }).catch(function(err) {
        console.error("更新抽奖结果失败:", err);
        _showToast("抽奖结果保存失败，请重试", "error");
      });
    }
  };

  var _openPaymentModal = function(voucher) {
    if (!voucher) return;
    var paymentType = voucher.paymentMethodType || "userFirst";
    var originalAmount = parseFloat(voucher.originalPrice || voucher.amount || 0);
    var discountValue = parseFloat(voucher.discountValue || 1);
    var finalAmount = isNaN(originalAmount) ? 0 : (originalAmount * discountValue);
    var discountAmount = originalAmount - finalAmount;

    if (paymentType === "unionFirst") {
      var overlay = document.getElementById("wechatPayOverlay");
      var amountEl = document.getElementById("wechatPayAmount");
      if (overlay) {
        if (amountEl) amountEl.textContent = "支付金额：\u00a5" + finalAmount.toFixed(2) + "（原价\u00a5" + originalAmount.toFixed(2) + " \u00d7 " + (voucher.discount || "10折") + "）";
        overlay.classList.add("active");
      }
    } else {
      var overlay2 = document.getElementById("userFirstPayOverlay");
      var subEl = document.getElementById("userFirstPaySub");
      if (overlay2) {
        if (subEl) {
          var discountStr = discountAmount > 0 ? "\u00a5" + discountAmount.toFixed(2) : (discountAmount < 0 ? "-\u00a5" + Math.abs(discountAmount).toFixed(2) + "（工会额外给您）" : "\u00a50.00");
          subEl.innerHTML = "\u539f\u4ef7\uff1a\u00a5" + originalAmount.toFixed(2) + "<br>\u6298\u6263\uff1a" + (voucher.discount || "10\u6298") + "<br>\u60a8\u5148\u652f\u4ed8\uff1a\u00a5" + originalAmount.toFixed(2) + "<br>\u5de5\u4f1a\u8fd4\u8fd8\uff1a" + discountStr;
        }
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

  // =============================================
  // 后台管理功能
  // =============================================
  var _isAdmin = function() {
    return _currentUser === "admin";
  };

  var _updateAdminButton = function() {
    var module = document.getElementById("moduleAdmin");
    if (module) {
      module.style.display = _isAdmin() ? "" : "none";
    }
  };

  var _initAdmin = function() {
    _updateAdminButton();
    _bindAdminEvents();
  };

  var _bindAdminEvents = function() {
    var btnAdmin = document.getElementById("btnAdmin");
    if (btnAdmin) {
      btnAdmin.addEventListener("click", _openAdminModal);
    }

    var btnAdminClose = document.getElementById("btnAdminClose");
    if (btnAdminClose) {
      btnAdminClose.addEventListener("click", _closeAdminModal);
    }

    var adminOverlay = document.getElementById("adminOverlay");
    if (adminOverlay) {
      adminOverlay.addEventListener("click", function(e) {
        if (e.target === adminOverlay) _closeAdminModal();
      });
    }

    // Tab 切换
    var tabs = document.querySelectorAll(".admin-tab");
    tabs.forEach(function(tab) {
      tab.addEventListener("click", function() {
        var tabName = this.getAttribute("data-tab");
        document.querySelectorAll(".admin-tab").forEach(function(t) { t.classList.remove("active"); });
        this.classList.add("active");
        document.querySelectorAll(".admin-panel").forEach(function(p) { p.classList.remove("active"); });
        var panel = document.getElementById("admin" + tabName.charAt(0).toUpperCase() + tabName.slice(1) + "Panel");
        if (panel) panel.classList.add("active");

        // 加载对应的数据
        if (tabName === "review") _loadAdminReviewList();
        else if (tabName === "lottery") _loadAdminLotteryConfig();
        else if (tabName === "users") _loadAdminUsers();
        else if (tabName === "settings") _loadAdminSettings();
      });
    });

    // 刷新审核列表
    var refreshBtn = document.getElementById("btnAdminRefreshReview");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", _loadAdminReviewList);
    }

    // 保存抽奖概率
    var saveLotteryBtn = document.getElementById("btnAdminSaveLottery");
    if (saveLotteryBtn) {
      saveLotteryBtn.addEventListener("click", _saveAdminLotteryConfig);
    }

    // 用户管理
    var addUserBtn = document.getElementById("btnAdminAddUser");
    if (addUserBtn) {
      addUserBtn.addEventListener("click", function() {
        var form = document.getElementById("adminUserForm");
        if (form) form.style.display = form.style.display === "none" ? "block" : "none";
      });
    }

    var confirmAddUser = document.getElementById("btnAdminConfirmAddUser");
    if (confirmAddUser) {
      confirmAddUser.addEventListener("click", _addAdminUser);
    }

    var cancelAddUser = document.getElementById("btnAdminCancelAddUser");
    if (cancelAddUser) {
      cancelAddUser.addEventListener("click", function() {
        document.getElementById("adminUserForm").style.display = "none";
        document.getElementById("adminNewUsername").value = "";
        document.getElementById("adminNewPassword").value = "";
      });
    }

    // 保存设置
    var saveSettingsBtn = document.getElementById("btnAdminSaveSettings");
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener("click", _saveAdminSettings);
    }
  };

  var _openAdminModal = function() {
    var overlay = document.getElementById("adminOverlay");
    if (!overlay) return;
    overlay.classList.add("active");
    // 默认加载审核列表
    setTimeout(function() {
      _loadAdminReviewList();
    }, 300);
  };

  var _closeAdminModal = function() {
    var overlay = document.getElementById("adminOverlay");
    if (overlay) overlay.classList.remove("active");
  };

  // ===== 审核订单 =====
  var _loadAdminReviewList = function() {
    var list = document.getElementById("adminReviewList");
    if (!list) return;
    list.innerHTML = '<div class="admin-loading">加载中...</div>';

    JITApi.getAllVouchers().then(function(vouchers) {
      var pending = vouchers.filter(function(v) {
        return v.statusType === "pending" || v.statusType === "paid";
      });

      if (pending.length === 0) {
        list.innerHTML = '<div class="admin-loading" style="color:var(--ice-blue);">暂无待审核订单</div>';
        return;
      }

      var html = "";
      pending.forEach(function(v) {
        var statusBadge = v.statusType === "paid" ? "已支付" : "待审核";
        var statusStyle = v.statusType === "paid" ? "color:#4caf50;" : "color:#ffa726;";

        html += '<div class="admin-review-item" data-issue="' + _escapeHtml(v._issueNumber) + '">';
        html += '<div class="admin-review-info">';
        html += '<div class="admin-review-shop">' + _escapeHtml(v.shopName || "未知店铺") + ' <span style="font-size:11px;color:var(--text-dim);font-weight:400;">by ' + _escapeHtml(v.username || "未知") + '</span></div>';
        html += '<div class="admin-review-detail">';
        html += '金额: <span>' + _escapeHtml(v.originalPrice || "-") + '</span> | ';
        html += '优惠: <span>' + _escapeHtml(v.discount || "未抽奖") + '</span> | ';
        html += '状态: <span style="' + statusStyle + '">' + statusBadge + '</span>';
        if (v.date) html += ' | 日期: <span>' + _escapeHtml(v.date) + '</span>';
        if (v.paymentMethod) html += ' | 支付: <span>' + _escapeHtml(v.paymentMethod) + '</span>';
        if (v.remark) html += '<br>备注: <span>' + _escapeHtml(v.remark) + '</span>';
        html += '</div>';

        // 照片预览
        var photos = [];
        if (v.shopPhoto) photos.push(v.shopPhoto);
        if (v.orderPhotos) {
          if (typeof v.orderPhotos === "string") {
            v.orderPhotos.split("|").forEach(function(p) { if (p.trim()) photos.push(p.trim()); });
          } else if (Array.isArray(v.orderPhotos)) {
            photos = photos.concat(v.orderPhotos);
          }
        }
        if (photos.length > 0) {
          html += '<div class="admin-review-photos">';
          photos.forEach(function(p) {
            html += '<img class="admin-review-photo" src="' + _escapeHtml(p) + '" onclick="window.open(\'' + _escapeHtml(p) + '\')" onerror="this.style.display=\'none\'">';
          });
          html += '</div>';
        }

        html += '</div>';
        html += '<div class="admin-review-actions">';
        html += '<button class="admin-btn-approve" data-issue="' + _escapeHtml(v._issueNumber) + '">✅ 通过</button>';
        html += '<button class="admin-btn-reject" data-issue="' + _escapeHtml(v._issueNumber) + '">❌ 拒绝</button>';
        html += '<button class="admin-btn-delete" data-issue="' + _escapeHtml(v._issueNumber) + '">🗑 删除</button>';
        html += '</div>';
        html += '</div>';
      });

      list.innerHTML = html;

      // 绑定审核按钮事件
      list.querySelectorAll(".admin-btn-approve").forEach(function(btn) {
        btn.addEventListener("click", function(e) {
          var issueNum = this.getAttribute("data-issue");
          _adminApprove(issueNum, this);
        });
      });
      list.querySelectorAll(".admin-btn-reject").forEach(function(btn) {
        btn.addEventListener("click", function(e) {
          var issueNum = this.getAttribute("data-issue");
          _adminReject(issueNum, this);
        });
      });
      list.querySelectorAll(".admin-btn-delete").forEach(function(btn) {
        btn.addEventListener("click", function(e) {
          var issueNum = this.getAttribute("data-issue");
          _adminDelete(issueNum, this);
        });
      });
    }).catch(function(err) {
      list.innerHTML = '<div class="admin-loading" style="color:#ef5350;">加载失败: ' + _escapeHtml(err.message) + '</div>';
    });
  };

  var _adminApprove = function(issueNumber, btn) {
    if (!confirm("确认通过此订单审核？")) return;
    btn.disabled = true;
    btn.textContent = "处理中...";

    var labels = JITConfig.getLabels();
    JITApi.updateIssue(issueNumber, {
      labels: [labels.voucher, labels.approved]
    }).then(function() {
      JITApi.invalidateCache("allVouchers");
      JITApi.invalidateCache("allVouchersForId");
      _showToast("✅ 订单已通过审核", "success");
      _loadAdminReviewList();
      _loadData();
    }).catch(function(err) {
      _showToast("审核失败: " + err.message, "error");
      btn.disabled = false;
      btn.textContent = "✅ 通过";
    });
  };

  var _adminReject = function(issueNumber, btn) {
    if (!confirm("确认拒绝此订单？")) return;
    btn.disabled = true;
    btn.textContent = "处理中...";

    var labels = JITConfig.getLabels();
    JITApi.updateIssue(issueNumber, {
      labels: [labels.voucher, labels.rejected],
      state: "closed"
    }).then(function() {
      JITApi.invalidateCache("allVouchers");
      JITApi.invalidateCache("allVouchersForId");
      _showToast("❌ 订单已拒绝", "error");
      _loadAdminReviewList();
      _loadData();
    }).catch(function(err) {
      _showToast("操作失败: " + err.message, "error");
      btn.disabled = false;
      btn.textContent = "❌ 拒绝";
    });
  };

  var _adminDelete = function(issueNumber, btn) {
    if (!confirm("⚠️ 确认删除此订单？此操作不可恢复！")) return;
    btn.disabled = true;
    btn.textContent = "删除中...";

    JITApi.deleteIssue(issueNumber).then(function() {
      JITApi.invalidateCache("allVouchers");
      JITApi.invalidateCache("allVouchersForId");
      _showToast("🗑 订单已删除", "error");
      _loadAdminReviewList();
      _loadData();
    }).catch(function(err) {
      _showToast("删除失败: " + err.message, "error");
      btn.disabled = false;
      btn.textContent = "🗑 删除";
    });
  };

  // ===== 抽奖概率配置 =====
  var _defaultPrizeConfig = [
    { discount: "7折", value: 0.7, label: "恭喜！", weight: 10 },
    { discount: "8折", value: 0.8, label: "手气不错！", weight: 20 },
    { discount: "9折", value: 0.9, label: "好运连连！", weight: 30 },
    { discount: "9.5折", value: 0.95, label: "小有收获！", weight: 20 },
    { discount: "10折", value: 1.0, label: "保本！", weight: 15 },
    { discount: "11折", value: 1.1, label: "超级幸运！反向给钱！", weight: 5 }
  ];

  var _getPrizeConfig = function() {
    var saved = localStorage.getItem("jit_admin_prize_config");
    if (saved) {
      try { return JSON.parse(saved); } catch(e) {}
    }
    return JSON.parse(JSON.stringify(_defaultPrizeConfig));
  };

  var _loadAdminLotteryConfig = function() {
    var config = _getPrizeConfig();
    var container = document.getElementById("adminLotteryConfig");
    if (!container) return;

    var html = "";
    config.forEach(function(prize, index) {
      html += '<div class="admin-lottery-row">';
      html += '<span class="admin-lottery-discount">' + _escapeHtml(prize.discount) + '</span>';
      html += '<span class="admin-lottery-label">' + _escapeHtml(prize.label) + '</span>';
      html += '<span style="font-size:12px;color:var(--text-dim);">权重:</span>';
      html += '<input type="number" class="admin-lottery-weight" data-index="' + index + '" value="' + prize.weight + '" min="0" max="1000">';
      html += '</div>';
    });

    var totalWeight = config.reduce(function(sum, p) { return sum + p.weight; }, 0);
    html += '<div class="admin-lottery-total">总权重: <span id="adminLotteryTotal">' + totalWeight + '</span> | 中奖概率: <span id="adminLotteryRate">' + (totalWeight > 0 ? "100%" : "0%") + '</span></div>';

    container.innerHTML = html;

    // 实时更新总权重
    container.querySelectorAll(".admin-lottery-weight").forEach(function(input) {
      input.addEventListener("input", function() {
        var total = 0;
        document.querySelectorAll(".admin-lottery-weight").forEach(function(inp) {
          total += parseInt(inp.value) || 0;
        });
        var totalEl = document.getElementById("adminLotteryTotal");
        var rateEl = document.getElementById("adminLotteryRate");
        if (totalEl) totalEl.textContent = total;
        if (rateEl) rateEl.textContent = total > 0 ? "100%" : "0%";
      });
    });
  };

  var _saveAdminLotteryConfig = function() {
    var config = _getPrizeConfig();
    var inputs = document.querySelectorAll(".admin-lottery-weight");
    var valid = true;
    inputs.forEach(function(input) {
      var index = parseInt(input.getAttribute("data-index"));
      var val = parseInt(input.value);
      if (isNaN(val) || val < 0) {
        valid = false;
        input.style.borderColor = "#ef5350";
      } else {
        input.style.borderColor = "";
        config[index].weight = val;
      }
    });

    if (!valid) {
      _showToast("权重值无效，请输入非负整数", "error");
      return;
    }

    localStorage.setItem("jit_admin_prize_config", JSON.stringify(config));
    // 同步更新 lottery.js 的奖品配置
    if (window.JITLottery && JITLottery.updatePrizeConfig) {
      JITLottery.updatePrizeConfig(config);
    }
    _showToast("✅ 抽奖概率配置已保存", "success");
  };

  // ===== 用户管理 =====
  var _getAdminUsers = function() {
    var saved = localStorage.getItem("jit_admin_users");
    if (saved) {
      try { return JSON.parse(saved); } catch(e) {}
    }
    // 从 config 获取默认用户
    var defaultUsers = JITConfig.getUsers();
    var users = {};
    for (var key in defaultUsers) {
      if (defaultUsers.hasOwnProperty(key)) {
        users[key] = defaultUsers[key];
      }
    }
    return users;
  };

  var _saveAdminUsers = function(users) {
    localStorage.setItem("jit_admin_users", JSON.stringify(users));
  };

  var _loadAdminUsers = function() {
    var users = _getAdminUsers();
    var container = document.getElementById("adminUsersConfig");
    if (!container) return;

    var html = "";
    var userList = [];
    for (var key in users) {
      if (users.hasOwnProperty(key)) {
        userList.push({ username: key, password: users[key] });
      }
    }

    if (userList.length === 0) {
      html = '<div class="admin-loading">暂无用户</div>';
    } else {
      userList.forEach(function(u) {
        var isAdminUser = u.username === "admin";
        html += '<div class="admin-user-item">';
        html += '<div><span class="admin-user-name">' + _escapeHtml(u.username) + '</span>';
        if (isAdminUser) html += '<span class="admin-user-role">管理员</span>';
        html += '</div>';
        html += '<div class="admin-user-actions">';
        if (!isAdminUser) {
          html += '<button class="admin-user-delete-btn" data-username="' + _escapeHtml(u.username) + '">删除</button>';
        }
        html += '</div>';
        html += '</div>';
      });
    }

    container.innerHTML = html;

    // 绑定删除事件
    container.querySelectorAll(".admin-user-delete-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var username = this.getAttribute("data-username");
        if (confirm("确认删除用户 " + username + "？")) {
          var users = _getAdminUsers();
          delete users[username];
          _saveAdminUsers(users);
          _loadAdminUsers();
          _showToast("用户 " + username + " 已删除", "success");
        }
      });
    });
  };

  var _addAdminUser = function() {
    var username = document.getElementById("adminNewUsername").value.trim();
    var password = document.getElementById("adminNewPassword").value.trim();

    if (!username || !password) {
      _showToast("请输入用户名和密码", "error");
      return;
    }

    var users = _getAdminUsers();
    if (users[username]) {
      _showToast("用户 " + username + " 已存在", "error");
      return;
    }

    users[username] = password;
    _saveAdminUsers(users);
    document.getElementById("adminNewUsername").value = "";
    document.getElementById("adminNewPassword").value = "";
    document.getElementById("adminUserForm").style.display = "none";
    _loadAdminUsers();
    _showToast("✅ 用户 " + username + " 添加成功", "success");
  };

  // ===== 高级设置 =====
  var _getAdminSettings = function() {
    var saved = localStorage.getItem("jit_admin_settings");
    if (saved) {
      try { return JSON.parse(saved); } catch(e) {}
    }
    return {
      pageSize: 10,
      enableAutoApprove: false,
      cacheTTL: 30,
      lotteryThreshold: 40
    };
  };

  var _loadAdminSettings = function() {
    var settings = _getAdminSettings();
    var container = document.getElementById("adminSettingsConfig");
    if (!container) return;

    var html = '';
    html += '<div class="admin-setting-row">';
    html += '<div><div class="admin-setting-label">每页显示条数</div><div class="admin-setting-desc">订单列表每页显示的记录数量</div></div>';
    html += '<input type="number" class="admin-setting-input" id="adminSettingPageSize" value="' + settings.pageSize + '" min="5" max="50">';
    html += '</div>';

    html += '<div class="admin-setting-row">';
    html += '<div><div class="admin-setting-label">缓存时间（秒）</div><div class="admin-setting-desc">API 数据缓存刷新间隔</div></div>';
    html += '<input type="number" class="admin-setting-input" id="adminSettingCacheTTL" value="' + settings.cacheTTL + '" min="5" max="300">';
    html += '</div>';

    html += '<div class="admin-setting-row">';
    html += '<div><div class="admin-setting-label">刮开阈值（%）</div><div class="admin-setting-desc">刮开多少百分比后自动显示结果</div></div>';
    html += '<input type="number" class="admin-setting-input" id="adminSettingThreshold" value="' + settings.lotteryThreshold + '" min="10" max="90">';
    html += '</div>';

    html += '<div class="admin-setting-row">';
    html += '<div><div class="admin-setting-label">自动审核</div><div class="admin-setting-desc">新提交的凭证自动通过审核</div></div>';
    html += '<button class="admin-setting-toggle' + (settings.enableAutoApprove ? ' active' : '') + '" id="adminSettingAutoApprove"></button>';
    html += '</div>';

    container.innerHTML = html;

    // 绑定 toggle
    var toggle = document.getElementById("adminSettingAutoApprove");
    if (toggle) {
      toggle.addEventListener("click", function() {
        this.classList.toggle("active");
      });
    }
  };

  var _saveAdminSettings = function() {
    var settings = _getAdminSettings();
    settings.pageSize = parseInt(document.getElementById("adminSettingPageSize").value) || 10;
    settings.cacheTTL = parseInt(document.getElementById("adminSettingCacheTTL").value) || 30;
    settings.lotteryThreshold = parseInt(document.getElementById("adminSettingThreshold").value) || 40;
    settings.enableAutoApprove = document.getElementById("adminSettingAutoApprove").classList.contains("active");

    localStorage.setItem("jit_admin_settings", JSON.stringify(settings));

    // 应用设置
    _perPage = settings.pageSize;
    // 更新缓存 TTL
    var cacheTTLMs = settings.cacheTTL * 1000;
    // 更新抽奖阈值
    if (window.JITLottery && JITLottery.setThreshold) {
      JITLottery.setThreshold(settings.lotteryThreshold / 100);
    }

    _showToast("✅ 设置已保存", "success");
    _loadData();
  };

  // 重写 initLogin 以支持 admin 检测
  var _origInitLogin = _initLogin;
  _initLogin = function() {
    var savedUser = localStorage.getItem("jit_current_user");
    if (savedUser) {
      _currentUser = savedUser;
      _updateLogoutText();
      _initAdmin();
      return;
    }
    _showLoginPrompt();
  };

  // 重写 _showLoginPrompt 成功后回调
  var _origShowLoginPrompt = _showLoginPrompt;
  _showLoginPrompt = function() {
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
      var users = _getAdminUsers();

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
        _initAdmin();
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

  return {
    init: _init
  };
})();

document.addEventListener("DOMContentLoaded", function() {
  JITApp.init();
});