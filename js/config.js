// ============================================================
// 玉国金融 - 配置文件（Worker + D1 版本）
// 所有敏感数据已迁移到 Cloudflare D1 数据库
// 前端只保留 Worker 连接信息
// ============================================================

const CONFIG = {
  WORKER_URL: 'https://floral-cake-1f5f.sgg12332108-825.workers.dev',
  AUTH_TOKEN: 'Jrb@025808'
};

const VERSION = '3.0.0';

// ============================================================
// D1 数据库 Schema SQL（首次运行时自动创建表）
// ============================================================
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
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
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS vouchers (
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
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS points_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT DEFAULT '',
    voucher_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    sender TEXT NOT NULL DEFAULT 'user',
    content TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    sender TEXT DEFAULT 'admin',
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    target_users TEXT DEFAULT 'all',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS notification_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id TEXT NOT NULL,
    username TEXT NOT NULL,
    message TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS blacklist (
    username TEXT PRIMARY KEY,
    reason TEXT DEFAULT '',
    time TEXT DEFAULT '',
    type TEXT DEFAULT 'dynamic',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS urgent_blacklist (
    username TEXT PRIMARY KEY,
    reason TEXT DEFAULT '',
    from_time TEXT DEFAULT '',
    until TEXT DEFAULT 'permanent',
    operator TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS registrations (
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
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS whitelist (
    username TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sys_config (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vouchers_user_id ON vouchers(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status)`,
  `CREATE INDEX IF NOT EXISTS idx_points_records_user_id ON points_records(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_is_read ON chat_messages(is_read)`,
  `CREATE INDEX IF NOT EXISTS idx_registrations_username ON registrations(username)`,
  `CREATE INDEX IF NOT EXISTS idx_registrations_review_status ON registrations(review_status)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)`,
  // 内置管理员
  `INSERT OR IGNORE INTO users (id, password_hash, full_name, review_status, points, is_admin)
   VALUES ('admin', '86e1df29a846be596ceb035cec48c0d536c5549aa367722febb77ddb4b9e2556', '管理员', 'approved', 0, 1)`,
  // 内置用户
  `INSERT OR IGNORE INTO users (id, password_hash, full_name, review_status, points)
   VALUES ('谭绣云', 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', '谭绣云', 'approved', 0)`,
  `INSERT OR IGNORE INTO users (id, password_hash, full_name, review_status, points)
   VALUES ('江睿博', 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', '江睿博', 'approved', 0)`
];

// ============================================================
// 用户密码（SHA-256 预计算，用于前端登录认证）
// ============================================================
const INITIAL_USERS = {
  'admin': '86e1df29a846be596ceb035cec48c0d536c5549aa367722febb77ddb4b9e2556',
  '谭绣云': 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
  '江睿博': 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3'
};

// ============================================================
// 业务常量
// ============================================================
const ITEMS_PER_PAGE = 50;
const DEFAULT_COUNTRY = 'CN';
const SUPPORTED_COUNTRIES = ['CN', 'US', 'JP', 'KR', 'GB', 'FR', 'DE', 'CA', 'AU', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID'];
const MAX_UPLOAD_SIZE_MB = 10;
const SIGN_IN_POINTS = 10;
const REGISTER_POINTS = 100;
const REFERRAL_POINTS = 50;
const MAX_DAILY_VOUCHERS = 5;
const MAX_SIGN_STREAK_BONUS = 5;