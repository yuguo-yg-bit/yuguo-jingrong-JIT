#!/usr/bin/env python3
"""重构 work.html 为 v4.0 Claude 风格布局"""

import re

# 读取现有文件
with open("work.html", "r", encoding="utf-8") as f:
    old_html = f.read()

# 提取</head>之前的内容并修改
head_end = old_html.find("</head>")

# 找到 <body> 之后、</body> 之前的 body 内容
body_start = old_html.find("<body>") + 6
body_end_tag = old_html.rfind("</body>")
body_inner = old_html[body_start:body_end_tag]

# 提取所有 modal-overlay 块（它们闭合在 </div> 之后）
overlay_pattern = r'(<div class="modal-overlay [^>]*>.*?</div>\s*</div>\s*</div>)'
overlay_matches = list(re.finditer(overlay_pattern, body_inner, re.DOTALL))

# 收集所有 overlay HTML
overlays_html = ""
for m in overlay_matches:
    overlays_html += m.group(1) + "\n"

# 检查是否还有 slotMachineOverlay, scratchResultOverlay 等额外 overlay
extra_overlays = [
    "slotMachineOverlay", "scratchResultOverlay",
    "notificationOverlay", "notificationDetailOverlay",
    "urgentApplyOverlay", "pointsHistoryOverlay",
    "userFirstPayOverlay", "unionFirstPayOverlay",
    "wheelOverlay"
]

# 提取剩余的 JS 引用部分（在 overlay 之后）
last_overlay_end = max(m.end() for m in overlay_matches) if overlay_matches else 0

# 提取 sidebarHistoryList 内容用于历史单据页面
sidebar_match = re.search(
    r'<aside class="sidebar" id="sidebar">(.*?)</aside>',
    body_inner, re.DOTALL
)

# 提取 order table 内容
orders_section_match = re.search(
    r'(<div class="orders-section">.*?</main>)',
    body_inner, re.DOTALL
)

# 提取 header 信息
header_end_match = re.search(r'</header>', body_inner)
content_wrapper_match = re.search(r'<div class="content-wrapper">', body_inner)

# 获取主容器结束
main_end_match = re.search(r'</main>\s*</div>\s*</div>', body_inner)

# 检查遗留的JS引用区
js_ref_start = body_inner.rfind('<script ')
js_refs = ""
if js_ref_start > 0:
    js_section = body_inner[js_ref_start:]
    # 只提取 script 标签引用，不要内联代码
    script_refs = re.findall(r'<script src="[^"]+\.js[^"]*"></script>', js_section)
    js_refs = "\n".join(script_refs)

# ========== 构建新的 work.html ==========

# SVG 图标集合
svg_icons = {
    "home": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    "plus": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    "list": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    "edit": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    "coin": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="16"/></svg>',
    "gift": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
    "users": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    "message": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    "user": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    "bell": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    "search": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    "chevron_left": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>',
    "log_out": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
}

