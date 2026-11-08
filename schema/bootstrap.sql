-- cf-b2b-pro 全新安装脚本（推荐：一次执行即可，替代 schema.sql + migrate.sql 的顺序依赖）
-- 用法：
--   wrangler d1 execute b2b_database --remote --file=./schema/bootstrap.sql
-- 特点：
--   1) 表结构已包含 migrate.sql 的全部新增列（slug / translations / brand / moq / seo_* / notes / mail_status ...）
--   2) 不写入任何默认管理员 —— 原版 admin123/staff 是公开口令且 role 写错会导致全站 403；
--      请用 `node scripts/reset-admin.mjs '<强密码>'` 生成你自己的 super_admin。
--   3) 只带 3 个示例产品（已带 slug），上线前请替换或删除。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  detailed_description TEXT,
  specifications TEXT,
  image_url TEXT,
  gallery_images TEXT,               -- JSON 数组字符串
  category TEXT,
  is_featured BOOLEAN DEFAULT 0,
  is_active BOOLEAN DEFAULT 1,
  -- 以下为 B2B / 多语言 / SEO 扩展列
  slug TEXT,
  translations TEXT,                 -- JSON: {"es":{"name":"...","description":"..."},"ar":{...}}
  brand TEXT,
  moq TEXT,
  seo_title TEXT,
  seo_description TEXT,
  -- 阶段一C：详情页说服力与资料下载
  video_url TEXT,
  applications TEXT,                 -- 应用场景，逗号或换行分隔
  customization TEXT,                -- 可定制项
  sample_policy TEXT,                -- 样品政策
  lead_time TEXT,                    -- 交货周期
  datasheet_url TEXT,                -- 规格书 / 图纸
  related_ids TEXT,                  -- JSON 数组，手工指定相关产品
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  country TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',     -- pending/processing/quoted/completed/won/lost/spam
  -- 轻 CRM + 邮件投递状态 + 合规
  notes TEXT,
  assignee TEXT,
  lang TEXT DEFAULT 'en',
  source TEXT,
  consent INTEGER DEFAULT 0,
  mail_status TEXT DEFAULT 'pending',-- pending/sent/failed
  mail_error TEXT,
  quoted_at DATETIME,
  -- 阶段一C：附件与来源归因
  attachment_url TEXT,
  attachment_name TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  landing_page TEXT,
  referrer TEXT,
  -- 阶段二A：轻 CRM
  customer_id INTEGER,
  priority TEXT DEFAULT 'warm',      -- hot / warm / cold
  next_follow_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,       -- pbkdf2$150000$salt$hash（兼容旧 sha256，登录后自动升级）
  email TEXT,
  role TEXT DEFAULT 'admin',         -- super_admin / admin
  last_login DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug) WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_product ON inquiries(product_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_mail ON inquiries(mail_status);
CREATE INDEX IF NOT EXISTS idx_inquiries_email ON inquiries(email);

-- 示例产品（含 slug，便于验证 SSR / sitemap / hreflang；上线前请替换）
INSERT OR IGNORE INTO products
  (id, name, slug, description, detailed_description, specifications, image_url, category, is_featured, is_active, moq, brand)
VALUES
  (1, 'Sample Industrial Pump', 'sample-industrial-pump',
   'High-quality industrial pump for continuous duty applications.',
   'Cast-iron body with stainless steel impeller, suitable for water treatment and chemical transfer.',
   'Material: Cast iron / SS304' || char(10) || 'Flow: 5-50 m3/h' || char(10) || 'Power: 1.5-15 kW',
   '/images/placeholder.svg', 'Industrial', 1, 1, '10 pcs', 'OEM'),
  (2, 'Sample Control Cabinet', 'sample-control-cabinet',
   'IP65 control cabinet with customizable PLC configuration.',
   'Custom wiring, CE marked components, supports Modbus / Profinet.',
   'Protection: IP65' || char(10) || 'Voltage: 380V' || char(10) || 'Certification: CE',
   '/images/placeholder.svg', 'Technology', 1, 1, '1 set', 'OEM'),
  (3, 'Sample Conveyor Belt', 'sample-conveyor-belt',
   'Modular conveyor belt for food-grade production lines.',
   'PP modular belt, easy to clean, supports 0-60 C working temperature.',
   'Width: 200-1200 mm' || char(10) || 'Material: PP / POM',
   '/images/placeholder.svg', 'Equipment', 0, 1, '50 m', 'OEM');


-- ===== 阶段一B 内容模块（与 schema/migrations/002-content.sql 保持一致）=====

-- 新闻 / 动态 / 展会
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,                          -- Markdown 子集（见 src/utils/markdown.js）
  cover_image TEXT,
  category TEXT DEFAULT 'news',           -- news / event / company
  translations TEXT,                      -- JSON: {"es":{"title":"..","excerpt":"..","content":".."}}
  seo_title TEXT,
  seo_description TEXT,
  is_published INTEGER DEFAULT 1,
  published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 客户案例（结构化，可关联产品）
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  country TEXT,
  industry TEXT,
  client_name TEXT,                       -- 建议脱敏，如 "European water utility"
  summary TEXT,
  content TEXT,
  cover_image TEXT,
  product_ids TEXT,                       -- JSON 数组 [1,2]
  translations TEXT,
  is_published INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 资质证书
CREATE TABLE IF NOT EXISTS certifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  issuer TEXT,
  cert_no TEXT,
  issued_at TEXT,                         -- YYYY-MM
  expires_at TEXT,
  image_url TEXT,
  file_url TEXT,                          -- PDF 下载
  translations TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 合作品牌
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  logo_url TEXT,
  website TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- FAQ（付款 / 物流 / 售后 / 定制）
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT DEFAULT 'general',        -- general / payment / shipping / after-sales / customization
  translations TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 工厂实力：设备 / 产能 / 质检流程
CREATE TABLE IF NOT EXISTS factory_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'equipment',          -- equipment / capacity / qc
  metric TEXT,                            -- "12,000 m²" / "300,000 units / year"
  description TEXT,
  image_url TEXT,
  translations TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_slug ON cases(slug);
CREATE INDEX IF NOT EXISTS idx_cases_published ON cases(is_published);

CREATE INDEX IF NOT EXISTS idx_certs_active ON certifications(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_brands_active ON brands(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_faqs_active ON faqs(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_factory_active ON factory_assets(is_active, sort_order);

-- 示例内容（便于验证前台渲染；上线前替换）
-- 注意：SQLite 不解析 '\n' 转义，换行必须用 char(10) 拼接，否则 Markdown 会渲染成一大段
INSERT OR IGNORE INTO posts (id, slug, title, excerpt, content, category, is_published, published_at)
VALUES
  (1, 'canton-fair-2026-autumn', 'Meet Us at Canton Fair 2026 Autumn',
   'Booth 12.2 C08 — we will showcase our new high-efficiency pump series and IIoT control cabinets.',
   'We are attending the 138th Canton Fair (Phase 1, Oct 15-19, 2026) at Booth 12.2 C08 in Guangzhou.'
     || char(10) || char(10) || '## What we are showing'
     || char(10) || char(10) || '- High-efficiency centrifugal pumps with IE4 motors'
     || char(10) || '- IP65 PLC control cabinets with remote monitoring'
     || char(10) || '- Custom stainless steel skids for chemical dosing'
     || char(10) || char(10) || '## Book a meeting'
     || char(10) || char(10) || 'Email sales@example.com with your preferred time slot and we will reserve a **30-minute session**. Bring your drawing or sample and our engineer will quote on the spot.',
   'event', 1, '2026-10-01 09:00:00'),
  (2, 'new-qc-lab-2026', 'New In-House QC Lab Put Into Operation',
   'Hydrostatic testing, spectrometer analysis and 72-hour continuous running tests are now done in-house.',
   'We invested USD 450,000 in a new quality control laboratory covering 600 m2.'
     || char(10) || char(10) || '## New capabilities'
     || char(10) || char(10) || '- Hydrostatic pressure test up to 6.4 MPa'
     || char(10) || '- Spectrometer material verification for every incoming batch'
     || char(10) || '- 72-hour continuous duty running test'
     || char(10) || '- Vibration and noise measurement to ISO 10816'
     || char(10) || char(10) || 'This shortens sample lead time from 15 days to **7 days** and removes third-party lab dependency.',
   'company', 1, '2026-08-12 09:00:00');

INSERT OR IGNORE INTO certifications (id, name, issuer, cert_no, issued_at, image_url, sort_order)
VALUES
  (1, 'ISO 9001:2015', 'TÜV Rheinland', '01100Q30012R0M', '2024-05', '/images/placeholder.svg', 1),
  (2, 'CE - Machinery Directive', 'SGS', 'CE-2024-8812', '2024-06', '/images/placeholder.svg', 2),
  (3, 'RoHS Compliance', 'Intertek', 'RoHS-2025-0917', '2025-09', '/images/placeholder.svg', 3);

INSERT OR IGNORE INTO brands (id, name, website, sort_order)
VALUES
  (1, 'Siemens', 'https://www.siemens.com', 1),
  (2, 'Schneider Electric', 'https://www.se.com', 2),
  (3, 'ABB', 'https://new.abb.com', 3),
  (4, 'SKF', 'https://www.skf.com', 4);

INSERT OR IGNORE INTO faqs (id, question, answer, category, sort_order)
VALUES
  (1, 'What is your minimum order quantity (MOQ)?', 'Standard models start from 1 set for samples and 10 pcs for bulk orders. Customized configurations usually require 50 pcs. MOQ is shown on each product page.', 'general', 1),
  (2, 'How long is the lead time?', 'Samples: 7-10 working days. Bulk orders: 25-35 working days after deposit, depending on configuration and quantity.', 'shipping', 2),
  (3, 'What payment terms do you accept?', 'T/T 30% deposit + 70% before shipment; L/C at sight for orders above USD 50,000; PayPal for sample orders below USD 2,000.', 'payment', 3),
  (4, 'Do you provide OEM/ODM service?', 'Yes. We support custom nameplate, packaging, color, voltage/frequency and PLC logic. Send your drawing or sample and we will confirm feasibility within 3 working days.', 'customization', 4),
  (5, 'What is the warranty and after-sales policy?', '18 months from shipment or 12 months from commissioning, whichever comes first. Spare parts are available for 10 years. Remote diagnostics via video call is free.', 'after-sales', 5);

INSERT OR IGNORE INTO factory_assets (id, title, kind, metric, description, image_url, sort_order)
VALUES
  (1, 'CNC Machining Center', 'equipment', '18 sets', '5-axis CNC centers for impeller and casing machining, tolerance ±0.01 mm.', '/images/placeholder.svg', 1),
  (2, 'Annual Production Capacity', 'capacity', '300,000 units / year', 'Four assembly lines running two shifts, expandable to three shifts in peak season.', '/images/placeholder.svg', 2),
  (3, 'Incoming Material Inspection', 'qc', '100% batch', 'Spectrometer verification on every incoming steel batch; certificates archived for 5 years.', '/images/placeholder.svg', 3),
  (4, 'Final Performance Test', 'qc', '100% units', 'Every unit runs 30 minutes on the test bench; flow, head, power and vibration recorded.', '/images/placeholder.svg', 4);

-- ============================================================
-- 阶段二A：轻 CRM —— 客户档案 + 跟进记录 + 登录日志
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  country TEXT,
  website TEXT,
  level TEXT DEFAULT 'new',           -- new / lead / qualified / quote / negotiation / won / lost
  owner TEXT,
  tags TEXT,
  notes TEXT,
  source TEXT,
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
  type TEXT DEFAULT 'note',
  content TEXT NOT NULL,
  admin_user TEXT,
  due_at DATETIME,
  done_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activities_inquiry ON activities(inquiry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_customer ON activities(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_due ON activities(due_at) WHERE due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inquiries_priority ON inquiries(priority);
CREATE INDEX IF NOT EXISTS idx_inquiries_next_follow ON inquiries(next_follow_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_customer ON inquiries(customer_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_utm_source ON inquiries(utm_source);
CREATE INDEX IF NOT EXISTS idx_inquiries_created_status ON inquiries(created_at DESC, status);

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

-- ============================================================
-- 阶段二C：邮件订阅（双 opt-in）
-- ============================================================
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL,               -- 确认/退订共用的签名 token
  status TEXT DEFAULT 'pending',     -- pending / confirmed / unsubscribed
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

-- ============================================================
-- 阶段三：交易（报价单 / 订单 / 客户门户）
-- ============================================================

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
