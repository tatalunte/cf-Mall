# B2B Product Exhibition Website

[English](README.md) | [简体中文](readme-cn.md)

A professional B2B product exhibition website built on Cloudflare Workers with D1 database, R2 storage, and role-based admin system.

## Features

### ✅ Frontend Website
1. **Home Page** - Company introduction and featured products showcase
2. **Products Page** - Product listing with category filtering and search
3. **Product Detail Page** - Detailed product information and inquiry form
4. **About Page** - Company introduction, history, and certifications
5. **Contact Page** - Contact information and online inquiry form
6. **Responsive Design** - Optimized for mobile, tablet, and desktop devices

### ✅ Admin Backend System
1. **Role-Based Access Control**
   - **Super Admin** - Full CRUD permissions (create, read, update, delete)
   - **Regular Admin** - Read-only access (view only)
2. **Admin Dashboard** - Statistical overview and data insights
3. **Product Management** - Product listing, editing, deletion, and creation
4. **Image Upload** - Support for uploading images to Cloudflare R2
5. **Inquiry Management** - View, process, and delete customer inquiries
6. **Website Settings** - Configure site information, contact details, and social media links (Super Admin only)

### ✅ Backend API
1. **Product API** - Complete CRUD operations (GET/POST/PUT/DELETE)
2. **Inquiry API** - Submit inquiries, query, and status updates
3. **Admin API** - Login authentication, token verification, role management
4. **Image Upload API** - Upload images to R2 storage
5. **Settings API** - Manage website configuration via KV storage

### ✅ Database Design
- **Products Table** - Product information storage
- **Inquiries Table** - Customer inquiry records
- **Admins Table** - Admin accounts with role-based permissions

## Tech Stack

- **Backend**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (Images), Cloudflare KV (Settings)
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Authentication**: JWT tokens with SHA-256 password hashing
- **Authorization**: Role-based access control (RBAC)

## Deployment Steps

### 1. Install Node.js

Before you begin, ensure Node.js is installed on your system (version 16 or higher recommended).

