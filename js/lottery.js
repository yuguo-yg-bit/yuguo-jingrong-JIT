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

    var gradient = _ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, "#1a237e");
    gradient.addColorStop(0.3, "#283593");
    gradient.addColorStop(0.6, "#1565c0");
    gradient.addColorStop(1, "#0d47a1");
    _ctx.fillStyle = gradient;
    _ctx.fillRect(0, 0, w, h);

    _ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (var i = 0; i < 50; i++) {
      var x = Math.random() * w;
      var y = Math.random() * h;
      var r = Math.random() * 3 + 1;
      _ctx.beginPath();
      _ctx.arc(x, y, r, 0, Math.PI * 2);
      _ctx.fill();
    }

    _ctx.fillStyle = "rgba(66, 165, 245, 0.8)";
    _ctx.font = "bold 18px sans-serif";
    _ctx.textAlign = "center";
    _ctx.textBaseline = "middle";
    _ctx.fillText("刮开此处", w / 2, h / 2 - 15);
    _ctx.fillText("查看奖品", w / 2, h / 2 + 15);

    _ctx.strokeStyle = "rgba(66, 165, 245, 0.4)";
    _ctx.lineWidth = 1;
    _ctx.strokeRect(10, 10, w - 20, h - 20);
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
      info.textContent = "恭喜中奖！" + (_currentPrize ? _currentPrize.label : "");
    }
    var newBtn = document.getElementById("btnLotteryNew");
    if (newBtn) {
      newBtn.style.display = "block";
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

    var discountEl = document.getElementById("lotteryDiscount");
    var labelEl = document.getElementById("lotteryLabel");
    if (discountEl) discountEl.textContent = _currentPrize.discount;
    if (labelEl) labelEl.textContent = _currentPrize.label;

    _initCanvas(canvasId);

    var newBtn = document.getElementById("btnLotteryNew");
    if (newBtn) newBtn.style.display = "none";
    var info = document.getElementById("lotteryInfo");
    if (info) info.textContent = "用手指或鼠标刮开涂层查看奖品！";
  };

  var _reset = function(canvasId) {
    _currentPrize = _getRandomPrize();

    var discountEl = document.getElementById("lotteryDiscount");
    var labelEl = document.getElementById("lotteryLabel");
    if (discountEl) discountEl.textContent = _currentPrize.discount;
    if (labelEl) labelEl.textContent = _currentPrize.label;

    _scratchedPixels = 0;
    _initCanvas(canvasId);

    var newBtn = document.getElementById("btnLotteryNew");
    if (newBtn) newBtn.style.display = "none";
    var info = document.getElementById("lotteryInfo");
    if (info) info.textContent = "用手指或鼠标刮开涂层查看奖品！";
  };

  return {
    start: _start,
    reset: _reset,
    getCurrentPrize: function() { return _currentPrize; }
  };
})();