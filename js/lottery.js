var JITLottery = (function() {
  // ================================================================
  // v2.0 双奖池系统 + 顶呱刮 + 老虎机 + 连败保护
  // ================================================================

  // ===== 日常基础奖池 =====
  var BASIC_POOL = [
    { id: "rebate_5",  name: "返现 5%",  sub: "≈9.5折补贴", weight: 15, cashRate: 0.05, icon: "💎", isWin: true },
    { id: "rebate_2",  name: "返现 2%",  sub: "≈9.8折补贴", weight: 30, cashRate: 0.02, icon: "🎁", isWin: true },
    { id: "no_reward", name: "无返现",   sub: "下次好运",    weight: 50, cashRate: 0,    icon: "🍀", isWin: false },
    { id: "surprise",  name: "小额惊喜", sub: "封顶20元",    weight: 5,  cashRate: 0,  maxAmount: 20, icon: "✨", isWin: true }
  ];

  // ===== 稀有大奖池（Lv3 解锁） =====
  var RARE_POOL = [
    { id: "cash_20",  name: "20元返现",   weight: 40, cashAmount: 20,  icon: "💰", isWin: true },
    { id: "cash_50",  name: "50元返现",   weight: 35, cashAmount: 50,  icon: "💵", isWin: true },
    { id: "cash_100", name: "100元返现",  weight: 20, cashAmount: 100, icon: "🪙", isWin: true },
    { id: "jackpot",  name: "大额免单",   weight: 5,  cashAmount: 200, maxAmount: 200, icon: "👑", isWin: true }
  ];

  // ===== 顶呱刮保留的折数映射（刮刮乐结果 → 基础奖池风格） =====
  var _scratchDiscounts = [
    { discount: "7折",  value: 0.7,  label: "恭喜！",     weight: 5 },
    { discount: "8折",  value: 0.8,  label: "手气不错！", weight: 5 },
    { discount: "9折",  value: 0.9,  label: "好运连连！", weight: 10 },
    { discount: "9.5折",value: 0.95, label: "小有收获！", weight: 15 },
    { discount: "10折", value: 1.0,  label: "保本！",     weight: 25 },
    { discount: "11折", value: 1.1,  label: "小赚！",     weight: 15 },
    { discount: "12折", value: 1.2,  label: "公司请客！", weight: 10 },
    { discount: "13折", value: 1.3,  label: "老板大气！", weight: 10 },
    { discount: "14折", value: 1.4,  label: "超级福利！", weight: 5 }
  ];

  // ===== 连败保护 =====
  var _userLossStreak = 0;
  var MAX_LOSS_STREAK = 2;
  var _lossProtectActive = false;

  // ===== 状态 =====
  var _canvas = null;
  var _ctx = null;
  var _isDrawing = false;
  var _revealThreshold = 0.4;
  var _currentPrize = null;
  var _onRevealed = null;
  var _luckyMode = false;
  var _savedWeights = null;
  var _currentUser = null;
  var _currentVoucherAmount = 0;
  var _slotResults = null;
  var _rarePoolOpen = true;
  var _userLevel = 0;

  // 号码匹配数据
  var _winningNumbers = [];
  var _yourNumbers = [];
  var _yourDiscounts = [];
  var _matchedIndices = [];

  // 老虎机符号
  var SLOT_SYMBOLS_BASIC = ["💎","🎁","🍀","✨","🎰","💰","💵","🎯","⭐","🪙"];
  var SLOT_SYMBOLS_RARE  = ["💰","💵","🪙","👑","💎","🎰","⭐","🎯"];

  // ===== 音效系统 =====
  var _audioCtx = null;
  var _initAudio = function() {
    if (_audioCtx) return _audioCtx;
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {}
    return _audioCtx;
  };

  var _playBeep = function(freq, duration, type) {
    var ctx = _initAudio();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  };

  var _playSlotTick = function() { _playBeep(800 + Math.random() * 200, 0.08, "square"); };
  var _playSlotStop = function() { _playBeep(400, 0.2, "triangle"); };
  var _playWin = function() {
    _playBeep(523, 0.15, "sine");
    setTimeout(function() { _playBeep(659, 0.15, "sine"); }, 120);
    setTimeout(function() { _playBeep(784, 0.3, "sine"); }, 240);
  };
  var _playBigWin = function() {
    _playBeep(523, 0.12, "sine");
    setTimeout(function() { _playBeep(659, 0.12, "sine"); }, 100);
    setTimeout(function() { _playBeep(784, 0.12, "sine"); }, 200);
    setTimeout(function() { _playBeep(1047, 0.12, "sine"); }, 300);
    setTimeout(function() { _playBeep(784, 0.12, "sine"); }, 420);
    setTimeout(function() { _playBeep(1047, 0.4, "sine"); }, 540);
  };
  var _playJackpot = function() {
    for (var i = 0; i < 5; i++) {
      (function(idx) {
        setTimeout(function() {
          _playBeep(523 + idx * 130, 0.15, "sine");
        }, idx * 100);
      })(i);
    }
    setTimeout(function() {
      _playBeep(1047, 0.5, "triangle");
    }, 500);
  };
  var _playReveal = function() { _playBeep(600, 0.3, "triangle"); };
  var _playNoWin = function() { _playBeep(300, 0.3, "sine"); };

  // ===== 工具函数 =====
  var _pickWeighted = function(pool) {
    var total = pool.reduce(function(s, p) { return s + p.weight; }, 0);
    var rand = Math.random() * total;
    var cum = 0;
    for (var i = 0; i < pool.length; i++) {
      cum += pool[i].weight;
      if (rand <= cum) return pool[i];
    }
    return pool[pool.length - 1];
  };

  var _pickWeightedWithProtection = function(pool, voucherAmount) {
    if (_lossProtectActive) {
      _lossProtectActive = false;
      var winPrizes = pool.filter(function(p) { return p.isWin; });
      if (winPrizes.length > 0) {
        var picked = _pickWeighted(winPrizes.map(function(p) {
          return Object.assign({}, p, { weight: p.weight || 10 });
        }));
        return picked;
      }
    }
    return _pickWeighted(pool);
  };

  var _calcPrizeReward = function(prize, voucherAmount) {
    if (prize.cashAmount) {
      if (prize.maxAmount && prize.cashAmount > prize.maxAmount) {
        return Math.min(prize.cashAmount, voucherAmount, prize.maxAmount);
      }
      return Math.min(prize.cashAmount, voucherAmount);
    }
    if (prize.cashRate) {
      var reward = voucherAmount * prize.cashRate;
      if (prize.maxAmount) reward = Math.min(reward, prize.maxAmount);
      return Math.round(reward * 100) / 100;
    }
    return 0;
  };

  // ===== 顶呱刮保留功能 =====
  var _generateUniqueNumbers = function(count, min, max) {
    var nums = [];
    while (nums.length < count) {
      var n = Math.floor(Math.random() * (max - min + 1)) + min;
      if (nums.indexOf(n) === -1) nums.push(n);
    }
    return nums;
  };

  var _getRandomDiscount = function() {
    return _pickWeighted(_scratchDiscounts);
  };

  var _generateNumbers = function() {
    var resultPrize = _getRandomDiscount();
    _winningNumbers = _generateUniqueNumbers(5, 1, 30);
    _yourNumbers = [];
    while (_yourNumbers.length < 9) {
      var n = Math.floor(Math.random() * 30) + 1;
      if (_winningNumbers.indexOf(n) === -1 && _yourNumbers.indexOf(n) === -1) {
        _yourNumbers.push(n);
      }
    }
    _yourNumbers.push(_winningNumbers[0]);
    _yourDiscounts = [];
    _matchedIndices = [];
    for (var i = 0; i < _yourNumbers.length; i++) {
      if (_winningNumbers.indexOf(_yourNumbers[i]) !== -1) {
        _matchedIndices.push(i);
      }
    }
    for (var i = 0; i < _yourNumbers.length; i++) {
      if (_matchedIndices.indexOf(i) !== -1) {
        _yourDiscounts.push({ discount: resultPrize.discount, value: resultPrize.value, label: resultPrize.label });
      } else {
        var p = _getRandomDiscount();
        _yourDiscounts.push({ discount: p.discount, value: p.value, label: p.label });
      }
    }
    _currentPrize = {
      discount: resultPrize.discount,
      value: resultPrize.value,
      label: "匹配" + _matchedIndices.length + "个号码！" + resultPrize.label
    };
  };

  var _renderNumbers = function() {
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
    var yourGrid = document.getElementById("yourNumbersGrid");
    if (yourGrid) {
      var cells = yourGrid.querySelectorAll(".ticket-num-cell");
      cells.forEach(function(el, idx) {
        if (idx < _yourNumbers.length) {
          var numEl = el.querySelector(".ticket-num-your");
          var discEl = el.querySelector(".ticket-num-discount");
          if (numEl) numEl.textContent = String(_yourNumbers[idx]).padStart(2, "0");
          if (discEl) discEl.textContent = _yourDiscounts[idx].discount;
          el.className = "ticket-num-cell";
        }
      });
    }
  };

  var _markMatches = function() {
    var winGrid = document.getElementById("winningNumbersGrid");
    if (winGrid) {
      var winCells = winGrid.querySelectorAll(".ticket-num");
      winCells.forEach(function(el, idx) {
        if (idx < _winningNumbers.length) {
          for (var j = 0; j < _matchedIndices.length; j++) {
            if (_yourNumbers[_matchedIndices[j]] === _winningNumbers[idx]) {
              el.classList.add("matched-win");
              break;
            }
          }
        }
      });
    }
    var yourGrid = document.getElementById("yourNumbersGrid");
    if (yourGrid) {
      var cells = yourGrid.querySelectorAll(".ticket-num-cell");
      _matchedIndices.forEach(function(idx) {
        if (idx < cells.length) cells[idx].classList.add("matched");
      });
    }
  };

  // ===== 翻翻乐系统（替代刮刮乐Canvas） =====
  var _flipFlipped = [];
  var _flipTotal = 10;
  var _flipRevealed = false;

  var _flipCard = function(idx) {
    if (_flipRevealed) return;
    if (_flipFlipped[idx]) return;
    _flipFlipped[idx] = true;

    var cell = document.querySelector('.flip-card[data-idx="' + idx + '"]');
    if (cell) {
      cell.classList.add("flipped");
      _playReveal();
    }

    // 显示号码和折扣
    _updateFlipCellContent(idx);

    // 检查是否全部翻完
    var allFlipped = _flipFlipped.every(function(v) { return v; });
    if (allFlipped) {
      var revealArea = document.getElementById("flipRevealArea");
      if (revealArea) revealArea.style.display = "block";
      var info = document.getElementById("lotteryInfo");
      if (info) info.textContent = "全部翻完！点击「揭晓折数」查看你的折扣";
      var hint = document.getElementById("flipRevealHint");
      if (hint) hint.textContent = "全部翻完，点击揭晓你的折扣！";
    }
  };

  var _updateFlipCellContent = function(idx) {
    var cell = document.querySelector('.flip-card[data-idx="' + idx + '"]');
    if (!cell) return;
    var numEl = cell.querySelector(".ticket-num-your");
    var discEl = cell.querySelector(".ticket-num-discount");
    if (numEl && idx < _yourNumbers.length) numEl.textContent = String(_yourNumbers[idx]).padStart(2, "0");
    if (discEl && idx < _yourDiscounts.length) discEl.textContent = _yourDiscounts[idx].discount;
  };

  var _revealResult = function() {
    if (_flipRevealed) return;
    _flipRevealed = true;

    _markMatches();

    var resultEl = document.getElementById("lotteryResult");
    if (resultEl) {
      resultEl.classList.add("show");
      var matchInfo = document.getElementById("lotteryMatchInfo");
      if (matchInfo) {
        matchInfo.textContent = _matchedIndices.length > 0
          ? "🎯 匹配 " + _matchedIndices.length + " 个号码！" : "😅 没有匹配的号码";
      }
      var discountEl = document.getElementById("lotteryDiscount");
      var labelEl = document.getElementById("lotteryLabel");
      if (discountEl) discountEl.textContent = _currentPrize.discount;
      if (labelEl) labelEl.textContent = _currentPrize.label;
    }

    var info = document.getElementById("lotteryInfo");
    if (info) {
      info.textContent = _matchedIndices.length > 0
        ? "🎉 恭喜！匹配 " + _matchedIndices.length + " 个号码，获得 " + _currentPrize.discount + "！"
        : "未中奖，下次好运！";
    }

    if (_luckyMode) _disableLuckyMode();

    // 调用外部回调
    if (_onRevealed && _currentPrize) {
      _onRevealed(_currentPrize);
    }
  };

  var _bindFlipEvents = function() {
    var cards = document.querySelectorAll(".flip-card");
    cards.forEach(function(card) {
      card.addEventListener("click", function() {
        var idx = parseInt(card.getAttribute("data-idx"));
        if (!isNaN(idx)) _flipCard(idx);
      });
    });

    var revealBtn = document.getElementById("btnFlipReveal");
    if (revealBtn) {
      revealBtn.addEventListener("click", function() {
        if (_flipRevealed) return;
        var allFlipped = _flipFlipped.every(function(v) { return v; });
        if (!allFlipped) {
          var hint = document.getElementById("flipRevealHint");
          if (hint) hint.textContent = "还有牌没翻开，请全部翻完！";
          return;
        }
        var revealArea = document.getElementById("flipRevealArea");
        if (revealArea) revealArea.style.display = "none";
        _revealResult();
      });
    }
  };

  // ===== 老虎机系统 =====
  var _slotSpinning = false;
  var _slotTimers = [];
  var _slotRowResults = [null, null, null];
  var _slotRowSymbols = [[],[],[]];

  var _generateSlotSymbols = function(rowIdx, count) {
    var symbols = rowIdx === 2 ? SLOT_SYMBOLS_RARE : SLOT_SYMBOLS_BASIC;
    var result = [];
    for (var i = 0; i < count; i++) {
      result.push(symbols[Math.floor(Math.random() * symbols.length)]);
    }
    return result;
  };

  var _spinSlotRow = function(rowIdx, finalSymbol, onDone) {
    var rowEl = document.getElementById("slotRow" + rowIdx);
    if (!rowEl) { if (onDone) onDone(); return; }
    var symbolEl = rowEl.querySelector(".slot-symbol");
    if (!symbolEl) { if (onDone) onDone(); return; }

    var spins = 8 + rowIdx * 3;
    var delay = 80;
    var count = 0;
    var symbols = _generateSlotSymbols(rowIdx, spins);

    var spin = function() {
      if (count >= spins) {
        symbolEl.textContent = finalSymbol;
        symbolEl.classList.add("slot-stop");
        _playSlotStop();
        if (onDone) onDone();
        return;
      }
      symbolEl.textContent = symbols[count];
      symbolEl.classList.remove("slot-stop");
      _playSlotTick();
      count++;
      var nextDelay = delay + count * 15;
      _slotTimers.push(setTimeout(spin, nextDelay));
    };
    spin();
  };

  var _startSlotMachine = function(basicResults, rareResult, onAllDone) {
    _slotSpinning = true;
    _slotRowResults = [basicResults[0], basicResults[1], rareResult];
    var doneCount = 0;

    var checkAllDone = function() {
      doneCount++;
      if (doneCount >= 3) {
        _slotSpinning = false;
        // 判断结果
        var bestReward = 0;
        var bestPrize = null;
        [basicResults[0], basicResults[1], rareResult].forEach(function(r) {
          if (r && r.reward > bestReward) { bestReward = r.reward; bestPrize = r; }
        });
        if (bestReward > 0) {
          if (bestReward >= 100) _playJackpot();
          else if (bestReward >= 50) _playBigWin();
          else _playWin();
        } else {
          _playNoWin();
        }
        if (onAllDone) onAllDone(_slotRowResults, bestPrize, bestReward);
      }
    };

    // Row 0 (基础奖池) - 先转
    var sym0 = basicResults[0] && basicResults[0].icon ? basicResults[0].icon : "🎰";
    _spinSlotRow(0, sym0, function() {
      // Row 1 (基础奖池)
      var sym1 = basicResults[1] && basicResults[1].icon ? basicResults[1].icon : "🎰";
      _spinSlotRow(1, sym1, function() {
        // Row 2 (稀有奖池)
        var sym2 = rareResult && rareResult.icon ? rareResult.icon : (_rarePoolOpen ? "🎰" : "🔒");
        _spinSlotRow(2, sym2, checkAllDone);
      });
    });
  };

  var _stopSlotMachine = function() {
    _slotTimers.forEach(function(t) { clearTimeout(t); });
    _slotTimers = [];
    _slotSpinning = false;
  };

  var _resetSlotUI = function() {
    for (var i = 0; i < 3; i++) {
      var rowEl = document.getElementById("slotRow" + i);
      if (!rowEl) continue;
      var symbolEl = rowEl.querySelector(".slot-symbol");
      if (symbolEl) {
        symbolEl.textContent = "🎰";
        symbolEl.classList.remove("slot-stop");
      }
      var labelEl = rowEl.querySelector(".slot-row-label");
      if (labelEl) {
        labelEl.textContent = i === 2 ? "稀有奖池" : "日常基础奖池 " + (i + 1);
        labelEl.className = "slot-row-label";
      }
      var resultEl = rowEl.querySelector(".slot-row-result");
      if (resultEl) resultEl.textContent = "";
    }
  };

  // ===== 公开方法：开始翻翻乐 =====
  var _start = function(ignoredCanvasId, onRevealed) {
    _onRevealed = onRevealed;
    _flipFlipped = [];
    _flipTotal = 10;
    _flipRevealed = false;
    for (var i = 0; i < _flipTotal; i++) { _flipFlipped[i] = false; }

    _generateNumbers();
    var ticketNum = document.getElementById("ticketNumber");
    if (ticketNum) {
      var chars = "0123456789";
      var num = "";
      for (var i = 0; i < 6; i++) { num += chars.charAt(Math.floor(Math.random() * chars.length)); }
      ticketNum.textContent = num;
    }
    _renderNumbers();
    var resultEl = document.getElementById("lotteryResult");
    if (resultEl) resultEl.classList.remove("show");

    // 重置所有翻牌状态
    var cards = document.querySelectorAll(".flip-card");
    cards.forEach(function(card) { card.classList.remove("flipped"); });
    var revealArea = document.getElementById("flipRevealArea");
    if (revealArea) revealArea.style.display = "none";
    var info = document.getElementById("lotteryInfo");
    if (info) info.textContent = "点击翻牌揭晓号码，匹配赢折扣！";

    _bindFlipEvents();
  };

  // ===== 公开方法：执行双奖池抽奖 =====
  var _drawDualPool = function(voucherAmount, userId, level) {
    _currentUser = userId || _currentUser;
    _currentVoucherAmount = voucherAmount || _currentVoucherAmount;
    _userLevel = level || 0;

    // 检查连败保护
    _lossProtectActive = (_userLossStreak >= MAX_LOSS_STREAK);

    // 基础奖池抽2次
    var basic1 = _pickWeightedWithProtection(BASIC_POOL, voucherAmount);
    var basic2 = _pickWeightedWithProtection(BASIC_POOL, voucherAmount);
    var reward1 = _calcPrizeReward(basic1, voucherAmount);
    var reward2 = _calcPrizeReward(basic2, voucherAmount);

    // 稀有奖池（需要 Lv3+ 且奖品池开放）
    var rarePrize = null;
    var rareReward = 0;
    if (_userLevel >= 3 && _rarePoolOpen) {
      rarePrize = _pickWeighted(RARE_POOL);
      rareReward = _calcPrizeReward(rarePrize, voucherAmount);
    }

    // 更新连败计数
    if (reward1 === 0 && reward2 === 0 && rareReward === 0) {
      _userLossStreak++;
    } else {
      _userLossStreak = 0;
    }

    // 取最佳结果
    var bestReward = Math.max(reward1, reward2, rareReward);
    var bestPrize = null;
    if (rareReward >= bestReward && rarePrize) bestPrize = rarePrize;
    else if (reward2 >= bestReward && reward2 > 0) bestPrize = basic2;
    else if (reward1 > 0) bestPrize = basic1;

    _slotResults = {
      basicResults: [
        { prize: basic1, reward: reward1, icon: basic1.icon, id: basic1.id, name: basic1.name, isWin: basic1.isWin, cashRate: basic1.cashRate, cashAmount: basic1.cashAmount },
        { prize: basic2, reward: reward2, icon: basic2.icon, id: basic2.id, name: basic2.name, isWin: basic2.isWin, cashRate: basic2.cashRate, cashAmount: basic2.cashAmount }
      ],
      rareResult: rarePrize ? { prize: rarePrize, reward: rareReward, icon: rarePrize.icon, id: rarePrize.id, name: rarePrize.name, isWin: rarePrize.isWin, cashRate: rarePrize.cashRate, cashAmount: rarePrize.cashAmount } : { id: "rare_locked", name: "稀有池未解锁", isWin: false, icon: "🔒" },
      bestPrize: bestPrize,
      bestReward: bestReward,
      lossProtectUsed: _lossProtectActive
    };

    return _slotResults;
  };

  // ===== 公开方法：启动老虎机动画 =====
  var _playSlotMachine = function(voucherAmount, userId, level, onDone) {
    var results = _drawDualPool(voucherAmount, userId, level);
    _resetSlotUI();

    var basic1 = results.basicResults[0];
    var basic2 = results.basicResults[1];
    var rare = results.rareResult;

    // 显示奖池标签
    for (var i = 0; i < 2; i++) {
      var labelEl = document.getElementById("slotRow" + i);
      if (labelEl) {
        var l = labelEl.querySelector(".slot-row-label");
        if (l) l.textContent = "日常基础奖池";
      }
    }
    if (!_rarePoolOpen || _userLevel < 3) {
      var row2 = document.getElementById("slotRow2");
      if (row2) {
        var l2 = row2.querySelector(".slot-row-label");
        if (l2) {
          l2.textContent = _userLevel < 3 ? "稀有奖池（Lv3 解锁）" : "稀有奖池（已关闭）";
          l2.style.color = "rgba(255,255,255,0.4)";
        }
      }
    }

    _startSlotMachine(
      [basic1, basic2],
      rare,
      function(rowResults, bestPrize, bestReward) {
        // 显示每行结果
        for (var i = 0; i < 3; i++) {
          var rowEl = document.getElementById("slotRow" + i);
          if (!rowEl) continue;
          var resultEl = rowEl.querySelector(".slot-row-result");
          var labelEl = rowEl.querySelector(".slot-row-label");

          if (i === 2 && !rowResults[2]) {
            if (resultEl) resultEl.textContent = "未开放";
            if (resultEl) resultEl.style.color = "rgba(255,255,255,0.4)";
          } else if (rowResults[i]) {
            var r = rowResults[i];
            if (resultEl) {
              resultEl.textContent = r.reward > 0 ? "¥" + r.reward.toFixed(2) : "未中奖";
              resultEl.style.color = r.reward > 0 ? "var(--gold)" : "var(--text-muted)";
            }
            if (labelEl && r.icon) {
              labelEl.textContent = (r.name || r.prizeName || "") + " " + r.icon;
            }
          }
        }

        if (onDone) onDone(results);
      }
    );

    return results;
  };

  // ===== 获取奖池信息 =====
  var _getPoolInfo = function() {
    return {
      basicPool: BASIC_POOL,
      rarePool: RARE_POOL,
      rarePoolOpen: _rarePoolOpen,
      lossStreak: _userLossStreak,
      maxLossStreak: MAX_LOSS_STREAK
    };
  };

  var _setRarePoolOpen = function(open) {
    _rarePoolOpen = !!open;
  };

  var _setUserLevel = function(level) {
    _userLevel = level || 0;
  };

  var _setUserLossStreak = function(streak) {
    _userLossStreak = streak || 0;
  };

  // ===== 幸运抽奖模式（保留兼容） =====
  var _lowDiscountIds = ["7折", "8折", "9折", "9.5折"];
  var _enableLuckyMode = function() {
    if (_luckyMode) return true;
    _savedWeights = _scratchDiscounts.map(function(p) { return p.weight; });
    _scratchDiscounts.forEach(function(p) {
      if (_lowDiscountIds.indexOf(p.discount) !== -1) {
        p.weight = Math.max(1, Math.round(p.weight * 3));
      } else {
        p.weight = Math.max(0, Math.round(p.weight * 0.2));
      }
    });
    _luckyMode = true;
    return true;
  };

  var _disableLuckyMode = function() {
    if (!_luckyMode || !_savedWeights) return;
    _scratchDiscounts.forEach(function(p, idx) {
      if (typeof _savedWeights[idx] === "number") p.weight = _savedWeights[idx];
    });
    _savedWeights = null;
    _luckyMode = false;
  };

  // ===== 返回公开 API =====
  return {
    // 顶呱刮保留接口
    start: _start,
    getCurrentPrize: function() { return _currentPrize; },
    getMatchedCount: function() { return _matchedIndices ? _matchedIndices.length : 0; },
    getPrizes: function() { return _scratchDiscounts; },
    updatePrizeConfig: function(config) {
      if (!Array.isArray(config)) return;
      if (_luckyMode) _disableLuckyMode();
      config.forEach(function(item, index) {
        if (_scratchDiscounts[index] && typeof item.weight === "number" && item.weight >= 0) {
          _scratchDiscounts[index].weight = item.weight;
        }
      });
    },
    setThreshold: function(t) { _revealThreshold = typeof t === "number" ? t : 0.4; },
    isLuckyMode: function() { return _luckyMode; },
    enableLuckyMode: _enableLuckyMode,
    disableLuckyMode: _disableLuckyMode,

    // 双奖池新接口
    drawDualPool: _drawDualPool,
    playSlotMachine: _playSlotMachine,
    getPoolInfo: _getPoolInfo,
    setRarePoolOpen: _setRarePoolOpen,
    setUserLevel: _setUserLevel,
    setUserLossStreak: _setUserLossStreak,
    getSlotResults: function() { return _slotResults; },
    getLossStreak: function() { return _userLossStreak; },
    resetLossStreak: function() { _userLossStreak = 0; },
    stopSlotMachine: _stopSlotMachine,

    // 奖池常量
    BASIC_POOL: BASIC_POOL,
    RARE_POOL: RARE_POOL
  };
})();

