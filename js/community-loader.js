/**
 * 社区/个人中心 内嵌加载器
 * 把独立页面 community.html 拆成多个片段，按需注入 work.html 的 SPA 容器，
 * 避免整页跳转。
 */
var JITCommunityLoader = (function() {
  var _promise = null;
  var _mounts = {
    profile: "profileMount",
    community: "communityMount"
  };

  function _fetchFragment(url) {
    return fetch(url, { cache: "no-store" }).then(function(res) {
      if (!res.ok) throw new Error("加载片段失败: " + url + " (" + res.status + ")");
      return res.text();
    });
  }

  function _appendToBody(html) {
    var holder = document.createElement("div");
    holder.innerHTML = html;
    while (holder.firstElementChild) {
      document.body.appendChild(holder.firstElementChild);
    }
  }

  function mount() {
    if (_promise) return _promise;

    var profileEl = document.getElementById(_mounts.profile);
    var communityEl = document.getElementById(_mounts.community);

    _promise = Promise.all([
      _fetchFragment("partials/profile.html"),
      _fetchFragment("partials/community.html"),
      _fetchFragment("partials/community-modals.html")
    ]).then(function(parts) {
      if (profileEl) profileEl.innerHTML = parts[0];
      if (communityEl) communityEl.innerHTML = parts[1];
      _appendToBody(parts[2]);

      if (window.JITCommunity && typeof window.JITCommunity.init === "function") {
        window.JITCommunity.init();
      }
    }).catch(function(err) {
      _promise = null;
      console.error("[CommunityLoader]", err);
      throw err;
    });

    return _promise;
  }

  return { mount: mount };
})();