# 侧边栏菜单构建
sidebar_html = f'''  <nav class="sidebar-v4" id="sidebarV4">
    <!-- Logo -->
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon">玉</div>
      <span class="sidebar-brand-text">玉国金融</span>
    </div>

    <!-- 导航区域 -->
    <div class="sidebar-nav">
      <!-- 第一组：首页 -->
      <div class="sidebar-group">
        <div class="sidebar-group-title">主菜单</div>
        <div class="sidebar-item sidebar-tooltip-wrapper active" data-route="/home" data-tooltip="首页动态">
          <span class="sidebar-item-icon">{svg_icons["home"]}</span>
          <span class="sidebar-item-text">首页动态</span>
        </div>
      </div>

      <!-- 第二组：凭证中心 -->
      <div class="sidebar-group">
        <div class="sidebar-group-title">凭证中心</div>
        <div class="sidebar-item sidebar-tooltip-wrapper" data-route="/voucher/apply" data-tooltip="凭证申请">
          <span class="sidebar-item-icon">{svg_icons["plus"]}</span>
          <span class="sidebar-item-text">凭证申请</span>
        </div>
        <div class="sidebar-item sidebar-tooltip-wrapper" data-route="/voucher/list" data-tooltip="我的凭证订单">
          <span class="sidebar-item-icon">{svg_icons["list"]}</span>
          <span class="sidebar-item-text">我的凭证订单</span>
        </div>
        <div class="sidebar-item sidebar-tooltip-wrapper" data-route="/voucher/manage" data-tooltip="凭证编辑管理">
          <span class="sidebar-item-icon">{svg_icons["edit"]}</span>
          <span class="sidebar-item-text">凭证编辑管理</span>
        </div>
      </div>

      <!-- 第三组：福利&活动 -->
      <div class="sidebar-group">
        <div class="sidebar-group-title">福利 & 活动</div>
        <div class="sidebar-item sidebar-tooltip-wrapper" data-route="/points" data-tooltip="积分中心">
          <span class="sidebar-item-icon">{svg_icons["coin"]}</span>
          <span class="sidebar-item-text">积分中心</span>
        </div>
        <div class="sidebar-item sidebar-tooltip-wrapper" data-route="/activity" data-tooltip="活动广场">
          <span class="sidebar-item-icon">{svg_icons["gift"]}</span>
          <span class="sidebar-item-text">活动广场</span>
        </div>
        <div class="sidebar-item sidebar-tooltip-wrapper" data-route="/invite" data-tooltip="邀请与农场">
          <span class="sidebar-item-icon">{svg_icons["users"]}</span>
          <span class="sidebar-item-text">邀请与农场</span>
        </div>
      </div>

      <!-- 第四组：社区&个人 -->
      <div class="sidebar-group">
        <div class="sidebar-group-title">社区 & 个人</div>
        <div class="sidebar-item sidebar-tooltip-wrapper" data-route="/community" data-tooltip="社区">
          <span class="sidebar-item-icon">{svg_icons["message"]}</span>
          <span class="sidebar-item-text">社区</span>
        </div>
        <div class="sidebar-item sidebar-tooltip-wrapper" data-route="/profile" data-tooltip="个人设置">
          <span class="sidebar-item-icon">{svg_icons["user"]}</span>
          <span class="sidebar-item-text">个人设置</span>
        </div>
      </div>
    </div>

    <!-- 底部用户区 -->
    <div class="sidebar-footer">
      <div class="sidebar-user" id="sidebarUser">
        <div class="sidebar-user-avatar" id="sidebarUserAvatar">用</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name" id="sidebarUserName">未登录</div>
          <div class="sidebar-user-role" id="sidebarUserRole">用户</div>
        </div>
      </div>
    </div>
  </nav>'''

# 顶栏
topbar_html = f'''    <header class="topbar">
      <div class="topbar-left">
        <button class="topbar-collapse-btn" id="btnToggleSidebar" title="折叠侧边栏">
          {svg_icons["chevron_left"]}
        </button>
        <div class="topbar-search" id="topbarSearch">
          <span class="topbar-search-icon">{svg_icons["search"]}</span>
          <input type="text" id="topbarSearchInput" placeholder="搜索凭证、订单、活动...">
        </div>
      </div>
      <div class="topbar-right">
        <span class="topbar-points">
          积分 <span class="topbar-points-value" id="pointsTotal">0</span>
        </span>
        <button class="topbar-icon-btn" id="btnNotification" title="通知">
          {svg_icons["bell"]}
          <span class="topbar-badge" id="topbarNotificationBadge" style="display:none;">0</span>
        </button>
        <button class="topbar-user-btn" id="btnUserMenu">
          <div class="topbar-user-avatar" id="topbarUserAvatar">用</div>
          <span class="topbar-user-name" id="topbarUserNameDisplay">用户</span>
        </button>
      </div>
    </header>'''

