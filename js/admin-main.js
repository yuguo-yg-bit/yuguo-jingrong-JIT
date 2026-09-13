// ============================================================
// 玉国金融 - 管理后台（Worker + D1 版本）
// ============================================================

(function() {
  var currentIssue = null;
  var currentVoucherData = null;
  var vouchersCache = {};

  var _avatarCache = {};
  var _allVouchers = [];
  var _currentStatusFilter = "all";
  var _currentUserFilter = "";
  var _currentSearchTerm = "";
  var _broadcastInterval = null;
  var _userList = [];
  var _pendingRegCount = 0;
  var _currentChatUser = null;
  var _chatPollInterval = null;
  var _notifPollInterval = null;

  // 管理员添加凭证上传引用
  var _adminAddShopPhoto = { file: null };
  var _adminAddOrderPhotos = { files: [] };
  var _adminAddOnlineProduct = { file: null };
  var _adminAddOnlineShopping = { files: [] };
  var _adminAddElectricProduct = { file: null };
  var _adminAddElectricOrder = { files: [] };
  var _adminSignatureNormal = { data: null };
  var _adminSignatureOnline = { data: null };
  var _adminSignatureElectric = { data: null };

  // 编辑凭证上传引用
  var _editShopPhoto = { file: null };
  var _editOrderPhotos = { files: [] };
  var _editOnlineProduct = { file: null };
  var _editOnlineShopping = { files: [] };
  var _editElectricProduct = { file: null };
  var _editElectricOrder = { files: [] };
  var _editSignatureNormal = { data: null };
  var _editSignatureOnline = { data: null };
  var _editSignatureElectric = { data: null };

  // ============================================================
  // 数据加载
  // ============================================================
  var loadIssues = function(statusFilter) {
    statusFilter = statusFilter || _currentStatusFilter || "all";
    _currentStatusFilter = statusFilter;
    showLoading(true);

    var filter = {};
    if (statusFilter !== "all") filter.status = statusFilter;
    if (_currentUserFilter) filter.user_id = _currentUserFilter;
    if (_currentSearchTerm) filter.search = _currentSearchTerm;
    filter.limit = 500;

    Api.getVouchers(filter).then(function(vouchers) {
      _allVouchers = vouchers;
      // 同步到 JITApi.vouchersCache
      JITApi.vouchersCache = {};
      vouchers.forEach(function(v) {
        var data = _voucherToLegacyFormat(v);
        JITApi.vouchersCache[v.id] = data;
      });
      renderVoucherList(vouchers);
      updateStats();
      showLoading(false);
    }).catch(function(e) {
      showLoading(false);
      _showToast("加载失败: " + e.message);
    });
  };

  var _voucherToLegacyFormat = function(v) {
    var data = {
      id: v.id,
      voucherId: v.id,
      username: v.user_id,
      userId: v.user_id,
      voucherType: v.order_type,
      shopName: v.shop_name,
      amount: String(v.amount || ""),
      originalPrice: String(v.amount || ""),
      finalPrice: v.final_price || String(v.amount || ""),
      discount: v.discount || "",
      discountValue: v.discounted_amount || 0,
      status: v.status,
      statusType: v.status === "待审核" ? "pending" : v.status === "已通过" ? "approved" : v.status === "已拒绝" ? "rejected" : v.status,
      paymentStatus: v.payment_status,
      paymentMethod: v.payment_method,
      paymentNote: v.payment_method,
      remark: v.remark,
      signature: v.signature,
      rejectReason: v.reject_reason,
      platform: v.platform,
      orderNo: v.order_no,
      productPhoto: v.product_photo,
      shopPhoto: v.shop_photo,
      orderPhotos: _safeParseJSON(v.order_photos, []),
      shoppingPhotos: _safeParseJSON(v.shopping_photos, []),
      electric: v.order_type === "电器凭证",
      electricCategory: v.electric_category,
      electricBrand: v.electric_brand,
      electricApplyAmount: v.electric_apply_amount ? String(v.electric_apply_amount) : "",
      electricSubsidyRate: v.electric_subsidy_rate,
      electricSubsidyAmount: v.electric_subsidy_amount ? String(v.electric_subsidy_amount) : "",
      reviewResult: v.review_result,
      date: v.created_at ? v.created_at.split("T")[0] : "",
      createTime: v.created_at,
      _issueNumber: null,
      _createdAt: v.created_at ? new Date(v.created_at).getTime() : Date.now(),
      latitude: v.latitude,
      longitude: v.longitude,
      isUrgent: v.is_urgent === 1,
      urgentReason: v.urgent_reason,
      urgentUsername: v.urgent_username,
      urgentTime: v.urgent_time
    };
    return data;
  };

  var _safeParseJSON = function(str, def) {
    if (!str) return def;
    try { return JSON.parse(str); } catch (e) { return def; }
  };

  // ============================================================
  // 统计
  // ============================================================
  var updateStats = function() {
    Api.getVoucherStats().then(function(stats) {
      var totalEl = document.getElementById("statTotal");
      var pendingEl = document.getElementById("statPendingVouchers");
      var paidEl = document.getElementById("statPaidVouchers");
      var urgentEl = document.getElementById("statUrgentVouchers");
      if (totalEl) totalEl.textContent = stats.total;
      if (pendingEl) pendingEl.textContent = stats.pending;
      if (paidEl) paidEl.textContent = stats.paid;
      if (urgentEl) urgentEl.textContent = stats.urgent;
      var totalAmountEl = document.getElementById("statTotalAmount");
      if (totalAmountEl) totalAmountEl.textContent = (stats.totalAmount || 0).toFixed(2);

      Api.getUserCountByStatus("approved").then(function(cnt) {
        var usersEl = document.getElementById("statTotalUsers");
        if (usersEl) usersEl.textContent = cnt;
      });

      Api.getUserCountByStatus("pending").then(function(cnt) {
        var regEl = document.getElementById("statRegistrations");
        if (regEl) regEl.textContent = cnt;
      });
    });
  };

  // ============================================================
  // 渲染凭证列表
  // ============================================================
  var renderVoucherList = function(vouchers) {
    var tbody = document.getElementById("voucherTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!vouchers || vouchers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#999;">暂无凭证</td></tr>';
      return;
    }
    vouchers.forEach(function(v) {
      var data = _voucherToLegacyFormat(v);
      var row = document.createElement("tr");
      var statusClass = data.statusType === "pending" ? "pending" : data.statusType === "approved" ? "approved" : data.statusType === "rejected" ? "rejected" : "";
      var urgentTag = data.isUrgent ? ' <span style="background:#ff4444;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;">急</span>' : "";

      row.innerHTML =
        '<td>' + data.voucherId + '</td>' +
        '<td>' + data.username + urgentTag + '</td>' +
        '<td>' + data.shopName + '</td>' +
        '<td>' + data.amount + '</td>' +
        '<td>' + data.date + '</td>' +
        '<td><span class="status-badge ' + statusClass + '">' + data.status + '</span></td>' +
        '<td>' + (data.paymentStatus || "") + '</td>' +
        '<td>' +
          '<button class="btn btn-sm btn-primary" onclick="AdminView.openReview(\'' + v.id + '\')">审核</button>' +
          '<button class="btn btn-sm btn-danger" onclick="AdminView.deleteVoucher(\'' + v.id + '\')">删除</button>' +
        '</td>';
      row.style.cursor = "pointer";
      row.onclick = function(e) {
        if (e.target.tagName === "BUTTON") return;
        AdminView.openReview(v.id);
      };
      tbody.appendChild(row);
    });
  };

  var openReview = function(voucherId) {
    Api.getVoucher(voucherId).then(function(v) {
      if (!v) { _showToast("凭证不存在"); return; }
      currentIssue = { number: null, body: JSON.stringify(v), id: v.id };
      currentVoucherData = _voucherToLegacyFormat(v);
      renderReviewModal(currentVoucherData, v);
      document.getElementById("reviewOverlay").classList.add("active");
    }).catch(function(e) {
      _showToast("加载失败: " + e.message);
    });
  };

  var renderReviewModal = function(data, rawVoucher) {
    var modal = document.getElementById("reviewDetail");
    if (!modal) return;
    var statusClass = data.statusType === "pending" ? "pending" : data.statusType === "approved" ? "approved" : "rejected";
    var urgentHtml = data.isUrgent ? '<div style="color:#ff4444;font-weight:bold;">加急凭证！原因: ' + (data.urgentReason || "") + '</div>' : "";

    var imgsHtml = "";
    if (data.shopPhoto) imgsHtml += '<div><strong>店铺照片：</strong><br><img src="' + data.shopPhoto + '" style="max-width:300px;cursor:pointer;" onclick="AdminView._previewImage(\'' + data.shopPhoto + '\')"></div>';
    if (data.productPhoto) imgsHtml += '<div><strong>商品截图：</strong><br><img src="' + data.productPhoto + '" style="max-width:300px;cursor:pointer;" onclick="AdminView._previewImage(\'' + data.productPhoto + '\')"></div>';
    if (data.orderPhotos && data.orderPhotos.length > 0) {
      imgsHtml += '<div><strong>订单截图：</strong><br>';
      data.orderPhotos.forEach(function(p) {
        imgsHtml += '<img src="' + p + '" style="max-width:300px;cursor:pointer;margin:4px;" onclick="AdminView._previewImage(\'' + p + '\')">';
      });
      imgsHtml += '</div>';
    }
    if (data.shoppingPhotos && data.shoppingPhotos.length > 0) {
      imgsHtml += '<div><strong>购物截图：</strong><br>';
      data.shoppingPhotos.forEach(function(p) {
        imgsHtml += '<img src="' + p + '" style="max-width:300px;cursor:pointer;margin:4px;" onclick="AdminView._previewImage(\'' + p + '\')">';
      });
      imgsHtml += '</div>';
    }
    if (data.electricCategory) imgsHtml += '<div><strong>电器分类：</strong>' + data.electricCategory + '</div>';
    if (data.electricBrand) imgsHtml += '<div><strong>电器品牌：</strong>' + data.electricBrand + '</div>';

    modal.innerHTML =
      '<h3>凭证详情 - ' + data.voucherId + '</h3>' +
      urgentHtml +
      '<div class="review-grid">' +
        '<div><strong>用户：</strong>' + data.username + '</div>' +
        '<div><strong>类型：</strong>' + data.voucherType + '</div>' +
        '<div><strong>店铺：</strong>' + data.shopName + '</div>' +
        '<div><strong>金额：</strong>' + data.amount + '</div>' +
        '<div><strong>折扣：</strong>' + (data.discount || "无") + '</div>' +
        '<div><strong>状态：</strong><span class="status-badge ' + statusClass + '">' + data.status + '</span></div>' +
        '<div><strong>支付方式：</strong>' + (data.paymentMethod || "未设置") + '</div>' +
        '<div><strong>支付状态：</strong>' + (data.paymentStatus || "待支付") + '</div>' +
        '<div><strong>平台：</strong>' + (data.platform || "") + '</div>' +
        '<div><strong>订单号：</strong>' + (data.orderNo || "") + '</div>' +
        '<div><strong>备注：</strong>' + (data.remark || "") + '</div>' +
        '<div><strong>创建时间：</strong>' + (data.createTime || data.date || "") + '</div>' +
      '</div>' +
      imgsHtml +
      (data.signature ? '<div><strong>签名：</strong><br><img src="' + data.signature + '" style="max-width:200px;background:#1a3a5c;padding:10px;"></div>' : "") +
      (data.rejectReason ? '<div style="color:#ff4444;"><strong>拒绝原因：</strong>' + data.rejectReason + '</div>' : "") +
      (data.reviewResult ? '<div style="color:#4caf50;"><strong>审核结果：</strong>' + data.reviewResult + '</div>' : "") +
      '<div class="review-actions" style="margin-top:20px;">' +
        (data.statusType === "pending" ?
          '<button class="btn btn-success" onclick="AdminView.approveVoucher(\'' + data.id + '\')">通过</button>' +
          '<button class="btn btn-danger" onclick="AdminView.showRejectReason()">拒绝</button>' +
          '<button class="btn" onclick="AdminView.openEditVoucherModal()">编辑</button>'
        : "") +
        (data.statusType === "rejected" ?
          '<button class="btn btn-success" onclick="AdminView.approveVoucher(\'' + data.id + '\')">改为通过</button>'
        : "") +
        (data.statusType === "approved" ?
          '<button class="btn btn-success" onclick="AdminView.markPaid(\'' + data.id + '\')">标记已支付</button>' +
          '<button class="btn" onclick="AdminView.runLottery(\'' + data.id + '\')">执行抽奖</button>'
        : "") +
      '</div>' +
      '<div id="rejectReasonArea" style="display:none;margin-top:10px;">' +
        '<input id="rejectReasonInput" placeholder="请输入拒绝原因" style="width:100%;padding:8px;">' +
        '<button class="btn btn-danger" onclick="AdminView.doReject()">确认拒绝</button>' +
      '</div>';
  };

  var _previewImage = function(src) {
    var overlay = document.getElementById("imagePreviewOverlay");
    if (!overlay) return;
    overlay.innerHTML = '<img src="' + src + '" style="max-width:90%;max-height:90%;">';
    overlay.style.display = "flex";
    overlay.onclick = function() { overlay.style.display = "none"; };
  };

  // ============================================================
  // 凭证操作
  // ============================================================
  var approveVoucher = function(voucherId) {
    Api.updateVoucher(voucherId, { status: "已通过" }).then(function() {
      _showToast("凭证已通过", "success");
      document.getElementById("reviewOverlay").classList.remove("active");
      loadIssues();
    }).catch(function(e) {
      _showToast("操作失败: " + e.message);
    });
  };

  var showRejectReason = function() {
    var area = document.getElementById("rejectReasonArea");
    if (area) area.style.display = "block";
  };

  var doReject = function() {
    var reason = document.getElementById("rejectReasonInput").value.trim();
    if (!reason) { _showToast("请输入拒绝原因"); return; }
    var voucherId = currentVoucherData ? currentVoucherData.id : "";
    if (!voucherId) return;
    Api.updateVoucher(voucherId, { status: "已拒绝", reject_reason: reason }).then(function() {
      _showToast("凭证已拒绝", "success");
      document.getElementById("reviewOverlay").classList.remove("active");
      loadIssues();
    }).catch(function(e) {
      _showToast("操作失败: " + e.message);
    });
  };

  var markPaid = function(voucherId) {
    Api.updateVoucher(voucherId, { payment_status: "已支付" }).then(function() {
      _showToast("已标记为已支付", "success");
      document.getElementById("reviewOverlay").classList.remove("active");
      loadIssues();
    }).catch(function(e) {
      _showToast("操作失败: " + e.message);
    });
  };

  var deleteVoucher = function(voucherId) {
    if (!confirm("确定要删除这个凭证吗？此操作不可撤销。")) return;
    Api.deleteVoucher(voucherId).then(function() {
      _showToast("凭证已删除", "success");
      loadIssues();
    }).catch(function(e) {
      _showToast("删除失败: " + e.message);
    });
  };

  var runLottery = function(voucherId) {
    Api.getVoucher(voucherId).then(function(v) {
      if (!v) return;
      var discount = v.discount || "";
      var reward = Points.getLotteryReward(discount);
      if (reward > 0) {
        Points.adminAddPoints(v.user_id, reward, "抽奖奖励（" + discount + "）").then(function() {
          _showToast("抽奖完成，奖励 " + reward + " 积分！", "success");
        });
      } else {
        _showToast("该凭证没有抽奖奖励");
      }
    });
  };

  // ============================================================
  // 用户加载（用于聊天、添加凭证等）
  // ============================================================
  var _loadRegisteredUsers = function() {
    Api.getAllUsers().then(function(users) {
      _userList = users.filter(function(u) { return u.review_status === "approved"; });
      var selectEls = document.querySelectorAll(".user-select");
      selectEls.forEach(function(sel) {
        var currentVal = sel.value;
        sel.innerHTML = '<option value="">请选择用户</option>';
        _userList.forEach(function(u) {
          sel.innerHTML += '<option value="' + u.id + '">' + u.id + '</option>';
        });
        sel.value = currentVal;
      });
    });
  };

  var _loadRegisteredUsersForVoucher = function() {
    Api.getUsersByStatus("approved").then(function(users) {
      var sel = document.getElementById("adminVoucherUser");
      if (!sel) return;
      sel.innerHTML = '<option value="">请选择用户</option>';
      users.forEach(function(u) {
        sel.innerHTML += '<option value="' + u.id + '">' + u.id + '</option>';
      });
    });
  };

  // ============================================================
  // 聊天功能
  // ============================================================
  var _loadChatUsers = function() {
    Api.getChatUsers().then(function(rows) {
      var list = document.getElementById("chatUserList");
      if (!list) return;
      list.innerHTML = "";
      rows.forEach(function(r) {
        var div = document.createElement("div");
        div.className = "chat-user-item";
        div.textContent = r.user_id;
        div.onclick = function() { _openChat(r.user_id); };
        list.appendChild(div);
      });
    });
  };

  var _openChat = function(userId) {
    _currentChatUser = userId;
    var header = document.getElementById("chatWithUser");
    if (header) header.textContent = "与 " + userId + " 聊天中";
    _loadChatMessages(userId);
    // 启动轮询
    if (_chatPollInterval) clearInterval(_chatPollInterval);
    _chatPollInterval = setInterval(function() { _loadChatMessages(userId); }, 5000);
  };

  var _loadChatMessages = function(userId) {
    if (!userId) return;
    Api.getChatMessages(userId, 200).then(function(msgs) {
      var container = document.getElementById("chatMessages");
      if (!container) return;
      container.innerHTML = "";
      msgs.forEach(function(m) {
        var div = document.createElement("div");
        div.className = "chat-msg " + (m.sender === "admin" ? "chat-admin" : "chat-user");
        div.innerHTML = '<strong>' + (m.sender === "admin" ? "管理员" : userId) + ":</strong> " +
          (m.content || "") +
          (m.image_url ? '<br><img src="' + m.image_url + '" style="max-width:200px;">' : "") +
          '<div style="font-size:10px;color:#999;">' + m.created_at + '</div>';
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
      Api.markChatRead(userId);
    });
  };

  var _sendChat = function() {
    if (!_currentChatUser) return;
    var input = document.getElementById("chatInput");
    if (!input || !input.value.trim()) return;
    var msg = input.value.trim();
    Api.sendChatMessage(_currentChatUser, "admin", msg, "").then(function() {
      input.value = "";
      _loadChatMessages(_currentChatUser);
    });
  };

  var _sendChatImage = function() {
    // 简化版图片发送（通过文件上传）
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        var base64 = ev.target.result.split(",")[1];
        Api.uploadImage(base64, "chat").then(function(result) {
          Api.sendChatMessage(_currentChatUser, "admin", "[图片]", result.url);
          _loadChatMessages(_currentChatUser);
        }).catch(function(err) {
          _showToast("图片上传失败: " + err.message);
        });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  // ============================================================
  // 通知功能
  // ============================================================
  var _loadNotifications = function() {
    Api.getNotifications({ status: "active" }).then(function(notifs) {
      var list = document.getElementById("notificationList");
      if (!list) return;
      list.innerHTML = "";
      notifs.forEach(function(n) {
        var div = document.createElement("div");
        div.className = "notification-item";
        div.innerHTML = '<strong>' + n.title + '</strong><br>' +
          (n.content || "") + '<br>' +
          '<span style="font-size:11px;color:#999;">' + n.created_at + '</span>' +
          '<button class="btn btn-sm btn-danger" style="float:right;" onclick="AdminView.deleteNotification(\'' + n.id + '\')">删除</button>';
        div.style.cursor = "pointer";
        div.onclick = function(e) {
          if (e.target.tagName === "BUTTON") return;
          _loadNotificationReplies(n.id);
        };
        list.appendChild(div);
      });
    });
  };

  var _loadNotificationReplies = function(notifId) {
    Api.getNotificationReplies(notifId).then(function(replies) {
      var container = document.getElementById("notificationReplies");
      if (!container) return;
      container.setAttribute("data-notif-id", notifId);
      container.innerHTML = "<h4>回复</h4>";
      replies.forEach(function(r) {
        container.innerHTML += '<div><strong>' + r.username + ":</strong> " + r.message + ' <span style="font-size:10px;color:#999;">' + r.created_at + '</span></div>';
      });
    });
  };

  var _sendNotification = function() {
    var title = document.getElementById("notificationTitle").value.trim();
    var content = document.getElementById("notificationContent").value.trim();
    var target = document.getElementById("notificationTarget").value || "all";
    if (!title) { _showToast("请输入通知标题"); return; }
    Api.createNotification("admin", title, content, target).then(function() {
      _showToast("通知已发送", "success");
      document.getElementById("notificationTitle").value = "";
      document.getElementById("notificationContent").value = "";
      _loadNotifications();
    }).catch(function(e) {
      _showToast("发送失败: " + e.message);
    });
  };

  var deleteNotification = function(id) {
    if (!confirm("确定要删除此通知？")) return;
    Api.deleteNotification(id).then(function() {
      _showToast("通知已删除");
      _loadNotifications();
    });
  };

  // ============================================================
  // 黑名单管理
  // ============================================================
  var _loadBlacklist = function() {
    Api.getBlacklist().then(function(bl) {
      var listEl = document.getElementById("blacklistBody");
      if (!listEl) return;
      listEl.innerHTML = "";
      bl.forEach(function(item) {
        listEl.innerHTML +=
          '<tr>' +
            '<td>' + item.username + '</td>' +
            '<td>' + (item.reason || "") + '</td>' +
            '<td>' + (item.type || "") + '</td>' +
            '<td>' + (item.created_at || "") + '</td>' +
            '<td><button class="btn btn-sm btn-danger" onclick="AdminView.removeFromBlacklist(\'' + item.username + '\')">移除</button></td>' +
          '</tr>';
      });
    });

    Api.getUrgentBlacklist().then(function(ubl) {
      var listEl = document.getElementById("urgentBlacklistBody");
      if (!listEl) return;
      listEl.innerHTML = "";
      ubl.forEach(function(item) {
        listEl.innerHTML +=
          '<tr>' +
            '<td>' + item.username + '</td>' +
            '<td>' + (item.reason || "") + '</td>' +
            '<td>' + (item.from_time || "") + '</td>' +
            '<td>' + (item.until || "") + '</td>' +
            '<td><button class="btn btn-sm btn-danger" onclick="AdminView.removeFromUrgentBlacklist(\'' + item.username + '\')">移除</button></td>' +
          '</tr>';
      });
    });
  };

  var _addToBlacklist = function() {
    var username = document.getElementById("blacklistUsername").value.trim();
    var reason = document.getElementById("blacklistReason").value.trim();
    var type = document.getElementById("blacklistType").value;
    if (!username) { _showToast("请输入用户名"); return; }
    Api.addToBlacklist(username, reason, type).then(function() {
      _showToast("已添加到黑名单", "success");
      document.getElementById("blacklistUsername").value = "";
      document.getElementById("blacklistReason").value = "";
      _loadBlacklist();
    });
  };

  var removeFromBlacklist = function(username) {
    if (!confirm("确定移除 " + username + " 的黑名单？")) return;
    Api.removeFromBlacklist(username).then(function() {
      _showToast("已移除");
      _loadBlacklist();
    });
  };

  var _addToUrgentBlacklist = function() {
    var username = document.getElementById("urgentBlUsername").value.trim();
    var reason = document.getElementById("urgentBlReason").value.trim();
    var fromTime = document.getElementById("urgentBlFrom").value;
    var until = document.getElementById("urgentBlUntil").value || "permanent";
    if (!username) { _showToast("请输入用户名"); return; }
    Api.addToUrgentBlacklist(username, reason, fromTime, until, "admin").then(function() {
      _showToast("已添加到加急黑名单");
      document.getElementById("urgentBlUsername").value = "";
      document.getElementById("urgentBlReason").value = "";
      _loadBlacklist();
    });
  };

  var removeFromUrgentBlacklist = function(username) {
    if (!confirm("确定移除 " + username + " 的加急黑名单？")) return;
    Api.removeFromUrgentBlacklist(username).then(function() {
      _showToast("已移除");
      _loadBlacklist();
    });
  };

  // ============================================================
  // 注册审核
  // ============================================================
  var _loadRegistrations = function(filter) {
    var promise;
    if (filter === "pending") promise = Api.getRegistrationsByStatus("pending");
    else if (filter === "approved") promise = Api.getRegistrationsByStatus("approved");
    else if (filter === "rejected") promise = Api.getRegistrationsByStatus("rejected");
    else promise = Api.getAllRegistrations();

    promise.then(function(regs) {
      _pendingRegCount = regs.filter(function(r) { return r.review_status === "pending"; }).length;
      var badge = document.getElementById("regBadge");
      if (badge) badge.textContent = _pendingRegCount;

      var listEl = document.getElementById("registrationList");
      if (!listEl) return;
      listEl.innerHTML = "";
      regs.forEach(function(r) {
        var row = document.createElement("tr");
        var statusClass = r.review_status === "pending" ? "pending" : r.review_status === "approved" ? "approved" : "rejected";
        row.innerHTML =
          '<td>' + r.username + '</td>' +
          '<td>' + (r.full_name || "") + '</td>' +
          '<td>' + (r.birthdate || "") + '</td>' +
          '<td>' + (r.country || "") + ' ' + (r.province || "") + ' ' + (r.city || "") + '</td>' +
          '<td>' + (r.referrer || "无") + '</td>' +
          '<td><span class="status-badge ' + statusClass + '">' + r.review_status + '</span></td>' +
          '<td>' + r.created_at + '</td>' +
          '<td>' +
            (r.review_status === "pending" ?
              '<button class="btn btn-sm btn-success" onclick="AdminView.approveRegistration(\'' + r.username + '\')">通过</button>' +
              '<button class="btn btn-sm btn-danger" onclick="AdminView.rejectRegistration(\'' + r.username + '\')">拒绝</button>'
            : "") +
            '<button class="btn btn-sm" onclick="AdminView.deleteRegistration(\'' + r.username + '\')">删除</button>' +
          '</td>';
        listEl.appendChild(row);
      });
    });
  };

  var approveRegistration = function(username) {
    Api.approveRegistration(username).then(function(user) {
      _showToast("已通过 " + username + " 的注册申请", "success");
      _loadRegistrations();
      _loadRegisteredUsers();
      updateStats();
    }).catch(function(e) {
      _showToast("操作失败: " + e.message);
    });
  };

  var rejectRegistration = function(username) {
    Api.rejectRegistration(username).then(function() {
      _showToast("已拒绝 " + username + " 的注册申请");
      _loadRegistrations();
    });
  };

  var deleteRegistration = function(username) {
    if (!confirm("确定删除 " + username + " 的注册申请？")) return;
    Api.deleteRegistration(username).then(function() {
      _showToast("已删除");
      _loadRegistrations();
    });
  };

  // ============================================================
  // 用户管理
  // ============================================================
  var _loadUserManagement = function() {
    Api.getAllUsers().then(function(users) {
      var listEl = document.getElementById("userManagementList");
      if (!listEl) return;
      listEl.innerHTML = "";
      users.forEach(function(u) {
        var statusClass = u.review_status === "approved" ? "approved" : u.review_status === "pending" ? "pending" : "rejected";
        var frozenBadge = u.frozen === 1 ? ' <span style="color:#ff4444;">[已冻结]</span>' : "";
        listEl.innerHTML +=
          '<tr>' +
            '<td>' + u.id + frozenBadge + '</td>' +
            '<td>' + (u.full_name || "") + '</td>' +
            '<td>' + u.points + '</td>' +
            '<td><span class="status-badge ' + statusClass + '">' + u.review_status + '</span></td>' +
            '<td>' + u.created_at + '</td>' +
            '<td>' +
              (u.frozen === 1 ?
                '<button class="btn btn-sm btn-success" onclick="AdminView.unfreezeUser(\'' + u.id + '\')">解冻</button>'
              : '<button class="btn btn-sm btn-warning" onclick="AdminView.freezeUser(\'' + u.id + '\')">冻结</button>') +
              '<button class="btn btn-sm btn-danger" onclick="AdminView.deleteUser(\'' + u.id + '\')">删除</button>' +
            '</td>' +
          '</tr>';
      });
    });
  };

  var freezeUser = function(username) {
    if (!confirm("确定冻结用户 " + username + "？")) return;
    Api.freezeUser(username).then(function() {
      _showToast("已冻结 " + username);
      _loadUserManagement();
    });
  };

  var unfreezeUser = function(username) {
    Api.unfreezeUser(username).then(function() {
      _showToast("已解冻 " + username);
      _loadUserManagement();
    });
  };

  var deleteUser = function(username) {
    if (!confirm("确定删除用户 " + username + " 及其所有数据？此操作不可撤销！")) return;
    Api.deleteUser(username).then(function() {
      _showToast("已删除 " + username);
      _loadUserManagement();
      updateStats();
    });
  };

  // ============================================================
  // 管理员添加凭证（简化版）
  // ============================================================
  var _submitAdminAddVoucher = function() {
    var username = document.getElementById("adminVoucherUser").value;
    var type = document.getElementById("adminVoucherType").value;
    var shop = document.getElementById("adminVoucherShop").value.trim();
    var remark = document.getElementById("adminVoucherRemark").value.trim();
    var payRadio = document.querySelector('input[name="adminPaymentMethod"]:checked');
    var payVal = payRadio ? payRadio.value : "";

    if (!username) { _showToast("请选择用户"); return; }
    if (!shop) { _showToast("请输入店铺名称"); return; }

    var voucherData = {
      user_id: username,
      order_type: type,
      shop_name: shop,
      remark: remark,
      payment_method: payVal,
      status: "待审核",
      payment_status: "待支付"
    };

    // 根据类型获取金额
    if (type === "普通凭证") {
      voucherData.amount = parseFloat(document.getElementById("adminVoucherAmount").value) || 0;
    } else if (type === "线上购物") {
      voucherData.amount = parseFloat(document.getElementById("adminOnlineAmount").value) || 0;
      voucherData.platform = document.getElementById("adminOnlinePlatform").value;
      voucherData.order_no = document.getElementById("adminOnlineOrderNo").value.trim();
    } else if (type === "电器凭证") {
      voucherData.amount = parseFloat((document.getElementById("adminElectricAmount").value || "").replace(/元|,/g, "")) || 0;
      voucherData.electric_category = document.getElementById("adminElectricCategory").value;
      voucherData.electric_brand = document.getElementById("adminElectricBrand").value.trim();
    }

    var btn = document.getElementById("btnAdminAddVoucherConfirm");
    btn.textContent = "提交中...";
    btn.disabled = true;

    // 上传图片
    var shopPhotoFile = _adminAddShopPhoto.file;
    var orderPhotoFiles = _adminAddOrderPhotos.files.slice();

    var uploadPromises = [];
    if (shopPhotoFile) {
      uploadPromises.push(_fileToBase64(shopPhotoFile).then(function(b64) {
        return Api.uploadImage(b64, "vouchers").then(function(r) { voucherData.shop_photo = r.url; });
      }));
    }
    if (orderPhotoFiles.length > 0) {
      var orderUrls = [];
      orderPhotoFiles.forEach(function(f) {
        uploadPromises.push(_fileToBase64(f).then(function(b64) {
          return Api.uploadImage(b64, "vouchers").then(function(r) { orderUrls.push(r.url); });
        }));
      });
      Promise.all(uploadPromises).then(function() {
        voucherData.order_photos = JSON.stringify(orderUrls);
        if (type === "线上购物") voucherData.shopping_photos = JSON.stringify(orderUrls);
        return _doCreateAdminVoucher(voucherData, btn);
      }).catch(function(e) {
        _showToast("图片上传失败: " + e.message);
        btn.textContent = "提交凭证";
        btn.disabled = false;
      });
    } else {
      _doCreateAdminVoucher(voucherData, btn);
    }
  };

  var _doCreateAdminVoucher = function(voucherData, btn) {
    // 签名
    if (voucherData.order_type === "普通凭证" && _adminSignatureNormal.data) {
      voucherData.signature = _adminSignatureNormal.data;
    } else if (voucherData.order_type === "线上购物" && _adminSignatureOnline.data) {
      voucherData.signature = _adminSignatureOnline.data;
    } else if (voucherData.order_type === "电器凭证" && _adminSignatureElectric.data) {
      voucherData.signature = _adminSignatureElectric.data;
    }

    Api.createVoucher(voucherData).then(function() {
      _showToast("凭证已添加", "success");
      document.getElementById("adminAddVoucherOverlay").classList.remove("active");
      loadIssues();
    }).catch(function(e) {
      _showToast("添加失败: " + e.message);
    }).then(function() {
      btn.textContent = "提交凭证";
      btn.disabled = false;
    });
  };

  var _fileToBase64 = function(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) { resolve(e.target.result.split(",")[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // ============================================================
  // 显示/隐藏加载动画
  // ============================================================
  var showLoading = function(show) {
    var el = document.getElementById("loadingOverlay");
    if (el) el.style.display = show ? "flex" : "none";
  };

  var _showToast = function(msg, type) {
    type = type || "info";
    var toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 3000);
  };

  // ============================================================
  // 定时同步
  // ============================================================
  var _startAutoSync = function() {
    if (_broadcastInterval) clearInterval(_broadcastInterval);
    _broadcastInterval = setInterval(function() {
      if (_currentChatUser) _loadChatMessages(_currentChatUser);
      updateStats();
    }, 30000);
  };

  // ============================================================
  // 积分调整
  // ============================================================
  var adjustPoints = function() {
    var username = document.getElementById("pointsUsername").value.trim();
    var delta = parseInt(document.getElementById("pointsDelta").value) || 0;
    var reason = document.getElementById("pointsReason").value.trim();
    if (!username || delta === 0) { _showToast("请输入用户名和积分变动量"); return; }
    Points.adminAdjust(username, delta, reason || "管理员调整").then(function() {
      _showToast("积分调整成功", "success");
      document.getElementById("pointsUsername").value = "";
      document.getElementById("pointsDelta").value = "";
      document.getElementById("pointsReason").value = "";
    }).catch(function(e) {
      _showToast("操作失败: " + e.message);
    });
  };

  // ============================================================
  // 初始化
  // ============================================================
  var init = function() {
    Api.init().then(function() {
      loadIssues();
      _loadRegisteredUsers();
      _loadChatUsers();
      _loadNotifications();
      _loadBlacklist();
      _loadRegistrations("pending");
      _startAutoSync();
      setInterval(function() { _loadChatUsers(); _loadNotifications(); }, 60000);
    }).catch(function(e) {
      console.error("Admin init error:", e);
      _showToast("初始化失败: " + e.message);
    });
  };

  // ============================================================
  // 签名 Canvas
  // ============================================================
  var _initSignatureCanvas = function(canvasId, clearBtnId, storageRef) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var parent = canvas.parentElement;
    if (parent && parent.clientWidth > 0) {
      canvas.width = parent.clientWidth;
      canvas.height = 150;
    }
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
    function end() { if (drawing) { drawing = false; storageRef.data = canvas.toDataURL(); } }
    canvas.onmousedown = start; canvas.onmousemove = move; canvas.onmouseup = end; canvas.onmouseleave = end;
    canvas.ontouchstart = start; canvas.ontouchmove = move; canvas.ontouchend = end;
    var clearBtn = document.getElementById(clearBtnId);
    if (clearBtn) {
      clearBtn.onclick = function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        storageRef.data = null;
      };
    }
    if (storageRef.data) {
      var img = new Image();
      img.onload = function() { ctx.drawImage(img, 0, 0); };
      img.src = storageRef.data;
    }
  };

  // ============================================================
  // 添加凭证弹窗 UI
  // ============================================================
  var _openAdminAddVoucherModal = function() {
    _loadRegisteredUsersForVoucher();
    document.getElementById("adminVoucherType").value = "普通凭证";
    document.getElementById("adminVoucherShop").value = "";
    document.getElementById("adminVoucherAmount").value = "";
    document.getElementById("adminOnlinePlatform").value = "";
    document.getElementById("adminOnlineOrderNo").value = "";
    document.getElementById("adminOnlineAmount").value = "";
    document.getElementById("adminElectricOrderType").value = "";
    document.getElementById("adminElectricCategory").value = "";
    document.getElementById("adminElectricBrand").value = "";
    document.getElementById("adminElectricAmount").value = "";
    document.getElementById("adminVoucherRemark").value = "";
    document.querySelectorAll('input[name="adminPaymentMethod"]').forEach(function(r) { r.checked = false; });
    _adminAddShopPhoto.file = null;
    _adminAddOrderPhotos.files = [];
    _adminSignatureNormal.data = null;
    _adminSignatureOnline.data = null;
    _adminSignatureElectric.data = null;
    _toggleAdminVoucherFields();
    document.getElementById("adminAddVoucherOverlay").classList.add("active");
    setTimeout(function() {
      _initSignatureCanvas("adminSignatureCanvasNormal", "btnAdminClearSignatureNormal", _adminSignatureNormal);
    }, 200);
  };

  var _toggleAdminVoucherFields = function() {
    var type = document.getElementById("adminVoucherType").value;
    var isNormal = (type === "普通凭证");
    var isOnline = (type === "线上购物");
    var isElec = (type === "电器凭证");
    document.getElementById("adminAddNormalFields").style.display = isNormal ? "block" : "none";
    document.getElementById("adminAddOnlineFields").style.display = isOnline ? "block" : "none";
    document.getElementById("adminAddElectricFields").style.display = isElec ? "block" : "none";
    setTimeout(function() {
      if (isNormal) _initSignatureCanvas("adminSignatureCanvasNormal", "btnAdminClearSignatureNormal", _adminSignatureNormal);
      if (isOnline) _initSignatureCanvas("adminSignatureCanvasOnline", "btnAdminClearSignatureOnline", _adminSignatureOnline);
      if (isElec) _initSignatureCanvas("adminSignatureCanvasElectric", "btnAdminClearSignatureElectric", _adminSignatureElectric);
    }, 200);
  };

  var _bindUploadArea = function(areaId, inputId, previewId, storageRef, isMulti) {
    var area = document.getElementById(areaId);
    var input = document.getElementById(inputId);
    if (!area || !input) return;
    var clickHandler = function(e) {
      if (e.target === area || e.target.closest(".upload-placeholder") || e.target.closest(".upload-preview") || (isMulti && e.target.closest(".upload-preview-list"))) {
        input.click();
      }
    };
    area.addEventListener("click", clickHandler);
    input.addEventListener("change", function(e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      if (!files.length) return;
      if (isMulti) {
        storageRef.files = (storageRef.files || []).concat(files);
        var list = document.getElementById(previewId);
        if (!list) return;
        files.forEach(function(f) {
          var reader = new FileReader();
          reader.onload = function(ev) {
            var wrap = document.createElement("div");
            wrap.className = "upload-preview-item";
            var img = document.createElement("img");
            img.src = ev.target.result;
            var rm = document.createElement("button");
            rm.className = "remove-preview";
            rm.textContent = "×";
            rm.onclick = function(ev2) {
              ev2.stopPropagation();
              var idx = Array.prototype.indexOf.call(list.children, wrap);
              if (idx >= 0) storageRef.files.splice(idx, 1);
              wrap.remove();
            };
            wrap.appendChild(img);
            wrap.appendChild(rm);
            list.appendChild(wrap);
          };
          reader.readAsDataURL(f);
        });
      } else {
        storageRef.file = files[0];
        var preview = document.getElementById(previewId);
        if (!preview) return;
        var reader = new FileReader();
        reader.onload = function(ev) { preview.src = ev.target.result; preview.style.display = "block"; };
        reader.readAsDataURL(files[0]);
      }
      input.value = "";
    });
  };

  var _clearUploadArea = function(previewId, storageRef, isMulti) {
    if (isMulti) {
      storageRef.files = [];
      var list = document.getElementById(previewId);
      if (list) list.innerHTML = "";
    } else {
      storageRef.file = null;
      var preview = document.getElementById(previewId);
      if (preview) { preview.src = ""; preview.style.display = "none"; }
    }
  };

  var _hideAllAdminErrors = function(prefix) {
    var errors = document.querySelectorAll("#" + prefix + " .form-error, [id^='error" + prefix + "'], [id^='errorAdmin'], [id^='errorEdit']");
    errors.forEach(function(el) {
      el.classList.remove("visible");
      el.textContent = "";
    });
  };

  var _showAdminError = function(id, msg) {
    var el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add("visible"); }
  };

  // ============================================================
  // 导出
  // ============================================================
  window.AdminView = {
    init: init,
    loadIssues: loadIssues,
    openReview: openReview,
    approveVoucher: approveVoucher,
    showRejectReason: showRejectReason,
    doReject: doReject,
    markPaid: markPaid,
    deleteVoucher: deleteVoucher,
    runLottery: runLottery,
    approveRegistration: approveRegistration,
    rejectRegistration: rejectRegistration,
    deleteRegistration: deleteRegistration,
    freezeUser: freezeUser,
    unfreezeUser: unfreezeUser,
    deleteUser: deleteUser,
    adjustPoints: adjustPoints,
    removeFromBlacklist: removeFromBlacklist,
    removeFromUrgentBlacklist: removeFromUrgentBlacklist,
    deleteNotification: deleteNotification,
    _previewImage: _previewImage,
    _initSignatureCanvas: _initSignatureCanvas,
    _bindUploadArea: _bindUploadArea,
    _clearUploadArea: _clearUploadArea,
    openAdminAddVoucherModal: _openAdminAddVoucherModal,
    submitAdminAddVoucher: _submitAdminAddVoucher,
    toggleAdminVoucherFields: _toggleAdminVoucherFields,
    sendChat: _sendChat,
    sendChatImage: _sendChatImage,
    sendNotification: _sendNotification,
    addToBlacklist: _addToBlacklist,
    addToUrgentBlacklist: _addToUrgentBlacklist,
    loadBlacklist: _loadBlacklist,
    loadRegistrations: _loadRegistrations,
    loadUserManagement: _loadUserManagement,
    loadChatUsers: _loadChatUsers
  };
})();