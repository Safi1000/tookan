# Start Local Testing Environment
# This script starts both backend and frontend servers with logging

Write-Host "🚀 Starting Turbo Bahrain Project - Local Testing Environment" -ForegroundColor Cyan
Write-Host "=" -NoNewline; Write-Host ("=" * 70) -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (-not (Test-Path .env)) {
    Write-Host "❌ Error: .env file not found!" -ForegroundColor Red
    Write-Host "   Please create .env file with TOOKAN_API_KEY" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ .env file found" -ForegroundColor Green
Write-Host ""

# Start Backend Server
Write-Host "📡 Starting Backend Server (Port 3001)..." -ForegroundColor Yellow
Write-Host "   All backend operations will be logged to this terminal" -ForegroundColor Gray
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; Write-Host '📡 Backend Server - Port 3001' -ForegroundColor Green; Write-Host '📝 All operations logged below' -ForegroundColor Yellow; Write-Host ''; node server/index.js"

# Wait a bit for backend to start
Start-Sleep -Seconds 3

# Start Frontend Server
Write-Host "🌐 Starting Frontend Dev Server (Port 3000)..." -ForegroundColor Yellow
Write-Host "   Frontend will be available at http://localhost:3000" -ForegroundColor Gray
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; Write-Host '🌐 Frontend Dev Server - Port 3000' -ForegroundColor Green; Write-Host '📝 Available at http://localhost:3000' -ForegroundColor Yellow; Write-Host ''; npm run dev"

Write-Host ""
Write-Host "✅ Servers starting in separate windows..." -ForegroundColor Green
Write-Host ""
Write-Host "📋 Servers:" -ForegroundColor Cyan
Write-Host "   Backend:  http://localhost:3001" -ForegroundColor White
Write-Host "   Frontend: http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "💡 Note: Check the server windows for detailed logs" -ForegroundColor Yellow
Write-Host "💡 If creating test data, add '*test*' to the name" -ForegroundColor Yellow
Write-Host ""
Write-Host "⏳ Waiting 10 seconds for servers to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

Write-Host ""
Write-Host "🧪 Running Analytics and Records Test..." -ForegroundColor Cyan
Write-Host "=" -NoNewline; Write-Host ("=" * 70) -ForegroundColor Cyan
Write-Host ""
node test-analytics-records.js

Write-Host ""
Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host "   Open http://localhost:3000 in your browser to view the application" -ForegroundColor White





