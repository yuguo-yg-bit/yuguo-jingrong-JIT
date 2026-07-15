var JITApi = (function() {
  var _pt3 = "po1eLaQK";
  var _token = JITConfig.getTokenPart1() + JITConfig.getTokenPart3() + _pt3;
  var _apiBase = JITConfig.getApiBase();
  var _repoFull = JITConfig.getRepoFull();
  var _imageRepoFull = JITConfig.getImageRepoFull();

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

  var _uploadFileToRepo = function(path, base64Content, commitMsg) {
    var url = _apiBase + "/repos/" + _imageRepoFull + "/contents/" + _encodePath(path);
    var body = {
      message: commitMsg || "upload image",
      content: base64Content,
      branch: "main"
    };
    return _safeRequest(url, {
      method: "PUT",
      headers: _headers(),
      body: JSON.stringify(body)
    }).then(function(result) {
      return result && result.content ? result.content.download_url : "";
    }).catch(function(err) {
      var msg = String(err.message || "");
      if (msg.indexOf("sha") === -1 && msg.indexOf("expected") === -1 && msg.indexOf("422") === -1) {
        throw err;
      }
      return _getFileSha(path).then(function(sha) {
        if (sha) body.sha = sha;
        return _safeRequest(url, {
          method: "PUT",
          headers: _headers(),
          body: JSON.stringify(body)
        });
      }).then(function(result) {
        return result && result.content ? result.content.download_url : "";
      });
    });
  };

  var _uploadImageToRepo = function(file, folderPath, fileName, commitMsg) {
    return _compressImage(file).then(function(base64) {
      return _uploadFileToRepo(folderPath + "/" + fileName, base64, commitMsg);
    });
  };

  var _uploadImagesToRepo = function(files, folderPath, commitMsg) {
    var uploads = [];
    for (var i = 0; i < files.length; i++) {
      (function(file, index) {
        var fileName = "order_" + (index + 1) + ".png";
        uploads.push(_uploadImageToRepo(file, folderPath, fileName, commitMsg));
      })(files[i], i);
    }
    return Promise.all(uploads);
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

    return [
      "｜标题：" + (voucherData.username || "user") + (voucherData.voucherId || ""),
      "｜内容：店铺：" + (voucherData.shopName || ""),
      "｜     店铺照片：" + (voucherData.shopPhoto || ""),
      "｜     商品订单照片：" + orderPhotos,
      "｜     定位：" + (voucherData.latitude || "") + "," + (voucherData.longitude || ""),
      "｜     金额：" + (voucherData.amount || ""),
      "｜     签名：" + (voucherData.signature || ""),
      "｜     备注：" + (voucherData.remark || ""),
      "｜     创建时间：" + (voucherData.date || new Date().toISOString().split("T")[0]),
      "｜     状态：" + (voucherData.status || "待审核"),
      "｜     中奖打折：" + (voucherData.discount || ""),
      "｜     支付方式：" + (voucherData.paymentMethodText || voucherData.paymentMethod || "")
    ].join("\n");
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
    var parsed = _parseIssueBody(issue.body);
    if (parsed.shopName || parsed.amount || parsed.paymentMethod || parsed.status || parsed.date) {
      var labels = (issue.labels || []).map(function(l) { return l.name; });
      var amountValue = parseFloat(parsed.amount || 0);
      var discountValue = 0;
      if (parsed.discount && parsed.discount.indexOf("折") > -1) {
        var discountMatch = parsed.discount.match(/(\d+(?:\.\d+)?)/);
        if (discountMatch) {
          discountValue = parseFloat(discountMatch[1]) / 10;
        }
      }
      var finalAmount = isNaN(amountValue) ? parsed.amount : (amountValue * (discountValue || 1)).toFixed(2);
      var paymentMethodType = "userFirst";
      if (parsed.paymentMethod && parsed.paymentMethod.indexOf("工会先代替") > -1) {
        paymentMethodType = "unionFirst";
      }
      return {
        shopName: parsed.shopName || "",
        date: parsed.date || (issue.created_at ? issue.created_at.split("T")[0] : ""),
        discount: parsed.discount || "",
        discountValue: discountValue,
        paymentNote: parsed.paymentMethod || "",
        paymentMethod: parsed.paymentMethod || "",
        paymentMethodType: paymentMethodType,
        originalPrice: parsed.amount ? (parsed.amount + (parsed.amount.indexOf("元") > -1 ? "" : "元")) : "",
        finalPrice: finalAmount ? (finalAmount + (String(finalAmount).indexOf("元") > -1 ? "" : "元")) : "",
        amount: parsed.amount || "",
        status: parsed.status || (issue.state === "closed" ? "已关闭" : "待审核"),
        statusType: labels.indexOf("approved") > -1 ? "approved" : (labels.indexOf("paid") > -1 ? "paid" : (labels.indexOf("rejected") > -1 ? "rejected" : "pending")),
        shopPhoto: parsed.shopPhoto || "",
        orderPhotos: parsed.orderPhotos || "",
        latitude: parsed.latitude || "",
        longitude: parsed.longitude || "",
        signature: parsed.signature || "",
        remark: parsed.remark || "",
        username: parsed.title ? parsed.title.replace(/\d+$/, "") : "",
        voucherId: parsed.voucherId || "",
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

  var _submitVoucher = function(voucherData) {
    var body = _formatIssueBody(voucherData);
    var title = (voucherData.username || "user") + (voucherData.voucherId || "");
    return _createIssue(title, body, [JITConfig.getLabels().voucher, JITConfig.getLabels().pending]);
  };

  var _submitVoucherWithImages = function(voucherData, shopPhotoFile, orderPhotoFiles, isNewShopPhoto, anyNewOrderPhotos) {
    var voucherId = voucherData.voucherId || Date.now();
    var username = voucherData.username || "user";
    var ts = Date.now();
    var folderPath = "uploads/" + username + "/" + voucherId + "_" + ts;
    var commitMsg = "上传凭证图片: " + (voucherData.shopName || "") + " #" + voucherId;

    var uploadPromises = [];

    if (shopPhotoFile && isNewShopPhoto) {
      uploadPromises.push(
        _uploadImageToRepo(shopPhotoFile, folderPath, "shop.png", commitMsg).then(function(url) {
          voucherData.shopPhoto = url;
        })
      );
    }

    if (orderPhotoFiles && orderPhotoFiles.length > 0 && anyNewOrderPhotos) {
      uploadPromises.push(
        _uploadImagesToRepo(orderPhotoFiles, folderPath, commitMsg).then(function(urls) {
          voucherData.orderPhotos = (voucherData.orderPhotos || []).concat(urls);
        })
      );
    }

    if (voucherData.signature && voucherData.signature.indexOf("base64,") > -1) {
      var sigBase64 = voucherData.signature.split(",")[1];
      uploadPromises.push(
        _uploadFileToRepo(folderPath + "/signature.png", sigBase64, commitMsg).then(function(url) {
          voucherData.signature = url;
        })
      );
    }

    return Promise.all(uploadPromises).then(function() {
      if (voucherData._issueNumber) {
        return _updateVoucherIssueBody(voucherData);
      } else {
        return _submitVoucher(voucherData);
      }
    });
  };

  var _updateVoucherIssueBody = function(voucherData) {
    var body = _formatIssueBody(voucherData);
    return _updateIssue(voucherData._issueNumber, { body: body });
  };

  var _updateVoucherIssue = function(voucherData) {
    var body = _formatIssueBody(voucherData);
    return _updateIssue(voucherData._issueNumber, { body: body });
  };

  var _updateVoucherWithLottery = function(issueNumber, voucherData) {
    var body = _formatIssueBody(voucherData);
    return _updateIssue(issueNumber, { body: body });
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
    return _getIssues([JITConfig.getLabels().voucher], page, perPage).then(function(issues) {
      return issues.map(_parseVoucherData).filter(function(d) { return d !== null; });
    });
  };

  var _getAllVouchers = function() {
    return _getCachedOrFetch("allVouchers", function() {
      return _getAllIssues([JITConfig.getLabels().voucher]).then(function(issues) {
        return issues.map(_parseVoucherData).filter(function(d) { return d !== null; });
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
      return _getAllIssues([JITConfig.getLabels().voucher]).then(function(issues) {
        var maxId = 0;
        issues.forEach(function(issue) {
          var data = _parseVoucherData(issue);
          if (data && data.voucherId) {
            var num = parseInt(data.voucherId, 10);
            if (!isNaN(num) && num > maxId) maxId = num;
          }
        });
        return maxId + 1;
      });
    }).catch(function() {
      return 1;
    });
  };

  var _getIssueComments = function(issueNumber) {
    var url = _baseUrl + "/repos/" + _repoOwner + "/" + _repoName + "/issues/" + issueNumber + "/comments?per_page=100";
    return _fetchJSON(url).catch(function() { return []; });
  };

  var _addIssueComment = function(issueNumber, body) {
    var url = _baseUrl + "/repos/" + _repoOwner + "/" + _repoName + "/issues/" + issueNumber + "/comments";
    return _fetchJSON(url, {
      method: "POST",
      body: JSON.stringify({ body: body })
    });
  };

  return {
    getVouchers: _getVouchers,
    getAllVouchers: _getAllVouchers,
    submitVoucher: _submitVoucher,
    submitVoucherWithImages: _submitVoucherWithImages,
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
    ensureLabels: _ensureLabels,
    invalidateCache: _invalidateCache,
    getIssueComments: _getIssueComments,
    addIssueComment: _addIssueComment
  };
})();