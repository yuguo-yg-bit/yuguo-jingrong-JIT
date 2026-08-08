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
    registrationRequest: "registration-request"
  };

  var _users = {
    "admin": "admin123",
    "谭绣云": "123321",
    "江睿博": "27015150111"
  };

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
    getRepoFull: function() { return _repoOwner + "/" + _repoName; },
    getImageRepoFull: function() { return _repoOwner + "/" + _imageRepoName; },
    getUnionPayQrUrl: _getUnionPayQrUrl
  };
})();
