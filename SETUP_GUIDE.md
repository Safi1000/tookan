# Turbo Bahrain - Complete Setup Guide

## Prerequisites Checklist

- [x] Tookan API Key (provided)
- [ ] Supabase Project Created
- [ ] Supabase Credentials Added to `.env`
- [ ] Database Migrations Run
- [ ] COD Template Fields Configured in Tookan
- [ ] Webhooks Configured in Tookan

---

## Step 1: Configure Supabase Credentials

Your `.env` file has been created with placeholder values. Update it with your actual Supabase credentials:

### Getting Your Supabase Credentials

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project (or create one)
3. Go to **Settings > API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

### Update `.env` File

Edit the `.env` file in your project root and replace the placeholder values:

```env
SUPABASE_URL=https://your-actual-project.supabase.co
SUPABASE_ANON_KEY=eyJ...your-actual-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-actual-service-role-key
```

---

## Step 2: Run Database Migrations

### Option A: Using Supabase SQL Editor (Recommended)

1. Go to your Supabase project dashboard
2. Click **SQL Editor** in the sidebar
3. Run each migration file in order:

**Migration 1: Initial Schema**
- Copy contents from `server/db/migrations/001_initial_schema.sql`
- Paste into SQL Editor and click **Run**

**Migration 2: RLS Policies** (Optional - for production security)
- Copy contents from `server/db/migrations/002_rls_policies.sql`
- Paste into SQL Editor and click **Run**

**Migration 3: Users Table Setup**
- Copy contents from `server/db/migrations/003_users_table_setup.sql`
- Paste into SQL Editor and click **Run**

### Option B: Using Test Script

After updating your `.env` file:

```bash
npm install
node server/db/test-connection.js
```

---

## Step 3: Test the Connection

Run the connection test:

```bash
node server/db/test-connection.js
```

Expected output:
```
✅ Supabase connection successful!
✅ Database tables exist
```

---

## Step 4: Configure COD Template Fields in Tookan

This is **critical** for COD tracking to work properly.

### Login to Tookan Dashboard

1. Go to https://app.tookanapp.com
2. Login with:
   - Email: ahmedhassan123.ah83@gmail.com
   - Password: A*123321*a

### Create/Edit Task Template

1. Go to **Settings** (gear icon) > **Task Template**
2. Click **Add Template** or edit an existing template
3. Add these custom fields:

| Field Label | Field Type | Field Name (slug) |
|-------------|------------|-------------------|
| COD Amount | Number | `cod_amount` |
| COD Collected | Checkbox | `cod_collected` |

4. Save the template

### Alternative: Use Built-in Order Payment

If you prefer, you can use Tookan's built-in `order_payment` field instead of custom fields. The system already supports both approaches.

---

## Step 5: Start the Application

### Development Mode

Terminal 1 - Start Backend:
```bash
npm run server
```

Terminal 2 - Start Frontend:
```bash
npm run dev
```

Or both together:
```bash
npm run dev:all
```

### Access the Dashboard

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

---

## Step 6: Verify Tookan Integration

### Test API Connection

Run the Tookan API test:

```bash
node test-tookan-integration.js
```

This will:
- Test fetching fleets (drivers)
- Test fetching customers
- Test fetching tasks
- Verify your API key works

---

## Next Steps (After Local Testing)

### Deploy to Vercel

1. Push code to GitHub
2. Connect repo to Vercel
3. Add environment variables in Vercel dashboard:
   - `TOOKAN_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NODE_ENV=production`

### Configure Webhooks

After deployment, configure webhooks in Tookan:

1. Go to Tookan Dashboard > **Settings** > **Webhooks**
2. Add webhook URL: `https://your-domain.vercel.app/api/tookan/webhook`
3. Enable events:
   - Task Created
   - Task Updated
   - Task Completed
   - Task Status Changed

---

## Troubleshooting

### "TOOKAN_API_KEY not configured"
- Ensure `.env` file exists in project root
- Restart the server after changing `.env`

### "Supabase connection failed"
- Check your SUPABASE_URL and keys are correct
- Ensure your Supabase project is active

### "COD data not syncing"
- Verify COD template fields are configured in Tookan
- Check webhook URL is accessible (for production)

### "Permission denied"
- Run database migrations including RLS policies
- Ensure user has correct role in database

---

## Support

For issues with:
- **Tookan API**: https://help.jungleworks.com/
- **Supabase**: https://supabase.com/docs