# 页面容器
pages_html = f'''
    <div class="content-area" id="contentArea">
      <!-- ========== 首页动态 /home ========== -->
      <div class="page-container" data-page="/home" id="pageHome">
        <div class="page-header">
          <div class="page-title-group">
            <h2 id="pageTitle">首页动态</h2>
            <p id="pageSubtitle">汇总凭证、积分、交易等全部动态</p>
          </div>
        </div>

        <!-- 统计卡片 -->
        <div class="stats-grid" id="homeStatsGrid">
          <div class="stat-card">
            <div class="stat-label">总凭证数</div>
            <div class="stat-value gold" id="homeStatTotal">-</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">当前积分</div>
            <div class="stat-value gold" id="homeStatPoints">-</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">会员等级</div>
            <div class="stat-value" id="homeStatLevel">-</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">待处理订单</div>
            <div class="stat-value" id="homeStatPending">-</div>
          </div>
        </div>

        <!-- 会员进度条 -->
        <div class="card" id="memberProgressCard">
          <div class="card-header"><span class="card-title">会员等级进度</span></div>
          <div class="member-progress" id="memberProgress">
            <div class="progress-labels">
              <span class="progress-label">一阶</span>
              <span class="progress-label">1级IT会员</span>
              <span class="progress-label">2级</span>
              <span class="progress-label">3级</span>
              <span class="progress-label">4级</span>
            </div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill" id="progressBarFill"></div>
            </div>
            <div class="progress-text" id="progressText">{svg_icons["coin"]} 加载中...</div>
          </div>
        </div>

        <!-- 动态信息流 -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">最近动态</span>
            <div class="filter-bar" id="homeFilterBar">
              <span class="filter-pill active" data-filter="all">全部</span>
              <span class="filter-pill" data-filter="voucher">凭证</span>
              <span class="filter-pill" data-filter="points">积分</span>
              <span class="filter-pill" data-filter="lottery">抽奖</span>
            </div>
          </div>
          <div id="homeFeed" class="loading-brand">
            {svg_icons["coin"]} 加载动态中...
          </div>
        </div>
      </div>

      <!-- ========== 凭证申请 /voucher/apply ========== -->
      <div class="page-container" data-page="/voucher/apply" style="display:none;" id="pageVoucherApply">
        <div class="page-header">
          <div class="page-title-group">
            <h2>凭证申请</h2>
            <p>提交新的消费凭证，享受工会优惠补贴</p>
          </div>
        </div>
        <!-- 电器补贴入口 -->
        <div class="card" style="cursor:pointer;border-color:rgba(255,112,67,0.35);background:linear-gradient(135deg,rgba(255,112,67,0.06),rgba(255,152,0,0.08));" id="jumpElectricTop">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:15px;font-weight:800;color:#ff6e40;margin-bottom:4px;">🎁 玉国金融 · 大额电器补贴（推荐）</div>
              <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">
                单件 / 单订单金额 ≥ <b style="color:#ff8a65;">3000 元</b> 的电器消费<br>
                <b style="color:#ffab91;">非抽奖模式</b> → 管理员审核按比例直接补贴（如 5%）
              </div>
            </div>
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:6px;">
              <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#ff7043,#ff5722);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px;box-shadow:0 4px 14px rgba(255,87,34,0.4);">🎁</div>
              <div style="font-size:11px;color:#ff8a65;font-weight:700;white-space:nowrap;">点我去填写 →</div>
            </div>
          </div>
        </div>
        <!-- 凭证类型选择 -->
        <div class="card">
          <div class="card-title" style="margin-bottom:14px;">选择凭证类型</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button class="btn btn-secondary" id="btnAddVoucher" style="display:flex;align-items:center;gap:8px;padding:12px 20px;">
              {svg_icons["plus"]} <span>添加凭证</span>
            </button>
            <button class="btn btn-secondary" id="btnWriteVoucher" style="display:flex;align-items:center;gap:8px;padding:12px 20px;">
              {svg_icons["edit"]} <span>编辑凭证</span>
            </button>
            <button class="btn btn-secondary" id="btnAddOnlineVoucher" style="display:flex;align-items:center;gap:8px;padding:12px 20px;border-color:var(--accent);color:var(--accent);">
              🛒 <span>线上购物</span>
            </button>
            <button class="btn btn-secondary" id="btnAddElectricVoucher" style="display:flex;align-items:center;gap:8px;padding:12px 20px;border-color:#ff7043;color:#ff7043;">
              🎁 <span>电器补贴凭证</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ========== 我的凭证订单 /voucher/list ========== -->
      <div class="page-container" data-page="/voucher/list" style="display:none;" id="pageVoucherList">
        <div class="page-header">
          <div class="page-title-group">
            <h2>我的凭证订单</h2>
            <p>查看所有凭证订单的历史记录</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary btn-sm" id="btnUserFirstPayClose" style="display:none;">用户先付详情</button>
            <button class="btn btn-secondary btn-sm" id="btnUnionFirstPayClose" style="display:none;">工会先付详情</button>
            <button class="btn btn-secondary btn-sm" id="btnUnionPaid" style="display:none;">已支付确认</button>
          </div>
        </div>

        <!-- 二级筛选 -->
        <div class="filter-bar" id="voucherFilterBar">
          <span class="filter-pill active" data-status="all">全部</span>
          <span class="filter-pill" data-status="pending">待审核</span>
          <span class="filter-pill" data-status="approved">已通过</span>
          <span class="filter-pill" data-status="rejected">已拒绝</span>
          <span class="filter-pill" data-status="waiting">等待中</span>
        </div>

        <div class="card" style="padding:0;overflow:hidden;">
          <div class="table-container">
            <table class="data-table" id="ordersTable">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>名称</th>
                  <th>日期</th>
                  <th>中奖</th>
                  <th>支付方式</th>
                  <th>原价</th>
                  <th>折扣后实付</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="ordersTableBody">
                <tr class="empty-row"><td colspan="9">' + svg_icons["coin"] + ' 加载凭证订单中...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="pagination" id="pagination" style="display:flex;justify-content:center;align-items:center;gap:12px;padding:16px 0;">
          <button class="btn btn-secondary btn-sm" id="btnPrevPage" disabled>上一页</button>
          <span class="page-info" id="pageInfo" style="font-size:13px;color:var(--text-secondary);">第 1 页</span>
          <button class="btn btn-secondary btn-sm" id="btnNextPage">下一页</button>
        </div>
        <div id="noMoreOrders" style="display:none;text-align:center;color:var(--text-dim);padding:16px;font-size:13px;">没有更多订单！</div>
      </div>

      <!-- ========== 凭证编辑管理 /voucher/manage ========== -->
      <div class="page-container" data-page="/voucher/manage" style="display:none;" id="pageVoucherManage">
        <div class="page-header">
          <div class="page-title-group">
            <h2>凭证编辑管理</h2>
            <p>修改已有凭证信息</p>
          </div>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:14px;">选择要编辑的凭证</div>
          <p style="color:var(--text-dim);font-size:13px;">点击下方"编辑凭证"按钮，从订单列表中选择要修改的凭证</p>
          <div style="margin-top:16px;">
            <button class="btn btn-secondary" id="btnWriteVoucher2" style="display:flex;align-items:center;gap:8px;padding:12px 20px;">
              {svg_icons["edit"]} <span>编辑凭证</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ========== 积分中心 /points ========== -->
      <div class="page-container" data-page="/points" style="display:none;" id="pagePoints">
        <div class="page-header">
          <div class="page-title-group">
            <h2>积分中心</h2>
            <p>积分明细与会员等级进度</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary btn-sm" id="btnPointsHistory">📋 积分明细</button>
            <button class="btn btn-secondary btn-sm" id="btnUsePointsOffset">🎯 积分抵扣</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">当前积分</div>
            <div class="stat-value gold" id="pointsTotalCard">-</div>
            <div class="stat-change" id="pointsChangeHint"></div>
          </div>
          <div class="stat-card">
            <div class="stat-label">积分抵扣余额</div>
            <div class="stat-value gold" id="offsetCurrentPoints" style="font-size:20px;">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">幸运模式积分</div>
            <div class="stat-value gold" id="luckyCurrentPoints" style="font-size:20px;">0</div>
          </div>
        </div>

        <!-- 会员进度 -->
        <div class="card">
          <div class="card-title" style="margin-bottom:16px;">会员等级进度</div>
          <div class="member-progress">
            <div class="progress-labels">
              <span class="progress-label">一阶</span>
              <span class="progress-label">1级IT会员</span>
              <span class="progress-label">2级</span>
              <span class="progress-label">3级</span>
              <span class="progress-label">4级</span>
            </div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill" id="progressBarFill2"></div>
            </div>
            <div class="progress-text" id="progressText2" style="margin-top:4px;font-size:12px;color:var(--text-dim);">-</div>
          </div>
        </div>
      </div>

      <!-- ========== 活动广场 /activity ========== -->
      <div class="page-container" data-page="/activity" style="display:none;" id="pageActivity">
        <div class="page-header">
          <div class="page-title-group">
            <h2>活动广场</h2>
            <p>抽奖、补贴、优惠券等活动</p>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card" style="cursor:pointer;border-color:rgba(255,213,79,0.35);" id="btnWheelLottery">
            <div class="stat-label">🎡 转盘抽奖</div>
            <div class="stat-value" style="font-size:14px;color:var(--brand-gold);">参与抽奖赢折扣</div>
            <div class="stat-change" style="color:var(--brand-gold);">立即参与 →</div>
          </div>
          <div class="stat-card" style="cursor:pointer;border-color:rgba(255,213,79,0.35);" id="btnLotteryOpen">
            <div class="stat-label">🎴 翻翻乐</div>
            <div class="stat-value" style="font-size:14px;color:var(--brand-gold);">翻牌赢取折扣</div>
            <div class="stat-change" style="color:var(--brand-gold);">立即参与 →</div>
          </div>
          <div class="stat-card" style="cursor:pointer;border-color:rgba(255,112,67,0.35);" id="btnElectricActivity">
            <div class="stat-label">🎁 电器补贴（≥3000元）</div>
            <div class="stat-value" style="font-size:14px;color:#ff8a65;">大额电器专属补贴</div>
            <div class="stat-change" style="color:#ff8a65;">立即申请 →</div>
          </div>
          <div class="stat-card" style="cursor:pointer;border-color:rgba(102,126,234,0.35);" id="btnJITVip">
            <div class="stat-label">🎟️ JIT级别会员优惠券</div>
            <div class="stat-value" style="font-size:14px;color:var(--accent);">会员专享优惠</div>
            <div class="stat-change" style="color:var(--accent);">查看详情 →</div>
          </div>
        </div>
      </div>

      <!-- ========== 邀请与农场 /invite ========== -->
      <div class="page-container" data-page="/invite" style="display:none;" id="pageInvite">
        <div class="page-header">
          <div class="page-title-group">
            <h2>邀请与农场</h2>
            <p>邀请好友得积分，经营我的农场</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary btn-sm" id="btnInvite">📨 邀请好友</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">已邀请好友</div>
            <div class="stat-value gold" id="referralCount">-</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">邀请获得积分</div>
            <div class="stat-value gold" id="referralPoints">-</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title" style="margin-bottom:14px;">已邀请好友列表</div>
          <div id="referralList" style="min-height:40px;color:var(--text-dim);">邀请好友后显示在这里</div>
        </div>

        <!-- 快捷链接 -->
        <div class="card" style="cursor:pointer;border-color:rgba(139,195,74,0.35);">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font-weight:650;color:#8bc34a;margin-bottom:4px;">🌾 我的农场</div>
              <div style="font-size:12px;color:var(--text-dim);">经营农场，获取更多积分奖励</div>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="window.location.href=\'/farm\'">进入农场 →</button>
          </div>
        </div>
      </div>

      <!-- ========== 社区 /community ========== -->
      <div class="page-container" data-page="/community" style="display:none;" id="pageCommunity">
        <div class="page-header">
          <div class="page-title-group">
            <h2>社区</h2>
            <p>鱼果社区 - 个人主页</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary btn-sm" id="btnCommunityEnter" onclick="window.location.href=\'community.html\'">进入社区 →</button>
          </div>
        </div>
        <div class="card" style="text-align:center;padding:48px;">
          <div style="font-size:48px;margin-bottom:16px;">🏘️</div>
          <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">鱼果社区</div>
          <p style="color:var(--text-dim);font-size:13px;margin-bottom:20px;">查看社区动态、发表评论、与好友互动</p>
          <button class="btn btn-primary" onclick="window.location.href='community.html'">打开社区页面</button>
        </div>
      </div>

      <!-- ========== 个人设置 /profile ========== -->
      <div class="page-container" data-page="/profile" style="display:none;" id="pageProfile">
        <div class="page-header">
          <div class="page-title-group">
            <h2>个人设置</h2>
            <p>账号信息与安全设置</p>
          </div>
        </div>

        <div class="card" style="text-align:center;padding:32px;">
          <div class="sidebar-user-avatar" id="profileAvatar" style="width:64px;height:64px;font-size:24px;margin:0 auto 16px;">用</div>
          <div style="font-size:18px;font-weight:650;color:var(--text-primary);margin-bottom:4px;" id="profileName">-</div>
          <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;" id="profileRealName">真实姓名: -</div>
          <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;" id="profileDianpu">店铺: -</div>
          <div class="member-level-badge" id="profileLevel">-</div>
          <div style="margin-top:20px;display:flex;justify-content:center;gap:10px;">
            <button class="btn btn-secondary" id="btnUserCenter">👤 鱼果社区</button>
            <button class="btn btn-danger" id="btnLogout">
              {svg_icons["log_out"]} <span id="logoutUserText">退出登录</span>
            </button>
          </div>
        </div>
      </div>
    </div>'''

