@echo off
cd /d "%~dp0"
echo ============================================================
echo   GeeLo 测试台 - 一键安装
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] 没有找到 Node.js
  echo.
  echo     请先到 https://nodejs.org/ 下载安装
  echo     ** 需要 20.19 以上，推荐 22 LTS 或更高 **
  echo     装完关掉这个窗口，重新双击本文件。
  echo.
  pause
  exit /b 1
)

echo [1/3] Node.js 版本：
node -v
echo.

if exist "node_modules\@google\earthengine" (
  echo [2/3] 依赖已就位，跳过安装。
) else (
  echo [2/3] 正在安装依赖，约 100 MB，请稍候...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [X] npm install 失败。常见原因：没联网，或需要给 npm 设代理：
    echo       npm config set proxy http://127.0.0.1:端口
    echo       npm config set https-proxy http://127.0.0.1:端口
    echo.
    pause
    exit /b 1
  )
)
echo.

echo [3/3] 开始环境自检...
echo.
node run.js check
echo.
echo ============================================================
echo   若自检有失败项，按它给的「怎么办」逐条处理，再双击本文件重来。
echo   用法详见本目录的《说明.md》，总入口见上一级的 README.md。
echo ============================================================
echo.
pause
