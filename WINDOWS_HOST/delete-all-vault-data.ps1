$ErrorActionPreference = 'Stop'

$VaultDir = Join-Path $env:LOCALAPPDATA 'IVACToolkit\Vault'

if (-not (Test-Path $VaultDir)) {
    Write-Host 'No vault data exists.' -ForegroundColor Yellow
    exit 0
}

Write-Host "This permanently deletes ALL IVAC TOOLKIT vault data under: $VaultDir" -ForegroundColor Red
$confirmation = Read-Host 'Type DELETE ALL to continue'
if ($confirmation -cne 'DELETE ALL') {
    Write-Host 'Cancelled.' -ForegroundColor Yellow
    exit 0
}

Remove-Item -Recurse -Force $VaultDir
Write-Host 'All vault data deleted.' -ForegroundColor Green
