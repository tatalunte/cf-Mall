-- 阶段三：交易与自动化（报价单 / 订单 / 客户账号）
--
-- 设计取舍：
--  1. 金额全部存 REAL 而非分（整数）—— 外贸报价是展示单据，不参与账务对账，
--     按分存储反而会让运营在后台改价时反复换算、容易错。
--  2. 报价行与订单行快照 name/spec/unit_price，不回查 products：
--     产品改名或涨价后，历史单据必须仍显示成交时的样子（合规要求）。
--  3. 状态机只允许向前流转，非法迁移在 API 层拒绝并写 order_events。
--  4. 客户账号不存密码，只走邮箱魔法链接（一次性 token），
--     避免在多租户 SaaS 里承担口令泄漏责任。
--
-- ⚠️ D1 的 ALTER TABLE 不支持 ADD COLUMN IF NOT EXISTS，本文件只能执行一次。
--    全新安装请直接用 schema/bootstrap.sql。

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT UNIQUE,                 -- QT-20261108-0001
  inquiry_id INTEGER,
  customer_id INTEGER,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  customer_company TEXT,
  customer_country TEXT,
  currency TEXT DEFAULT 'USD',
  incoterm TEXT,                        -- EXW / FOB / CIF / DDP
  payment_terms TEXT,
  valid_until DATE,
  subtotal REAL DEFAULT 0,
  discount_type TEXT,                   -- percent / amount
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  shipping_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  status TEXT DEFAULT 'draft',           -- draft/sent/accepted/changes_requested/rejected/expired
  token TEXT UNIQUE,                    -- 客户查看/确认用的签名 token
  sent_at DATETIME,
  responded_at DATETIME,
  accepted_at DATETIME,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_no ON quotes(quote_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_token ON quotes(token);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_email ON quotes(customer_email);
CREATE INDEX IF NOT EXISTS idx_quotes_inquiry ON quotes(inquiry_id);

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  spec TEXT,
  qty REAL DEFAULT 1,
  unit TEXT DEFAULT 'pcs',
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id, sort_order);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE,                 -- SO-20261108-0001
  quote_id INTEGER,
  inquiry_id INTEGER,
  customer_id INTEGER,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  customer_company TEXT,
  customer_country TEXT,
  currency TEXT DEFAULT 'USD',
  total REAL DEFAULT 0,
  deposit_amount REAL DEFAULT 0,
  deposit_paid INTEGER DEFAULT 0,
  status TEXT DEFAULT 'placed',         -- placed/confirmed/in_production/ready/shipped/delivered/completed/cancelled
  payment_status TEXT DEFAULT 'unpaid', -- unpaid/deposit_paid/paid/refunded
  incoterm TEXT,
  payment_terms TEXT,
  carrier TEXT,
  tracking_no TEXT,
  tracking_url TEXT,
  ship_date DATE,
  eta DATE,
  notes TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_quote ON orders(quote_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  spec TEXT,
  qty REAL DEFAULT 1,
  unit TEXT DEFAULT 'pcs',
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id, sort_order);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  type TEXT,                            -- status / payment / shipping / note
  from_value TEXT,
  to_value TEXT,
  message TEXT,
  admin_user TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at DESC);

-- 客户自助门户：只认邮箱魔法链接，不存口令
CREATE TABLE IF NOT EXISTS customer_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  company TEXT,
  phone TEXT,
  country TEXT,
  lang TEXT DEFAULT 'en',
  status TEXT DEFAULT 'active',         -- active / blocked
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_email ON customer_accounts(email);

CREATE TABLE IF NOT EXISTS magic_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL,
  purpose TEXT DEFAULT 'login',         -- login / quote
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  ip TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_magic_tokens_token ON magic_tokens(token);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_email ON magic_tokens(email, created_at DESC);
