-- ============================================================
-- migrations/001_security_hardening_phase2.sql
-- 目标库：Turso / libSQL（SQLite 语法）
-- 基于 main@678977a（已完成的一轮加固）继续补的数据库侧改动。
--
-- 执行前请备份：turso db dump <db> > backup.sql
-- ============================================================

-- ------------------------------------------------------------------
-- 1) 账本幂等：给 ledger.biz_no 加唯一索引
--
-- 现状：幂等只靠应用层 `WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE biz_no=?)`。
--      在并发下两条请求可能同时看到“不存在”，从而写出两笔同号流水
--      （重复加分 / 重复扣分）。唯一索引是最后一道物理锁。
--
-- 第一步先体检，确认没有历史重复：
--   SELECT biz_no, COUNT(*) AS c FROM ledger
--     WHERE biz_no IS NOT NULL AND biz_no <> ''
--     GROUP BY biz_no HAVING c > 1 ORDER BY c DESC LIMIT 50;
-- ------------------------------------------------------------------

-- 1.1 去重：每个 biz_no 只保留最早一条（⚠️ 会删数据，务必先备份并确认体检结果）
DELETE FROM ledger
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM ledger
  WHERE biz_no IS NOT NULL AND biz_no <> ''
  GROUP BY biz_no
)
AND biz_no IS NOT NULL AND biz_no <> '';

-- 1.2 去重后回算余额
-- ledger 是权威账本，users.points 是派生缓存。删掉重复流水后如果不回算，
-- 会出现“账本已去重、余额仍保留重复加分”的资损差异，且后续对账永远不平。
UPDATE users
SET points = MAX(0, (
  SELECT COALESCE(SUM(amount), 0) FROM ledger WHERE ledger.user_id = users.id
));

-- 1.3 建唯一索引（部分索引，排除历史空单号）
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_biz_no
  ON ledger(biz_no) WHERE biz_no IS NOT NULL AND biz_no <> '';

-- 1.4 账务查询索引（余额与日限统计都按 user_id + 时间扫描）
CREATE INDEX IF NOT EXISTS ix_ledger_user_time ON ledger(user_id, created_at);

-- ------------------------------------------------------------------
-- 2) 跨实例限流表（security/core.js 的 isRateLimited 依赖它）
--    Val.town 多实例/冷启动会让进程内计数器归零，所以计数必须落库。
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- ------------------------------------------------------------------
-- 3) 审计检索索引（安全事件回溯依赖它，目前在 audit_logs 上无索引）
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_logs(action, created_at);

-- ------------------------------------------------------------------
-- 说明：以下项本轮【不改】，避免与已有逻辑冲突
--   - sessions：现有实现用 DELETE 回收会话，不引入 revoked_at 列；
--   - email_bindings：现有实现已在 users/registrations 侧做邮箱占用校验，
--     唯一索引可能因历史脏数据导致迁移失败，故留到数据清洗后再加；
--   - oauth_tokens：现有实现已在换绑/改密时批量删除，暂不引入 used_at。
-- ------------------------------------------------------------------
