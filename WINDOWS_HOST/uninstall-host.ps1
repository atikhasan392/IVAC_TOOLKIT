$ErrorActionPreference = 'Stop'

$HostName = 'com.atikhasan.ivac_toolkit'
$InstallDir = Join-Path $env:LOCALAPPDATA 'IVACToolkit\NativeHost'

$registryPaths = @(
    "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKCU\Software\Chromium\NativeMessagingHosts\$HostName",
    "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
    "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName"
)

foreach ($registryPath in $registryPaths) {
    & reg.exe DELETE $registryPath /f 2>$null | Out-Null
}

if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
}

Write-Host 'Native host uninstalled. All encrypted vault data was intentionally kept.' -ForegroundColor Yellow
Write-Host (Join-Path $env:LOCALAPPDATA 'IVACToolkit\Vault')
