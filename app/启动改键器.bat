@echo off
setlocal
chcp 65001 >nul
title imk60 keymapper
set "HERE=%~dp0"
where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [ERROR] Python 3 not found in PATH.
    echo   Install Python 3.8+ from https://www.python.org/
    echo   and tick "Add python.exe to PATH" during setup.
    echo.
    pause
    exit /b 1
)
python "%HERE%server.py" 8766
echo.
echo Server stopped. Press any key to close.
pause >nul
