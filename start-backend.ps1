# Backend Server Startup Script
# Run this script to start the backend server

Write-Host "🚀 Starting Backend Server..." -ForegroundColor Green
Write-Host ""

# Navigate to server directory
$serverPath = Join-Path $PSScriptRoot "server"
Set-Location $serverPath

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "⚠️  WARNING: .env file not found!" -ForegroundColor Yellow
    Write-Host "   Creating .env template..." -ForegroundColor Yellow
    @"
TOOKAN_API_KEY=your_tookan_api_key_here
PORT=3001
"@ | Out-File -FilePath ".env" -Encoding utf8
    Write-Host "   Please edit server/.env and add your TOOKAN_API_KEY" -ForegroundColor Yellow
    Write-Host ""
}

# Check if port 3001 is in use
$portInUse = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "⚠️  WARNING: Port 3001 is already in use!" -ForegroundColor Yellow
    Write-Host "   Process ID: $($portInUse.OwningProcess)" -ForegroundColor Yellow
    Write-Host "   You may need to stop the process first:" -ForegroundColor Yellow
    Write-Host "   Stop-Process -Id $($portInUse.OwningProcess) -Force" -ForegroundColor Cyan
    Write-Host ""
    $response = Read-Host "Do you want to stop the process and continue? (y/n)"
    if ($response -eq 'y' -or $response -eq 'Y') {
        Stop-Process -Id $portInUse.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Write-Host "✅ Process stopped" -ForegroundColor Green
    } else {
        Write-Host "❌ Cancelled. Please free port 3001 manually." -ForegroundColor Red
        exit 1
    }
}

Write-Host "Starting server on port 3001..." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Start the server
node index.js

