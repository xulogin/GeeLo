@echo off
chcp 65001 >nul
title GEE - Unregister
node "%~dp0gee-open.js" --unregister
pause
