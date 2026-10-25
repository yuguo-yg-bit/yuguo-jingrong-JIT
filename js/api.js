var JITApi = (function() {
  // ========== Turso 代理配置 ==========
  var _tursoProxy = "https://yuguoygbit--8f55f7b6d02111f18f891607ee4eb77e.web.val.run";
  var _gameProxy = "https://yuguoygbit--游戏引擎val名.web.val.run";
  var _tursoAuth = "Jrb@025808";

  // ========== Turso 代理调用 ==========
  var _currentOperator = function() {
    try { return localStorage.getItem("jit_current_user") || "anonymous"; } catch(e) { return "anonymous"; }
  };
  var _sessionToken = function() {
    try { return localStorage.getItem("jit_session_token") || ""; } catch(e) { return ""; }
  };
  // 密码哈希（SHA-256 + 用户名盐；防数据库明文泄露）
  var _sha256hex = function(str) {
    try {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function(buf) {
        return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
      });
    } catch (e) {
      return Promise.reject(new Error("当前环境不支持哈希计算"));
    }
  };
  var _hashPw = function(password, username) {
    return _sha256hex("jit_salt_2026#" + String(username) + "#" + String(password));
  };
  var _tursoCall = function(endpoint, body) {
    var payload = body || {};
    // 统一携带操作人（审计用）
    if (!payload.operator) payload.operator = _currentOperator();
    return fetch(_tursoProxy + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": _tursoAuth,
        "X-Session-Token": _sessionToken()
      },
      body: JSON.stringify(payload)
    }).then(function(resp) {
      if (!resp.ok) {
        return resp.text().then(function(txt) {
          try {
            var errJson = JSON.parse(txt);
            throw new Error(errJson.error || "代理错误 HTTP " + resp.status);
          } catch (parseErr) {
            if (parseErr.message && parseErr.message.indexOf("代理错误 HTTP") === 0) throw parseErr;
            throw new Error("代理错误 HTTP " + resp.status + ": " + txt.substring(0, 200));
          }
        });
      }
      return resp.json();
    }).then(function(data) {
      if (data.error) throw new Error(data.error);
      return data;
    });
  };

  var _tursoSql = function(sql, params) {
    return _tursoCall("/sql", { sql: sql, params: params || [] });
  };

  var _tursoRowsToObjects = function(columns, rows) {
    return (rows || []).map(function(row) {
      var obj = {};
      (columns || []).forEach(function(col, i) {
        obj[col] = row[i] !== undefined ? row[i] : "";
      });
      return obj;
    });
  };

  // ========== localStorage → Turso 双向同步辅助 ==========
  // 读取：优先从 Turso 读，同时更新 localStorage；Turso 挂了就用 localStorage
  var _syncLoad = function(storageKey, tursoFetcher) {
    return tursoFetcher().then(function(tursoData) {
      if (tursoData !== undefined && tursoData !== null) {
        try { localStorage.setItem(storageKey, typeof tursoData === "string" ? tursoData : JSON.stringify(tursoData)); } catch(e) {}
        return tursoData;
      }
      return _syncLoadLocal(storageKey);
    }).catch(function() {
      return _syncLoadLocal(storageKey);
    });
  };

  var _syncLoadLocal = function(storageKey) {
    try { return JSON.parse(localStorage.getItem(storageKey) || "null"); } catch(e) { return null; }
  };

  // 保存：同时写 Turso + localStorage，Turso 失败也写 localStorage
  var _syncSave = function(storageKey, data, tursoSaver) {
    try { localStorage.setItem(storageKey, typeof data === "string" ? data : JSON.stringify(data)); } catch(e) {}
    if (tursoSaver) {
      return tursoSaver().catch(function(err) {
        console.warn("Turso 同步失败，localStorage 已保存:", storageKey, err.message);
        return data;
      });
    }
    return Promise.resolve(data);
  };

  var _getTursoHelpers = function() {
    var fn = function(sql, params) {
      return _tursoSql(sql, params);
    };
    fn.rowsToObjects = _tursoRowsToObjects;
    // 账务入账：积分变更唯一写入口（代理端原子+幂等，前端只读余额）
    fn.postPoints = function(payload) {
      return _tursoCall("/points", payload);
    };
    // 查自己余额（代理端校验 viewer===target，越权拒绝+留痕）
    fn.getBalance = function(username) {
      return _tursoCall("/balance", { userId: username, viewer: _currentOperator() });
    };
    // 显式审计日志
    fn.audit = function(action, detail, targetType, targetId, bizNo) {
      return _tursoCall("/audit", {
        action: action, operator: _currentOperator(),
        targetType: targetType || "", targetId: targetId || "",
        detail: detail || "", bizNo: bizNo || ""
      }).catch(function() {});
    };
    // 农场数据：从数据库加载
    fn.loadFarmData = function(username) {
      return _tursoCall("/farm-load", { userId: username }).then(function(res) {
        return res.data || null;
      });
    };
    // 农场数据：保存到数据库
    fn.saveFarmData = function(username, data) {
      return _tursoCall("/farm-save", { userId: username, data: data });
    };
    // 游戏引擎：统一接口
    fn.gameAction = function(username, action, params) {
      var payload = { userId: username, action: action };
      if (params) {
        Object.keys(params).forEach(function(k) { payload[k] = params[k]; });
      }
      return fetch(_gameProxy + "/game", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": _sessionToken()
        },
        body: JSON.stringify(payload)
      }).then(function(resp) {
        if (!resp.ok) {
          return resp.text().then(function(txt) {
            try { var e = JSON.parse(txt); throw new Error(e.error || "引擎错误 HTTP "+resp.status); }
            catch(p) { if (p.message.indexOf("引擎错误 HTTP")===0) throw p; throw new Error("引擎错误 HTTP "+resp.status); }
          });
        }
        return resp.json();
      }).then(function(data) {
        if (data.error) throw new Error(data.error);
        return data;
      });
    };
    return fn;
  };

  // ========== 缓存 ==========
  var _cache = {};
  var _getCachedOrFetch = function(key, fetcher) {
    if (_cache[key] !== undefined) return Promise.resolve(_cache[key]);
    return fetcher().then(function(data) {
      _cache[key] = data;
      return data;
    });
  };
  var _invalidateCache = function(key) {
    if (key) {
      delete _cache[key];
    } else {
      _cache = {};
    }
  };

  // ========== 将 Turso DB 行转为凭证数据结构 ==========
  var _dbRowToVoucherData = function(db) {
    var amountVal = parseFloat(db.amount || 0);
    var isElectric = !!(db.electric_category || db.electric_brand || db.electric_apply_amount);
    var discountValue = 0;
    var displayDiscount = db.discount || "";

    if (isElectric) {
      if (db.electric_subsidy_rate) {
        displayDiscount = "🎁 补贴 " + db.electric_subsidy_rate;
        if (db.electric_subsidy_amount) displayDiscount += "（约 " + db.electric_subsidy_amount + "）";
      } else {
        displayDiscount = "⏳ 待审核补贴";
      }
    } else if (db.discount && db.discount.indexOf("折") > -1) {
      var dm = db.discount.match(/(\d+(?:\.\d+)?)/);
      if (dm) discountValue = parseFloat(dm[1]) / 10;
    }

    var finalAmount;
    if (isElectric && db.final_price) {
      finalAmount = db.final_price;
    } else {
      finalAmount = isNaN(amountVal) ? db.amount : (amountVal * (discountValue || 1)).toFixed(2);
    }
    var finalPriceStr = isElectric && db.final_price ? db.final_price
      : (finalAmount ? (finalAmount + (String(finalAmount).indexOf("元") > -1 ? "" : "元")) : "");

    var originalPriceStr = db.amount ? (db.amount + (db.amount.toString().indexOf("元") > -1 ? "" : "元")) : "";
    if (isElectric && db.electric_apply_amount) {
      try { var n = parseFloat(db.electric_apply_amount); if (!isNaN(n)) originalPriceStr = n.toFixed(2) + "元（电器申请基数）"; } catch(e) {}
    }

    var paymentMethodType = "userFirst";
    if (db.payment_method && db.payment_method.indexOf("工会先代替") > -1) paymentMethodType = "unionFirst";

    var statusType;
    var statusText = db.status || "待审核";
    if (db.status === "已完成交易" || db.status === "completed") { statusType = "completed"; statusText = "已完成交易"; }
    else if (db.payment_status === "paid" || db.status === "已付款·待确认" || db.status === "paid") { statusType = "paid"; statusText = "已付款·待确认"; }
    else if (db.status === "approved") { statusType = "approved"; statusText = "已通过"; }
    else if (db.status === "rejected") { statusType = "rejected"; statusText = "已拒绝"; }
    else { statusType = "pending"; statusText = "待审核"; }

    return {
      electric: isElectric,
      electricCategory: db.electric_category || "",
      electricBrand: db.electric_brand || "",
      electricApplyAmount: String(db.electric_apply_amount || ""),
      electricSubsidyRate: db.electric_subsidy_rate || "",
      electricSubsidyAmount: String(db.electric_subsidy_amount || ""),
      shopName: db.shop_name || "",
      date: (db.created_at || "").substring(0, 10),
      discount: displayDiscount,
      discountValue: discountValue,
      paymentNote: db.payment_method || "",
      paymentMethod: db.payment_method || "",
      paymentMethodType: paymentMethodType,
      originalPrice: originalPriceStr,
      finalPrice: finalPriceStr,
      amount: String(db.amount || ""),
      status: statusText,
      statusType: statusType,
      shopPhoto: db.shop_photo || "",
      orderPhotos: db.order_photos || "",
      latitude: db.latitude || "",
      longitude: db.longitude || "",
      signature: db.signature || "",
      remark: db.remark || "",
      rejectReason: db.reject_reason || "",
      username: db.user_id || "",
      voucherId: db.id || "",
      voucherType: db.order_type || "普通凭证",
      platform: db.platform || "",
      orderNo: db.order_no || "",
      productPhoto: db.product_photo || "",
      shoppingPhotos: db.shopping_photos || "",
      _issueNumber: db.id,
      _issueUrl: "#",
      _createdAt: db.created_at || "",
      _updatedAt: db.updated_at || "",
      _state: (db.status === "已完成交易" || db.status === "已关闭") ? "closed" : "open",
      _labels: [],
      _title: (db.user_id || "") + (db.id || ""),
      number: db.id
    };
  };

  // ========== 图片压缩（返回 base64 数据） ==========
  var _compressImage = function(file) {
    return new Promise(function(resolve, reject) {
      if (!file || !file.type || !file.type.match(/image\//)) {
        reject(new Error("不是图片文件"));
        return;
      }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var maxW = 600;
        var maxH = 600;
        var w = img.width;
        var h = img.height;
        if (w > maxW || h > maxH) {
          var ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL("image/jpeg", 0.5);
        resolve(dataUrl);
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        reject(new Error("图片加载失败"));
      };
      img.src = url;
    });
  };

  var _imageFileToDataUrl = function(file) {
    return new Promise(function(resolve, reject) {
      if (!file) { resolve(""); return; }
      if (file.size > 5 * 1024 * 1024) {
        return _compressImage(file).then(resolve).catch(function() { resolve(""); });
      }
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { resolve(""); };
      reader.readAsDataURL(file);
    });
  };

  // 上传图片到代理，代理用 GitHub Token 上传到图片仓库，返回 URL
  var _uploadImageToProxy = function(base64DataUrl, folder) {
    if (!base64DataUrl) return Promise.resolve("");
    // 提取纯 base64（去掉 data:image/...;base64, 前缀）
    var parts = base64DataUrl.split(",");
    var base64Content = parts.length > 1 ? parts[1] : parts[0];
    return _tursoCall("/upload-image", {
      base64Data: base64Content,
      folder: folder || "vouchers"
    }).then(function(result) {
      return result.url || "";
    }).catch(function(err) {
      console.error("图片上传失败，使用 base64 兜底:", err);
      return base64DataUrl;
    });
  };

  // ========== 凭证 CRUD（Turso） ==========

  var _getVouchers = function(username) {
    return _getCachedOrFetch("vouchers_" + username, function() {
      return _tursoSql("SELECT * FROM vouchers WHERE user_id=? AND user_id NOT LIKE '【%】%' AND shop_name NOT LIKE '【%】%' ORDER BY created_at DESC", [username]).then(function(result) {
        var objs = _tursoRowsToObjects(result.columns, result.rows);
        return objs.map(_dbRowToVoucherData);
      });
    });
  };

  var _getAllVouchers = function() {
    return _getCachedOrFetch("allVouchers", function() {
      return _tursoSql("SELECT * FROM vouchers WHERE user_id NOT LIKE '【%】%' AND shop_name NOT LIKE '【%】%' ORDER BY created_at DESC", []).then(function(result) {
        var objs = _tursoRowsToObjects(result.columns, result.rows);
        return objs.map(_dbRowToVoucherData);
      });
    });
  };

  var _getVoucherCount = function() {
    return _getAllVouchers().then(function(vouchers) {
      return vouchers.length;
    });
  };

  var _getApprovedCount = function() {
    return _getAllVouchers().then(function(vouchers) {
      return vouchers.filter(function(v) { return v.statusType === "approved"; }).length;
    });
  };

  var _getNextVoucherId = function() {
    return _getCachedOrFetch("allVouchersForId", function() {
      return _tursoSql("SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) + 1 AS next_id FROM vouchers", []).then(function(result) {
        var objs = _tursoRowsToObjects(result.columns, result.rows);
        return parseInt((objs[0] && objs[0].next_id) || 1, 10);
      });
    }).catch(function() {
      return Date.now().toString().slice(-8);
    });
  };

  var _getVoucherById = function(id) {
    return _getAllVouchers().then(function(vouchers) {
      return vouchers.find(function(v) { return String(v.voucherId) === String(id); });
    });
  };

  var _submitVoucher = function(voucherData) {
    var now = new Date().toISOString();
    var id = voucherData.voucherId || voucherData._issueNumber || "";
    var sql = "INSERT OR REPLACE INTO vouchers (id, user_id, shop_name, latitude, longitude, amount, discount, order_photos, payment_method, signature, remark, reject_reason, platform, order_no, product_photo, shopping_photos, electric_category, electric_brand, electric_apply_amount, electric_subsidy_rate, electric_subsidy_amount, review_result, final_price, shop_photo, status, order_type, payment_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    var params = [
      id,
      voucherData.username || "",
      voucherData.shopName || "",
      voucherData.latitude || "",
      voucherData.longitude || "",
      String(voucherData.amount || "0"),
      voucherData.discount || "",
      Array.isArray(voucherData.orderPhotos) ? voucherData.orderPhotos.join("|") : (voucherData.orderPhotos || ""),
      voucherData.paymentMethod || "",
      voucherData.signature || "",
      voucherData.remark || "",
      voucherData.rejectReason || "",
      voucherData.platform || "",
      voucherData.orderNo || "",
      voucherData.productPhoto || "",
      Array.isArray(voucherData.shoppingPhotos) ? voucherData.shoppingPhotos.join("|") : (voucherData.shoppingPhotos || ""),
      voucherData.electricCategory || "",
      voucherData.electricBrand || "",
      String(voucherData.electricApplyAmount || "0"),
      voucherData.electricSubsidyRate || "",
      String(voucherData.electricSubsidyAmount || "0"),
      voucherData.reviewResult || "",
      voucherData.finalPrice || "",
      voucherData.shopPhoto || "",
      voucherData.status || "待审核",
      voucherData.voucherType || "普通凭证",
      voucherData.paymentStatus || "pending",
      now, now
    ];
    return _tursoSql(sql, params).then(function() {
      _invalidateCache();
      return _dbRowToVoucherData({
        id: id,
        user_id: voucherData.username || "",
        shop_name: voucherData.shopName || "",
        shop_photo: voucherData.shopPhoto || "",
        order_photos: Array.isArray(voucherData.orderPhotos) ? voucherData.orderPhotos.join("|") : (voucherData.orderPhotos || ""),
        latitude: voucherData.latitude || "",
        longitude: voucherData.longitude || "",
        amount: String(voucherData.amount || "0"),
        discount: voucherData.discount || "",
        payment_method: voucherData.paymentMethod || "",
        signature: voucherData.signature || "",
        remark: voucherData.remark || "",
        reject_reason: voucherData.rejectReason || "",
        platform: voucherData.platform || "",
        order_no: voucherData.orderNo || "",
        product_photo: voucherData.productPhoto || "",
        shopping_photos: Array.isArray(voucherData.shoppingPhotos) ? voucherData.shoppingPhotos.join("|") : (voucherData.shoppingPhotos || ""),
        electric_category: voucherData.electricCategory || "",
        electric_brand: voucherData.electricBrand || "",
        electric_apply_amount: String(voucherData.electricApplyAmount || "0"),
        electric_subsidy_rate: voucherData.electricSubsidyRate || "",
        electric_subsidy_amount: String(voucherData.electricSubsidyAmount || "0"),
        review_result: voucherData.reviewResult || "",
        final_price: voucherData.finalPrice || "",
        status: voucherData.status || "待审核",
        order_type: voucherData.voucherType || "普通凭证",
        lotteried_users: voucherData.lotteriedUsers || "",
        payment_status: voucherData.paymentStatus || "pending",
        completed_at: voucherData.completedAt || null,
        created_at: now,
        updated_at: now
      });
    });
  };

  var _submitVoucherWithImages = function(voucherData, shopPhotoFile, orderPhotoFiles, isNewShopPhoto, anyNewOrderPhotos) {
    var promises = [];
    if (isNewShopPhoto && shopPhotoFile) {
      promises.push(
        _imageFileToDataUrl(shopPhotoFile).then(function(dataUrl) {
          return _uploadImageToProxy(dataUrl, "vouchers").then(function(url) {
            voucherData.shopPhoto = url || dataUrl;
          });
        })
      );
    } else {
      if (!voucherData.shopPhoto) voucherData.shopPhoto = "";
    }
    if (anyNewOrderPhotos && orderPhotoFiles && orderPhotoFiles.length > 0) {
      for (var i = 0; i < orderPhotoFiles.length; i++) {
        promises.push((function(idx) {
          return _imageFileToDataUrl(orderPhotoFiles[idx]).then(function(dataUrl) {
            return _uploadImageToProxy(dataUrl, "vouchers").then(function(url) {
              if (!Array.isArray(voucherData.orderPhotos)) {
                voucherData.orderPhotos = typeof voucherData.orderPhotos === "string" ? voucherData.orderPhotos.split("|").filter(function(x) { return !!x; }) : (voucherData.orderPhotos ? [voucherData.orderPhotos] : []);
              }
              if (!Array.isArray(voucherData.orderPhotos)) voucherData.orderPhotos = [];
              voucherData.orderPhotos[idx] = url || dataUrl;
            });
          });
        })(i));
      }
    }
    return Promise.all(promises).then(function() {
      return _submitVoucher(voucherData);
    });
  };

  var _updateVoucherIssueBody = function(voucherData) {
    var id = voucherData._issueNumber || voucherData.voucherId || "";
    var now = new Date().toISOString();
    var sql = "UPDATE vouchers SET shop_name=?, shop_photo=?, order_photos=?, latitude=?, longitude=?, amount=?, discount=?, payment_method=?, remark=?, signature=?, reject_reason=?, platform=?, order_no=?, product_photo=?, shopping_photos=?, electric_category=?, electric_brand=?, electric_apply_amount=?, electric_subsidy_rate=?, electric_subsidy_amount=?, review_result=?, final_price=?, updated_at=? WHERE id=?";
    var params = [
      voucherData.shopName || "",
      voucherData.shopPhoto || "",
      Array.isArray(voucherData.orderPhotos) ? voucherData.orderPhotos.join("|") : (voucherData.orderPhotos || ""),
      voucherData.latitude || "",
      voucherData.longitude || "",
      String(voucherData.amount || "0"),
      voucherData.discount || "",
      voucherData.paymentMethod || "",
      voucherData.remark || "",
      voucherData.signature || "",
      voucherData.rejectReason || "",
      voucherData.platform || "",
      voucherData.orderNo || "",
      voucherData.productPhoto || "",
      Array.isArray(voucherData.shoppingPhotos) ? voucherData.shoppingPhotos.join("|") : (voucherData.shoppingPhotos || ""),
      voucherData.electricCategory || "",
      voucherData.electricBrand || "",
      String(voucherData.electricApplyAmount || "0"),
      voucherData.electricSubsidyRate || "",
      String(voucherData.electricSubsidyAmount || "0"),
      voucherData.reviewResult || "",
      voucherData.finalPrice || "",
      now, id
    ];
    return _tursoSql(sql, params).then(function() {
      _invalidateCache("allVouchers");
      return { number: id, html_url: "#" };
    });
  };

  var _updateVoucherIssue = function(voucherData) {
    return _updateVoucherIssueBody(voucherData);
  };

  // ========== 凭证状态变更（Turso） ==========
  var _markVoucherCompleted = function(issueNumber, paymentNote) {
    var now = new Date().toISOString();
    return _tursoSql(
      "UPDATE vouchers SET payment_status='completed', payment_method=COALESCE(NULLIF(?,''),payment_method), status='已完成交易', updated_at=? WHERE id=?",
      [paymentNote || "", now, String(issueNumber)]
    ).then(function() { _invalidateCache("allVouchers"); });
  };

  var _markVoucherPaid = function(issueNumber, paymentNote) {
    var now = new Date().toISOString();
    return _tursoSql(
      "UPDATE vouchers SET payment_status='paid', payment_method=COALESCE(NULLIF(?,''),payment_method), status='已付款·待确认', updated_at=? WHERE id=?",
      [paymentNote || "", now, String(issueNumber)]
    ).then(function() { _invalidateCache("allVouchers"); });
  };

  // ========== 聊天（Turso） ==========
  var _getChatMessages = function(userId) {
    return _tursoSql("SELECT * FROM chat_messages WHERE user_id=? ORDER BY created_at ASC", [userId]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(function(r) {
        return {
          from: r.sender || "",
          text: r.content || "",
          time: r.created_at || "",
          image: r.image_url || ""
        };
      });
    });
  };

  var _sendChatMessage = function(userId, sender, text, imageUrl) {
    var now = new Date().toISOString();
    var msgId = "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return _tursoSql(
      "INSERT INTO chat_messages (id, user_id, sender, content, image_url, is_read, created_at) VALUES (?,?,?,?,?,0,?)",
      [msgId, userId, sender, text || "", imageUrl || "", now]
    );
  };

  var _getAllChatUsers = function() {
    return _tursoSql(
      "SELECT user_id, MAX(created_at) AS last_at FROM chat_messages GROUP BY user_id ORDER BY last_at DESC",
      []
    ).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(function(r) { return r.user_id; });
    });
  };

  var _getVoucherUsers = function() {
    return _tursoSql("SELECT DISTINCT user_id FROM vouchers ORDER BY user_id ASC", []).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(function(r) { return r.user_id; });
    });
  };

  var _markChatRead = function(userId) {
    return _tursoSql("UPDATE chat_messages SET is_read=1 WHERE user_id=?", [userId]);
  };

  var _uploadChatImage = function(file, username) {
    return _compressImage(file).then(function(dataUrl) {
      return _uploadImageToProxy(dataUrl, "chat").then(function(url) {
        return url || dataUrl;
      });
    });
  };

  // ========== 头像上传（GitHub 代理） ==========
  var _uploadAvatar = function(base64DataUrl) {
    if (!base64DataUrl) return Promise.resolve("");
    var parts = base64DataUrl.split(",");
    var base64Content = parts.length > 1 ? parts[1] : parts[0];
    return _tursoCall("/upload-image", {
      base64Data: base64Content,
      folder: "avatars"
    }).then(function(result) {
      return result.url || "";
    }).catch(function(err) {
      console.warn("头像上传 GitHub 失败:", err.message);
      return "";
    });
  };

  // ========== 单用户等级查询 ==========
  var _getUserLevel = function(userId) {
    return _tursoSql("SELECT * FROM user_levels WHERE user_id=? LIMIT 1", [userId]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length === 0) return null;
      var r = objs[0];
      return {
        userId: r.user_id || userId,
        level: parseInt(r.level || 0, 10),
        exp: parseInt(r.exp || 0, 10),
        streak: parseInt(r.streak_days || 0, 10),
        totalVouchers: parseInt(r.total_vouchers || 0, 10),
        basicTickets: parseInt(r.basic_tickets || 0, 10),
        rareTickets: parseInt(r.rare_tickets || 0, 10),
        lastLogin: r.last_login || "",
        lastUpload: r.last_upload || "",
        badges: (function() { try { return JSON.parse(r.badges || "[]"); } catch(e) { return []; } })(),
        avatar: r.avatar || "",
        theme: r.theme || "default",
        avatarFrame: r.avatar_frame || "none",
        bio: r.bio || "",
        location: r.location || "",
        joinedAt: r.joined_at || "",
        cover: r.cover || "",
        lastWheelFree: r.last_wheel_free || "",
        discountBackup: (function() { try { return JSON.parse(r.discount_backup || "[]"); } catch(e) { return []; } })(),
        nickname: r.nickname || "",
        realName: r.real_name || ""
      };
    });
  };

  // ========== 管理员端 Turso 操作 ==========
  var _getAllVoucherIssueObjects = function() {
    // 排除【积分】【注册申请】【注册用户】等系统占位行
    return _tursoSql("SELECT * FROM vouchers WHERE user_id NOT LIKE '【%】%' AND shop_name NOT LIKE '【%】%' ORDER BY created_at DESC", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows).map(_voucherRowToIssue);
    });
  };

  var _updateVoucherStatusTurso = function(issueNumber, action, reason, extra) {
    var now = new Date().toISOString();
    var newStatus;
    if (action === "approved") newStatus = "approved";
    else if (action === "rejected") newStatus = "rejected";
    else if (action === "completed") newStatus = "completed";
    else if (action === "paid") newStatus = "paid";
    else newStatus = "pending";
    var sql = "UPDATE vouchers SET status=?, reject_reason=COALESCE(NULLIF(?,''),reject_reason), updated_at=? WHERE id=?";
    var params = [newStatus, reason || "", now, String(issueNumber)];
    // 电器补贴：额外更新补贴比例和金额
    if (extra && extra.isElectric) {
      sql = "UPDATE vouchers SET status=?, reject_reason=COALESCE(NULLIF(?,''),reject_reason), electric_subsidy_rate=?, electric_subsidy_amount=?, updated_at=? WHERE id=?";
      params = [newStatus, reason || "", String(extra.subsidyRate || ""), String(extra.subsidyAmount || ""), now, String(issueNumber)];
    }
    return _tursoSql(sql, params).then(function() { _invalidateCache("allVouchers"); });
  };

  var _deleteVoucherTurso = function(issueNumber) {
    return _tursoSql("DELETE FROM vouchers WHERE id=?", [String(issueNumber)]).then(function() { _invalidateCache("allVouchers"); });
  };

  var _updateVoucherWithLottery = function(voucherId, voucherData) {
    var now = new Date().toISOString();
    return _tursoSql(
      "UPDATE vouchers SET discount=?, final_price=?, updated_at=? WHERE id=?",
      [voucherData.discount || "", voucherData.finalPrice || "", now, String(voucherId)]
    ).then(function() {
      _invalidateCache("allVouchers");
      _invalidateCache("allVouchersForId");
      return { number: voucherId, html_url: "#" };
    });
  };

  var _updateVoucherFields = function(issueNumber, fields) {
    var now = new Date().toISOString();
    var setClauses = [];
    var params = [];
    var allowedFields = ["shop_name", "shop_photo", "order_photos", "latitude", "longitude", "amount", "discount", "payment_method", "remark", "signature", "reject_reason", "platform", "order_no", "product_photo", "shopping_photos", "electric_category", "electric_brand", "electric_apply_amount", "electric_subsidy_rate", "electric_subsidy_amount", "review_result", "final_price", "status", "order_type", "payment_status"];
    Object.keys(fields).forEach(function(key) {
      if (allowedFields.indexOf(key) > -1) {
        setClauses.push(key + "=?");
        params.push(fields[key] === undefined ? "" : fields[key]);
      }
    });
    if (setClauses.length === 0) return Promise.resolve();
    setClauses.push("updated_at=?");
    params.push(now);
    params.push(String(issueNumber));
    return _tursoSql("UPDATE vouchers SET " + setClauses.join(",") + " WHERE id=?", params).then(function() {
      _invalidateCache("allVouchers");
    });
  };

  var _getAllRegistrationIssueObjects = function() {
    return _tursoSql("SELECT * FROM registrations ORDER BY created_at DESC", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows).map(_registrationRowToIssue);
    });
  };

  var _approveRegistrationTurso = function(regId) {
    return _tursoSql("UPDATE registrations SET review_status='approved' WHERE id=?", [String(regId)]);
  };

  var _rejectRegistrationTurso = function(regId) {
    return _tursoSql("UPDATE registrations SET review_status='rejected' WHERE id=?", [String(regId)]);
  };

  // ========== 注册系统（Turso） ==========
  var _findRegisteredUser = function(username) {
    return _tursoSql("SELECT * FROM registrations WHERE username=? AND review_status='approved' LIMIT 1", [username]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length > 0) return objs[0];
      return null;
    });
  };

  var _findPendingRegistration = function(username) {
    return _tursoSql("SELECT * FROM registrations WHERE username=? AND review_status='pending' LIMIT 1", [username]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length > 0) return objs[0];
      return null;
    });
  };

  var _submitRegistrationRequest = function(data) {
    var username = data.username || "";
    return _findRegisteredUser(username).then(function(existing) {
      if (existing) {
        return _submitVoucher({ username: username, shopName: "【注册已通过】请勿重复注册", amount: "0", status: "registration-duplicate" });
      }
      return _findPendingRegistration(username);
    }).then(function(pending) {
      if (pending) {
        return Promise.resolve({ number: pending.id || pending.number || "", html_url: "#", alreadyPending: true });
      }
      var now = new Date().toISOString();
      var fullName = data.fullName || "";
      var password = data.password || "";
      var referrer = data.referrer || "";
      var birthdate = data.birthdate || "";
      var country = data.country || "";
      var province = data.province || "";
      var city = data.city || "";
      var regId = "reg_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      // 密码哈希存储（不再存明文）
      return _hashPw(password, username).then(function(hash) {
        return _tursoSql(
          "INSERT INTO registrations (id, username, password_hash, full_name, birthdate, country, province, city, referrer, review_status, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?)",
          [regId, username, "sha256$" + hash, fullName, birthdate, country, province, city, referrer, now]
        ).then(function() {
          return { number: regId, html_url: "#" };
        });
      });
    });
  };

  var _getPendingRegistrations = function() {
    return _tursoSql("SELECT * FROM registrations WHERE review_status='pending' ORDER BY created_at DESC", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows);
    });
  };

  var _approveRegistration = function(regId) {
    return _approveRegistrationTurso(regId);
  };

  var _rejectRegistration = function(regId) {
    return _rejectRegistrationTurso(regId);
  };

  var _verifyRegisteredUser = function(username, password) {
    return _findRegisteredUser(username).then(function(result) {
      if (!result) return { valid: false, reason: "not_found" };
      var stored = String(result.password_hash || "");
      if (stored.indexOf("sha256$") === 0) {
        // 哈希存储：比对哈希
        return _hashPw(password, username).then(function(hash) {
          if (stored !== "sha256$" + hash) return { valid: false, reason: "wrong_password" };
          return { valid: true, user: result, fullName: result.full_name || result.username || "" };
        });
      }
      // 旧明文数据：比对明文，成功后就地升级为哈希
      if (stored !== password) return { valid: false, reason: "wrong_password" };
      _hashPw(password, username).then(function(hash) {
        return _tursoSql("UPDATE registrations SET password_hash=? WHERE username=? AND review_status='approved'", ["sha256$" + hash, username]).catch(function() {});
      });
      return { valid: true, user: result, fullName: result.full_name || result.username || "" };
    });
  };

  // ========== 登录（发会话 token，代理端校验） ==========
  var _login = function(username, password) {
    if (!username || !password) return Promise.reject(new Error("请输入用户名和密码"));
    return _hashPw(password, username).then(function(hash) {
      return _tursoCall("/login", {
        username: username,
        password: password,
        passwordHash: "sha256$" + hash,
        role: "user"
      }).then(function(res) {
        if (res.ok && res.token) {
          try {
            localStorage.setItem("jit_session_token", res.token);
            localStorage.setItem("jit_session_user", res.username || username);
            localStorage.setItem("jit_session_role", res.role || "user");
          } catch (e) {}
        }
        return res;
      });
    });
  };

  var _getReferrals = function(username) {
    return _tursoSql("SELECT * FROM registrations WHERE referrer=? AND review_status='approved' ORDER BY created_at DESC", [username]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(function(r) {
        return {
          username: r.username || "",
          fullName: r.full_name || "",
          createdAt: r.created_at || ""
        };
      });
    });
  };

  // ========== 通知系统（Turso） ==========
  var _sendNotification = function(title, content, targetUsers) {
    var now = new Date().toISOString();
    var targetStr = Array.isArray(targetUsers) ? targetUsers.join(",") : (targetUsers || "all");
    var notifId = "ntf_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return _tursoSql(
      "INSERT INTO notifications (id, title, content, target_users, created_at) VALUES (?,?,?,?,?)",
      [notifId, title, content, targetStr, now]
    ).then(function() {
      return { ok: true };
    });
  };

  var _getAllNotifications = function() {
    return _tursoSql("SELECT * FROM notifications ORDER BY created_at DESC", []).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(function(r) {
        return {
          number: r.id || "",
          title: r.title || "",
          body: r.content || r.body || "",
          created_at: r.created_at || "",
          target_users: r.target_users || "all",
          state: r.state || "open"
        };
      });
    });
  };

  var _getUserNotifications = function(username) {
    return _getAllNotifications().then(function(list) {
      return list.filter(function(n) {
        if (!n.target_users || n.target_users === "all") return true;
        var targets = n.target_users.split(",").map(function(t) { return t.trim(); });
        return targets.indexOf(username) !== -1;
      });
    });
  };

  var _replyNotification = function(notifId, username, message) {
    var now = new Date().toISOString();
    return _tursoSql(
      "INSERT INTO notification_replies (notification_id, username, message, created_at) VALUES (?,?,?,?)",
      [String(notifId), username, message, now]
    );
  };

  var _getNotificationReplies = function(notifId) {
    return _tursoSql("SELECT * FROM notification_replies WHERE notification_id=? ORDER BY created_at ASC", [String(notifId)]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(function(r) {
        return {
          user: { login: r.username || "" },
          body: r.message || "",
          created_at: r.created_at || ""
        };
      });
    });
  };

  // ========== 加急标记（Turso） ==========
  var _markUrgent = function(voucherId, reason, username) {
    var now = new Date().toISOString();
    return _tursoSql(
      "UPDATE vouchers SET is_urgent=1, urgent_reason=?, urgent_username=?, urgent_time=?, updated_at=? WHERE id=?",
      [reason || "", username || "", now, now, String(voucherId)]
    ).then(function() { _invalidateCache("allVouchers"); });
  };

  var _removeUrgent = function(voucherId) {
    var now = new Date().toISOString();
    return _tursoSql(
      "UPDATE vouchers SET is_urgent=0, urgent_reason='', urgent_username='', urgent_time='', updated_at=? WHERE id=?",
      [now, String(voucherId)]
    ).then(function() { _invalidateCache("allVouchers"); });
  };

  var _getUrgentReason = function(voucherId) {
    return _tursoSql("SELECT is_urgent, urgent_reason, urgent_username, urgent_time FROM vouchers WHERE id=? LIMIT 1", [String(voucherId)]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length === 0) return { is_urgent: false, reason: "", username: "", time: "" };
      return {
        is_urgent: !!objs[0].is_urgent,
        reason: objs[0].urgent_reason || "",
        username: objs[0].urgent_username || "",
        time: objs[0].urgent_time || ""
      };
    });
  };

  // ========== 用户档案（Turso） ==========
  var _updateUserPassword = function(username, newPasswordHash) {
    var now = new Date().toISOString();
    return _tursoSql(
      "INSERT OR REPLACE INTO users (id, password_hash, updated_at) VALUES (?,?,?)",
      [username, newPasswordHash, now]
    );
  };

  var _getUserProfile = function(username) {
    return _tursoSql("SELECT * FROM users WHERE id=? LIMIT 1", [username]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length === 0) return null;
      var r = objs[0];
      return {
        username: r.id || username,
        fullName: r.full_name || "",
        isAdmin: !!r.is_admin,
        createdAt: r.created_at || ""
      };
    });
  };

  // ===== OAuth =====
  var _oauthVerifyToken = function(token) {
    return _tursoSql("SELECT * FROM oauth_tokens WHERE token=? LIMIT 1", [token]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length === 0) return null;
      var r = objs[0];
      var now = Date.now();
      var expiresAt = parseInt(r.expires_at || 0, 10);
      if (now >= expiresAt && expiresAt > 0) {
        return _tursoSql("DELETE FROM oauth_tokens WHERE token=?", [token]).then(function() { return null; });
      }
      return _tursoSql("UPDATE oauth_tokens SET last_used_at=? WHERE token=?", [new Date().toISOString(), token]).then(function() {
        try {
          localStorage.setItem("jit_session_token", token);
          localStorage.setItem("jit_session_user", r.username || "");
          localStorage.setItem("jit_session_role", "user");
        } catch (e) {}
        return { username: r.username || "", token: token, expiresAt: expiresAt };
      });
    });
  };

  // ===== OAuth 迁移（确保 oauth_tokens 表存在） =====
  var _runOAuthMigration = function() {
    var chain = Promise.resolve();
    chain = chain.then(function() {
      return _tursoCall("/sql", { sql: "SELECT 1 FROM oauth_tokens LIMIT 1", params: [] }).catch(function(err) {
        if (err.message && err.message.indexOf("no such table") > -1) {
          return _tursoCall("/sql", { sql: "CREATE TABLE oauth_tokens (token TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER DEFAULT 0, created_at TEXT, last_used_at TEXT)", params: [] });
        }
        throw err;
      });
    });
    return chain;
  };

  _runOAuthMigration().catch(function(err) {
    console.warn("OAuth 迁移跳过（可能已执行过）:", err.message);
  });

  // ===== 积分+装扮+社区迁移（确保 users/user_levels 有新列） =====
  var _runPointsMigration = function() {
    var chain = Promise.resolve();
    var migrateCol = function(table, col, def) {
      return _tursoCall("/sql", { sql: "ALTER TABLE " + table + " ADD COLUMN " + col + " " + def, params: [] }).catch(function(err) {
        if (err.message && err.message.indexOf("duplicate column") > -1) return;
        console.warn(col + " 列迁移跳过:", err.message);
      });
    };
    chain = chain.then(function() { return migrateCol("users", "frozen", "INTEGER DEFAULT 0"); });
    chain = chain.then(function() { return migrateCol("user_levels", "theme", "TEXT DEFAULT 'default'"); });
    chain = chain.then(function() { return migrateCol("user_levels", "avatar_frame", "TEXT DEFAULT 'none'"); });
    chain = chain.then(function() { return migrateCol("user_levels", "bio", "TEXT DEFAULT ''"); });
    chain = chain.then(function() { return migrateCol("user_levels", "location", "TEXT DEFAULT ''"); });
    chain = chain.then(function() { return migrateCol("user_levels", "joined_at", "TEXT DEFAULT ''"); });
    chain = chain.then(function() { return migrateCol("user_levels", "cover", "TEXT DEFAULT ''"); });
    chain = chain.then(function() { return migrateCol("user_levels", "last_wheel_free", "TEXT DEFAULT ''"); });
    chain = chain.then(function() { return migrateCol("user_levels", "discount_backup", "TEXT DEFAULT '[]'"); });
    return chain;
  };

  _runPointsMigration().catch(function(err) {
    console.warn("积分迁移跳过（可能已执行过）:", err.message);
  });

  // ========== 加急黑名单（Turso） ==========
  var _addToUrgentBlacklistTurso = function(username, reason, until, operator) {
    var now = new Date().toISOString();
    return _tursoSql(
      "INSERT OR REPLACE INTO urgent_blacklist (username, reason, from_time, until, operator, created_at) VALUES (?,?,?,?,?,?)",
      [username, reason || "", now, until || "permanent", operator || "admin", now]
    );
  };

  var _removeFromUrgentBlacklistTurso = function(username) {
    return _tursoSql("DELETE FROM urgent_blacklist WHERE username=?", [username]);
  };

  var _getUrgentBlacklistRows = function() {
    return _tursoSql("SELECT * FROM urgent_blacklist ORDER BY created_at DESC", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows);
    });
  };

  // ========== 普通黑名单（Turso） ==========
  var _addToBlacklistTurso = function(username, reason, type, until) {
    var now = new Date().toISOString();
    return _tursoSql(
      "INSERT OR REPLACE INTO blacklist (username, reason, time, type, until, created_at) VALUES (?,?,?,?,?,?)",
      [username, reason || "", now, type || "dynamic", until || "", now]
    );
  };

  var _removeFromBlacklistTurso = function(username) {
    return _tursoSql("DELETE FROM blacklist WHERE username=?", [username]);
  };

  var _getBlacklistRows = function() {
    return _tursoSql("SELECT * FROM blacklist ORDER BY created_at DESC", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows);
    });
  };

  // ========== 管理员登录验证（走会话） ==========
  var _adminLogin = function(passwordHash) {
    return _tursoCall("/login", {
      username: "admin",
      passwordHash: passwordHash,
      role: "admin"
    }).then(function(res) {
      if (res.ok && res.token) {
        try {
          localStorage.setItem("jit_session_token", res.token);
          localStorage.setItem("jit_session_user", "admin");
          localStorage.setItem("jit_session_role", "admin");
        } catch (e) {}
        return true;
      }
      return false;
    }).catch(function() {
      return false;
    });
  };

  // ========== 社区状态（Turso） ==========
  var _getCommunityStatuses = function() {
    return _tursoSql("SELECT * FROM community_statuses ORDER BY created_at DESC LIMIT 200", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows);
    });
  };

  var _postCommunityStatus = function(username, content) {
    var now = new Date().toISOString();
    return _tursoSql(
      "INSERT INTO community_statuses (username, content, created_at) VALUES (?,?,?)",
      [username, content, now]
    );
  };

  // ========== 社区监管（禁言 + 删除动态） ==========
  var _getCommunityBans = function() {
    return _tursoSql("SELECT * FROM community_bans ORDER BY created_at DESC", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows);
    });
  };

  var _getCommunityBan = function(username) {
    return _tursoSql("SELECT * FROM community_bans WHERE user_id=? ORDER BY id DESC LIMIT 1", [username]).then(function(result) {
      var rows = _tursoRowsToObjects(result.columns, result.rows);
      return rows.length > 0 ? rows[0] : null;
    });
  };

  // bannedUntil：ISO 时间字符串；永久传 "9999-12-31T23:59:59.999Z"
  var _upsertCommunityBan = function(username, bannedUntil, reason, createdBy) {
    var now = new Date().toISOString();
    return _tursoSql("SELECT id FROM community_bans WHERE user_id=? LIMIT 1", [username]).then(function(result) {
      var rows = _tursoRowsToObjects(result.columns, result.rows);
      if (rows.length === 0) {
        return _tursoSql(
          "INSERT INTO community_bans (user_id, banned_until, reason, created_by, created_at) VALUES (?,?,?,?,?)",
          [username, bannedUntil, reason || "", createdBy || "admin", now]
        );
      }
      return _tursoSql(
        "UPDATE community_bans SET banned_until=?, reason=?, created_by=?, created_at=? WHERE id=?",
        [bannedUntil, reason || "", createdBy || "admin", now, String(rows[0].id)]
      );
    });
  };

  var _removeCommunityBan = function(username) {
    return _tursoSql("DELETE FROM community_bans WHERE user_id=?", [username]);
  };

  var _deleteCommunityStatus = function(statusId) {
    return _tursoSql("DELETE FROM community_statuses WHERE id=?", [String(statusId)]);
  };

  // ========== 管理端兼容层：Turso 行 → GitHub Issue 结构 ==========
  // 迁移 Turso 后管理端渲染层仍按 GitHub Issue 字段访问（issue.user.login / issue.body / issue.labels / issue.number），
  // 此处把 Turso 结构化行映射成兼容结构，避免管理端崩溃。
  var _voucherRowToIssue = function(r) {
    var st = String(r.status || "");
    var stLower = st.toLowerCase();
    var labels = [];
    if (st.indexOf("完成") > -1 || stLower === "completed") labels.push("completed");
    else if (st.indexOf("拒绝") > -1 || st.indexOf("驳回") > -1 || stLower === "rejected") labels.push("rejected");
    else if (st.indexOf("通过") > -1 || stLower === "approved") labels.push("approved");
    else if (st.indexOf("已支付") > -1 || stLower === "paid") labels.push("paid");
    else labels.push("pending");
    if (String(r.is_urgent) === "1" || r.is_urgent === 1 || r.is_urgent === true) labels.push("urgent");
    var lines = [
      "｜用户ID：" + (r.user_id || ""),
      "｜店铺名称：" + (r.shop_name || ""),
      "｜店铺照片：" + (r.shop_photo || ""),
      "｜商品订单照片：" + (r.order_photos || ""),
      "｜定位：" + ((r.latitude || "") + "," + (r.longitude || "")),
      "｜金额：" + (r.amount != null ? r.amount : ""),
      "｜支付方式：" + (r.payment_method || ""),
      "｜备注：" + (r.remark || ""),
      "｜签字：" + (r.signature || ""),
      "｜创建时间：" + (r.created_at || ""),
      "｜状态：" + st,
      "｜中奖打折：" + (r.discount || ""),
      "｜不通过原因：" + (r.reject_reason || ""),
      "｜凭证类型：" + (r.order_type || ""),
      "｜购物平台：" + (r.platform || ""),
      "｜订单号：" + (r.order_no || "")
    ];
    return {
      id: r.id,
      number: r.id,
      userId: r.user_id,
      user: { login: r.user_id },
      title: r.shop_name,
      body: lines.join("\n"),
      labels: labels.map(function(l) { return { name: l }; }),
      state: st,
      status: st,
      isUrgent: String(r.is_urgent) === "1" || r.is_urgent === 1 || r.is_urgent === true,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  };

  var _registrationRowToIssue = function(r) {
    var lines = [
      "｜用户名：" + (r.username || ""),
      "｜姓名：" + (r.full_name || ""),
      "｜出生日期：" + (r.birthdate || ""),
      "｜国家：" + (r.country || ""),
      "｜省份：" + (r.province || ""),
      "｜城市：" + (r.city || ""),
      "｜邀请人：" + (r.referrer || ""),
      "｜审核状态：" + (r.review_status || ""),
      "｜注册时间：" + (r.created_at || "")
    ];
    return {
      id: r.id,
      number: r.id,
      body: lines.join("\n"),
      _oauthProvider: r.oauth_provider || "",
      state: r.review_status || "pending",
      status: r.review_status || "pending",
      created_at: r.created_at,
      user: { login: r.username || "" }
    };
  };

  // ========== 用户等级/经验/打卡（Turso user_levels 表） ==========
  var _getUserLevels = function() {
    return _tursoSql("SELECT * FROM user_levels", []).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      var map = {};
      objs.forEach(function(r) {
        map[r.user_id || r.id || ""] = {
          level: parseInt(r.level || 0, 10),
          exp: parseInt(r.exp || 0, 10),
          streak: parseInt(r.streak_days || 0, 10),
          totalVouchers: parseInt(r.total_vouchers || 0, 10),
          basicTickets: parseInt(r.basic_tickets || 0, 10),
          rareTickets: parseInt(r.rare_tickets || 0, 10),
          lastLogin: r.last_login || "",
          lastUpload: r.last_upload || "",
          badges: (function() { try { return JSON.parse(r.badges || "[]"); } catch(e) { return []; } })(),
          avatar: r.avatar || "",
          theme: r.theme || "default",
          avatarFrame: r.avatar_frame || "none",
          bio: r.bio || "",
          location: r.location || "",
          joinedAt: r.joined_at || "",
          cover: r.cover || "",
          lastWheelFree: r.last_wheel_free || "",
          discountBackup: (function() { try { return JSON.parse(r.discount_backup || "[]"); } catch(e) { return []; } })(),
          nickname: r.nickname || "",
          realName: r.real_name || ""
        };
      });
      return map;
    });
  };

  var _updateUserLevel = function(userId, data) {
    var now = new Date().toISOString();
    return _tursoSql(
      "INSERT OR REPLACE INTO user_levels (user_id, level, exp, streak_days, total_vouchers, basic_tickets, rare_tickets, last_login, last_upload, badges, avatar, theme, avatar_frame, bio, location, joined_at, cover, last_wheel_free, discount_backup, nickname, real_name, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [userId, data.level||0, data.exp||0, data.streak||0, data.totalVouchers||0, data.basicTickets||0, data.rareTickets||0, data.lastLogin||"", data.lastUpload||"", JSON.stringify(data.badges||[]), data.avatar||"", data.theme||"default", data.avatarFrame||"none", data.bio||"", data.location||"", data.joinedAt||"", data.cover||"", data.lastWheelFree||"", JSON.stringify(data.discountBackup||[]), data.nickname||"", data.realName||"", now]
    );
  };

  var _incrementUserLevelField = function(userId, field, delta) {
    var now = new Date().toISOString();
    // 严格白名单：非法字段直接拒绝，防列名注入
    var columnMap = { exp: "exp", streak: "streak_days", totalVouchers: "total_vouchers", basicTickets: "basic_tickets", rareTickets: "rare_tickets" };
    var column = columnMap[field];
    if (!column) return Promise.reject(new Error("非法字段: " + field));
    return _tursoSql(
      "INSERT INTO user_levels (user_id, " + column + ", updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET " + column + " = COALESCE(user_levels." + column + ",0) + ?, updated_at=?",
      [userId, delta||0, now, delta||0, now]
    );
  };

  // ========== 抽奖券（Turso lottery_tickets 表） ==========
  var _getUserTickets = function(userId) {
    return _tursoSql("SELECT COUNT(*) AS cnt FROM lottery_tickets WHERE user_id=? AND status='unused' AND expires_at > ?", [userId, new Date().toISOString()]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return parseInt((objs[0] && objs[0].cnt) || 0, 10);
    });
  };

  var _getUserExpiredTickets = function(userId) {
    return _tursoSql("SELECT COUNT(*) AS cnt FROM lottery_tickets WHERE user_id=? AND (status='expired' OR expires_at <= ?)", [userId, new Date().toISOString()]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return parseInt((objs[0] && objs[0].cnt) || 0, 10);
    });
  };

  var _addTickets = function(userId, count, ticketType, source) {
    var now = new Date().toISOString();
    var expire = new Date(Date.now() + 30*24*60*60*1000).toISOString();
    var type = ticketType || "basic";
    var src = source || "system";
    var inserts = [];
    for (var i = 0; i < (count||1); i++) {
      var tid = "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8) + "_" + i;
      inserts.push(_tursoSql(
        "INSERT INTO lottery_tickets (id, user_id, ticket_type, source, status, expires_at, created_at) VALUES (?,?,?,?,'unused',?,?)",
        [tid, userId, type, src, expire, now]
      ));
    }
    return Promise.all(inserts).then(function() { return count; });
  };

  var _useTicket = function(userId) {
    return _tursoSql(
      "UPDATE lottery_tickets SET status='used', used_at=? WHERE id=(SELECT id FROM lottery_tickets WHERE user_id=? AND status='unused' AND expires_at > ? LIMIT 1)",
      [new Date().toISOString(), userId, new Date().toISOString()]
    );
  };

  var _expireOldTickets = function() {
    var now = new Date().toISOString();
    return _tursoSql("UPDATE lottery_tickets SET status='expired' WHERE status IN ('unused','used') AND expires_at <= ?", [now]);
  };

  // ========== 抽奖记录（Turso lottery_records 表） ==========
  var _getLotteryRecords = function(userId) {
    var sql = userId ? "SELECT * FROM lottery_records WHERE user_id=? ORDER BY created_at DESC LIMIT 200" : "SELECT * FROM lottery_records ORDER BY created_at DESC LIMIT 500";
    var params = userId ? [userId] : [];
    return _tursoSql(sql, params).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows);
    });
  };

  var _addLotteryRecord = function(record) {
    var now = new Date().toISOString();
    var rid = record.id || ("lr_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8));
    return _tursoSql(
      "INSERT INTO lottery_records (id, user_id, voucher_id, pool_type, prize_id, prize_name, prize_cash, prize_rate, voucher_amount, final_reward, is_win, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [rid, record.userId||"", record.voucherId||"", record.poolType||"basic", record.prizeId||"", record.prizeName||"", record.prizeCash||0, record.prizeRate||0, record.voucherAmount||0, record.finalReward||0, record.isWin?1:0, now]
    );
  };

  var _syncLotteryRecordsFromLocal = function(userId, recordsArray) {
    if (!recordsArray || recordsArray.length === 0) return Promise.resolve();
    var promises = recordsArray.map(function(r) {
      return _addLotteryRecord({
        id: r.id || ("lr_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8)),
        userId: r.userId || r.user || userId || "",
        voucherId: r.voucherId || r.voucherKey || "",
        poolType: r.poolType || "basic",
        prizeId: r.prize || r.prizeId || "",
        prizeName: r.discount || r.prizeName || r.scratchDiscount || "",
        prizeCash: parseFloat(r.reward || r.prizeCash || r.totalReward || 0),
        prizeRate: parseFloat(r.value || r.prizeRate || 0),
        voucherAmount: parseFloat(r.voucherAmount || 0),
        finalReward: parseFloat(r.reward || r.finalReward || 0),
        isWin: !!(r.isWin || r.reward || r.totalReward),
        created_at: r.date || new Date().toISOString()
      });
    });
    return Promise.all(promises);
  };

  // ========== 中奖墙（Turso win_wall 表） ==========
  var _getWinWall = function() {
    return _tursoSql("SELECT * FROM win_wall ORDER BY created_at DESC LIMIT 200", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows);
    });
  };

  var _addWinWallEntry = function(entry) {
    var now = new Date().toISOString();
    var wid = entry.id || ("ww_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8));
    return _tursoSql(
      "INSERT INTO win_wall (id, user_id, prize_name, prize_cash, pool_type, voucher_amount, created_at) VALUES (?,?,?,?,?,?,?)",
      [wid, entry.userId||entry.user||"", entry.prizeName||entry.prize||"", parseFloat(entry.prizeCash||entry.amount||0), entry.poolType||"basic", parseFloat(entry.voucherAmount||0), now]
    );
  };

  var _syncWinWallFromLocal = function(wallArray) {
    if (!wallArray || wallArray.length === 0) return Promise.resolve();
    var promises = wallArray.map(function(w) {
      return _addWinWallEntry({
        userId: w.user || w.userId || "",
        prizeName: w.prize || w.prizeName || w.discount || "",
        prizeCash: parseFloat(w.amount || w.prizeCash || w.reward || 0),
        poolType: w.poolType || "basic",
        voucherAmount: parseFloat(w.voucherAmount || 0),
        created_at: w.time || w.created_at || new Date().toISOString()
      });
    });
    return Promise.all(promises);
  };

  // ========== 任务奖励（Turso task_rewards 表） ==========
  var _getTaskRewards = function(userId) {
    return _tursoSql("SELECT * FROM task_rewards WHERE user_id=? ORDER BY created_at DESC", [userId]).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows);
    });
  };

  var _addTaskReward = function(userId, taskId, rewardType, rewardAmount) {
    var now = new Date().toISOString();
    var rid = "tr_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
    return _tursoSql(
      "INSERT INTO task_rewards (id, user_id, task_id, reward_type, reward_amount, claimed_at, created_at) VALUES (?,?,?,?,?,?,?)",
      [rid, userId, taskId, rewardType||"", rewardAmount||0, now, now]
    );
  };

  var _syncTaskRewardsFromLocal = function(userId, taskMap) {
    if (!taskMap || Object.keys(taskMap).length === 0) return Promise.resolve();
    var promises = [];
    Object.keys(taskMap).forEach(function(taskId) {
      var val = taskMap[taskId];
      var count = (typeof val === "number") ? val : 1;
      for (var i = 0; i < count; i++) {
        promises.push(_addTaskReward(userId, taskId, typeof val === "object" ? (val.type||"") : "", typeof val === "object" ? (val.amount||0) : 1));
      }
    });
    return Promise.all(promises);
  };

  // ========== 装扮（Turso user_outfits 表） ==========
  var _getUserOutfits = function(userId) {
    return _tursoSql("SELECT outfit_id FROM user_outfits WHERE user_id=? ORDER BY unlocked_at ASC", [userId]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(function(r) { return r.outfit_id; });
    });
  };

  var _unlockOutfit = function(userId, outfitId) {
    var now = new Date().toISOString();
    var oid = "uo_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
    return _tursoSql(
      "INSERT OR IGNORE INTO user_outfits (id, user_id, outfit_id, unlocked_at) VALUES (?,?,?,?)",
      [oid, userId, outfitId, now]
    );
  };

  var _syncOutfitsFromLocal = function(userId, outfitsArray) {
    if (!outfitsArray || outfitsArray.length === 0) return Promise.resolve();
    var promises = outfitsArray.map(function(oid) {
      return _unlockOutfit(userId, String(oid));
    });
    return Promise.all(promises);
  };

  // ========== 风控（Turso risk_control 表） ==========
  var _getRiskBudget = function() {
    return _tursoSql("SELECT * FROM risk_control WHERE id='global' LIMIT 1", []).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length === 0) return { budget: 5000, spent: 0, perUserCap: 500, perTicketCap: 200, rareOpen: true };
      var r = objs[0];
      return {
        budget: parseFloat(r.monthly_budget || 5000),
        spent: parseFloat(r.monthly_spent || 0),
        perUserCap: parseFloat(r.per_user_monthly_cap || 500),
        perTicketCap: parseFloat(r.per_ticket_cap || 200),
        rareOpen: !!(r.rare_pool_open || r.rare_pool_open === undefined ? true : r.rare_pool_open)
      };
    });
  };

  var _updateRiskBudget = function(data) {
    var now = new Date().toISOString();
    var monthKey = new Date().toISOString().substring(0,7);
    return _tursoSql(
      "INSERT OR REPLACE INTO risk_control (id, monthly_budget, monthly_spent, per_user_monthly_cap, per_ticket_cap, rare_pool_open, month_key, updated_at) VALUES ('global',?,?,?,?,?,?,?)",
      [data.budget||5000, data.spent||0, data.perUserCap||500, data.perTicketCap||200, data.rareOpen?1:0, monthKey, now]
    );
  };

  var _spendRiskBudget = function(amount) {
    return _getRiskBudget().then(function(b) {
      return _updateRiskBudget({ budget: b.budget, spent: b.spent + amount, perUserCap: b.perUserCap, perTicketCap: b.perTicketCap, rareOpen: b.rareOpen });
    });
  };

  // ========== 用户月度奖励（Turso user_monthly_rewards 表） ==========
  var _getUserMonthlyReward = function(userId) {
    var monthKey = new Date().toISOString().substring(0,7);
    return _tursoSql("SELECT * FROM user_monthly_rewards WHERE user_id=? AND month_key=? LIMIT 1", [userId, monthKey]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length === 0) return { totalReward: 0, drawCount: 0 };
      return { totalReward: parseFloat(objs[0].total_reward || 0), drawCount: parseInt(objs[0].draw_count || 0, 10) };
    });
  };

  var _addUserMonthlyReward = function(userId, rewardAmount) {
    var monthKey = new Date().toISOString().substring(0,7);
    var now = new Date().toISOString();
    var rid = "umr_" + userId + "_" + monthKey;
    return _tursoSql(
      "INSERT INTO user_monthly_rewards (id, user_id, month_key, total_reward, draw_count, updated_at) VALUES (?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET total_reward = total_reward + ?, draw_count = draw_count + 1, updated_at=?",
      [rid, userId, monthKey, rewardAmount||0, now, rewardAmount||0, now]
    );
  };

  // ========== Turso 全量同步助手函数 ==========
  // 首次使用时把 localStorage 数据迁到 Turso
  var _migrateLocalToTurso = function(userId) {
    var promises = [];
    // 用户等级
    try {
      var levels = JSON.parse(localStorage.getItem("jit_user_levels") || "{}");
      if (levels && levels[userId]) {
        var ld = levels[userId];
        promises.push(_updateUserLevel(userId, { level: ld.level||0, exp: ld.exp||0, streak: ld.streak||0, totalVouchers: ld.totalVouchers||0, basicTickets: ld.basicTickets||0, rareTickets: ld.rareTickets||0, lastLogin: ld.lastLogin||localStorage.getItem("jit_last_login_"+userId)||"", badges: ld.badges||[], avatar: ld.avatar||"", nickname: ld.nickname||"", realName: ld.realName||"", bio: localStorage.getItem("jit_bio_"+userId)||"", location: localStorage.getItem("jit_location_"+userId)||"", joinedAt: localStorage.getItem("jit_joined_"+userId)||"", cover: localStorage.getItem("jit_cover_"+userId)||"", lastWheelFree: localStorage.getItem("jit_wheel_free_"+userId)||"", discountBackup: (function() { try { return JSON.parse(localStorage.getItem("jit_discount_backup")||"[]"); } catch(e) { return []; } })() }));
      }
    } catch(e) {}
    // 抽奖券
    try {
      var tickets = JSON.parse(localStorage.getItem("jit_user_tickets") || "{}");
      var cnt = parseInt(tickets[userId]||0, 10);
      if (cnt > 0) promises.push(_addTickets(userId, cnt, "basic", "migrate"));
    } catch(e) {}
    // 老虎机/刮刮乐记录
    try {
      var slotRecords = JSON.parse(localStorage.getItem("jit_slot_records") || "[]");
      if (slotRecords.length > 0) promises.push(_syncLotteryRecordsFromLocal(userId, slotRecords));
    } catch(e) {}
    try {
      var lotteryResults = JSON.parse(localStorage.getItem("jit_lottery_results") || "[]");
      if (lotteryResults.length > 0) promises.push(_syncLotteryRecordsFromLocal(userId, lotteryResults));
    } catch(e) {}
    // 中奖墙
    try {
      var winwall = JSON.parse(localStorage.getItem("jit_winwall") || "[]");
      if (winwall.length > 0) promises.push(_syncWinWallFromLocal(winwall));
    } catch(e) {}
    // 任务奖励
    try {
      var taskRewards = JSON.parse(localStorage.getItem("jit_task_rewards") || "{}");
      if (taskRewards && Object.keys(taskRewards).length > 0) promises.push(_syncTaskRewardsFromLocal(userId, taskRewards));
    } catch(e) {}
    // 装扮
    try {
      var outfits = JSON.parse(localStorage.getItem("jit_unlocked_outfits") || "[]");
      if (outfits.length > 0) promises.push(_syncOutfitsFromLocal(userId, outfits));
    } catch(e) {}
    return Promise.allSettled(promises).then(function() {
      localStorage.setItem("jit_migrated_to_turso", "1");
      return true;
    });
  };

  var _hasMigratedToTurso = function() {
    return localStorage.getItem("jit_migrated_to_turso") === "1";
  };

  // ========== 导出 ==========
  return {
    adminLogin: _adminLogin,
    getVouchers: _getVouchers,
    getAllVouchers: _getAllVouchers,
    submitVoucher: _submitVoucher,
    submitVoucherWithImages: _submitVoucherWithImages,
    getVoucherCount: _getVoucherCount,
    getApprovedCount: _getApprovedCount,
    compressImage: _compressImage,
    updateVoucherIssue: _updateVoucherIssue,
    getNextVoucherId: _getNextVoucherId,
    getVoucherById: _getVoucherById,
    invalidateCache: _invalidateCache,
    getChatMessages: _getChatMessages,
    sendChatMessage: _sendChatMessage,
    getAllChatUsers: _getAllChatUsers,
    getVoucherUsers: _getVoucherUsers,
    markChatRead: _markChatRead,
    uploadChatImage: _uploadChatImage,
    uploadAvatar: _uploadAvatar,
    uploadImageToProxy: _uploadImageToProxy,
    markVoucherCompleted: _markVoucherCompleted,
    markVoucherPaid: _markVoucherPaid,
    registerUser: _submitRegistrationRequest,
    submitRegistrationRequest: _submitRegistrationRequest,
    findRegisteredUser: _findRegisteredUser,
    findPendingRegistration: _findPendingRegistration,
    verifyRegisteredUser: _verifyRegisteredUser,
    login: _login,
    getReferrals: _getReferrals,
    getPendingRegistrations: _getPendingRegistrations,
    approveRegistration: _approveRegistration,
    rejectRegistration: _rejectRegistration,
    sendNotification: _sendNotification,
    getAllNotifications: _getAllNotifications,
    getUserNotifications: _getUserNotifications,
    replyNotification: _replyNotification,
    getNotificationReplies: _getNotificationReplies,
    markUrgent: _markUrgent,
    removeUrgent: _removeUrgent,
    getUrgentReason: _getUrgentReason,
    getAllVoucherIssueObjects: _getAllVoucherIssueObjects,
    updateVoucherStatusTurso: _updateVoucherStatusTurso,
    deleteVoucherTurso: _deleteVoucherTurso,
    updateVoucherFields: _updateVoucherFields,
    updateVoucherWithLottery: _updateVoucherWithLottery,
    getAllRegistrationIssueObjects: _getAllRegistrationIssueObjects,
    approveRegistrationTurso: _approveRegistrationTurso,
    rejectRegistrationTurso: _rejectRegistrationTurso,
    updateUserPassword: _updateUserPassword,
    getUserProfile: _getUserProfile,
    addToUrgentBlacklistTurso: _addToUrgentBlacklistTurso,
    removeFromUrgentBlacklistTurso: _removeFromUrgentBlacklistTurso,
    getUrgentBlacklistRows: _getUrgentBlacklistRows,
    addToBlacklistTurso: _addToBlacklistTurso,
    removeFromBlacklistTurso: _removeFromBlacklistTurso,
    getBlacklistRows: _getBlacklistRows,
    oauthVerifyToken: _oauthVerifyToken,
    getCommunityStatuses: _getCommunityStatuses,
    postCommunityStatus: _postCommunityStatus,
    getCommunityBans: _getCommunityBans,
    getCommunityBan: _getCommunityBan,
    upsertCommunityBan: _upsertCommunityBan,
    removeCommunityBan: _removeCommunityBan,
    deleteCommunityStatus: _deleteCommunityStatus,
    getTursoHelpers: _getTursoHelpers,
    // localStorage → Turso 迁移
    getUserLevels: _getUserLevels,
    getUserLevel: _getUserLevel,
    updateUserLevel: _updateUserLevel,
    incrementUserLevelField: _incrementUserLevelField,
    getUserTickets: _getUserTickets,
    getUserExpiredTickets: _getUserExpiredTickets,
    addTickets: _addTickets,
    useTicket: _useTicket,
    expireOldTickets: _expireOldTickets,
    getLotteryRecords: _getLotteryRecords,
    addLotteryRecord: _addLotteryRecord,
    syncLotteryRecordsFromLocal: _syncLotteryRecordsFromLocal,
    getWinWall: _getWinWall,
    addWinWallEntry: _addWinWallEntry,
    syncWinWallFromLocal: _syncWinWallFromLocal,
    getTaskRewards: _getTaskRewards,
    addTaskReward: _addTaskReward,
    syncTaskRewardsFromLocal: _syncTaskRewardsFromLocal,
    getUserOutfits: _getUserOutfits,
    unlockOutfit: _unlockOutfit,
    syncOutfitsFromLocal: _syncOutfitsFromLocal,
    getRiskBudget: _getRiskBudget,
    updateRiskBudget: _updateRiskBudget,
    spendRiskBudget: _spendRiskBudget,
    getUserMonthlyReward: _getUserMonthlyReward,
    addUserMonthlyReward: _addUserMonthlyReward,
    migrateLocalToTurso: _migrateLocalToTurso,
    hasMigratedToTurso: _hasMigratedToTurso,
    syncLoad: _syncLoad,
    syncSave: _syncSave
  };
})();