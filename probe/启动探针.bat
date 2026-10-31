@echo off
setlocal
chcp 65001 >nul
title imk60 probe
set "HERE=%~dp0"
where python >nul 2>nul
if errorlevel 1 (
    echo   [ERROR] Python 3 not found in PATH.
    pause
    exit /b 1
)
python "%HERE%server.py" 8765
echo.
echo Server stopped. Press any key to close.
pause >nul
