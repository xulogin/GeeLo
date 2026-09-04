@echo off
chcp 65001 >nul
title GEE - Setup
node "%~dp0gee-open.js" --setup %*
echo.
pause
