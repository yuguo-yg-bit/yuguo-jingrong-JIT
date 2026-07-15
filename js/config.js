var JITConfig = (function() {
  var _pt1 = "ghp_6C";
  var _pt2 = "5Fv6UxjRX";

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
    lottery: "lottery"
  };

  var _users = {
    "admin": "admin123",
    "谭绣云": "123321"
  };

  return {
    getTokenPart1: _getTokenPart1,
    getTokenPart3: function() { return "6eIA6D3k79u4L32V4"; },
    getApiBase: function() { return _apiBase; },
    getRepoOwner: function() { return _repoOwner; },
    getRepoName: function() { return _repoName; },
    getImageRepoName: function() { return _imageRepoName; },
    getLabels: function() { return _labels; },
    getUsers: function() { return _users; },
    getRepoFull: function() { return _repoOwner + "/" + _repoName; },
    getImageRepoFull: function() { return _repoOwner + "/" + _imageRepoName; }
  };
})();