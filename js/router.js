/* ============================================================
   玉国金融 GUI v4.0 - 客户端 Hash 路由系统
   ============================================================ */
var JITRouter = (function() {

  var _currentRoute = null;
  var _routeCallbacks = {};

  var ROUTES = {
    "/home": { title: "首页动态", group: "main", icon: "home" },
    "/voucher/apply": { title: "凭证申请", group: "voucher", icon: "plus" },
    "/voucher/list": { title: "我的凭证订单", group: "voucher", icon: "list" },
    "/voucher/manage": { title: "凭证编辑管理", group: "voucher", icon: "edit" },
    "/points": { title: "积分中心", group: "benefits", icon: "coin" },
    "/activity": { title: "活动广场", group: "benefits", icon: "gift" },
    "/invite": { title: "邀请与农场", group: "benefits", icon: "users" },
    "/community": { title: "社区", group: "social", icon: "message" },
    "/profile": { title: "个人设置", group: "social", icon: "user" }
  };

  function parseHash() {
    var h = window.location.hash.replace("#", "") || "/home";
    if (!h.startsWith("/")) h = "/" + h;
    if (!ROUTES[h]) h = "/home";
    return h;
  }

  function onRoute(route, callback) {
    _routeCallbacks[route] = callback;
  }

  function navigate(route) {
    if (!ROUTES[route]) route = "/home";
    if (window.location.hash === "#" + route) {
      activateRoute(route);
      return;
    }
    window.location.hash = "#" + route;
  }

  function activateRoute(route) {
    if (!ROUTES[route]) route = "/home";
    if (_currentRoute === route) return;

    var old = _currentRoute;
    _currentRoute = route;

    // Update sidebar active state
    var items = document.querySelectorAll(".sidebar-item[data-route]");
    items.forEach(function(el) {
      var r = el.getAttribute("data-route");
      if (r === route) el.classList.add("active");
      else el.classList.remove("active");
    });

    // Update page title
    var titleEl = document.getElementById("pageTitle");
    if (titleEl) titleEl.textContent = ROUTES[route].title;
    var subtitleEl = document.getElementById("pageSubtitle");
    if (subtitleEl) subtitleEl.textContent = "";

    // Show/hide page containers
    var pages = document.querySelectorAll("[data-page]");
    pages.forEach(function(el) {
      var p = el.getAttribute("data-page");
      if (p === route) el.style.display = "";
      else el.style.display = "none";
    });

    // Fire route callback
    if (_routeCallbacks[route]) {
      _routeCallbacks[route](route, old);
    }

    // Scroll to top
    var contentArea = document.querySelector(".content-area");
    if (contentArea) contentArea.scrollTop = 0;
  }

  function init() {
    // Click delegation for sidebar items
    document.addEventListener("click", function(e) {
      var item = e.target.closest("[data-route]");
      if (!item) return;
      var route = item.getAttribute("data-route");
      if (route) {
        e.preventDefault();
        navigate(route);
      }
    });

    // Listen for hash changes
    window.addEventListener("hashchange", function() {
      activateRoute(parseHash());
    });

    // Initial route
    var initial = parseHash();
    activateRoute(initial);
  }

  function getCurrentRoute() { return _currentRoute; }

  return {
    init: init,
    navigate: navigate,
    onRoute: onRoute,
    getCurrentRoute: getCurrentRoute,
    ROUTES: ROUTES
  };

})();