# 旧按钮代理（隐藏，供 app.js 兼容）
hidden_buttons = '''
  <!-- Old button proxies for app.js compatibility (hidden) -->
  <div style="display:none;">
    <button id="btnCustomerService">客服</button>
    <button id="btnWheelClose"></button>
    <button id="btnWheelSpin"><span id="wheelSpinText"></span></button>
    <button id="wheelFreeBadge"><span id="wheelFreeCount"></span></button>
    <button id="btnSlotClose"></button>
    <button id="btnSlotSpin"></button>
    <button id="btnLotteryClose"></button>
    <button id="btnEnableLucky"></button>
    <button id="btnInviteClose"></button>
    <button id="btnCopyInvite"></button>
    <button id="btnModalClose"></button>
    <button id="btnElectricModalClose"></button>
    <button id="btnOnlineModalClose"></button>
    <button id="btnClearSignature"></button>
    <button id="btnElectricClearSignature"></button>
    <button id="btnOnlineClearSignature"></button>
    <button id="btnGetLocation"></button>
    <button id="btnPointsHistoryClose"></button>
    <button id="btnNotificationClose"></button>
    <button id="btnNotifDetailClose"></button>
    <button id="btnSendNotifReply"></button>
    <button id="btnUrgentApplyClose"></button>
    <button id="btnUrgentApplyCancel"></button>
    <button id="btnUrgentApplyConfirm"></button>
    <button id="btnJumpElectric"></button>
    <span id="urgentReasonCount"></span>
    <input type="text" id="inviteLinkInput">
    <textarea id="inputUrgentReason"></textarea>
    <input type="hidden" id="inputLatitude">
    <input type="hidden" id="inputLongitude">
  </div>'''

