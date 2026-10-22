@echo off
title 9Router Server (Port 20128)
cd /d "%~dp0"
set PORT=20128
echo ===================================================
echo   Menjalankan 9Router Standalone Server Port 20128
echo   Akses: http://localhost:20128
echo ===================================================
node .next/standalone/server.js
pause
