@echo off
setlocal
title Avoid N Survive - Dev Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo  Avoid N Survive - dev server
echo  - The game opens in your browser automatically.
echo  - Save any file and the page reloads by itself (CSS updates instantly).
echo  - Press Ctrl+C in this window to stop the server.
echo.

call npm run dev -- --open
pause
