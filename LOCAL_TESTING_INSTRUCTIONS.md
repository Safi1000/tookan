# Local Testing Instructions

## Quick Start

### Option 1: Use the Batch File (Recommended for Windows)
1. Double-click `START_LOCAL.bat`
2. This will start both backend and frontend servers in separate windows
3. Wait for servers to initialize (about 10-15 seconds)
4. Open http://localhost:3000 in your browser

### Option 2: Manual Start

#### Terminal 1 - Backend Server
```powershell
npm run server
```
This starts the backend on port 3001. All operations are logged to this terminal.

#### Terminal 2 - Frontend Server
```powershell
npm run dev
```
This starts the frontend on port 3000.

#### Terminal 3 - Run Tests (Optional)
```powershell
node test-analytics-records.js
```

## Testing Analytics and Records

The system has been set up to test records and analytics with the new API key.

### Endpoints Being Tested:
1. **Analytics Endpoint**: `/api/reports/analytics`
   - Fetches analytics data (KPIs, COD status, order volume, driver performance)
   - Requires authentication

2. **Reports Summary**: `/api/reports/summary`
   - Fetches aggregated reports data
   - Requires authentication

3. **Daily Reports**: `/api/reports/daily`
   - Exports daily reports
   - Requires authentication

4. **Orders Endpoint**: `/api/tookan/orders`
   - Fetches order records
   - Requires authentication

### Important Notes:

1. **Authentication Required**: Most endpoints require authentication. You'll need to:
   - Open the frontend at http://localhost:3000
   - Login with your credentials
   - The frontend will handle authentication automatically

2. **Test Data Naming**: When creating any new entries (orders, drivers, customers, etc.) during testing, **add `*test*` to the name** to identify test data.

3. **Logging**: All operations are logged to the terminal windows:
   - Backend operations are logged in the backend server window
   - API calls, database operations, and errors are all visible

4. **API Key**: The system uses the TOOKAN_API_KEY from your `.env` file. Make sure it's set correctly.

## Viewing the Application

1. Open http://localhost:3000 in your browser
2. Login with your credentials
3. Navigate to:
   - **Dashboard** - View analytics and KPIs
   - **Reports Panel** - View order records and analytics
   - **Financial Panel** - View financial data

## Checking Server Status

### Backend Health Check
```powershell
curl http://localhost:3001/api/health
```

Expected response:
```json
{"status":"ok","message":"API server is running"}
```

### Frontend
Open http://localhost:3000 - if the page loads, the frontend is running.

## Troubleshooting

### Port Already in Use
If port 3001 or 3000 is already in use:
```powershell
# Find process using port 3001
netstat -ano | findstr :3001

# Kill process (replace PID with actual process ID)
taskkill /PID <PID> /F
```

### API Key Issues
- Check that `.env` file exists in the project root
- Verify `TOOKAN_API_KEY` is set correctly
- Check backend server logs for API key errors

### Authentication Issues
- Make sure Supabase is configured in `.env`
- Check backend logs for authentication errors
- Verify user credentials are correct

## Test Script

Run the analytics test script:
```powershell
node test-analytics-records.js
```

This will test the endpoints and show detailed logs of what's happening.