# Overlays - 保留所有原始 overlay
# 查找所有 overlay 区域
# 我们需要提取 body_inner 中从第一个 </div> 主容器结束到 <script 之间的所有 overlay

# 找到 content-wrapper 结束位置
main_end = body_inner.find('</main>')
main_container_end = body_inner.find('</div>', body_inner.find('</div>', main_end + 6) + 1)
overlay_start = body_inner.find('<div class="modal-overlay"')

# 提取所有 overlay（从第一个 overlay 到第一个 <script）
script_pos = body_inner.find('<script ', overlay_start if overlay_start > 0 else 0)
if script_pos < 0:
    script_pos = body_inner.find('<script>', overlay_start if overlay_start > 0 else 0)

if overlay_start > 0:
    overlays = body_inner[overlay_start:script_pos] if script_pos > 0 else body_inner[overlay_start:]
else:
    overlays = ""

# 提取原有的 script 标签
js_scripts = re.findall(r'<script src="[^"]+"></script>', old_html[body_start:])

# 准备新的 head（修改 CSS 引用）
head_content = old_html[:head_end]
# 替换 CSS 引用
head_content = head_content.replace(
    '<link rel="stylesheet" href="css/style.css?v=3.5.1">',
    '<link rel="stylesheet" href="css/style.css?v=4.0.0">\n<link rel="stylesheet" href="css/layout.css?v=4.0.0">'
)

