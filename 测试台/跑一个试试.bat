@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GeeLo - Demo
node run.js demo
echo.
pause
