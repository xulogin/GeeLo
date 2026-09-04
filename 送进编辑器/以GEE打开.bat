@echo off
chcp 65001 >nul
title Open in GEE
node "%~dp0gee-open.js" "%~1"
if errorlevel 1 (
  echo.
  pause
)
