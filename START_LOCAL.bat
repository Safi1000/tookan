@echo off
echo ====================================================================
echo Starting Turbo Bahrain Project - Local Testing Environment
echo ====================================================================
echo.
echo Backend Server: http://localhost:3001
echo Frontend Server: http://localhost:3000
echo.
echo All operations will be logged to the terminal windows
echo If creating test data, add *test* to the name
echo.
echo ====================================================================
echo.

start "Backend Server (Port 3001)" cmd /k "echo Backend Server Starting... && echo All operations logged here && echo. && node server/index.js"

timeout /t 3 /nobreak >nul

start "Frontend Server (Port 3000)" cmd /k "echo Frontend Dev Server Starting... && echo Available at http://localhost:3000 && echo. && npm run dev"

timeout /t 10 /nobreak >nul

echo.
echo ====================================================================
echo Testing Analytics and Records Endpoints...
echo ====================================================================
echo.

node test-analytics-records.js

echo.
echo ====================================================================
echo Setup Complete!
echo Open http://localhost:3000 in your browser
echo ====================================================================
echo.
pause

