var JITApi = (function() {
  var _token = JITConfig.getTokenPart1() + JITConfig.getTokenPart3() + JITConfig.getTokenPart4();
  var _apiBase = JITConfig.getApiBase();
  var _repoFull = JITConfig.getRepoFull();
  var _imageRepoFull = JITConfig.getImageRepoFull();

  // ========== Turso 代理配置 ==========
  var _tursoProxy = "https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run";
  var _tursoAuth = "Jrb@025808";

  var _headers = function() {
    return {
      "Authorization": "token " + _token,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    };
  };

  var _safeRequest = function(url, options) {
    return fetch(url, options).then(function(resp) {
      if (!resp.ok) {
        return resp.json().then(function(err) {
          var msg = "";
          if (err.errors && err.errors.length > 0) {
            msg = err.errors.map(function(e) { return e.message || e.code || JSON.stringify(e); }).join("; ");
          }
          throw new Error(msg || err.message || "请求失败: " + resp.status);
        }).catch(function(e) {
          if (e.message && e.message !== "请求失败: " + resp.status) throw e;
          throw new Error("请求失败: " + resp.status);
        });
      }
      if (resp.status === 204) return null;
      return resp.json();
    });
  };

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

  // 将 Turso 返回的 {columns:["a","b"], rows:[["v1","v2"]]} 转成对象数组
  var _tursoRowsToObjects = function(columns, rows) {
    return (rows || []).map(function(row) {
      var obj = {};
      (columns || []).forEach(function(col, i) {
        obj[col] = row[i] !== undefined ? row[i] : "";
      });
      return obj;
    });
  };

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
        var base64 = dataUrl.split(",")[1];
        resolve(base64);
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        reject(new Error("图片加载失败"));
      };
      img.src = url;
    });
  };

  var _encodePath = function(path) {
    return path.split("/").map(function(seg) { return encodeURIComponent(seg); }).join("/");
  };

  var _getFileSha = function(path) {
    var url = _apiBase + "/repos/" + _imageRepoFull + "/contents/" + _encodePath(path);
    return _safeRequest(url, {
      method: "GET",
      headers: _headers()
    }).then(function(result) {
      return result && result.sha ? result.sha : null;
    }).catch(function() {
      return null;
    });
  };

  var _uploadFileToRepo = function(path, base64Content, commitMsg, retryCount) {
    retryCount = retryCount || 0;
    var url = _apiBase + "/repos/" + _imageRepoFull + "/contents/" + _encodePath(path);
    var body = {
      message: commitMsg || "upload image",
      content: base64Content,
      branch: "main"
    };
    // 乐观策略：直接 PUT（不带 sha），文件不存在时一次成功
    // 失败（文件已存在需要 sha）→ GET sha → 递归重试
    return _safeRequest(url, {
      method: "PUT",
      headers: _headers(),
      body: JSON.stringify(body)
    }).then(function(result) {
      return result && result.content ? result.content.download_url : "";
    }).catch(function(err) {
      var msg = String(err.message || "");
      // 递归重试：先 GET sha 再带 sha PUT，最多 3 次
      if (retryCount < 3 && (msg.indexOf("sha") > -1 || msg.indexOf("expected") > -1 || msg.indexOf("422") > -1 || msg.indexOf("409") > -1)) {
        return new Promise(function(resolve) {
          setTimeout(resolve, 400 * (retryCount + 1));
        }).then(function() {
          return _getFileSha(path);
        }).then(function(sha) {
          if (sha) body.sha = sha;
          // 递归调用自身重试（retryCount+1），确保每次失败都能继续重试
          return _uploadFileToRepo(path, base64Content, commitMsg, retryCount + 1);
        });
      }
      // 非 SHA 错误或已达最大重试次数，直接抛出
      throw err;
    });
  };

  var _uploadImageToRepo = function(file, folderPath, fileName, commitMsg) {
    return _compressImage(file).then(function(base64) {
      return _uploadFileToRepo(folderPath + "/" + fileName, base64, commitMsg);
    });
  };

  var _uploadImagesToRepo = function(files, folderPath, commitMsg) {
    // 串行上传，避免并发 PUT 同一目录导致 SHA 冲突
    var results = [];
    var chain = Promise.resolve();
    for (var i = 0; i < files.length; i++) {
      (function(file, index) {
        var fileName = "order_" + (index + 1) + "_" + Date.now() + ".png";
        chain = chain.then(function() {
          return _uploadImageToRepo(file, folderPath, fileName, commitMsg).then(function(url) {
            results.push(url);
          });
        });
      })(files[i], i);
    }
    return chain.then(function() { return results; });
  };

  var _ensureLabels = function() {
    var labels = JITConfig.getLabels();
    var labelNames = Object.values(labels);
    var url = _apiBase + "/repos/" + _repoFull + "/labels";
    var promises = labelNames.map(function(name) {
      return _safeRequest(url, {
        method: "POST",
        headers: _headers(),
        body: JSON.stringify({ name: name, color: "0366d6" })
      }).catch(function() {
        return Promise.resolve(null);
      });
    });
    return Promise.all(promises);
  };

  var _createIssue = function(title, body, labels) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues";
    return _safeRequest(url, {
      method: "POST",
      headers: _headers(),
      body: JSON.stringify({
        title: title,
        body: body,
        labels: labels || [JITConfig.getLabels().voucher]
      })
    });
  };

  var _getIssues = function(labels, page, perPage) {
    page = page || 1;
    perPage = perPage || 20;
    var labelStr = labels ? labels.join(",") : "";
    var url = _apiBase + "/repos/" + _repoFull + "/issues?state=all&labels=" + encodeURIComponent(labelStr) + "&page=" + page + "&per_page=" + perPage + "&sort=created&direction=desc";
    return _safeRequest(url, {
      method: "GET",
      headers: _headers()
    });
  };

  var _getAllIssues = function(labels) {
    var labelStr = labels ? labels.join(",") : "";
    var perPage = 100;
    var page = 1;
    var allIssues = [];

    var _fetchPage = function() {
      var url = _apiBase + "/repos/" + _repoFull + "/issues?state=all&labels=" + encodeURIComponent(labelStr) + "&per_page=" + perPage + "&page=" + page + "&sort=created&direction=desc";
      return _safeRequest(url, {
        method: "GET",
        headers: _headers()
      }).then(function(issues) {
        if (!issues || !Array.isArray(issues) || issues.length === 0) {
          return allIssues;
        }
        allIssues = allIssues.concat(issues);
        if (issues.length < perPage) {
          return allIssues;
        }
        page++;
        return _fetchPage();
      });
    };

    return _fetchPage();
  };

  var _updateIssue = function(issueNumber, updates) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber;
    return _safeRequest(url, {
      method: "PATCH",
      headers: _headers(),
      body: JSON.stringify(updates)
    });
  };

  var _deleteIssue = function(issueNumber) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber;
    // GitHub API 不能真正删除 issue，只能关闭并移除标签
    return _safeRequest(url, {
      method: "PATCH",
      headers: _headers(),
      body: JSON.stringify({
        state: "closed",
        labels: ["deleted"]
      })
    });
  };

  var _closeIssue = function(issueNumber) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber;
    return _safeRequest(url, {
      method: "PATCH",
      headers: _headers(),
      body: JSON.stringify({
        state: "closed"
      })
    });
  };

  var _formatIssueBody = function(voucherData) {
    var orderPhotos = "";
    if (Array.isArray(voucherData.orderPhotos)) {
      orderPhotos = voucherData.orderPhotos.join(" | ");
    } else if (voucherData.orderPhotos) {
      orderPhotos = voucherData.orderPhotos;
    }
    var isElectric = !!(voucherData.electric || voucherData.voucherType === "电器凭证" || voucherData.electricCategory || voucherData.electricBrand);

    var lines = [
      "｜标题：" + (voucherData.username || "user") + (voucherData.voucherId || ""),
      "｜用户ID：" + (voucherData.username || "user"),
      "｜内容：店铺：" + (voucherData.shopName || ""),
      "｜     凭证类型：" + (voucherData.voucherType || "普通凭证"),
      "｜     店铺照片：" + (voucherData.shopPhoto || ""),
      "｜     商品订单照片：" + orderPhotos,
      "｜     定位：" + (voucherData.latitude || "") + "," + (voucherData.longitude || ""),
      "｜     金额：" + (voucherData.amount || ""),
      "｜     签名：" + (voucherData.signature || ""),
      "｜     备注：" + (voucherData.remark || ""),
      "｜     创建时间：" + (voucherData.date || new Date().toISOString().split("T")[0]),
      "｜     状态：" + (voucherData.status || "待审核"),
      "｜     中奖打折：" + (voucherData.discount || ""),
      "｜     支付方式：" + (voucherData.paymentMethodText || voucherData.paymentMethod || ""),
      "｜     购物平台：" + (voucherData.platform || ""),
      "｜     订单号：" + (voucherData.orderNo || ""),
      "｜     商品截图：" + (voucherData.productPhoto || ""),
      "｜     购物截图：" + (voucherData.shoppingPhotos || "")
    ];
    if (isElectric) {
      lines.push("｜     模式标识：电器补贴（非抽奖）");
      lines.push("｜     电器分类：" + (voucherData.electricCategory || ""));
      lines.push("｜     品牌名称：" + (voucherData.electricBrand || ""));
      lines.push("｜     申请基数金额：" + (voucherData.electricApplyAmount || ""));
      lines.push("｜     补贴比例：" + (voucherData.electricSubsidyRate || ""));
      lines.push("｜     补贴金额：" + (voucherData.electricSubsidyAmount || ""));
      lines.push("｜     审核结果：" + (voucherData.reviewResult || ""));
      lines.push("｜     最终实付：" + (voucherData.finalPrice || ""));
    }
    return lines.join("\n");
  };

  var _parseIssueBody = function(body) {
    var data = {};
    var lines = String(body || "").split(/\r?\n/);

    lines.forEach(function(line) {
      var trimmed = line.trim();
      if (!trimmed) return;
      var match;

      if ((match = trimmed.match(/^｜?标题：(.+)$/))) {
        data.title = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*用户ID：(.+)$/))) {
        data.userId = match[1].trim();
      } else if ((match = trimmed.match(/^｜?内容：店铺：(.+)$/))) {
        data.shopName = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*店铺照片：(.+)$/))) {
        data.shopPhoto = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*商品订单照片：(.+)$/))) {
        data.orderPhotos = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*定位：(.+)$/))) {
        var loc = match[1].trim();
        var parts = loc.split(",");
        data.latitude = parts[0] || "";
        data.longitude = parts[1] || "";
      } else if ((match = trimmed.match(/^｜?\s*金额：(.+)$/))) {
        data.amount = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*签名：(.+)$/))) {
        data.signature = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*备注：(.+)$/))) {
        data.remark = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*创建时间：(.+)$/))) {
        data.date = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*状态：(.+)$/))) {
        data.status = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*中奖打折：(.+)$/))) {
        data.discount = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*支付方式：(.+)$/))) {
        data.paymentMethod = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*不通过原因：(.+)$/))) {
        data.rejectReason = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*凭证类型：(.+)$/))) {
        data.voucherType = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*购物平台：(.+)$/))) {
        data.platform = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*订单号：(.+)$/))) {
        data.orderNo = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*商品截图：(.+)$/))) {
        data.productPhoto = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*购物截图：(.+)$/))) {
        data.shoppingPhotos = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*模式标识：(.+)$/))) {
        var s = match[1].trim();
        if (s.indexOf("电器补贴") !== -1) data.electric = true;
      } else if ((match = trimmed.match(/^｜?\s*电器分类：(.+)$/))) {
        data.electricCategory = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*品牌名称：(.+)$/))) {
        data.electricBrand = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*申请基数金额：(.+)$/))) {
        data.electricApplyAmount = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*补贴比例：(.+)$/))) {
        data.electricSubsidyRate = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*补贴金额：(.+)$/))) {
        data.electricSubsidyAmount = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*审核结果：(.+)$/))) {
        data.reviewResult = match[1].trim();
      } else if ((match = trimmed.match(/^｜?\s*最终实付：(.+)$/))) {
        data.finalPrice = match[1].trim();
        if (typeof data.discount === "undefined" || !data.discount) {
          // 兼容逻辑：前端 _renderOrders 取 discountValue/finalPrice 展示结果，
          // 补贴模式没有折扣，但给 discount 占位避免显示“未抽奖”
          data.discount = "补贴模式";
        }
      }
    });

    if (data.title) {
      var voucherIdMatch = data.title.match(/(\d+)$/);
      if (voucherIdMatch) {
        data.voucherId = voucherIdMatch[1];
      }
    }

    return data;
  };

  var _parseVoucherData = function(issue) {
    // 已经是 DB 解析后的对象（Turso 迁移后），直接返回
    if (issue && issue.shopName !== undefined && issue._issueNumber !== undefined) {
      return issue;
    }
    var parsed = _parseIssueBody(issue.body);
    var labels = (issue.labels || []).map(function(l) { return l.name; });
    var hasVoucherLabel = labels.indexOf("voucher") > -1;
    var hasCompletedLabel = labels.indexOf("completed") > -1;

    if (parsed.shopName || parsed.amount || parsed.paymentMethod || parsed.status || parsed.date) {
      var isElectric = !!(parsed.electric || parsed.voucherType === "电器凭证" || parsed.electricCategory || parsed.electricSubsidyRate);
      var amountValue = parseFloat(parsed.amount || 0);
      var discountValue = 0;
      // ===== 电器补贴：discount 显示补贴比例 =====
      var displayDiscount = parsed.discount || "";
      if (isElectric) {
        if (parsed.electricSubsidyRate) {
          // 已审核：补贴 X%
          displayDiscount = "🎁 补贴 " + parsed.electricSubsidyRate;
          if (parsed.electricSubsidyAmount) displayDiscount += "（约 " + parsed.electricSubsidyAmount + "）";
        } else {
          // 待审核：还没设置补贴比例
          displayDiscount = "⏳ 待审核补贴";
        }
      } else if (parsed.discount && parsed.discount.indexOf("折") > -1) {
        var discountMatch = parsed.discount.match(/(\d+(?:\.\d+)?)/);
        if (discountMatch) {
          discountValue = parseFloat(discountMatch[1]) / 10;
        }
      }
      // ===== finalPrice：电器优先用 body 里已经算好的文本 =====
      var finalAmount;
      if (isElectric && parsed.finalPrice) {
        finalAmount = parsed.finalPrice; // 如 "4749.05元（已减补贴 ¥249.95）"
      } else {
        finalAmount = isNaN(amountValue) ? parsed.amount : (amountValue * (discountValue || 1)).toFixed(2);
      }
      var finalPriceStr;
      if (isElectric && parsed.finalPrice) {
        finalPriceStr = parsed.finalPrice;
      } else {
        finalPriceStr = finalAmount ? (finalAmount + (String(finalAmount).indexOf("元") > -1 ? "" : "元")) : "";
      }
      var originalPriceStr = parsed.amount ? (parsed.amount + (parsed.amount.indexOf("元") > -1 ? "" : "元")) : "";
      // ===== 申请基数（电器）显示 =====
      if (isElectric && parsed.electricApplyAmount) {
        try {
          var n = parseFloat(parsed.electricApplyAmount);
          if (!isNaN(n)) originalPriceStr = n.toFixed(2) + "元（电器申请基数）";
        } catch(e) {}
      }
      var paymentMethodType = "userFirst";
      if (parsed.paymentMethod && parsed.paymentMethod.indexOf("工会先代替") > -1) {
        paymentMethodType = "unionFirst";
      }
      var statusText = parsed.status || (hasCompletedLabel ? "已完成交易" : (issue.state === "closed" ? "已关闭" : "待审核"));
      return {
        electric: isElectric,
        electricCategory: parsed.electricCategory || "",
        electricBrand: parsed.electricBrand || "",
        electricApplyAmount: parsed.electricApplyAmount || "",
        electricSubsidyRate: parsed.electricSubsidyRate || "",
        electricSubsidyAmount: parsed.electricSubsidyAmount || "",
        shopName: parsed.shopName || "",
        date: parsed.date || (issue.created_at ? issue.created_at.split("T")[0] : ""),
        discount: displayDiscount,
        discountValue: discountValue,
        paymentNote: parsed.paymentMethod || "",
        paymentMethod: parsed.paymentMethod || "",
        paymentMethodType: paymentMethodType,
        originalPrice: originalPriceStr,
        finalPrice: finalPriceStr,
        amount: parsed.amount || "",
        status: statusText,
        statusType: labels.indexOf("completed") > -1 ? "completed" : (labels.indexOf("paid") > -1 ? "paid" : (labels.indexOf("approved") > -1 ? "approved" : (labels.indexOf("rejected") > -1 ? "rejected" : "pending"))),
        shopPhoto: parsed.shopPhoto || "",
        orderPhotos: parsed.orderPhotos || "",
        latitude: parsed.latitude || "",
        longitude: parsed.longitude || "",
        signature: parsed.signature || "",
        remark: parsed.remark || "",
        rejectReason: parsed.rejectReason || "",
        username: parsed.title ? parsed.title.replace(/\d+$/, "") : "",
        voucherId: parsed.voucherId || "",
        voucherType: parsed.voucherType || (isElectric ? "电器凭证" : "普通凭证"),
        platform: parsed.platform || "",
        orderNo: parsed.orderNo || "",
        productPhoto: parsed.productPhoto || "",
        shoppingPhotos: parsed.shoppingPhotos || "",
        _issueNumber: issue.number,
        _issueUrl: issue.html_url,
        _createdAt: issue.created_at,
        _updatedAt: issue.updated_at,
        _state: issue.state,
        _labels: labels,
        _title: issue.title
      };
    }

    // 兜底：body 为空/损坏，但有 voucher label 时，用标题+标签重建最小数据
    if (hasVoucherLabel && issue.title) {
      var title = issue.title;
      var uname = title.replace(/\d+$/, "").trim();
      return {
        shopName: "(数据异常)",
        date: issue.created_at ? issue.created_at.split("T")[0] : "",
        discount: "",
        discountValue: 0,
        paymentNote: "",
        paymentMethod: "",
        paymentMethodType: "userFirst",
        originalPrice: "",
        finalPrice: "",
        amount: "",
        status: hasCompletedLabel ? "已完成交易" : "数据异常",
        statusType: hasCompletedLabel ? "completed" : "pending",
        shopPhoto: "",
        orderPhotos: "",
        latitude: "",
        longitude: "",
        signature: "",
        remark: "",
        rejectReason: "",
        username: uname,
        voucherId: "",
        _issueNumber: issue.number,
        _issueUrl: issue.html_url,
        _createdAt: issue.created_at,
        _updatedAt: issue.updated_at,
        _state: issue.state,
        _labels: labels,
        _title: issue.title
      };
    }

    try {
      var data = JSON.parse(issue.body);
      data._issueNumber = issue.number;
      data._issueUrl = issue.html_url;
      data._createdAt = issue.created_at;
      data._updatedAt = issue.updated_at;
      data._state = issue.state;
      data._labels = (issue.labels || []).map(function(l) { return l.name; });
      data._title = issue.title;
      if (!data.username && issue.title) {
        data.username = issue.title.replace(/\d+$/, "");
      }
      return data;
    } catch (e) {
      return null;
    }
  };

  // ========== 凭证 CRUD（Turso） ==========

  var _submitVoucher = function(voucherData) {
    var id = String(voucherData.voucherId || Date.now());
    var now = new Date().toISOString();
    var sql = "INSERT INTO vouchers (id, user_id, order_type, shop_name, shop_photo, order_photos, latitude, longitude, amount, discounted_amount, discount, status, payment_status, payment_method, remark, signature, reject_reason, platform, order_no, product_photo, shopping_photos, electric_category, electric_brand, electric_apply_amount, electric_subsidy_rate, electric_subsidy_amount, review_result, final_price, is_urgent, urgent_reason, urgent_username, urgent_time, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    var params = [
      id,
      voucherData.username || "",
      voucherData.voucherType || "普通凭证",
      voucherData.shopName || "",
      voucherData.shopPhoto || "",
      Array.isArray(voucherData.orderPhotos) ? voucherData.orderPhotos.join("|") : (voucherData.orderPhotos || ""),
      voucherData.latitude || "",
      voucherData.longitude || "",
      String(voucherData.amount || "0"),
      String(voucherData.discountedAmount || "0"),
      voucherData.discount || "",
      "待审核",
      "待支付",
      voucherData.paymentMethod || "",
      voucherData.remark || "",
      voucherData.signature || "",
      "",
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
      voucherData.isUrgent || voucherData.is_urgent ? "1" : "0",
      voucherData.urgentReason || "",
      voucherData.urgentUsername || "",
      voucherData.urgentTime || "",
      now, now
    ];
    return _tursoSql(sql, params).then(function() {
      _invalidateCache("allVouchers");
      _invalidateCache("allVouchersForId");
      return _tursoSql("SELECT * FROM vouchers WHERE id=?", [id]);
    }).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length > 0) {
        return _dbRowToVoucherData(objs[0]);
      }
      return { number: id, html_url: "#", created_at: now, id: id };
    });
  };

  var _submitVoucherWithImages = function(voucherData, shopPhotoFile, orderPhotoFiles, isNewShopPhoto, anyNewOrderPhotos) {
    var voucherId = voucherData.voucherId || Date.now();
    var username = voucherData.username || "user";
    var ts = Date.now();
    var folderPath = "uploads/" + username + "/" + voucherId + "_" + ts;
    var commitMsg = "上传凭证图片: " + (voucherData.shopName || "") + " #" + voucherId;

    var uploadChain = Promise.resolve();

    if (shopPhotoFile && isNewShopPhoto) {
      uploadChain = uploadChain.then(function() {
        return _uploadImageToRepo(shopPhotoFile, folderPath, "shop.png", commitMsg).then(function(url) {
          voucherData.shopPhoto = url;
        });
      });
    }

    if (orderPhotoFiles && orderPhotoFiles.length > 0 && anyNewOrderPhotos) {
      uploadChain = uploadChain.then(function() {
        return _uploadImagesToRepo(orderPhotoFiles, folderPath, commitMsg).then(function(urls) {
          voucherData.orderPhotos = (voucherData.orderPhotos || []).concat(urls);
        });
      });
    }

    if (voucherData.signature && voucherData.signature.indexOf("base64,") > -1) {
      var sigBase64 = voucherData.signature.split(",")[1];
      uploadChain = uploadChain.then(function() {
        return _uploadFileToRepo(folderPath + "/signature.png", sigBase64, commitMsg).then(function(url) {
          voucherData.signature = url;
        });
      });
    }

    return uploadChain.then(function() {
      if (voucherData._issueNumber) {
        return _updateVoucherIssueBody(voucherData);
      } else {
        return _submitVoucher(voucherData);
      }
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

  var _updateVoucherWithLottery = function(issueNumber, voucherData) {
    var now = new Date().toISOString();
    var sql = "UPDATE vouchers SET discount=?, discounted_amount=?, final_price=?, status=?, updated_at=? WHERE id=?";
    var params = [
      voucherData.discount || "",
      String(voucherData.discountValue || "0"),
      voucherData.finalPrice || "",
      voucherData.status || "待审核",
      now, String(issueNumber)
    ];
    return _tursoSql(sql, params).then(function() {
      _invalidateCache("allVouchers");
      return { number: issueNumber };
    });
  };

  var _markVoucherCompleted = function(issueNumber) {
    var now = new Date().toISOString();
    return _tursoSql("UPDATE vouchers SET status=?, updated_at=? WHERE id=?", ["已完成交易", now, String(issueNumber)]).then(function() {
      _invalidateCache("allVouchers");
      return { number: issueNumber };
    });
  };

  var _markVoucherPaid = function(issueNumber) {
    var now = new Date().toISOString();
    return _tursoSql("UPDATE vouchers SET status=?, payment_status=?, updated_at=? WHERE id=?", ["已付款·待确认", "paid", now, String(issueNumber)]).then(function() {
      _invalidateCache("allVouchers");
      return { number: issueNumber };
    });
  };

  var _cache = {};
  var _CACHE_TTL = 30000;

  var _getCachedOrFetch = function(key, fetchFn) {
    var now = Date.now();
    if (_cache[key] && (now - _cache[key].ts < _CACHE_TTL)) {
      return Promise.resolve(_cache[key].data);
    }
    return fetchFn().then(function(data) {
      _cache[key] = { data: data, ts: Date.now() };
      return data;
    }).catch(function(err) {
      if (_cache[key]) return _cache[key].data;
      throw err;
    });
  };

  var _invalidateCache = function(key) {
    delete _cache[key];
  };

  var _getVouchers = function(page, perPage) {
    page = page || 1;
    perPage = perPage || 20;
    var offset = (page - 1) * perPage;
    return _tursoSql("SELECT * FROM vouchers ORDER BY created_at DESC LIMIT ? OFFSET ?", [perPage, offset]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(_dbRowToVoucherData);
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
      return 1;
    });
  };

  var _getVoucherById = function(id) {
    return _tursoSql("SELECT * FROM vouchers WHERE id=?", [String(id)]).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      if (objs.length > 0) {
        return _dbRowToVoucherData(objs[0]);
      }
      return null;
    });
  };

  // ======= 聊天系统（Turso） =======
  var _getChatMessages = function(userId) {
    return _tursoSql("SELECT * FROM chat_messages WHERE user_id=? ORDER BY created_at ASC", [userId]).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows);
    });
  };

  var _sendChatMessage = function(userId, sender, content, imageUrl) {
    var id = "chat_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    var now = new Date().toISOString();
    return _tursoSql(
      "INSERT INTO chat_messages (id, user_id, sender, content, image_url, is_read, chat_mode, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, userId, sender, content, imageUrl || "", 0, "manual", now]
    ).then(function() {
      return { id: id, user_id: userId, sender: sender, content: content, image_url: imageUrl || "", created_at: now };
    });
  };

  var _getAllChatUsers = function() {
    return _tursoSql("SELECT DISTINCT user_id FROM chat_messages ORDER BY user_id", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows).map(function(r) { return r.user_id; });
    });
  };

  var _getVoucherUsers = function() {
    return _tursoSql("SELECT DISTINCT user_id FROM vouchers WHERE shop_name != '【聊天专用】' ORDER BY user_id", []).then(function(result) {
      return _tursoRowsToObjects(result.columns, result.rows).map(function(r) { return r.user_id; });
    });
  };

  var _markChatRead = function(userId) {
    return _tursoSql("UPDATE chat_messages SET is_read=1 WHERE user_id=? AND sender='user'", [userId]);
  };

  var _getIssueComments = function(issueNumber) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber + "/comments?per_page=100";
    return _safeRequest(url, {
      method: "GET",
      headers: _headers()
    }).catch(function() { return []; });
  };

  var _addIssueComment = function(issueNumber, body) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber + "/comments";
    return _safeRequest(url, {
      method: "POST",
      headers: _headers(),
      body: JSON.stringify({ body: body })
    });
  };

  var _getIssue = function(issueNumber) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber;
    return _safeRequest(url, {
      method: "GET",
      headers: _headers()
    });
  };

  var _uploadChatImage = function(file, username) {
    var ts = Date.now();
    var folderPath = "chat/" + (username || "user") + "/" + ts;
    return _uploadImageToRepo(file, folderPath, "chat_img.png", "聊天图片: " + (username || ""));
  };

  // ======= 用户注册系统（申请-审核制） =======
  var _formatUserBody = function(data) {
    return [
      "｜用户名：" + (data.username || ""),
      "｜密码：" + (data.password || ""),
      "｜姓名：" + (data.fullName || ""),
      "｜出生日期：" + (data.birthdate || ""),
      "｜国家：" + (data.country || ""),
      "｜省份：" + (data.province || ""),
      "｜城市：" + (data.city || ""),
      "｜注册时间：" + (data.registerTime || ""),
      "｜邀请人：" + (data.referrer || ""),
      "｜审核状态：" + (data.reviewStatus || "待审核")
    ].join("\n");
  };

  var _parseUserBody = function(body) {
    var data = {
      username: "", password: "", fullName: "", birthdate: "",
      country: "", province: "", city: "", registerTime: "", referrer: "", reviewStatus: ""
    };
    var lines = String(body || "").split(/\r?\n/);
    lines.forEach(function(line) {
      var trimmed = line.trim();
      var match;
      if ((match = trimmed.match(/^｜?\s*用户名：(.+)$/))) data.username = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*密码：(.+)$/))) data.password = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*姓名：(.+)$/))) data.fullName = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*出生日期：(.+)$/))) data.birthdate = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*国家：(.+)$/))) data.country = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*省份：(.+)$/))) data.province = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*城市：(.+)$/))) data.city = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*注册时间：(.+)$/))) data.registerTime = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*邀请人：(.+)$/))) data.referrer = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*审核状态：(.+)$/))) data.reviewStatus = match[1].trim();
    });
    return data;
  };

  // 查找已审核通过的用户（registered-user label）
  var _findRegisteredUser = function(username) {
    var label = JITConfig.getLabels().registeredUser;
    var url = _apiBase + "/repos/" + _repoFull + "/issues?state=open&labels=" + encodeURIComponent(label) + "&per_page=100";
    return _safeRequest(url, { method: "GET", headers: _headers() }).then(function(issues) {
      if (!issues || issues.length === 0) return null;
      for (var i = 0; i < issues.length; i++) {
        var data = _parseUserBody(issues[i].body);
        if (data.username === username) return { issue: issues[i], data: data };
      }
      return null;
    });
  };

  // 查找待审核的注册申请（registration-request label）
  var _findPendingRegistration = function(username) {
    var label = JITConfig.getLabels().registrationRequest;
    var url = _apiBase + "/repos/" + _repoFull + "/issues?state=open&labels=" + encodeURIComponent(label) + "&per_page=100";
    return _safeRequest(url, { method: "GET", headers: _headers() }).then(function(issues) {
      if (!issues || issues.length === 0) return null;
      for (var i = 0; i < issues.length; i++) {
        var data = _parseUserBody(issues[i].body);
        if (data.username === username) return { issue: issues[i], data: data };
      }
      return null;
    });
  };

  // 提交注册申请
  var _submitRegistrationRequest = function(data) {
    var username = data.username;
    // 先检查是否已注册或已有待审核申请
    return _findRegisteredUser(username).then(function(existing) {
      if (existing) throw new Error("该用户名已被注册");
      var builtinUsers = JITConfig.getUsers();
      if (builtinUsers[username]) throw new Error("该用户名已存在");
      return _findPendingRegistration(username);
    }).then(function(pending) {
      if (pending) throw new Error("您已提交过注册申请，请等待管理员审核");
      var label = JITConfig.getLabels().registrationRequest;
      data.registerTime = new Date().toISOString().replace("T", " ").slice(0, 19);
      data.reviewStatus = "待审核";
      return _safeRequest(_apiBase + "/repos/" + _repoFull + "/issues", {
        method: "POST",
        headers: _headers(),
        body: JSON.stringify({
          title: "注册申请 - " + data.fullName + "（" + username + "）",
          body: _formatUserBody(data),
          labels: ["voucher", label]
        })
      });
    });
  };

  // 管理员获取待审核注册申请列表
  var _getPendingRegistrations = function() {
    var label = JITConfig.getLabels().registrationRequest;
    var url = _apiBase + "/repos/" + _repoFull + "/issues?state=open&labels=" + encodeURIComponent(label) + "&per_page=100";
    return _safeRequest(url, { method: "GET", headers: _headers() }).then(function(issues) {
      if (!issues || issues.length === 0) return [];
      return issues.map(function(issue) {
        var data = _parseUserBody(issue.body);
        return { issue: issue, data: data };
      });
    });
  };

  // 管理员通过注册申请（添加 registered-user label，更新审核状态）
  var _approveRegistration = function(issueNumber) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber;
    // 先获取当前Issue
    return _safeRequest(url, { method: "GET", headers: _headers() }).then(function(issue) {
      var data = _parseUserBody(issue.body);
      data.reviewStatus = "已通过";
      return _safeRequest(url, {
        method: "PATCH",
        headers: _headers(),
        body: JSON.stringify({
          body: _formatUserBody(data),
          labels: ["voucher", JITConfig.getLabels().registeredUser, JITConfig.getLabels().registrationRequest]
        })
      });
    });
  };

  // 管理员拒绝注册申请
  var _rejectRegistration = function(issueNumber) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber;
    return _safeRequest(url, { method: "GET", headers: _headers() }).then(function(issue) {
      var data = _parseUserBody(issue.body);
      data.reviewStatus = "已拒绝";
      return _safeRequest(url, {
        method: "PATCH",
        headers: _headers(),
        body: JSON.stringify({
          body: _formatUserBody(data),
          labels: ["voucher", JITConfig.getLabels().registrationRequest, "rejected"]
        })
      });
    });
  };

  // 验证已注册用户登录
  var _verifyRegisteredUser = function(username, password) {
    return _findRegisteredUser(username).then(function(result) {
      if (!result) return null;
      if (result.data.password !== password) return null;
      return result;
    });
  };

  // 获取邀请列表（谁通过我的邀请注册了）
  var _getReferrals = function(username) {
    var label = JITConfig.getLabels().registeredUser;
    var url = _apiBase + "/repos/" + _repoFull + "/issues?state=open&labels=" + encodeURIComponent(label) + "&per_page=100";
    return _safeRequest(url, { method: "GET", headers: _headers() }).then(function(issues) {
      if (!issues || issues.length === 0) return [];
      var referrals = [];
      issues.forEach(function(issue) {
        var data = _parseUserBody(issue.body);
        if (data.referrer === username) {
          referrals.push({ username: data.username, registerTime: data.registerTime });
        }
      });
      return referrals;
    });
  };

  // ======= 通知系统 =======
  var _formatNotificationBody = function(data) {
    return [
      "｜发送者：" + (data.sender || "admin"),
      "｜标题：" + (data.title || ""),
      "｜内容：" + (data.content || ""),
      "｜目标用户：" + (data.targetUsers || "all"),
      "｜发送时间：" + (data.sendTime || new Date().toISOString().replace("T", " ").slice(0, 19)),
      "｜状态：active"
    ].join("\n");
  };

  var _parseNotificationBody = function(body) {
    var data = {};
    var lines = String(body || "").split(/\r?\n/);
    lines.forEach(function(line) {
      var trimmed = line.trim();
      var match;
      if ((match = trimmed.match(/^｜?\s*发送者：(.+)$/))) data.sender = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*标题：(.+)$/))) data.title = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*内容：(.+)$/))) data.content = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*目标用户：(.+)$/))) data.targetUsers = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*发送时间：(.+)$/))) data.sendTime = match[1].trim();
      else if ((match = trimmed.match(/^｜?\s*状态：(.+)$/))) data.status = match[1].trim();
    });
    return data;
  };

  // 发送通知（管理员调用）
  var _sendNotification = function(title, content, targetUsers) {
    var label = JITConfig.getLabels().notification;
    var data = {
      sender: "admin",
      title: title,
      content: content,
      targetUsers: targetUsers || "all",
      sendTime: new Date().toISOString().replace("T", " ").slice(0, 19)
    };
    return _safeRequest(_apiBase + "/repos/" + _repoFull + "/issues", {
      method: "POST",
      headers: _headers(),
      body: JSON.stringify({
        title: "【通知】" + title,
        body: _formatNotificationBody(data),
        labels: ["voucher", label]
      })
    });
  };

  // 获取所有通知（管理员）
  var _getAllNotifications = function() {
    var label = JITConfig.getLabels().notification;
    var url = _apiBase + "/repos/" + _repoFull + "/issues?state=open&labels=" + encodeURIComponent(label) + "&per_page=100&sort=created&direction=desc";
    return _safeRequest(url, { method: "GET", headers: _headers() }).then(function(issues) {
      if (!issues) return [];
      return issues.map(function(issue) {
        var data = _parseNotificationBody(issue.body);
        return {
          issueNumber: issue.number,
          sender: data.sender || "admin",
          title: data.title || "",
          content: data.content || "",
          targetUsers: data.targetUsers || "all",
          sendTime: data.sendTime || "",
          status: data.status || "active",
          createdAt: issue.created_at,
          comments: issue.comments || 0
        };
      });
    });
  };

  // 获取用户可见的通知
  var _getUserNotifications = function(username) {
    return _getAllNotifications().then(function(list) {
      return list.filter(function(n) {
        if (n.status !== "active") return false;
        if (n.targetUsers === "all") return true;
        var targets = n.targetUsers.split(",").map(function(s) { return s.trim(); });
        return targets.indexOf(username) !== -1;
      });
    });
  };

  // 用户回复通知
  var _replyNotification = function(issueNumber, username, message) {
    return _addIssueComment(issueNumber, "｜NOTIFY_REPLY｜" + username + "：" + message);
  };

  // 获取通知的回复
  var _getNotificationReplies = function(issueNumber) {
    return _getIssueComments(issueNumber).then(function(comments) {
      var replies = [];
      (comments || []).forEach(function(c) {
        if (c.body && c.body.indexOf("｜NOTIFY_REPLY｜") === 0) {
          var rest = c.body.replace("｜NOTIFY_REPLY｜", "");
          var idx = rest.indexOf("：");
          replies.push({
            username: idx > -1 ? rest.substring(0, idx) : "unknown",
            message: idx > -1 ? rest.substring(idx + 1) : rest,
            time: c.created_at,
            commenter: c.user ? c.user.login : ""
          });
        }
      });
      return replies;
    });
  };

  // ======= 加急审核 =======
  var _markUrgent = function(issueNumber, reason, username) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber + "/labels";
    return _safeRequest(url, {
      method: "POST",
      headers: _headers(),
      body: JSON.stringify({ labels: [JITConfig.getLabels().urgent] })
    }).then(function(res) {
      // 加完标签后再追加一条加急理由的 Comment
      if (reason || username) {
        var body = "｜URGENT_REASON｜"
          + (username ? (username + "：") : "")
          + (reason || "无理由");
        return _addIssueComment(issueNumber, body).then(function() { return res; });
      }
      return res;
    });
  };

  var _getUrgentReason = function(issueNumber) {
    return _getIssueComments(issueNumber).then(function(comments) {
      var latest = null;
      (comments || []).forEach(function(c) {
        if (c.body && c.body.indexOf("｜URGENT_REASON｜") === 0) {
          latest = c;
        }
      });
      if (!latest) return null;
      var rest = latest.body.replace("｜URGENT_REASON｜", "");
      var idx = rest.indexOf("：");
      return {
        username: idx > -1 ? rest.substring(0, idx) : "unknown",
        reason: idx > -1 ? rest.substring(idx + 1) : rest,
        time: latest.created_at,
        commenter: latest.user ? latest.user.login : ""
      };
    });
  };

  var _removeLabel = function(issueNumber, labelName) {
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber + "/labels/" + encodeURIComponent(labelName);
    return _safeRequest(url, {
      method: "DELETE",
      headers: _headers()
    });
  };

  var _removeUrgent = function(issueNumber) {
    var label = JITConfig.getLabels().urgent;
    var url = _apiBase + "/repos/" + _repoFull + "/issues/" + issueNumber + "/labels/" + encodeURIComponent(label);
    return _safeRequest(url, {
      method: "DELETE",
      headers: _headers()
    }).catch(function() { return null; });
  };

  // ===== 管理员端 Turso 迁移：凭证列表 & 审核 =====
  var _tursoVoucherToIssue = function(row) {
    var isElectric = !!(row.electric_category || row.electric_brand || row.electric_apply_amount);
    var labels = [];
    if (row.status === "已通过" || row.status === "approved") labels.push({name: "approved"});
    else if (row.status === "已拒绝" || row.status === "rejected") labels.push({name: "rejected"});
    else if (row.status === "已完成交易" || row.status === "completed") labels.push({name: "completed"});
    else if (row.payment_status === "paid" || row.status === "已付款·待确认") labels.push({name: "paid"});
    else labels.push({name: "pending"});
    if (parseInt(row.is_urgent) === 1) labels.push({name: "urgent"});

    var bodyLines = [];
    bodyLines.push("｜ 用户ID：" + (row.user_id || ""));
    bodyLines.push("｜ 标题：" + (row.shop_name || "凭证"));
    bodyLines.push("｜ 店铺名称：" + (row.shop_name || ""));
    bodyLines.push("｜ 消费日期：" + (row.created_at || "").replace("T"," ").slice(0,10));
    if (isElectric) { bodyLines.push("｜ 凭证类型：电器凭证（大额补贴）"); bodyLines.push("｜ 模式标识：电器补贴模式"); }
    else bodyLines.push("｜ 凭证类型：" + (row.order_type || "普通凭证"));
    bodyLines.push("｜ 消费金额：" + (row.amount || "0"));
    if (row.discount) bodyLines.push("｜ 中奖打折：" + row.discount);
    bodyLines.push("｜ 支付方式：" + (row.payment_method || ""));
    if (row.remark) bodyLines.push("｜ 备注：" + row.remark);
    if (row.reject_reason) bodyLines.push("｜ 不通过原因：" + row.reject_reason);
    if (row.shop_photo) bodyLines.push("｜ 店铺照片：" + row.shop_photo);
    if (row.order_photos && row.order_photos !== "[]") bodyLines.push("｜ 商品订单照片：" + row.order_photos);
    if (row.signature) bodyLines.push("｜ 签名：" + row.signature);
    bodyLines.push("｜ 状态：" + (row.status || "待审核"));
    bodyLines.push("｜ 创建时间：" + (row.created_at || ""));
    if (isElectric) {
      if (row.electric_category) bodyLines.push("｜ 电器分类：" + row.electric_category);
      if (row.electric_brand) bodyLines.push("｜ 品牌名称：" + row.electric_brand);
      if (row.electric_apply_amount) bodyLines.push("｜ 申请基数金额：" + row.electric_apply_amount);
      if (row.electric_subsidy_rate) bodyLines.push("｜ 补贴比例：" + row.electric_subsidy_rate);
      if (row.electric_subsidy_amount) bodyLines.push("｜ 补贴金额：" + row.electric_subsidy_amount);
      if (row.review_result) bodyLines.push("｜ 审核结果：" + row.review_result);
      if (row.final_price) bodyLines.push("｜ 最终实付：" + row.final_price);
    }
    if (row.platform) bodyLines.push("｜ 购物平台：" + row.platform);
    if (row.order_no) bodyLines.push("｜ 订单号：" + row.order_no);
    var latLng = (row.latitude || row.longitude) ? (row.latitude || "") + "," + (row.longitude || "") : "";
    if (latLng && latLng !== ",") bodyLines.push("｜ 定位：" + latLng);

    return {
      number: String(row.id),
      title: row.shop_name ? "凭证  # " + row.shop_name : "凭证",
      state: (row.status === "已删除") ? "closed" : "open",
      user: { login: row.user_id || "" },
      labels: labels,
      body: bodyLines.join("\n"),
      created_at: row.created_at || "",
      userId: row.user_id || "",
      shopName: row.shop_name || "",
      isUrgent: parseInt(row.is_urgent) === 1,
      voucherType: row.order_type || "普通凭证",
      amount: row.amount || 0,
      discount: row.discount || "",
      paymentMethod: row.payment_method || "",
      isElectric: isElectric,
      electricCategory: row.electric_category || "",
      electricBrand: row.electric_brand || "",
      electricApplyAmount: row.electric_apply_amount || 0,
      electricSubsidyRate: row.electric_subsidy_rate || "",
      electricSubsidyAmount: row.electric_subsidy_amount || 0,
      reviewResult: row.review_result || "",
      finalPrice: row.final_price || "",
      platform: row.platform || "",
      orderNo: row.order_no || "",
      date: (row.created_at || "").replace("T"," ").slice(0,10),
      latitude: row.latitude || "",
      longitude: row.longitude || "",
      shopPhoto: row.shop_photo || "",
      orderPhotos: row.order_photos || "",
      signature: row.signature || "",
      remark: row.remark || "",
      rejectReason: row.reject_reason || ""
    };
  };

  var _getAllVoucherIssueObjects = function() {
    return _tursoSql("SELECT * FROM vouchers WHERE status != '已删除' AND user_id NOT LIKE '【%】%' AND shop_name NOT LIKE '【%】%' ORDER BY created_at DESC", []).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(_tursoVoucherToIssue);
    });
  };

  var _updateVoucherStatusTurso = function(voucherId, action, reason, extra) {
    extra = extra || {};
    var now = new Date().toISOString();
    if (action === "approved") {
      if (extra.isElectric && extra.subsidyRate) {
        return _tursoSql(
          "UPDATE vouchers SET status='approved', electric_subsidy_rate=?, electric_subsidy_amount=?, updated_at=? WHERE id=?",
          [String(extra.subsidyRate || ""), String(extra.subsidyAmount || "0"), now, String(voucherId)]
        );
      }
      return _tursoSql("UPDATE vouchers SET status='approved', updated_at=? WHERE id=?", [now, String(voucherId)]);
    } else if (action === "rejected") {
      return _tursoSql("UPDATE vouchers SET status='rejected', reject_reason=?, updated_at=? WHERE id=?", [reason || "", now, String(voucherId)]);
    } else if (action === "completed") {
      return _tursoSql("UPDATE vouchers SET status='已完成交易', updated_at=? WHERE id=?", [now, String(voucherId)]);
    }
    return Promise.resolve();
  };

  var _deleteVoucherTurso = function(voucherId) {
    return _tursoSql("UPDATE vouchers SET status='已删除', updated_at=? WHERE id=?", [new Date().toISOString(), String(voucherId)]);
  };

  var _updateVoucherFields = function(voucherId, voucherData) {
    var now = new Date().toISOString();
    return _tursoSql(
      "UPDATE vouchers SET user_id=?, order_type=?, shop_name=?, shop_photo=?, order_photos=?, latitude=?, longitude=?, amount=?, discount=?, payment_method=?, remark=?, signature=?, platform=?, order_no=?, product_photo=?, shopping_photos=?, electric_category=?, electric_brand=?, electric_apply_amount=?, electric_subsidy_rate=?, electric_subsidy_amount=?, updated_at=? WHERE id=?",
      [
        voucherData.username || "",
        voucherData.voucherType || "",
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
        voucherData.platform || "",
        voucherData.orderNo || "",
        voucherData.productPhoto || "",
        Array.isArray(voucherData.shoppingPhotos) ? voucherData.shoppingPhotos.join("|") : (voucherData.shoppingPhotos || ""),
        voucherData.electricCategory || "",
        voucherData.electricBrand || "",
        String(voucherData.electricApplyAmount || "0"),
        voucherData.electricSubsidyRate || "",
        String(voucherData.electricSubsidyAmount || "0"),
        now, String(voucherId)
      ]
    );
  };

  // ===== 注册审核 Turso 版 =====
  var _tursoRegistrationToIssue = function(row) {
    var bodyLines = [];
    bodyLines.push("｜ 用户名：" + (row.username || ""));
    bodyLines.push("｜ 姓名：" + (row.full_name || ""));
    bodyLines.push("｜ 出生日期：" + (row.birthdate || ""));
    bodyLines.push("｜ 国家：" + (row.country || ""));
    bodyLines.push("｜ 省份：" + (row.province || ""));
    bodyLines.push("｜ 城市：" + (row.city || ""));
    bodyLines.push("｜ 邀请人：" + (row.referrer || ""));
    bodyLines.push("｜ 审核状态：" + (row.review_status || "pending"));
    bodyLines.push("｜ 注册时间：" + (row.created_at || ""));
    if (row.oauth_provider) {
      bodyLines.push("｜ 注册方式：大平台登录（" + row.oauth_provider + "）");
      if (row.oauth_email) bodyLines.push("｜ 平台邮箱：" + row.oauth_email);
      if (row.oauth_id) bodyLines.push("｜ 平台ID：" + row.oauth_id);
    }

    var labels = [];
    if (row.review_status === "approved") labels.push({name: "registeredUser"});
    else if (row.review_status === "rejected") labels.push({name: "rejected"});
    labels.push({name: "registrationRequest"});
    if (row.oauth_provider) labels.push({name: "oauthUser"});

    return {
      number: String(row.id),
      title: "注册申请 - " + (row.username || "") + (row.oauth_provider ? " [GitHub]" : ""),
      state: "open",
      user: { login: row.username || "" },
      labels: labels,
      body: bodyLines.join("\n"),
      created_at: row.created_at || "",
      _oauthProvider: row.oauth_provider || "",
      _oauthEmail: row.oauth_email || "",
      _oauthAvatar: row.oauth_avatar || "",
      _oauthId: row.oauth_id || ""
    };
  };

  var _getAllRegistrationIssueObjects = function() {
    return _tursoSql("SELECT * FROM registrations ORDER BY created_at DESC", []).then(function(result) {
      var objs = _tursoRowsToObjects(result.columns, result.rows);
      return objs.map(_tursoRegistrationToIssue);
    });
  };

  var _approveRegistrationTurso = function(regId, regData) {
    if (!regData) return Promise.reject(new Error("缺少注册数据"));
    var now = new Date().toISOString();
    var isOAuth = !!(regData._oauthProvider || regData.oauth_provider);
    return _tursoSql("UPDATE registrations SET review_status='approved' WHERE id=?", [String(regId)]).then(function() {
      if (isOAuth) {
        // OAuth 用户：UPDATE 已有的 users 记录
        return _tursoSql(
          "UPDATE users SET review_status='approved', full_name=?, updated_at=? WHERE id=?",
          [regData.fullName || regData.full_name || "", now, regData.username]
        );
      } else {
        // 普通注册用户：INSERT OR REPLACE users 记录
        return _tursoSql(
          "INSERT OR REPLACE INTO users (id, password_hash, full_name, birthdate, country, province, city, referrer, review_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          [regData.username, regData.password_hash, regData.full_name || "", regData.birthdate || "", regData.country || "", regData.province || "", regData.city || "", regData.referrer || "", "approved", now, now]
        );
      }
    });
  };

  // ===== v2.0 修改密码 =====
  var _updateUserPassword = function(username, newPassword) {
    var now = new Date().toISOString();
    return _tursoSql(
      "UPDATE users SET password_hash=?, updated_at=? WHERE id=?",
      [newPassword, now, username]
    ).then(function(result) {
      if (!result || !result.rowsAffected && result.rowsAffected !== 0) {
        throw new Error("未找到用户或更新失败");
      }
      return { success: true };
    });
  };

  // ===== v2.0 获取用户档案 =====
  var _getUserProfile = function(username) {
    return _tursoSql("SELECT id, full_name, review_status, created_at, updated_at FROM users WHERE id=?", [username]).then(function(result) {
      var rows = (result && result.rows) ? result.rows : [];
      if (rows.length === 0) return null;
      var r = rows[0];
      return {
        username: r[0],
        fullName: r[1] || "",
        reviewStatus: r[2] || "",
        createdAt: r[3] || "",
        updatedAt: r[4] || ""
      };
    });
  };

  var _rejectRegistrationTurso = function(regId) {
    return _tursoSql("UPDATE registrations SET review_status='rejected' WHERE id=?", [String(regId)]);
  };

  // ===== OAuth Token 验证 =====
  var _oauthVerifyToken = function(token) {
    return _tursoCall("/verify-oauth-token", { token: token }).then(function(result) {
      if (!result.ok) throw new Error(result.error || "token 验证失败");
      return result;
    });
  };

  // ===== OAuth 数据库迁移（添加字段 + 创建 token 表）=====
  var _runOAuthMigration = function() {
    var migrations = [
      "ALTER TABLE users ADD COLUMN oauth_provider TEXT DEFAULT ''",
      "ALTER TABLE users ADD COLUMN oauth_id TEXT DEFAULT ''",
      "ALTER TABLE registrations ADD COLUMN oauth_provider TEXT DEFAULT ''",
      "ALTER TABLE registrations ADD COLUMN oauth_id TEXT DEFAULT ''",
      "ALTER TABLE registrations ADD COLUMN oauth_email TEXT DEFAULT ''",
      "ALTER TABLE registrations ADD COLUMN oauth_avatar TEXT DEFAULT ''",
      "CREATE TABLE IF NOT EXISTS oauth_tokens (token TEXT PRIMARY KEY, username TEXT NOT NULL, oauth_id TEXT DEFAULT '', provider TEXT DEFAULT '', created_at TEXT DEFAULT '', expires_at TEXT DEFAULT '')"
    ];
    var chain = Promise.resolve();
    migrations.forEach(function(sql) {
      chain = chain.then(function() {
        return _tursoSql(sql, []).catch(function(err) {
          // ALTER TABLE 可能因为列已存在而失败，忽略错误
          if (err.message && (err.message.indexOf("duplicate column") > -1 || err.message.indexOf("already exists") > -1)) {
            return null;
          }
          throw err;
        });
      });
    });
    return chain;
  };

  // 初始化时运行迁移
  _runOAuthMigration().catch(function(err) {
    console.warn("OAuth 迁移跳过（可能已执行过）:", err.message);
  });

  // ===== 加急黑名单 Turso 版 =====
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

  // ===== 普通黑名单 Turso 版 =====
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

  // ===== v2.0 管理员后端登录验证（不从数据库拉哈希，用 SQL WHERE 比对）=====
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

  return {
    adminLogin: _adminLogin,
    getVouchers: _getVouchers,
    getAllVouchers: _getAllVouchers,
    submitVoucher: _submitVoucher,
    submitVoucherWithImages: _submitVoucherWithImages,
    formatIssueBody: _formatIssueBody,
    getVoucherCount: _getVoucherCount,
    getApprovedCount: _getApprovedCount,
    compressImage: _compressImage,
    updateIssue: _updateIssue,
    deleteIssue: _deleteIssue,
    closeIssue: _closeIssue,
    updateVoucherWithLottery: _updateVoucherWithLottery,
    updateVoucherIssue: _updateVoucherIssue,
    parseVoucherData: _parseVoucherData,
    getNextVoucherId: _getNextVoucherId,
    getVoucherById: _getVoucherById,
    ensureLabels: _ensureLabels,
    invalidateCache: _invalidateCache,
    getIssueComments: _getIssueComments,
    addIssueComment: _addIssueComment,
    getChatMessages: _getChatMessages,
    sendChatMessage: _sendChatMessage,
    getAllChatUsers: _getAllChatUsers,
    getVoucherUsers: _getVoucherUsers,
    markChatRead: _markChatRead,
    uploadChatImage: _uploadChatImage,
    getIssue: _getIssue,
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
    // 管理员端 Turso 版
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
    _tursoSql: _tursoSql,
    _tursoRowsToObjects: _tursoRowsToObjects
  };
})();