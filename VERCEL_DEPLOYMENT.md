# Vercel Deployment Guide

This guide walks you through deploying the Turbo Bahrain platform to Vercel.

## Prerequisites

- GitHub account (for connecting repository)
- Vercel account (free tier works)
- Your environment variables ready:
  - `TOOKAN_API_KEY`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Step 1: Push Code to GitHub

If not already on GitHub:

```bash
# Initialize git (if needed)
git init

# Add all files
git add .

# Commit
git commit -m "Turbo Bahrain - Ready for deployment"

# Add remote (replace with your repo URL)
git remote add origin https://github.com/YOUR_USERNAME/turbo-bahrain.git

# Push
git push -u origin main
```

## Step 2: Connect to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository
4. Select the repository from the list

## Step 3: Configure Project Settings

### Framework Preset
- Select: **Vite**

### Build & Output Settings
These should auto-detect from `vercel.json`:
- Build Command: `npm run build`
- Output Directory: `build`
- Install Command: `npm install`

### Root Directory
- Leave as `.` (project root)

## Step 4: Add Environment Variables

In the Vercel project settings, add these environment variables:

| Name | Value | Environment |
|------|-------|-------------|
| `TOOKAN_API_KEY` | `5364638cf34a0d045853297a5f1525471be2c3fc29dc72385c1903c5` | Production, Preview, Development |
| `SUPABASE_URL` | `https://your-project.supabase.co` | Production, Preview, Development |
| `SUPABASE_ANON_KEY` | `eyJ...` | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Production, Preview, Development |
| `NODE_ENV` | `production` | Production |
| `JWT_SECRET` | `your-secure-jwt-secret` | Production, Preview, Development |

### How to Add:
1. Go to Project → Settings → Environment Variables
2. Add each variable with its value
3. Select which environments it applies to
4. Click Save

## Step 5: Deploy

1. Click **"Deploy"** button
2. Wait for build to complete (2-3 minutes)
3. Once deployed, you'll get a URL like: `https://turbo-bahrain-xxx.vercel.app`

## Step 6: Verify Deployment

### Test Health Endpoint
Visit: `https://your-domain.vercel.app/api/health`

Expected response:
```json
{
  "status": "success",
  "message": "Turbo Bahrain API is running",
  "timestamp": "2026-01-05T...",
  "environment": "production"
}
```

### Test Dashboard
Visit: `https://your-domain.vercel.app`

You should see the login page or dashboard.

## Step 7: Configure Webhooks in Tookan

After successful deployment, configure Tookan to send webhooks:

1. Login to Tookan Dashboard
2. Go to **Settings** → **Webhooks**
3. Add webhook URL: `https://your-domain.vercel.app/api/tookan/webhook`
4. Enable events:
   - Task Created
   - Task Updated
   - Task Completed
   - Task Status Changed
   - Task Assigned

## Serverless Limitations

The Vercel deployment runs as serverless functions with some limitations:

### Full Functionality
- ✅ Tookan API integration (fleets, customers, orders)
- ✅ Analytics and reports
- ✅ Webhook reception
- ✅ Customer wallet operations
- ✅ Driver wallet transactions

### Limited Functionality
- ⚠️ Long-running processes (webhooks process immediately, no retry queue)
- ⚠️ File-based storage (not available, must use Supabase)

### Not Available in Serverless
- ❌ Background job processing
- ❌ WebSocket connections

For full functionality, consider deploying to a VPS or using Vercel with a separate backend.

## Custom Domain

To add a custom domain:

1. Go to Project → Settings → Domains
2. Add your domain (e.g., `dashboard.turbobahrain.com`)
3. Follow DNS configuration instructions
4. SSL is automatically configured

## Troubleshooting

### Build Failed
- Check build logs in Vercel dashboard
- Ensure all dependencies are in `package.json`
- Verify environment variables are set

### API Returns 500
- Check function logs in Vercel dashboard
- Verify environment variables are correct
- Check Supabase connection

### Webhooks Not Received
- Verify webhook URL is correct in Tookan
- Check Vercel function logs for errors
- Test webhook manually using `curl`

### CORS Errors
- Headers are configured in `vercel.json`
- If issues persist, check browser console for specific errors

## Alternative: Full Backend Deployment

For production use with full functionality, consider:

1. **Vercel + Railway/Render**: Frontend on Vercel, backend on Railway
2. **VPS**: DigitalOcean, AWS EC2, or similar
3. **Docker**: Deploy containerized app to any cloud

The Express server at `server/index.js` includes all functionality and can be deployed separately.

## Updating the Deployment

After making changes:

```bash
git add .
git commit -m "Your changes"
git push
```

Vercel automatically deploys on push to main branch.

## Environment-Specific Builds

For different environments:

```bash
# Preview deployments (pull requests)
# Uses Preview environment variables

# Production deployments (main branch)
# Uses Production environment variables
```

---

## Quick Reference

| Item | Value |
|------|-------|
| Production URL | `https://your-project.vercel.app` |
| API Health Check | `https://your-project.vercel.app/api/health` |
| Webhook URL | `https://your-project.vercel.app/api/tookan/webhook` |
| Build Time | ~2-3 minutes |
| Region | Auto (or configure in settings) |

