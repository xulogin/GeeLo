@echo off
chcp 65001 >nul
title GeeLo - New Workspace
if "%~1"=="" (
  echo.
  echo   Drag a folder onto this file, or run:
  echo     node new-workspace.js "D:\your\project\folder"
  echo.
  pause
  exit /b 1
)
node "%~dp0new-workspace.js" "%~1"
pause
