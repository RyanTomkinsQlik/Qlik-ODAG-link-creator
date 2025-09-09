@echo off
REM pm2-setup.bat - Setup ODAG service using PM2 instead of node-windows

echo ========================================
echo PM2 ODAG Service Setup
echo ========================================
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Running as Administrator... Good!
) else (
    echo ERROR: This script must be run as Administrator
    echo Right-click on this file and select "Run as administrator"
    pause
    exit /b 1
)

echo.
echo Installing PM2 (Process Manager 2)...
npm install -g pm2
if %errorLevel% neq 0 (
    echo Failed to install PM2
    pause
    exit /b 1
)

echo.
echo Installing PM2 Windows service...
npm install -g pm2-windows-service
if %errorLevel% neq 0 (
    echo Failed to install PM2 Windows service
    pause
    exit /b 1
)

echo.
echo Starting ODAG application with PM2...
pm2 start odag-link-creator.js --name "odag-service" --env production
if %errorLevel__ neq 0 (
    echo Failed to start application with PM2
    pause
    exit /b 1
)

echo.
echo Installing PM2 as Windows service...
pm2-service-install
if %errorLevel__ neq 0 (
    echo Failed to install PM2 service
    pause
    exit /b 1
)

echo.
echo Saving PM2 configuration...
pm2 save

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Your ODAG Link Creator is now running as a Windows service via PM2.
echo.
echo Web Interface: http://localhost:3000
echo.
echo PM2 Management Commands:
echo - Status: pm2 status
echo - Logs: pm2 logs odag-service
echo - Restart: pm2 restart odag-service
echo - Stop: pm2 stop odag-service
echo - Remove: pm2 delete odag-service
echo.
echo The service will automatically start when Windows boots.
echo.
pause