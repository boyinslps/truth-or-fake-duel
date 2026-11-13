@echo off
rem Double-click to check GitHub and update this folder to the latest version.
chcp 65001 >nul
cd /d "%~dp0"
echo 更新前請先關閉真假對決的伺服器視窗（按 Ctrl+C 或直接關掉）。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
echo.
pause
