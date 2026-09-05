@echo off
chcp 65001 >nul
title GeeLo - Authenticate
node "%~dp0认证.js" %*
pause