// ===== JITSlot 公开接口（适配 app.js 调用） =====
window.JITSlot = (function() {
  var _slotResult = null;
  var _slotCallback = null;
  var _running = false;
  var _doneCount = 0;

  function _spinOneRow(rowIdx, finalSymbol, rowLabel) {
    var rowEl = document.getElementById("slotRow" + rowIdx);
    if (!rowEl) { _doneCount++; _checkDone(); return; }
    var symbolEl = rowEl.querySelector(".slot-symbol");
    if (!symbolEl) { _doneCount++; _checkDone(); return; }

    var spins = 8 + rowIdx * 3;
    var delay = 80;
    var count = 0;
    var symbols = rowIdx === 2 ? JITLottery.RARE_POOL.map(function(p){return p.icon;}) : JITLottery.BASIC_POOL.map(function(p){return p.icon;});
    // 扩展符号列表
    var extendedSymbols = [];
    for (var i = 0; i < spins; i++) {
      extendedSymbols.push(symbols[Math.floor(Math.random() * symbols.length)]);
    }

    var spin = function() {
      if (count >= spins) {
        symbolEl.textContent = finalSymbol;
        symbolEl.classList.add("slot-stop");
        // 回调
        if (_slotCallback) {
          var rowResult = null;
          if (_slotResult) {
            if (rowIdx === 2) { rowResult = _slotResult.rareResult; }
            else { rowResult = _slotResult.basicResults && _slotResult.basicResults[rowIdx]; }
          }
          var poolType = rowIdx === 2 ? "rare" : "basic";
          _slotCallback(poolType, rowIdx, rowResult, false);
        }
        _doneCount++;
        _checkDone();
        return;
      }
      symbolEl.textContent = extendedSymbols[count];
      symbolEl.classList.remove("slot-stop");
      count++;
      var nextDelay = delay + count * 15;
      setTimeout(spin, nextDelay);
    };
    spin();
  }

  function _checkDone() {
    if (_doneCount >= 3) {
      _running = false;
      if (_slotCallback) {
        _slotCallback(null, -1, null, true);
      }
    }
  }

  return {
    drawDualPool: function(voucherAmount, userId, level) {
      return JITLottery.drawDualPool(voucherAmount, userId, level);
    },
    play: function(callback) {
      if (_running) return;
      var result = JITLottery.getSlotResults();
      if (!result || !result.basicResults) {
        if (callback) callback(null, -1, null, true);
        return;
      }
      _slotResult = result;
      _slotCallback = callback;
      _running = true;
      _doneCount = 0;

      // 决定每行的最终符号
      var basic1 = result.basicResults[0];
      var basic2 = result.basicResults[1];
      var rare = result.rareResult;

      var sym0 = basic1 && basic1.icon ? basic1.icon : "🎰";
      var sym1 = basic2 && basic2.icon ? basic2.icon : "🎰";
      var rareLocked = (!rare || rare.id === "rare_locked");
      var sym2 = rareLocked ? "🔒" : (rare && rare.icon ? rare.icon : "🎰");

      // 稀有池锁定单独处理
      if (rareLocked) {
        if (callback) { callback("rare_locked", 2, rare, false); }
        _doneCount++;
      }

      // 逐行旋转
      var self = this;
      _spinOneRow(0, sym0, "基础奖池 1");
      setTimeout(function() { _spinOneRow(1, sym1, "基础奖池 2"); }, 600);
      if (!rareLocked) {
        setTimeout(function() { _spinOneRow(2, sym2, "稀有奖池"); }, 1200);
      } else {
        setTimeout(function() { _checkDone(); }, 1800);
      }
    },
    resetSlotUI: function() {
      for (var i = 0; i < 3; i++) {
        var rowEl = document.getElementById("slotRow" + i);
        if (!rowEl) continue;
        var sEl = rowEl.querySelector(".slot-symbol");
        if (sEl) { sEl.textContent = "🎰"; sEl.classList.remove("slot-stop"); }
        var rEl = rowEl.querySelector(".slot-row-result");
        if (rEl) rEl.textContent = "";
      }
    }
  };
})();