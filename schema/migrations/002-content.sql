-- 阶段一B：内容模块（新闻 / 案例 / 资质 / 品牌 / FAQ / 工厂实力）
-- 全部使用 CREATE TABLE IF NOT EXISTS，可重复执行。
-- 用法： wrangler d1 execute b2b_database --remote --file=./schema/migrations/002-content.sql

PRAGMA foreign_keys = ON;

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
