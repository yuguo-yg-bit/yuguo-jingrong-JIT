var JITApi = (function() {
  // ========== Turso 代理配置 ==========
  var _tursoProxy = "https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run";
  var _tursoAuth = "Jrb@025808";

  // ========== Turso 代理调用 ==========
  var _tursoCall = function(endpoint, body) {
    return fetch(_tursoProxy + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": _tursoAuth
      },
      body: JSON.stringify(body || {})
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

  // ========== getTursoHelpers（供外部模块直接使用 Turso） ==========
  var _getTursoHelpers = function() {
    var fn = function(sql, params) {
      return _tursoSql(sql, params);
    };
    fn.rowsToObjects = _tursoRowsToObjects;
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
    if (db.status === "已完成交易") statusType = "completed";
    else if (db.payment_status === "paid" || db.status === "已付款·待确认") statusType = "paid";
    else if (db.status === "approved") statusType = "approved";
    else if (db.status === "rejected") statusType = "rejected";
    else statusType = "pending";

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
      status: db.status || "待审核",
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
    var sql = "INSERT OR REPLACE INTO vouchers (id, user_id, shop_name, latitude, longitude, amount, discount, order_photos, payment_method, signature, remark, reject_reason, platform, order_no, product_photo, shopping_photos, electric_category, electric_brand, electric_apply_amount, electric_subsidy_rate, electric_subsidy_amount, review_result, final_price, shop_photo, status, order_type, lotteried_users, payment_status, completed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
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
      voucherData.lotteriedUsers || "",
      voucherData.paymentStatus || "pending",
      voucherData.completedAt || null,
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
      "UPDATE vouchers SET payment_status='completed', payment_method=COALESCE(NULLIF(?,''),payment_method), status='已完成交易', completed_at=?, updated_at=? WHERE id=?",
      [paymentNote || "", now, now, String(issueNumber)]
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
    return _tursoSql(
      "INSERT INTO chat_messages (user_id, sender, content, image_url, read_status, created_at) VALUES (?,?,?,?,0,?)",
      [userId, sender, text || "", imageUrl || "", now]
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
    return _tursoSql("UPDATE chat_messages SET read_status=1 WHERE user_id=?", [userId]);
  };

  var _uploadChatImage = function(file, username) {
    return _compressImage(file).then(function(dataUrl) {
      return _uploadImageToProxy(dataUrl, "chat").then(function(url) {
        return url || dataUrl;
      });
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
    var newStatus = action === "approved" ? "approved" : (action === "rejected" ? "rejected" : "pending");
    var sql = "UPDATE vouchers SET status=?, reject_reason=COALESCE(NULLIF(?,''),reject_reason), updated_at=? WHERE id=?";
    var params = [newStatus, reason || "", now, String(issueNumber)];
    return _tursoSql(sql, params).then(function() { _invalidateCache("allVouchers"); });
  };

  var _deleteVoucherTurso = function(issueNumber) {
    return _tursoSql("DELETE FROM vouchers WHERE id=?", [String(issueNumber)]).then(function() { _invalidateCache("allVouchers"); });
  };

  var _updateVoucherFields = function(issueNumber, fields) {
    var now = new Date().toISOString();
    var setClauses = [];
    var params = [];
    var allowedFields = ["shop_name", "shop_photo", "order_photos", "latitude", "longitude", "amount", "discount", "payment_method", "remark", "signature", "reject_reason", "platform", "order_no", "product_photo", "shopping_photos", "electric_category", "electric_brand", "electric_apply_amount", "electric_subsidy_rate", "electric_subsidy_amount", "review_result", "final_price", "status", "order_type", "lotteried_users", "payment_status"];
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
      return _tursoSql(
        "INSERT INTO registrations (username, full_name, password, referrer, review_status, created_at, updated_at) VALUES (?,?,?,?,'pending',?,?)",
        [username, fullName, password, referrer, now, now]
      ).then(function() {
        return _tursoSql("SELECT last_insert_rowid() AS id", []);
      }).then(function(result) {
        var objs = _tursoRowsToObjects(result.columns, result.rows);
        var newId = objs.length > 0 ? String(objs[0].id) : "";
        return { number: newId, html_url: "#" };
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
      if (result.password !== password) return { valid: false, reason: "wrong_password" };
      return { valid: true, user: result, fullName: result.full_name || result.username || "" };
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
    return _tursoSql(
      "INSERT INTO notifications (title, content, target_users, created_at) VALUES (?,?,?,?)",
      [title, content, targetStr, now]
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
  var _addToBlacklistTurso = function(username, reason, type) {
    var now = new Date().toISOString();
    return _tursoSql(
      "INSERT OR REPLACE INTO blacklist (username, reason, time, type, created_at) VALUES (?,?,?,?,?)",
      [username, reason || "", now, type || "dynamic", now]
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

  // ========== 管理员登录验证 ==========
  var _adminLogin = function(passwordHash) {
    return _tursoSql(
      "SELECT id FROM users WHERE id='admin' AND password_hash=? AND is_admin=1",
      [passwordHash]
    ).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.length > 0;
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
    var labels = [];
    if (st.indexOf("完成") > -1) labels.push("completed");
    else if (st.indexOf("拒绝") > -1 || st.indexOf("驳回") > -1) labels.push("rejected");
    else if (st.indexOf("通过") > -1) labels.push("approved");
    else if (st.indexOf("已支付") > -1 || st.toLowerCase() === "paid") labels.push("paid");
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
    markVoucherCompleted: _markVoucherCompleted,
    markVoucherPaid: _markVoucherPaid,
    registerUser: _submitRegistrationRequest,
    findRegisteredUser: _findRegisteredUser,
    findPendingRegistration: _findPendingRegistration,
    verifyRegisteredUser: _verifyRegisteredUser,
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
    getTursoHelpers: _getTursoHelpers
  };
})();