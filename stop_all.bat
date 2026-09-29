@echo off
rem ============================================================
rem  SentinelAI clean stop (Windows).
rem  Frees ports 8000 (backend) and 5173 (frontend) by stopping
rem  whatever is listening on them. Run this before re-starting
rem  if you ever see "[Errno 10048] address already in use".
rem ============================================================
powershell -NoProfile -Command "foreach ($p in 8000,5173) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"
echo SentinelAI stopped - ports 8000 and 5173 freed.
timeout /t 2 /nobreak >nul