**Download and Install:**
- Visit [Node.js official website](https://nodejs.org/)
- Download the LTS (Long Term Support) version
- Run the installer and follow the installation wizard
- Verify installation:

```bash
node --version
npm --version
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create D1 Database

```bash
# Create database
wrangler d1 create b2b_database

# Note the database_id from output and update wrangler.toml
```

### 4. Update Configuration

Edit `wrangler.toml` and replace `database_id` with the actual ID from step 3:

```toml
[[d1_databases]]
binding = "DB"
database_name = "b2b_database"
database_id = "your-database-id"  # Replace this
```

### 5. Create R2 Storage Bucket (for image uploads)

```bash
# Create R2 bucket
wrangler r2 bucket create b2b-product-images
```

Confirm `wrangler.toml` has R2 configuration:

```toml
[[r2_buckets]]
binding = "IMAGES"
bucket_name = "b2b-product-images"
```

### 6. Create KV Namespace (for website settings)

```bash
# Create KV namespace for production
wrangler kv namespace create "STATIC_ASSETS"

# Create KV namespace for development (optional)
wrangler kv namespace create "STATIC_ASSETS" --preview
```

Update `wrangler.toml` with the KV namespace IDs:

```toml
[[kv_namespaces]]
binding = "STATIC_ASSETS"
id = "your-kv-namespace-id"  # Replace this
preview_id = "your-preview-kv-namespace-id"  # Optional, for local dev
```

### 7. Initialize Database

```bash
# Execute database schema
wrangler d1 execute b2b_database --file=./schema/schema.sql
```

This will create:
- Database tables (products, inquiries, admins)
- Two default admin accounts:
  - **Super Admin**: username `admin123`, password `admin123`
  - **Regular Admin**: username `staff`, password `staff123`
- Sample products for testing

### 8. Local Development

```bash
npm run dev
```

Visit http://localhost:8787 to test the website.

**Admin Login**: Access http://localhost:8787/admin to log in.

### 9. Deploy to Cloudflare

```bash
npm run deploy
```



## Admin Account Management

### Default Credentials

After initial setup, you'll have two admin accounts:

| Username | Password | Role | Permissions |
|----------|----------|------|-------------|
| admin123 | admin123 | Super Admin | Full CRUD access |
| staff    | staff123 | Regular Admin | Read-only access |

### Security Best Practices

🔐 **IMPORTANT**: Change default passwords immediately after first deployment!

#### 1. Generate New Password Hash

Use browser console to generate a new password hash:

```javascript
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate hash for your new password
hashPassword('your-new-secure-password').then(hash => console.log(hash));
```

#### 2. Update Password in Database

```sql
-- Update admin password
UPDATE admins
SET password_hash = 'your-generated-hash'
WHERE username = 'admin';
```

Execute via Wrangler CLI:
```bash
wrangler d1 execute b2b_database --command="UPDATE admins SET password_hash = 'your-hash' WHERE username = 'admin';"
```

Or via Cloudflare Dashboard Console.

#### 3. Configure JWT Secret

**Option A**: Using wrangler.toml (not recommended for production)
```toml
[vars]
JWT_SECRET = "your-very-secure-secret-key-change-this"
ENVIRONMENT = "production"
```

**Option B**: Using Cloudflare Dashboard Secrets (recommended)
```bash
wrangler secret put JWT_SECRET
# Enter your secret when prompted
```

## Usage Guide

### Frontend Features

1. **Browse Products**
   - Visit homepage to see featured products
   - Navigate to Products page to browse all products
   - Use category filters and search to find specific products

2. **Submit Product Inquiry**
   - Click "Send Inquiry" on product detail page
   - Fill out and submit the inquiry form
   - Or submit general inquiry via Contact page

### Admin Backend

1. **Login**
   - Visit `/admin` or `/admin/login`
   - Use your admin credentials

2. **Manage Products** (Super Admin only)
   - View all products
   - Edit product information
   - Upload product images (JPEG, PNG, GIF, WebP, max 5MB)
   - Delete unwanted products
   - Add new products

3. **Manage Inquiries**
   - View all customer inquiries (All admins)
   - View inquiry details (All admins)
   - Update inquiry status (All admins)
   - Delete processed inquiries (Super Admin only)

4. **Configure Settings** (Super Admin only)
   - Update website name and description
   - Edit company introduction
   - Modify contact information
   - Set social media links

## Project Structure

```
cf_b2b/
├── src/
│   ├── index.js              # Workers entry point
│   ├── api/
│   │   ├── router.js         # API routing
│   │   └── handlers/         # API handlers
│   │       ├── products.js   # Product API
│   │       ├── inquiries.js  # Inquiry API
│   │       ├── admin.js      # Admin API
│   │       ├── upload.js     # Image upload API
│   │       └── settings.js   # Settings API
│   ├── pages/
│   │   ├── router.js         # Page routing
│   │   ├── layout.js         # Page layout template
│   │   ├── home.js           # Homepage
│   │   ├── products.js       # Product listing page
│   │   ├── product-detail.js # Product detail page
│   │   ├── about.js          # About page
│   │   ├── contact.js        # Contact page
│   │   ├── admin-login.js    # Admin login page
│   │   ├── admin-dashboard.js# Admin dashboard
│   │   └── static.js         # Static asset handler
│   └── utils/
│       └── auth.js           # Authentication utilities
├── public/
│   ├── css/
│   │   └── main.css          # Main stylesheet
│   └── js/
│       ├── main.js           # Main JS file
│       └── admin.js          # Admin dashboard JS
├── schema/
│   ├── schema.sql            # Database schema
│   ├── init.sql              # Initialization script
├── package.json
├── wrangler.toml             # Cloudflare Workers config
├── README.md
└── DEPLOY.md
```

## Troubleshooting

### Common Issues

1. **Database Connection Error**
   - Verify `database_id` in wrangler.toml matches your D1 database
   - Ensure database schema has been initialized

2. **Image Upload Fails**
   - Confirm R2 bucket exists: `wrangler r2 bucket list`
   - Check R2 binding name in wrangler.toml matches "IMAGES"

3. **Settings Not Saving**
   - Ensure KV namespace is created and bound
   - Verify you're logged in as Super Admin
   - Check browser console for errors

4. **Login Issues**
   - Verify password hash is correct
   - Check JWT_SECRET is configured
   - Clear browser localStorage and try again

5. **Permission Denied Errors**
   - Confirm your admin role (super_admin vs admin)
   - Only super admins can create/update/delete
   - Regular admins have read-only access

## Next Steps & Optimization

1. 📧 **Email Notifications** - Send alerts for new inquiries
2. 🔍 **Enhanced Search** - Full-text search functionality
3. 📊 **Analytics Dashboard** - More detailed statistics and charts
4. 🌐 **Multi-language Support** - I18n for global audiences
5. 💾 **Data Export** - Export data to Excel/CSV
6. 🔔 **Real-time Notifications** - WebSocket-based notifications
7. 🖼️ **Image Optimization** - Auto-resize and compress images
8. 📱 **Mobile Admin App** - Native mobile admin interface

## Support

For issues and questions:
1. Check Wrangler CLI version: `wrangler --version`
2. Verify D1 database initialization
3. Review wrangler.toml configuration
4. Check browser console for errors
5. Review Cloudflare Workers logs

## License

MIT