# 构建新的 body
new_body = f'''<body>
{hidden_buttons}

<div class="app-shell">
{sidebar_html}
  <div class="main-area">
{topbar_html}
{pages_html}
  </div>
</div>

{overlays}

<div class="toast-container" id="toastContainer"></div>
<div class="version-watermark" id="versionWatermark">v4.0.0</div>

<script src="js/config.js?v=4.0.0"></script>
<script src="js/api.js?v=4.0.0"></script>
<script src="js/points.js?v=4.0.0"></script>
<script src="js/lottery.js?v=4.0.0"></script>
<script src="js/wheel.js?v=4.0.0"></script>
<script src="js/router.js?v=4.0.0"></script>
<script src="js/app.js?v=4.0.0"></script>
<script>
// 侧边栏折叠切换
(function() {{
  var sidebar = document.getElementById("sidebarV4");
  var toggleBtn = document.getElementById("btnToggleSidebar");
  var collapsed = localStorage.getItem("sidebarCollapsed") === "true";
  if (collapsed) sidebar.classList.add("collapsed");
  if (toggleBtn) {{
    toggleBtn.addEventListener("click", function() {{
      sidebar.classList.toggle("collapsed");
      localStorage.setItem("sidebarCollapsed", sidebar.classList.contains("collapsed"));
    }});
  }}
  // 通知徽章同步
  var badge = document.getElementById("notificationBadge");
  var topBadge = document.getElementById("topbarNotificationBadge");
  if (badge && topBadge) {{
    var obs = new MutationObserver(function() {{
      topBadge.textContent = badge.textContent;
      topBadge.style.display = badge.style.display;
    }});
    obs.observe(badge, {{ childList: true, characterData: true, subtree: true }});
    obs.observe(badge, {{ attributes: true, attributeFilter: ["style"] }});
  }}
}})();
</script>
</body>'''

# 构建完整 HTML
new_html = head_content + "\n" + new_body + "\n</html>"

# 写入
with open("work.html", "w", encoding="utf-8") as f:
    f.write(new_html)

print("✅ work.html v4.0 已生成")
print(f"   文件大小: {len(new_html)} 字符")