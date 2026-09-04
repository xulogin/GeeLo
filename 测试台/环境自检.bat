@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GeeLo - Env Check
node run.js check
echo.
pause
