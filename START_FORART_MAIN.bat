@echo off
cd /d "%~dp0"

if not exist "node_modules" (
  echo [INFO] Installing Forart dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

call npm run dev
