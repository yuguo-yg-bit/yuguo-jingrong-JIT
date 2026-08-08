// ============================================================
// 积分抽奖转盘模块 JITWheel
// 花10积分抽一次，每天登录送一次免费抽奖
// 奖品：+10, +20, +30, +40, +50, -10, -20 积分
// ============================================================
var JITWheel = (function() {
  var SEGMENTS = [
    { label: "+10", delta: 10,  color: "#4caf50", textColor: "#fff" },
    { label: "-10", delta: -10, color: "#f44336", textColor: "#fff" },
    { label: "+20", delta: 20,  color: "#2196f3", textColor: "#fff" },
    { label: "-20", delta: -20, color: "#ff9800", textColor: "#fff" },
    { label: "+30", delta: 30,  color: "#9c27b0", textColor: "#fff" },
    { label: "+40", delta: 40,  color: "#ffd700", textColor: "#333" },
    { label: "+50", delta: 50,  color: "#00bcd4", textColor: "#fff" }
  ];

  var COST = 10;               // 每次抽奖消耗 10 积分
  var SEG_COUNT = SEGMENTS.length;
  var ARC = (2 * Math.PI) / SEG_COUNT;

  var _canvas = null;
  var _ctx = null;
  var _isSpinning = false;
  var _currentRotation = 0;
  var _animFrameId = null;
  var _onResult = null;
  var _currentUser = null;

  // ======= 绘制转盘 =======
  var _drawWheel = function(rotation) {
    if (!_ctx || !_canvas) return;
    var w = _canvas.width;
    var h = _canvas.height;
    var cx = w / 2;
    var cy = h / 2;
    var radius = Math.min(cx, cy) - 12;

    _ctx.clearRect(0, 0, w, h);

    // 绘制外圈装饰
    _ctx.save();
    _ctx.beginPath();
    _ctx.arc(cx, cy, radius + 8, 0, 2 * Math.PI);
    _ctx.fillStyle = "#ffd700";
    _ctx.fill();
    _ctx.shadowColor = "rgba(255,215,0,0.4)";
    _ctx.shadowBlur = 20;
    _ctx.beginPath();
    _ctx.arc(cx, cy, radius + 4, 0, 2 * Math.PI);
    _ctx.fillStyle = "#1a1a2e";
    _ctx.fill();
    _ctx.restore();

    // 绘制每个扇区
    for (var i = 0; i < SEG_COUNT; i++) {
      var startAngle = rotation + i * ARC;
      var endAngle = startAngle + ARC;

      _ctx.save();
      _ctx.beginPath();
      _ctx.moveTo(cx, cy);
      _ctx.arc(cx, cy, radius, startAngle, endAngle);
      _ctx.closePath();

      // 填充颜色
      _ctx.fillStyle = SEGMENTS[i].color;
      _ctx.fill();

      // 描边
      _ctx.strokeStyle = "rgba(255,255,255,0.2)";
      _ctx.lineWidth = 2;
      _ctx.stroke();
      _ctx.restore();

      // 绘制文字
      _ctx.save();
      _ctx.translate(cx, cy);
      _ctx.rotate(startAngle + ARC / 2);
      _ctx.textAlign = "right";
      _ctx.textBaseline = "middle";
      _ctx.fillStyle = SEGMENTS[i].textColor;
      _ctx.font = "bold 16px sans-serif";
      _ctx.fillText(SEGMENTS[i].label, radius - 18, 0);
      _ctx.restore();
    }

    // 中心圆
    _ctx.save();
    _ctx.beginPath();
    _ctx.arc(cx, cy, 28, 0, 2 * Math.PI);
    var grad = _ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
    grad.addColorStop(0, "#ffd700");
    grad.addColorStop(1, "#ff8f00");
    _ctx.fillStyle = grad;
    _ctx.fill();
    _ctx.strokeStyle = "#fff";
    _ctx.lineWidth = 3;
    _ctx.stroke();
    _ctx.restore();

    // 中心文字
    _ctx.save();
    _ctx.fillStyle = "#1a1a2e";
    _ctx.font = "bold 12px sans-serif";
    _ctx.textAlign = "center";
    _ctx.textBaseline = "middle";
    _ctx.fillText("抽奖", cx, cy - 1);
    _ctx.restore();

    // 顶部指针
    _ctx.save();
    _ctx.translate(cx, 0);
    _ctx.beginPath();
    _ctx.moveTo(-12, 6);
    _ctx.lineTo(0, -6);
    _ctx.lineTo(12, 6);
    _ctx.closePath();
    _ctx.fillStyle = "#ff1744";
    _ctx.fill();
    _ctx.strokeStyle = "#fff";
    _ctx.lineWidth = 2;
    _ctx.stroke();
    _ctx.restore();
  };

  // ======= 动画旋转 =======
  var _spin = function(targetAngle, duration, callback) {
    var startTime = null;
    var startRotation = _currentRotation;

    var animate = function(timestamp) {
      if (!startTime) startTime = timestamp;
      var elapsed = timestamp - startTime;
      var progress = Math.min(elapsed / duration, 1);

      // easeOutCubic
      var eased = 1 - Math.pow(1 - progress, 3);
      _currentRotation = startRotation + (targetAngle - startRotation) * eased;
      _drawWheel(_currentRotation);

      if (progress < 1) {
        _animFrameId = requestAnimationFrame(animate);
      } else {
        _isSpinning = false;
        _currentRotation = targetAngle;
        if (callback) callback();
      }
    };
    _animFrameId = requestAnimationFrame(animate);
  };

  // ======= 开始抽奖 =======
  var _startSpin = function(onResult) {
    if (_isSpinning) return;
    _isSpinning = true;
    _onResult = onResult;

    // 随机选择结果扇区
    var winIndex = Math.floor(Math.random() * SEG_COUNT);

    // 计算目标角度：使指针指到 winIndex 扇区的中间
    // 指针在顶部（0度），扇区 i 的中间角度 = rotation + (i + 0.5) * ARC
    // 所以 rotation + (winIndex + 0.5) * ARC = 2π * N （使扇区中间对准指针）
    // rotation = 2π * N - (winIndex + 0.5) * ARC
    // 加上多圈旋转
    var extraSpins = 5 + Math.floor(Math.random() * 3); // 5-7 圈
    var targetAngle = _currentRotation + extraSpins * 2 * Math.PI;
    // 微调使落到目标扇区
    var targetSegMid = (winIndex + 0.5) * ARC;
    // 当前指针方向是 0，需要让扇区 winIndex 的中间对准 0
    targetAngle = targetAngle - ((targetAngle + targetSegMid) % (2 * Math.PI)) + targetSegMid + 2 * Math.PI;

    var duration = 3000 + Math.random() * 1000; // 3-4 秒

    _spin(targetAngle, duration, function() {
      // 确定最终结果
      var normalized = ((_currentRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      var idx = Math.floor(normalized / ARC) % SEG_COUNT;
      var prize = SEGMENTS[idx];
      if (prize) {
        _showResult(prize);
        if (_onResult) _onResult(prize);
      }
    });
  };

  // ======= 显示结果弹窗 =======
  var _showResult = function(prize) {
    var overlay = document.getElementById("wheelResultOverlay");
    var labelEl = document.getElementById("wheelResultLabel");
    var deltaEl = document.getElementById("wheelResultDelta");
    var closeBtn = document.getElementById("btnWheelResultClose");
    if (!overlay) return;

    var isWin = prize.delta >= 0;
    if (labelEl) {
      labelEl.textContent = isWin ? "🎉 恭喜获得积分！" : "😅 运气不佳~";
      labelEl.style.color = isWin ? "#4caf50" : "#f44336";
    }
    if (deltaEl) {
      deltaEl.textContent = (isWin ? "+" : "") + prize.delta;
      deltaEl.style.color = isWin ? "#4caf50" : "#f44336";
    }
    overlay.classList.add("active");

    // 点击关闭
    if (closeBtn) {
      closeBtn.onclick = function() {
        overlay.classList.remove("active");
      };
    }
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.classList.remove("active");
    };
  };

  // ======= 检查每日免费抽奖 =======
  var _checkFreeSpin = function(username) {
    if (!username) return false;
    var key = "jit_wheel_free_" + username;
    var today = new Date().toISOString().split("T")[0];
    var stored = localStorage.getItem(key);
    return stored !== today;
  };

  var _markFreeSpinUsed = function(username) {
    if (!username) return;
    var key = "jit_wheel_free_" + username;
    var today = new Date().toISOString().split("T")[0];
    localStorage.setItem(key, today);
  };

  // ======= 初始化转盘 =======
  var _init = function(canvasId) {
    _canvas = document.getElementById(canvasId);
    if (!_canvas) return;
    _ctx = _canvas.getContext("2d");

    // 设置尺寸
    var container = _canvas.parentElement;
    var size = Math.min(container.clientWidth || 320, 320);
    _canvas.width = size;
    _canvas.height = size;

    _drawWheel(0);
  };

  // ======= 重置转盘 =======
  var _reset = function() {
    if (_animFrameId) {
      cancelAnimationFrame(_animFrameId);
      _animFrameId = null;
    }
    _isSpinning = false;
    _currentRotation = 0;
    if (_canvas && _ctx) {
      _drawWheel(0);
    }
  };

  return {
    init: _init,
    spin: _startSpin,
    reset: _reset,
    isSpinning: function() { return _isSpinning; },
    checkFreeSpin: _checkFreeSpin,
    markFreeSpinUsed: _markFreeSpinUsed,
    getCost: function() { return COST; },
    getSegments: function() { return SEGMENTS.slice(); }
  };
})();