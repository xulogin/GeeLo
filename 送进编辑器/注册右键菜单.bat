@echo off
chcp 65001 >nul
title GEE - Register
node "%~dp0gee-open.js" --register
pause
