-- ============================================================
-- 玉国金融 Turso/libsql 数据库 Schema
-- 数据库: yuguojinrong-yuguo-yg-bit
-- 区域: aws-ap-northeast-1 (东京)
-- ============================================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  full_name TEXT DEFAULT '',
  birthdate TEXT DEFAULT '',
  country TEXT DEFAULT '',
  province TEXT DEFAULT '',
  city TEXT DEFAULT '',
  referrer TEXT DEFAULT '',
  review_status TEXT DEFAULT 'pending',
  points INTEGER DEFAULT 0,
  frozen INTEGER DEFAULT 0,
  sign_ins TEXT DEFAULT '[]',
  last_sign_in TEXT DEFAULT '',
  streak_days INTEGER DEFAULT 0,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);

-- 凭证表
CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  order_type TEXT DEFAULT '凭证',
  shop_name TEXT NOT NULL,
  shop_photo TEXT DEFAULT '',
  order_photos TEXT DEFAULT '[]',
  latitude TEXT DEFAULT '',
  longitude TEXT DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  discounted_amount REAL DEFAULT 0,
  discount TEXT DEFAULT '',
  status TEXT DEFAULT '待审核',
  payment_status TEXT DEFAULT '待支付',
  payment_method TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  signature TEXT DEFAULT '',
  reject_reason TEXT DEFAULT '',
  platform TEXT DEFAULT '',
  order_no TEXT DEFAULT '',
  product_photo TEXT DEFAULT '',
  shopping_photos TEXT DEFAULT '[]',
  electric_category TEXT DEFAULT '',
  electric_brand TEXT DEFAULT '',
  electric_apply_amount REAL DEFAULT 0,
  electric_subsidy_rate TEXT DEFAULT '',
  electric_subsidy_amount REAL DEFAULT 0,
  review_result TEXT DEFAULT '',
  final_price TEXT DEFAULT '',
  is_urgent INTEGER DEFAULT 0,
  urgent_reason TEXT DEFAULT '',
  urgent_username TEXT DEFAULT '',
  urgent_time TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);

-- 积分变动记录
CREATE TABLE IF NOT EXISTS points_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  voucher_id TEXT DEFAULT '',
  created_at TEXT DEFAULT ''
);

-- 聊天消息
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sender TEXT NOT NULL DEFAULT 'user',
  content TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  chat_mode TEXT DEFAULT 'ai',
  created_at TEXT DEFAULT ''
);

-- 通知
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  sender TEXT DEFAULT 'admin',
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  target_users TEXT DEFAULT 'all',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT ''
);

-- 通知回复
CREATE TABLE IF NOT EXISTS notification_replies (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  username TEXT NOT NULL,
  message TEXT DEFAULT '',
  created_at TEXT DEFAULT ''
);

-- 黑名单
CREATE TABLE IF NOT EXISTS blacklist (
  username TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  time TEXT DEFAULT '',
  type TEXT DEFAULT 'dynamic',
  created_at TEXT DEFAULT ''
);

-- 加急黑名单
CREATE TABLE IF NOT EXISTS urgent_blacklist (
  username TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  from_time TEXT DEFAULT '',
  until TEXT DEFAULT 'permanent',
  operator TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT ''
);

-- 注册申请
CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT DEFAULT '',
  birthdate TEXT DEFAULT '',
  country TEXT DEFAULT '',
  province TEXT DEFAULT '',
  city TEXT DEFAULT '',
  referrer TEXT DEFAULT '',
  review_status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT ''
);

-- 白名单
CREATE TABLE IF NOT EXISTS whitelist (
  username TEXT PRIMARY KEY,
  created_at TEXT DEFAULT ''
);

-- 系统配置
CREATE TABLE IF NOT EXISTS sys_config (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

-- ============================================================
-- 索引（提升查询效率）
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_review_status ON users(review_status);
CREATE INDEX IF NOT EXISTS idx_users_referrer ON users(referrer);
CREATE INDEX IF NOT EXISTS idx_vouchers_user_id ON vouchers(user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_created_at ON vouchers(created_at);
CREATE INDEX IF NOT EXISTS idx_vouchers_user_status ON vouchers(user_id, status);
CREATE INDEX IF NOT EXISTS idx_points_records_user_id ON points_records(user_id);
CREATE INDEX IF NOT EXISTS idx_points_records_created_at ON points_records(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_is_read ON chat_messages(is_read);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_registrations_username ON registrations(username);
CREATE INDEX IF NOT EXISTS idx_registrations_review_status ON registrations(review_status);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- ============================================================
-- 初始数据
-- ============================================================
INSERT OR IGNORE INTO users (id, password_hash, full_name, review_status, points, is_admin)
VALUES ('admin', '86e1df29a846be596ceb035cec48c0d536c5549aa367722febb77ddb4b9e2556', '管理员', 'approved', 0, 1);

INSERT OR IGNORE INTO users (id, password_hash, full_name, review_status, points)
VALUES ('谭绣云', 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', '谭绣云', 'approved', 0);

INSERT OR IGNORE INTO users (id, password_hash, full_name, review_status, points)
VALUES ('江睿博', 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', '江睿博', 'approved', 0);