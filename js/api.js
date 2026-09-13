// ============================================================
// 玉国金融 - API 层（Worker + D1 版本）
// 通过 Cloudflare Worker 访问 D1 数据库
// ============================================================

const Api = {
  _initialized: false,

  async _send(sql, params = []) {
    const res = await fetch(CONFIG.WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': CONFIG.AUTH_TOKEN
      },
      body: JSON.stringify({ sql, params })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  async _query(sql, params = []) {
    const result = await this._send(sql, params);
    return result.results || [];
  },

  async _run(sql, params = []) {
    return this._send(sql, params);
  },

  async _getOne(sql, params = []) {
    const rows = await this._query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  },

  async _count(sql, params = []) {
    const row = await this._getOne(sql, params);
    return row ? (row.cnt || row.count || 0) : 0;
  },

  // ============================================================
  // 初始化：创建表结构和初始数据
  // ============================================================
  async init() {
    if (this._initialized) return;
    try {
      for (const sql of SCHEMA_SQL) {
        await this._run(sql);
      }
      this._initialized = true;
      console.log('[Api] D1 数据库初始化完成');
    } catch (e) {
      console.warn('[Api] 初始化警告:', e.message);
    }
  },

  // ============================================================
  // 图片上传
  // ============================================================
  async uploadImage(base64Data, folder) {
    const res = await fetch(CONFIG.WORKER_URL + '/upload-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': CONFIG.AUTH_TOKEN
      },
      body: JSON.stringify({ base64Data, folder })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  // ============================================================
  // 用户操作
  // ============================================================
  async getUser(username) {
    return this._getOne('SELECT * FROM users WHERE id = ?', [username]);
  },

  async getUserByHash(username, hash) {
    return this._getOne('SELECT * FROM users WHERE id = ? AND password_hash = ?', [username, hash]);
  },

  async createUser(username, hash, fullName, birthdate, country, province, city, referrer) {
    await this._run(
      `INSERT INTO users (id, password_hash, full_name, birthdate, country, province, city, referrer, review_status, points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
      [username, hash, fullName, birthdate, country, province, city, referrer]
    );
    return this.getUser(username);
  },

  async updateUser(username, fields) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClauses = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => fields[k]);
    values.push(username);
    await this._run(`UPDATE users SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`, values);
    return this.getUser(username);
  },

  async deleteUser(username) {
    await this._run('DELETE FROM users WHERE id = ?', [username]);
    await this._run('DELETE FROM vouchers WHERE user_id = ?', [username]);
    await this._run('DELETE FROM points_records WHERE user_id = ?', [username]);
    await this._run('DELETE FROM chat_messages WHERE user_id = ?', [username]);
  },

  async getAllUsers() {
    return this._query('SELECT * FROM users ORDER BY created_at DESC');
  },

  async getUsersByStatus(status) {
    return this._query('SELECT * FROM users WHERE review_status = ? ORDER BY created_at DESC', [status]);
  },

  async getUserCountByStatus(status) {
    return this._count('SELECT COUNT(*) as cnt FROM users WHERE review_status = ?', [status]);
  },

  async getUserVoucherCount(username) {
    return this._count('SELECT COUNT(*) as cnt FROM vouchers WHERE user_id = ?', [username]);
  },

  async freezeUser(username) {
    return this.updateUser(username, { frozen: 1 });
  },

  async unfreezeUser(username) {
    return this.updateUser(username, { frozen: 0 });
  },

  async getFrozenUsers() {
    return this._query('SELECT * FROM users WHERE frozen = 1');
  },

  // ============================================================
  // 注册申请
  // ============================================================
  async createRegistration(username, hash, fullName, birthdate, country, province, city, referrer) {
    const id = _generateId();
    await this._run(
      `INSERT INTO registrations (id, username, password_hash, full_name, birthdate, country, province, city, referrer, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [id, username, hash, fullName, birthdate, country, province, city, referrer]
    );
    return { id, username, review_status: 'pending' };
  },

  async getRegistration(username) {
    return this._getOne('SELECT * FROM registrations WHERE username = ?', [username]);
  },

  async getAllRegistrations() {
    return this._query('SELECT * FROM registrations ORDER BY created_at DESC');
  },

  async getRegistrationsByStatus(status) {
    return this._query('SELECT * FROM registrations WHERE review_status = ? ORDER BY created_at DESC', [status]);
  },

  async approveRegistration(username) {
    const reg = await this.getRegistration(username);
    if (!reg) throw new Error('申请不存在');
    await this._run(
      `INSERT OR REPLACE INTO users (id, password_hash, full_name, birthdate, country, province, city, referrer, review_status, points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
      [reg.username, reg.password_hash, reg.full_name, reg.birthdate, reg.country, reg.province, reg.city, reg.referrer, REGISTER_POINTS]
    );
    await this._run('UPDATE registrations SET review_status = ? WHERE username = ?', ['approved', username]);
    if (reg.referrer) {
      await this.addPointsRecord(reg.referrer, REFERRAL_POINTS, `推荐用户 ${username} 注册奖励`, null);
    }
    return this.getUser(username);
  },

  async rejectRegistration(username) {
    await this._run('UPDATE registrations SET review_status = ? WHERE username = ?', ['rejected', username]);
  },

  async deleteRegistration(username) {
    await this._run('DELETE FROM registrations WHERE username = ?', [username]);
  },

  // ============================================================
  // 凭证操作
  // ============================================================
  async createVoucher(data) {
    const id = _generateVId();
    const fields = [
      'id', 'user_id', 'order_type', 'shop_name', 'shop_photo', 'order_photos',
      'latitude', 'longitude', 'amount', 'discounted_amount', 'discount',
      'status', 'payment_status', 'payment_method', 'remark', 'signature',
      'platform', 'order_no', 'product_photo', 'shopping_photos',
      'electric_category', 'electric_brand', 'electric_apply_amount',
      'electric_subsidy_rate', 'electric_subsidy_amount',
      'is_urgent', 'urgent_reason', 'urgent_username', 'urgent_time'
    ];
    const values = fields.map(f => {
      if (f === 'id') return id;
      const key = f;
      const val = data[key];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return val;
    });
    const placeholders = fields.map(() => '?').join(', ');
    await this._run(
      `INSERT INTO vouchers (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );
    return this.getVoucher(id);
  },

  async getVoucher(id) {
    return this._getOne('SELECT * FROM vouchers WHERE id = ?', [id]);
  },

  async getVouchers(filters = {}) {
    let sql = 'SELECT * FROM vouchers WHERE 1=1';
    const params = [];
    if (filters.user_id) {
      sql += ' AND user_id = ?';
      params.push(filters.user_id);
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.payment_status) {
      sql += ' AND payment_status = ?';
      params.push(filters.payment_status);
    }
    if (filters.order_type) {
      sql += ' AND order_type = ?';
      params.push(filters.order_type);
    }
    if (filters.is_urgent !== undefined) {
      sql += ' AND is_urgent = ?';
      params.push(filters.is_urgent ? 1 : 0);
    }
    if (filters.search) {
      sql += ' AND (shop_name LIKE ? OR order_no LIKE ? OR platform LIKE ?)';
      const s = '%' + filters.search + '%';
      params.push(s, s, s);
    }
    sql += ' ORDER BY created_at DESC';
    const limit = filters.limit || 200;
    const offset = filters.offset || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return this._query(sql, params);
  },

  async updateVoucher(id, fields) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClauses = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => {
      const val = fields[k];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return val;
    });
    values.push(id);
    await this._run(`UPDATE vouchers SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`, values);
    return this.getVoucher(id);
  },

  async deleteVoucher(id) {
    await this._run('DELETE FROM vouchers WHERE id = ?', [id]);
  },

  async getVoucherCount(filters = {}) {
    let sql = 'SELECT COUNT(*) as cnt FROM vouchers WHERE 1=1';
    const params = [];
    if (filters.user_id) { sql += ' AND user_id = ?'; params.push(filters.user_id); }
    if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters.payment_status) { sql += ' AND payment_status = ?'; params.push(filters.payment_status); }
    return this._count(sql, params);
  },

  async getVoucherStats() {
    const stats = {};
    stats.total = await this._count('SELECT COUNT(*) as cnt FROM vouchers');
    stats.pending = await this._count("SELECT COUNT(*) as cnt FROM vouchers WHERE status = '待审核'");
    stats.approved = await this._count("SELECT COUNT(*) as cnt FROM vouchers WHERE status = '已通过'");
    stats.rejected = await this._count("SELECT COUNT(*) as cnt FROM vouchers WHERE status = '已拒绝'");
    stats.paid = await this._count("SELECT COUNT(*) as cnt FROM vouchers WHERE payment_status = '已支付'");
    stats.unpaid = await this._count("SELECT COUNT(*) as cnt FROM vouchers WHERE payment_status = '待支付'或 payment_status = ''");
    stats.urgent = await this._count('SELECT COUNT(*) as cnt FROM vouchers WHERE is_urgent = 1');
    const amtRow = await this._getOne('SELECT COALESCE(SUM(amount), 0) as total_amount FROM vouchers');
    stats.totalAmount = amtRow ? amtRow.total_amount : 0;
    return stats;
  },

  // ============================================================
  // 积分操作
  // ============================================================
  async getPointsRecords(userId, limit = 100) {
    return this._query(
      'SELECT * FROM points_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, limit]
    );
  },

  async addPointsRecord(userId, delta, reason, voucherId) {
    const id = _generateId();
    await this._run(
      'INSERT INTO points_records (id, user_id, delta, reason, voucher_id) VALUES (?, ?, ?, ?, ?)',
      [id, userId, delta, reason || '', voucherId || '']
    );
    await this._run(
      'UPDATE users SET points = points + ?, updated_at = datetime(\'now\') WHERE id = ?',
      [delta, userId]
    );
    return { id, user_id: userId, delta, reason, voucher_id: voucherId };
  },

  async getUserPoints(userId) {
    const user = await this.getUser(userId);
    return user ? user.points : 0;
  },

  async getTotalPointsIssued() {
    const row = await this._getOne(
      "SELECT COALESCE(SUM(delta), 0) as total FROM points_records WHERE delta > 0"
    );
    return row ? row.total : 0;
  },

  // ============================================================
  // 签到
  // ============================================================
  async signIn(username) {
    const user = await this.getUser(username);
    if (!user) throw new Error('用户不存在');
    const today = new Date().toISOString().split('T')[0];
    const signIns = JSON.parse(user.sign_ins || '[]');
    if (signIns.includes(today)) throw new Error('今日已签到');
    signIns.push(today);
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    let streakDays = user.streak_days || 0;
    if (signIns.includes(yesterday)) {
      streakDays += 1;
    } else {
      streakDays = 1;
    }
    const bonus = Math.min(Math.floor(streakDays / 7), MAX_SIGN_STREAK_BONUS);
    const points = SIGN_IN_POINTS + bonus;
    await this.updateUser(username, {
      sign_ins: JSON.stringify(signIns),
      last_sign_in: today,
      streak_days: streakDays
    });
    await this.addPointsRecord(username, points, `签到 (连续${streakDays}天) + ${points}`, null);
    return { points, streakDays, bonus };
  },

  async getTodaySignIn(username) {
    const user = await this.getUser(username);
    if (!user) return false;
    const today = new Date().toISOString().split('T')[0];
    const signIns = JSON.parse(user.sign_ins || '[]');
    return signIns.includes(today);
  },

  // ============================================================
  // 聊天消息
  // ============================================================
  async getChatMessages(userId, limit = 200) {
    return this._query(
      'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT ?',
      [userId, limit]
    );
  },

  async sendChatMessage(userId, sender, content, imageUrl) {
    await this._run(
      'INSERT INTO chat_messages (user_id, sender, content, image_url, is_read) VALUES (?, ?, ?, ?, 0)',
      [userId, sender, content || '', imageUrl || '']
    );
    return this._query(
      'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
  },

  async markChatRead(userId) {
    await this._run('UPDATE chat_messages SET is_read = 1 WHERE user_id = ? AND sender = ?', [userId, 'user']);
  },

  async getUnreadChatCount(userId) {
    return this._count(
      'SELECT COUNT(*) as cnt FROM chat_messages WHERE user_id = ? AND sender = ? AND is_read = 0',
      [userId, 'user']
    );
  },

  async getAllUnreadCounts() {
    const rows = await this._query(
      "SELECT user_id, COUNT(*) as cnt FROM chat_messages WHERE sender = 'user' AND is_read = 0 GROUP BY user_id"
    );
    const map = {};
    rows.forEach(r => { map[r.user_id] = r.cnt; });
    return map;
  },

  async getChatUsers() {
    return this._query("SELECT DISTINCT user_id FROM chat_messages WHERE sender = 'user'");
  },

  // ============================================================
  // 通知
  // ============================================================
  async getNotifications(filter = {}) {
    let sql = 'SELECT * FROM notifications WHERE 1=1';
    const params = [];
    if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
    sql += ' ORDER BY created_at DESC';
    return this._query(sql, params);
  },

  async getNotification(id) {
    return this._getOne('SELECT * FROM notifications WHERE id = ?', [id]);
  },

  async createNotification(sender, title, content, targetUsers) {
    const id = _generateId();
    await this._run(
      'INSERT INTO notifications (id, sender, title, content, target_users) VALUES (?, ?, ?, ?, ?)',
      [id, sender, title, content, targetUsers || 'all']
    );
    return { id, sender, title, content, target_users: targetUsers };
  },

  async deleteNotification(id) {
    await this._run('DELETE FROM notifications WHERE id = ?', [id]);
    await this._run('DELETE FROM notification_replies WHERE notification_id = ?', [id]);
  },

  async getNotificationReplies(notificationId) {
    return this._query(
      'SELECT * FROM notification_replies WHERE notification_id = ? ORDER BY created_at ASC',
      [notificationId]
    );
  },

  async addNotificationReply(notificationId, username, message) {
    await this._run(
      'INSERT INTO notification_replies (notification_id, username, message) VALUES (?, ?, ?)',
      [notificationId, username, message]
    );
    return { notification_id: notificationId, username, message };
  },

  // ============================================================
  // 黑名单
  // ============================================================
  async getBlacklist() {
    return this._query('SELECT * FROM blacklist ORDER BY created_at DESC');
  },

  async addToBlacklist(username, reason, type) {
    await this._run(
      'INSERT OR REPLACE INTO blacklist (username, reason, type, time) VALUES (?, ?, ?, datetime(\'now\'))',
      [username, reason || '', type || 'dynamic']
    );
  },

  async removeFromBlacklist(username) {
    await this._run('DELETE FROM blacklist WHERE username = ?', [username]);
  },

  async isBlacklisted(username) {
    const row = await this._getOne('SELECT * FROM blacklist WHERE username = ?', [username]);
    return !!row;
  },

  // ============================================================
  // 加急黑名单
  // ============================================================
  async getUrgentBlacklist() {
    return this._query('SELECT * FROM urgent_blacklist ORDER BY created_at DESC');
  },

  async getActiveUrgentBlacklist() {
    const now = datetime('now');
    return this._query(
      "SELECT * FROM urgent_blacklist WHERE until = 'permanent' OR until >= datetime('now')"
    );
  },

  async addToUrgentBlacklist(username, reason, fromTime, until, operator) {
    await this._run(
      'INSERT OR REPLACE INTO urgent_blacklist (username, reason, from_time, until, operator) VALUES (?, ?, ?, ?, ?)',
      [username, reason || '', fromTime || '', until || 'permanent', operator || 'admin']
    );
  },

  async removeFromUrgentBlacklist(username) {
    await this._run('DELETE FROM urgent_blacklist WHERE username = ?', [username]);
  },

  async isUrgentBlacklisted(username) {
    const row = await this._getOne(
      "SELECT * FROM urgent_blacklist WHERE username = ? AND (until = 'permanent' OR until >= datetime('now'))",
      [username]
    );
    return !!row;
  },

  // ============================================================
  // 白名单
  // ============================================================
  async getWhitelist() {
    return this._query('SELECT username FROM whitelist ORDER BY created_at DESC');
  },

  async addToWhitelist(username) {
    await this._run('INSERT OR IGNORE INTO whitelist (username) VALUES (?)', [username]);
  },

  async removeFromWhitelist(username) {
    await this._run('DELETE FROM whitelist WHERE username = ?', [username]);
  },

  async isWhitelisted(username) {
    const row = await this._getOne('SELECT * FROM whitelist WHERE username = ?', [username]);
    return !!row;
  },

  // ============================================================
  // 系统配置
  // ============================================================
  async getConfig(key) {
    const row = await this._getOne('SELECT value FROM sys_config WHERE key = ?', [key]);
    return row ? row.value : null;
  },

  async setConfig(key, value) {
    await this._run('INSERT OR REPLACE INTO sys_config (key, value) VALUES (?, ?)', [key, value]);
  },

  async getAllConfig() {
    const rows = await this._query('SELECT * FROM sys_config');
    const config = {};
    rows.forEach(r => { config[r.key] = r.value; });
    return config;
  },

  // ============================================================
  // 用户统计（管理后台用）
  // ============================================================
  async getUserStats(username) {
    const user = await this.getUser(username);
    if (!user) return null;
    const voucherCount = await this.getUserVoucherCount(username);
    const points = await this.getUserPoints(username);
    const pendingVouchers = await this._count(
      "SELECT COUNT(*) as cnt FROM vouchers WHERE user_id = ? AND status = '待审核'",
      [username]
    );
    const approvedVouchers = await this._count(
      "SELECT COUNT(*) as cnt FROM vouchers WHERE user_id = ? AND status = '已通过'",
      [username]
    );
    return { user, voucherCount, points, pendingVouchers, approvedVouchers };
  }
};

// ============================================================
// 工具函数
// ============================================================
function _generateId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
}

function _generateVId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'v_';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}