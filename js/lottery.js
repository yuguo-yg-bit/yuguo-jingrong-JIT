var JITLottery = (function() {
  var _prizes = [
    { discount: "7折", value: 0.7, label: "恭喜！", weight: 10 },
    { discount: "8折", value: 0.8, label: "手气不错！", weight: 10 },
    { discount: "9折", value: 0.9, label: "好运连连！", weight: 10 },
    { discount: "9.5折", value: 0.95, label: "小有收获！", weight: 10 },
    { discount: "10折", value: 1.0, label: "保本！", weight: 10 },
    { discount: "11折", value: 1.1, label: "小赚！", weight: 10 },
    { discount: "12折", value: 1.2, label: "公司请客！", weight: 10 },
    { discount: "13折", value: 1.3, label: "老板大气！", weight: 10 },
    { discount: "14折", value: 1.4, label: "超级福利！", weight: 10 },
    { discount: "0折", value: 0.0, label: "免单！", weight: 10 }
  ];

  var _canvas = null;
  var _ctx = null;
  var _isDrawing = false;
  var _revealThreshold = 0.4;
  var _currentPrize = null;
  var _onRevealed = null;

  // 从 localStorage 加载保存的权重配置
  var _loadSavedConfig = function() {
    var saved = localStorage.getItem("jit_lottery_prizes");
    if (!saved) return;
    try {
      var config = JSON.parse(saved);
      if (!Array.isArray(config)) return;
      // 奖项数量变了，丢弃旧配置用默认值
      if (config.length !== _prizes.length) {
        localStorage.removeItem("jit_lottery_prizes");
        return;
      }
      config.forEach(function(item, index) {
        if (_prizes[index] && item.weight > 0) {
          _prizes[index].weight = item.weight;
        }
      });
    } catch(e) {}
  };
  _loadSavedConfig();

  // 号码匹配数据
  var _winningNumbers = [];  // 5个中奖号码
  var _yourNumbers = [];     // 10个你的号码
  var _yourDiscounts = [];   // 每个号码对应的折扣
  var _matchedIndices = [];  // 匹配的号码索引

  // 从权重池中随机选一个折扣
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

  // 生成不重复的随机数
  var _generateUniqueNumbers = function(count, min, max) {
    var nums = [];
    while (nums.length < count) {
      var n = Math.floor(Math.random() * (max - min + 1)) + min;
      if (nums.indexOf(n) === -1) {
        nums.push(n);
      }
    }
    return nums;
  };

  // 生成号码匹配数据
  var _generateNumbers = function() {
    // 1. 先根据权重随机决定最终结果（娃娃机后台设定）
    var resultPrize = _getRandomPrize();

    // 2. 生成号码（纯视觉效果，走个形式）
    _winningNumbers = _generateUniqueNumbers(5, 1, 30);
    _yourNumbers = _generateUniqueNumbers(10, 1, 30);
    _yourDiscounts = [];
    _matchedIndices = [];

    // 3. 找出匹配的号码
    for (var i = 0; i < _yourNumbers.length; i++) {
      if (_winningNumbers.indexOf(_yourNumbers[i]) !== -1) {
        _matchedIndices.push(i);
      }
    }

    // 4. 分配折扣：匹配的号码显示最终结果的折数，不匹配的随机
    for (var i = 0; i < _yourNumbers.length; i++) {
      if (_matchedIndices.indexOf(i) !== -1) {
        _yourDiscounts.push({ discount: resultPrize.discount, value: resultPrize.value, label: resultPrize.label });
      } else {
        var p = _getRandomPrize();
        _yourDiscounts.push({ discount: p.discount, value: p.value, label: p.label });
      }
    }

    // 5. 最终结果直接用权重决定的
    if (_matchedIndices.length > 0) {
      _currentPrize = {
        discount: resultPrize.discount,
        value: resultPrize.value,
        label: "匹配" + _matchedIndices.length + "个号码！" + resultPrize.label
      };
    } else {
      _currentPrize = {
        discount: resultPrize.discount,
        value: resultPrize.value,
        label: resultPrize.label
      };
    }
  };

  // 渲染号码到界面
  var _renderNumbers = function() {
    // 渲染中奖号码
    var winGrid = document.getElementById("winningNumbersGrid");
    if (winGrid) {
      var winCells = winGrid.querySelectorAll(".ticket-num");
      winCells.forEach(function(el, idx) {
        if (idx < _winningNumbers.length) {
          el.textContent = String(_winningNumbers[idx]).padStart(2, "0");
          el.className = "ticket-num";
        }
      });
    }

    // 渲染你的号码
    var yourGrid = document.getElementById("yourNumbersGrid");
    if (yourGrid) {
      var cells = yourGrid.querySelectorAll(".ticket-num-cell");
      cells.forEach(function(el, idx) {
        if (idx < _yourNumbers.length) {
          var numEl = el.querySelector(".ticket-num-your");
          var discEl = el.querySelector(".ticket-num-discount");
          if (numEl) {
            numEl.textContent = String(_yourNumbers[idx]).padStart(2, "0");
          }
          if (discEl) {
            discEl.textContent = _yourDiscounts[idx].discount;
          }
          el.className = "ticket-num-cell";
        }
      });
    }
  };

  // 标记匹配的号码
  var _markMatches = function() {
    // 标记中奖号码中被匹配的
    var winGrid = document.getElementById("winningNumbersGrid");
    if (winGrid) {
      var winCells = winGrid.querySelectorAll(".ticket-num");
      winCells.forEach(function(el, idx) {
        if (idx < _winningNumbers.length) {
          // 检查这个中奖号码是否被匹配
          for (var j = 0; j < _matchedIndices.length; j++) {
            if (_yourNumbers[_matchedIndices[j]] === _winningNumbers[idx]) {
              el.classList.add("matched-win");
              break;
            }
          }
        }
      });
    }

    // 标记你的号码中匹配的
    var yourGrid = document.getElementById("yourNumbersGrid");
    if (yourGrid) {
      var cells = yourGrid.querySelectorAll(".ticket-num-cell");
      _matchedIndices.forEach(function(idx) {
        if (idx < cells.length) {
          cells[idx].classList.add("matched");
        }
      });
    }
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
    for (var i = 0; i < 100; i++) {
      var x = Math.random() * w;
      var y = Math.random() * h;
      var r = Math.random() * 2 + 0.5;
      _ctx.beginPath();
      _ctx.arc(x, y, r, 0, Math.PI * 2);
      _ctx.fill();
    }

    // 暗纹颗粒
    _ctx.fillStyle = "rgba(0,0,0,0.05)";
    for (var i = 0; i < 50; i++) {
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
    _ctx.font = "bold 18px sans-serif";
    _ctx.textAlign = "center";
    _ctx.textBaseline = "middle";
    _ctx.fillText("顶呱刮", w / 2, h / 2 - 20);

    // "刮开有奖" 提示
    _ctx.fillStyle = "rgba(139,0,0,0.45)";
    _ctx.font = "bold 13px sans-serif";
    _ctx.fillText("刮开有奖", w / 2, h / 2 + 10);

    // 底部小提示
    _ctx.fillStyle = "rgba(139,0,0,0.3)";
    _ctx.font = "10px sans-serif";
    _ctx.fillText("号码匹配型", w / 2, h / 2 + 35);

    // 装饰小星星
    _ctx.fillStyle = "rgba(255,215,0,0.3)";
    _drawStar(_ctx, 25, 22, 5, 6, 3);
    _drawStar(_ctx, w - 25, 22, 5, 6, 3);
    _drawStar(_ctx, 25, h - 22, 5, 6, 3);
    _drawStar(_ctx, w - 25, h - 22, 5, 6, 3);
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
    _ctx.arc(pos.x, pos.y, 22, 0, Math.PI * 2);
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

    // 标记匹配的号码
    _markMatches();

    // 显示结果
    var resultEl = document.getElementById("lotteryResult");
    if (resultEl) {
      resultEl.classList.add("show");
      var matchInfo = document.getElementById("lotteryMatchInfo");
      if (matchInfo) {
        if (_matchedIndices.length > 0) {
          matchInfo.textContent = "🎯 匹配 " + _matchedIndices.length + " 个号码！";
        } else {
          matchInfo.textContent = "😅 没有匹配的号码";
        }
      }
      var discountEl = document.getElementById("lotteryDiscount");
      var labelEl = document.getElementById("lotteryLabel");
      if (discountEl) discountEl.textContent = _currentPrize.discount;
      if (labelEl) labelEl.textContent = _currentPrize.label;
    }

    // 提示
    var info = document.getElementById("lotteryInfo");
    if (info) {
      if (_matchedIndices.length > 0) {
        info.textContent = "🎉 恭喜！匹配 " + _matchedIndices.length + " 个号码，获得 " + _currentPrize.discount + "！";
      } else {
        info.textContent = "未中奖，下次好运！";
      }
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

  var _onMouseDown = function(e) { _isDrawing = true; _scratch(e); };
  var _onMouseMove = function(e) { _scratch(e); };
  var _onMouseUp = function() { _isDrawing = false; };
  var _onTouchStart = function(e) { _isDrawing = true; _scratch(e); };
  var _onTouchMove = function(e) { _scratch(e); };
  var _onTouchEnd = function() { _isDrawing = false; };

  var _start = function(canvasId, onRevealed) {
    _onRevealed = onRevealed;

    // 生成号码匹配数据
    _generateNumbers();

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

    // 渲染号码到界面
    _renderNumbers();

    // 隐藏结果
    var resultEl = document.getElementById("lotteryResult");
    if (resultEl) resultEl.classList.remove("show");

    // 初始化涂层
    _initCanvas(canvasId);

    var info = document.getElementById("lotteryInfo");
    if (info) info.textContent = "刮开涂层，匹配号码赢折扣！";
  };

  return {
    start: _start,
    getCurrentPrize: function() { return _currentPrize; },
    getMatchedCount: function() { return _matchedIndices ? _matchedIndices.length : 0; },
    getPrizes: function() { return _prizes; },
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