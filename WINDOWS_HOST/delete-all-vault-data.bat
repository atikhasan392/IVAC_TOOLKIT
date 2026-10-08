@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0delete-all-vault-data.ps1"
echo.
pause
