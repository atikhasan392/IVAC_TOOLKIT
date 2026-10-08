@echo off
setlocal
set /p VAULT_ID=Enter profile vault UUID:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0delete-profile-vault.ps1" -VaultId "%VAULT_ID%"
echo.
pause
