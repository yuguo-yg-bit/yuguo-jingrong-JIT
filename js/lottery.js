var JITLottery = (function() {
  var _prizes = [
    { discount: "7折", value: 0.7, label: "恭喜！", color: "#ff6b6b", weight: 10 },
    { discount: "8折", value: 0.8, label: "手气不错！", color: "#ffa726", weight: 20 },
    { discount: "9折", value: 0.9, label: "好运连连！", color: "#42a5f5", weight: 30 },
    { discount: "9.5折", value: 0.95, label: "小有收获！", color: "#66bb6a", weight: 20 },
    { discount: "10折", value: 1.0, label: "保本！", color: "#90a4ae", weight: 15 },
    { discount: "11折", value: 1.1, label: "超级幸运！反向给钱！", color: "#ffd700", weight: 5 }
  ];

  var _canvas = null;
  var _ctx = null;
  var _isDrawing = false;
  var _scratchedPixels = 0;
  var _totalPixels = 0;
  var _revealThreshold = 0.4;
  var _currentPrize = null;
  var _onRevealed = null;

  var _getRandomPrize = function() {
    var totalWeight = _prizes.reduce(function(sum, p) { return sum + p.weight; }, 0);
    var rand = Math.random() * totalWeight;
    var cumulative = 0;
    for (var i = 0; i < _prizes.length; i++) {
      cumulative += _prizes[i].weight;
      if (rand <= cumulative) {
        return _prizes[i];
      }
    }
    return _prizes[_prizes.length - 1];
  };

  var _initCanvas = function(canvasId) {
    _canvas = document.getElementById(canvasId);
    if (!_canvas) return;
    _ctx = _canvas.getContext("2d");

    var container = _canvas.parentElement;
    var rect = container.getBoundingClientRect();
    _canvas.width = rect.width;
    _canvas.height = rect.height;

    _drawScratchLayer();
    _bindEvents();
    _scratchedPixels = 0;
    _totalPixels = _canvas.width * _canvas.height;
  };

  var _drawScratchLayer = function() {
    if (!_ctx) return;
    var w = _canvas.width;
    var h = _canvas.height;

    // 银灰色金属质感涂层
    var gradient = _ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, "#c0c0c0");
    gradient.addColorStop(0.2, "#e8e8e8");
    gradient.addColorStop(0.4, "#a8a8a8");
    gradient.addColorStop(0.6, "#d0d0d0");
    gradient.addColorStop(0.8, "#b0b0b0");
    gradient.addColorStop(1, "#c8c8c8");
    _ctx.fillStyle = gradient;
    _ctx.fillRect(0, 0, w, h);

    // 金属颗粒纹理
    _ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (var i = 0; i < 80; i++) {
      var x = Math.random() * w;
      var y = Math.random() * h;
      var r = Math.random() * 2 + 0.5;
      _ctx.beginPath();
      _ctx.arc(x, y, r, 0, Math.PI * 2);
      _ctx.fill();
    }

    // 暗纹颗粒
    _ctx.fillStyle = "rgba(0,0,0,0.05)";
    for (var i = 0; i < 40; i++) {
      var x = Math.random() * w;
      var y = Math.random() * h;
      var r = Math.random() * 1.5 + 0.3;
      _ctx.beginPath();
      _ctx.arc(x, y, r, 0, Math.PI * 2);
      _ctx.fill();
    }

    // 红色边框
    _ctx.strokeStyle = "rgba(204,0,0,0.6)";
    _ctx.lineWidth = 2;
    _ctx.strokeRect(8, 8, w - 16, h - 16);

    // 内框装饰
    _ctx.strokeStyle = "rgba(204,0,0,0.2)";
    _ctx.lineWidth = 1;
    _ctx.setLineDash([4, 4]);
    _ctx.strokeRect(14, 14, w - 28, h - 28);
    _ctx.setLineDash([]);

    // "顶呱刮" 品牌文字
    _ctx.fillStyle = "rgba(204,0,0,0.5)";
    _ctx.font = "bold 16px sans-serif";
    _ctx.textAlign = "center";
    _ctx.textBaseline = "middle";
    _ctx.fillText("顶呱刮", w / 2, h / 2 - 18);

    // "刮开有奖" 提示
    _ctx.fillStyle = "rgba(139,0,0,0.45)";
    _ctx.font = "bold 12px sans-serif";
    _ctx.fillText("刮开有奖", w / 2, h / 2 + 10);

    // 装饰小星星
    _ctx.fillStyle = "rgba(255,215,0,0.3)";
    var starX = 30, starY = 20;
    _drawStar(_ctx, starX, starY, 5, 6, 3);
    _drawStar(_ctx, w - starX, starY, 5, 6, 3);
    _drawStar(_ctx, starX, h - starY, 5, 6, 3);
    _drawStar(_ctx, w - starX, h - starY, 5, 6, 3);
  };

  var _drawStar = function(ctx, cx, cy, spikes, outerR, innerR) {
    var rot = Math.PI / 2 * 3;
    var step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (var i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
    ctx.closePath();
    ctx.fill();
  };

  var _getPos = function(e) {
    var rect = _canvas.getBoundingClientRect();
    var clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  var _scratch = function(e) {
    if (!_isDrawing || !_ctx) return;
    e.preventDefault();

    var pos = _getPos(e);
    _ctx.globalCompositeOperation = "destination-out";
    _ctx.beginPath();
    _ctx.arc(pos.x, pos.y, 25, 0, Math.PI * 2);
    _ctx.fill();

    _ctx.globalCompositeOperation = "source-over";
    _checkReveal();
  };

  var _checkReveal = function() {
    if (!_ctx || !_canvas) return;
    var imageData = _ctx.getImageData(0, 0, _canvas.width, _canvas.height);
    var pixels = imageData.data;
    var transparent = 0;
    for (var i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) transparent++;
    }
    var ratio = transparent / (pixels.length / 4);

    if (ratio > _revealThreshold) {
      _reveal();
    }
  };

  var _reveal = function() {
    if (!_ctx || !_canvas) return;
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    _unbindEvents();
    _isDrawing = false;

    var info = document.getElementById("lotteryInfo");
    if (info) {
      info.textContent = "🎉 恭喜中奖！" + (_currentPrize ? _currentPrize.label : "") + " 🎉";
    }

    if (_onRevealed && _currentPrize) {
      _onRevealed(_currentPrize);
    }
  };

  var _bindEvents = function() {
    if (!_canvas) return;
    _canvas.addEventListener("mousedown", _onMouseDown);
    _canvas.addEventListener("mousemove", _onMouseMove);
    _canvas.addEventListener("mouseup", _onMouseUp);
    _canvas.addEventListener("mouseleave", _onMouseUp);
    _canvas.addEventListener("touchstart", _onTouchStart, { passive: false });
    _canvas.addEventListener("touchmove", _onTouchMove, { passive: false });
    _canvas.addEventListener("touchend", _onTouchEnd);
  };

  var _unbindEvents = function() {
    if (!_canvas) return;
    _canvas.removeEventListener("mousedown", _onMouseDown);
    _canvas.removeEventListener("mousemove", _onMouseMove);
    _canvas.removeEventListener("mouseup", _onMouseUp);
    _canvas.removeEventListener("mouseleave", _onMouseUp);
    _canvas.removeEventListener("touchstart", _onTouchStart);
    _canvas.removeEventListener("touchmove", _onTouchMove);
    _canvas.removeEventListener("touchend", _onTouchEnd);
  };

  var _onMouseDown = function(e) {
    _isDrawing = true;
    _scratch(e);
  };
  var _onMouseMove = function(e) {
    _scratch(e);
  };
  var _onMouseUp = function() {
    _isDrawing = false;
  };
  var _onTouchStart = function(e) {
    _isDrawing = true;
    _scratch(e);
  };
  var _onTouchMove = function(e) {
    _scratch(e);
  };
  var _onTouchEnd = function() {
    _isDrawing = false;
  };

  var _start = function(canvasId, onRevealed) {
    _currentPrize = _getRandomPrize();
    _onRevealed = onRevealed;

    // 生成随机彩票编号
    var ticketNum = document.getElementById("ticketNumber");
    if (ticketNum) {
      var chars = "0123456789";
      var num = "";
      for (var i = 0; i < 6; i++) {
        num += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      ticketNum.textContent = num;
    }

    var discountEl = document.getElementById("lotteryDiscount");
    var labelEl = document.getElementById("lotteryLabel");
    if (discountEl) discountEl.textContent = _currentPrize.discount;
    if (labelEl) labelEl.textContent = _currentPrize.label;

    _initCanvas(canvasId);

    var info = document.getElementById("lotteryInfo");
    if (info) info.textContent = "用手指或鼠标刮开涂层查看奖品！";
  };

  var _reset = function(canvasId) {
    _currentPrize = _getRandomPrize();

    // 生成随机彩票编号
    var ticketNum = document.getElementById("ticketNumber");
    if (ticketNum) {
      var chars = "0123456789";
      var num = "";
      for (var i = 0; i < 6; i++) {
        num += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      ticketNum.textContent = num;
    }

    var discountEl = document.getElementById("lotteryDiscount");
    var labelEl = document.getElementById("lotteryLabel");
    if (discountEl) discountEl.textContent = _currentPrize.discount;
    if (labelEl) labelEl.textContent = _currentPrize.label;

    _scratchedPixels = 0;
    _initCanvas(canvasId);

    var info = document.getElementById("lotteryInfo");
    if (info) info.textContent = "用手指或鼠标刮开涂层查看奖品！";
  };

  return {
    start: _start,
    reset: _reset,
    getCurrentPrize: function() { return _currentPrize; },
    updatePrizeConfig: function(config) {
      if (!Array.isArray(config)) return;
      config.forEach(function(item, index) {
        if (_prizes[index]) {
          _prizes[index].weight = item.weight;
        }
      });
    },
    setThreshold: function(threshold) {
      _revealThreshold = typeof threshold === "number" ? threshold : 0.4;
    }
  };
})();