@echo off
title 9Router Proxy (v0.5.104)
set PORT=20128
set HOSTNAME=0.0.0.0
cd /d "%~dp0"
echo Starting 9Router on port 20128...
node .next/standalone/server.js
pause
