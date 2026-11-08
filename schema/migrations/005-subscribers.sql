-- 阶段二C：邮件订阅（双 opt-in）
--
-- 双 opt-in 不是可选项：单 opt-in 的列表在欧盟（GDPR）与加拿大（CASL）都不能作为
-- 营销许可凭证，且容易被判为垃圾邮件发送源。确认后才置 confirmed。
--
-- ⚠️ D1 的 ALTER TABLE 不支持 ADD COLUMN IF NOT EXISTS，本文件只能执行一次。
--    全新安装请直接用 schema/bootstrap.sql。

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  lang TEXT DEFAULT 'en',
  source TEXT,
  ip TEXT,
  confirm_sent_at DATETIME,
  confirmed_at DATETIME,
  unsubscribed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_token ON subscribers(token);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
