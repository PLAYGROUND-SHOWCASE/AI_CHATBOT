@echo off
title ZARVIS — Quick Start
color 0B
echo.
echo  ========================================
echo    ZARVIS AI COMMAND INTELLIGENCE
echo  ========================================
echo.

REM Check if backend .env has an API key
findstr /C:"GEMINI_API_KEY=" backend\.env | findstr /V "GEMINI_API_KEY=$" > nul
if errorlevel 1 (
    echo  [!] GEMINI_API_KEY not set in backend\.env
    echo      Edit backend\.env and add your key from:
    echo      https://aistudio.google.com/app/apikey
    echo.
)

REM Start backend
echo  [1] Starting ZARVIS Backend...
start "ZARVIS Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && uvicorn app.main:app --reload --port 8000"

timeout /t 3 /nobreak > nul

REM Start frontend server
echo  [2] Starting ZARVIS Frontend...
start "ZARVIS Frontend" cmd /k "cd /d %~dp0frontend && python -m http.server 3000"

timeout /t 2 /nobreak > nul

REM Open browser
echo  [3] Opening ZARVIS in browser...
start http://localhost:3000

echo.
echo  ZARVIS is starting up!
echo  Frontend: http://localhost:3000
echo  Backend API Docs: http://localhost:8000/api/docs
echo.
echo  Press any key to close this launcher...
pause > nul
