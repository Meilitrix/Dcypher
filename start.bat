@echo off
title Decypher
setlocal

echo ============================================
echo  Decypher - starting up
echo ============================================
echo.

:: Always run from the folder this script lives in, no matter where it's launched from.
cd /d "%~dp0"

:: Make sure Node.js is actually available on PATH before doing anything else.
where node >nul 2>nul
IF ERRORLEVEL 1 (
  echo ERROR: Node.js was not found on your PATH.
  echo Install it from https://nodejs.org then re-run this file.
  echo.
  pause
  exit /b 1
)

:: Install dependencies if node_modules is missing or concurrently isn't there yet.
IF NOT EXIST "node_modules\concurrently" (
  echo [1/2] Installing dependencies (first run only)...
  call npm install
  IF ERRORLEVEL 1 (
    echo.
    echo ERROR: npm install failed. See the messages above.
    echo.
    pause
    exit /b 1
  )
  echo.
) ELSE (
  echo [1/2] Dependencies already installed, skipping npm install.
  echo.
)

echo [2/2] Starting server + web UI...
echo.
echo   API server  ^>  http://localhost:8787
echo   Web UI      ^>  http://localhost:5173
echo.
echo   Opening the Web UI in your browser in 4 seconds...
echo   Press Ctrl+C in this window to stop both servers.
echo.

start "" /b cmd /c "timeout /t 4 >nul & start http://localhost:5173"

npm run dev:all

:: If dev:all ever exits (port conflict, crash, etc.) keep the window open so the error is readable.
echo.
echo --------------------------------------------
echo  Decypher stopped. If this was unexpected,
echo  read the error messages above.
echo --------------------------------------------
pause
