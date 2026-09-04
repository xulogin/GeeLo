@echo off
chcp 65001 >nul
title GEE - Status
node "%~dp0gee-open.js" --status
pause
