@echo off
setlocal
title MediaNest - Tools Portal Launcher

REM ============================================================
REM  MediaNest - run the tools server and open the main
REM  Tools Portal (tools/index.html) in the default browser.
REM
REM  Optional: pick a custom port before running,
REM  e.g.   set MEDIA_NEST_PORT=8080
REM ============================================================

REM Always work from the folder this script lives in
cd /d "%~dp0"

if "%MEDIA_NEST_PORT%"=="" set "MEDIA_NEST_PORT=4000"
set "TOOLS_URL=http://localhost:%MEDIA_NEST_PORT%/tools/index.html"
set "HEALTH_URL=http://localhost:%MEDIA_NEST_PORT%/api/health"

echo ================================================
echo    MediaNest - Main Tools Portal
echo ================================================
echo.

REM ---------- 1. Make sure Node.js is installed ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this computer.
    echo         Please install it from https://nodejs.org and run again.
    echo.
    pause
    exit /b 1
)

REM ---------- 2. First-run setup: install server deps ----------
if not exist "server\node_modules\express\" (
    echo [SETUP] Installing server dependencies - please wait...
    pushd server
    call npm install --no-audit --no-fund
    popd
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check your internet connection.
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM ---------- 3. Skip startup if the server already responds ----------
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 2 | Out-Null; exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 goto ALREADY_RUNNING

REM ---------- 4. Start the server in a minimized window ----------
echo [START] Starting MediaNest tools server on port %MEDIA_NEST_PORT% ...
start "MediaNest Tools Server" /min cmd /c "set PORT=%MEDIA_NEST_PORT%&& node server\server.js"

echo [WAIT ] Waiting for the server to come online...
powershell -NoProfile -Command "$u='%HEALTH_URL%';for($i=0;$i -lt 20;$i++){try{Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 2 | Out-Null; exit 0}catch{Start-Sleep -Milliseconds 700}};exit 1" >nul 2>nul
if errorlevel 1 goto START_FAILED

echo [ OK   ] Server is online.
goto ALREADY_RUNNING

:START_FAILED
echo.
echo [ERROR] The server did not respond within 20 seconds.
echo         Another program may already use port %MEDIA_NEST_PORT%.
echo         Try again with a free port, for example:
echo             set MEDIA_NEST_PORT=8080
echo         then run this file once more.
echo.
pause
exit /b 1

:ALREADY_RUNNING
echo [OPEN  ] Opening the Tools Portal in your browser...
echo.
echo          Tools portal : %TOOLS_URL%
echo          Main editor  : http://localhost:%MEDIA_NEST_PORT%/index.html
echo          Close the minimized "MediaNest Tools Server" window to stop it.
echo.
start "" "%TOOLS_URL%"

REM Give the browser a moment, then close this launcher window
ping -n 3 127.0.0.1 >nul
exit /b 0
