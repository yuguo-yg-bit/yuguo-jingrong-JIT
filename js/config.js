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
    points: "points"
  };

  var _users = {
    "admin": "admin123",
    "谭绣云": "123321",
    "江睿博": "27015150111"
  };

  // 工会代付时展示的微信支付二维码：可替换为工会收款码图片地址或微信收款链接
  // 留空则使用二维码生成 API 根据下方链接动态生成
  var _unionPayQrImage = ""; // 如有静态收款码图片 URL，填这里
  var _unionPayLink = "https://wx.tenpay.com/tmp/yuguo-union-collect"; // 微信收款链接（可改为工会真实收款链接）

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
