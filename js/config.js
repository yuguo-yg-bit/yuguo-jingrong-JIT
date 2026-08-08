var JITConfig = (function() {
  var _pt1 = "ghp_6C";
  var _pt2 = "5Fv6UxjRX";
  var _pt4 = "po1eLaQK";

  var _repoOwner = "yuguo-yg-bit";
  var _repoName = "yuguo-jingrong-JIT";
  var _imageRepoName = "yuguo-jingrong-JIT-images";

  var _getTokenPart1 = function() {
    return _pt1 + _pt2;
  };

  var _apiBase = "https://api.github.com";

  var _labels = {
    voucher: "voucher",
    approved: "approved",
    pending: "pending",
    rejected: "rejected",
    paid: "paid",
    completed: "completed",
    lottery: "lottery",
    points: "points",
    registeredUser: "registered-user",
    registrationRequest: "registration-request",
    blacklist: "blacklist"
  };

  var _users = {
    "admin": "admin123",
    "谭绣云": "123321",
    "江睿博": "27015150111"
  };

  // ======= 黑名单/白名单 =======
  // 静态黑名单（config.js 内置，不可被UI删除）
  var _blacklist = [
    // "用户名1",
    // "用户名2"
  ];
  // 动态黑名单（UI管理，保存在 localStorage + GitHub Issue）
  // 持久化格式：{ username: { reason, time } }
  var _BL_LOCAL_KEY = "jit_blacklist_dynamic";
  var _BL_LABEL_KEY = "blacklist"; // GitHub Issue label

  var _getDynamicBlacklist = function() {
    try {
      var raw = localStorage.getItem(_BL_LOCAL_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  };
  var _setDynamicBlacklist = function(obj) {
    localStorage.setItem(_BL_LOCAL_KEY, JSON.stringify(obj || {}));
  };

  // 白名单：如果启用白名单模式，只有白名单中的用户可以登录
  var _whitelistEnabled = false; // true=开启白名单模式，false=关闭
  var _whitelist = [
    // "admin",
    // "谭绣云"
  ];

  // 工会代付时展示的微信支付收款码（仓库根目录 IMG_3106.jpeg）
  var _unionPayQrImage = "https://raw.githubusercontent.com/yuguo-yg-bit/yuguo-jingrong-JIT/main/IMG_3106.jpeg";
  var _unionPayLink = "https://wx.tenpay.com/tmp/yuguo-union-collect"; // 备用：如改为收款链接则动态生成二维码

  var _getUnionPayQrUrl = function() {
    if (_unionPayQrImage) return _unionPayQrImage;
    return "https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=" + encodeURIComponent(_unionPayLink);
  };

  return {
    getTokenPart1: _getTokenPart1,
    getTokenPart3: function() { return "6eIA6D3k79u4L32V4"; },
    getTokenPart4: function() { return _pt4; },
    getApiBase: function() { return _apiBase; },
    getRepoOwner: function() { return _repoOwner; },
    getRepoName: function() { return _repoName; },
    getImageRepoName: function() { return _imageRepoName; },
    getLabels: function() { return _labels; },
    getUsers: function() { return _users; },
    getBlacklist: function() { return _blacklist.slice(); },
    // 返回合并后的完整黑名单（静态 + 动态），格式：[{username, reason, time, type}]
    getAllBlacklistDetailed: function() {
      var list = [];
      _blacklist.forEach(function(u) {
        list.push({ username: u, reason: "config.js 静态配置（需改代码移除）", time: "—", type: "static" });
      });
      var dyn = _getDynamicBlacklist();
      Object.keys(dyn).forEach(function(u) {
        list.push({
          username: u,
          reason: dyn[u].reason || "—",
          time: dyn[u].time || "—",
          type: "dynamic"
        });
      });
      return list;
    },
    getDynamicBlacklist: function() { return _getDynamicBlacklist(); },
    setDynamicBlacklist: _setDynamicBlacklist,
    // 加入动态黑名单（UI 里点「加入黑名单」调用）
    addToBlacklist: function(username, reason) {
      if (!username) return false;
      var dyn = _getDynamicBlacklist();
      dyn[username] = { reason: reason || "", time: new Date().toLocaleString("zh-CN") };
      _setDynamicBlacklist(dyn);
      return true;
    },
    // 从动态黑名单移除（UI 里点「解除」调用）
    removeFromBlacklist: function(username) {
      if (!username) return false;
      var dyn = _getDynamicBlacklist();
      if (!dyn[username]) return false; // 静态的不能通过这里删
      delete dyn[username];
      _setDynamicBlacklist(dyn);
      return true;
    },
    getBlacklistLabel: function() { return _labels[_BL_LABEL_KEY] || _BL_LABEL_KEY; },
    getWhitelist: function() { return _whitelist.slice(); },
    isWhitelistEnabled: function() { return _whitelistEnabled; },
    isBlacklisted: function(username) {
      if (!username) return false;
      if (_blacklist.indexOf(username) !== -1) return true;
      var dyn = _getDynamicBlacklist();
      return !!dyn[username];
    },
    isWhitelisted: function(username) {
      return _whitelist.indexOf(username) !== -1;
    },
    getRepoFull: function() { return _repoOwner + "/" + _repoName; },
    getImageRepoFull: function() { return _repoOwner + "/" + _imageRepoName; },
    getUnionPayQrUrl: _getUnionPayQrUrl
  };
})();
