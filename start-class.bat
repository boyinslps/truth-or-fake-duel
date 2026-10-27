@echo off
rem Double-click to start the game server for class. Students open the address shown below.
chcp 65001 >nul
cd /d "%~dp0"

rem Use the Node.js bundled in this folder (node-portable) so a USB copy works anywhere; fall back to installed Node.
set "NODE_DIR=%~dp0node-portable"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js。請到 https://nodejs.org 安裝 Node.js 22 LTS 後再試一次。
  pause
  exit /b 1
)

rem First run only: install packages and build the game pages.
if not exist node_modules (
  echo 第一次啟動：安裝套件中……
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
if not exist dist\index.html (
  echo 第一次啟動：建置遊戲畫面中……
  call npm run build
  if errorlevel 1 ( pause & exit /b 1 )
)

call npm start
pause
