-- 阶段二A：轻 CRM —— 客户档案 + 跟进记录 + 意向分级 + 跟进提醒
--
-- ⚠️ D1 的 ALTER TABLE 不支持 ADD COLUMN IF NOT EXISTS，本文件只能执行一次。
--    全新安装请直接用 schema/bootstrap.sql（已包含这些列/表）。
--
-- 设计取舍：
--  * 不引入完整 CRM 的「商机/阶段/预测」概念——外贸 SOHO 与中小工厂用不上，
--    询盘本身就是商机。customers 只是「同一买家多次询盘」的聚合视图。
--  * activities 同时挂 inquiry_id 与 customer_id：一条跟进记录既能从询盘看，
--    也能从客户看。两者都为空时是纯备忘。
--  * 提醒用 next_follow_at（询盘上的绝对时间）+ Cron 汇总，不做复杂规则引擎。

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT,                       -- 公司名（可空，个人买家很多不填）
  email TEXT NOT NULL,
  phone TEXT,
  country TEXT,
  website TEXT,
  level TEXT DEFAULT 'new',           -- new / lead / qualified / quote / negotiation / won / lost
  owner TEXT,                         -- 负责人（admins.username）
  tags TEXT,                          -- JSON 数组，如 ["阿里巴巴","年采购100万"]
  notes TEXT,
  source TEXT,                        -- 首次来源（utm_source 或 'direct'）
  first_inquiry_at DATETIME,
  last_activity_at DATETIME,
  inquiry_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_level ON customers(level);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER,
  customer_id INTEGER,
  type TEXT DEFAULT 'note',           -- note / call / email / meeting / quote / status
  content TEXT NOT NULL,
  admin_user TEXT,
  due_at DATETIME,                    -- 这条跟进「下次该做什么」的时间（可空）
  done_at DATETIME,                   -- 完成时间；为空表示未完成
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activities_inquiry ON activities(inquiry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_customer ON activities(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_due ON activities(due_at) WHERE due_at IS NOT NULL;

-- 询盘补充：意向分级 / 归属客户 / 下次跟进时间
ALTER TABLE inquiries ADD COLUMN customer_id INTEGER;
ALTER TABLE inquiries ADD COLUMN priority TEXT DEFAULT 'warm';   -- hot / warm / cold
ALTER TABLE inquiries ADD COLUMN next_follow_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_inquiries_priority ON inquiries(priority);
CREATE INDEX IF NOT EXISTS idx_inquiries_next_follow ON inquiries(next_follow_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_customer ON inquiries(customer_id);

-- 登录日志（阶段二B 会用到，放这里一起建，避免二次迁移）
CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  ip TEXT,
  country TEXT,
  user_agent TEXT,
  ok INTEGER DEFAULT 0,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_logs_created ON login_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(username, created_at DESC);
