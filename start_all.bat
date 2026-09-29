@echo off
rem ============================================================
rem  SentinelAI — one-click launcher
rem  Starts backend (FastAPI :8000) + frontend (Vite :5173)
rem ============================================================
cd /d "%~dp0"

echo.
echo  [1/3] Killing any process on ports 8000 and 5173...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 3 /nobreak >nul

echo  [2/3] Starting frontend  ^(http://localhost:5173^)...
start "SentinelAI Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo  [3/3] Starting backend   ^(http://127.0.0.1:8000^)...
echo.
echo  Keep this window open.  Ctrl+C to stop.
echo  Open browser: http://localhost:5173/signin.html
echo.

:loop
"%~dp0.venv\Scripts\python.exe" -W ignore run.py
echo.
echo  [watchdog] Backend stopped — restarting in 3 s...
timeout /t 3 /nobreak >nul
goto loop
