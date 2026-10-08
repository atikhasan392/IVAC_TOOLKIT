$ErrorActionPreference = 'Stop'

$HostName = 'com.atikhasan.ivac_toolkit'
$ExtensionId = 'ppkhmbhihbhbkcgghgmkldadliemhfdl'
$InstallDir = Join-Path $env:LOCALAPPDATA 'IVACToolkit\NativeHost'
$VaultDir = Join-Path $env:LOCALAPPDATA 'IVACToolkit\Vault'
$ProfilesDir = Join-Path $VaultDir 'profiles'
$SourceFile = Join-Path $PSScriptRoot 'Host.cs'
$ExePath = Join-Path $InstallDir 'ivac-toolkit-native-host.exe'
$ManifestPath = Join-Path $InstallDir ($HostName + '.json')

if (-not (Test-Path $SourceFile)) {
    throw "Host source was not found: $SourceFile"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $ProfilesDir | Out-Null

$source = [System.IO.File]::ReadAllText($SourceFile)

if (Test-Path $ExePath) {
    Remove-Item -Force $ExePath
}

$references = @(
    'System.dll',
    'System.Core.dll',
    'System.Security.dll',
    'System.Web.Extensions.dll'
)

Add-Type `
    -TypeDefinition $source `
    -Language CSharp `
    -ReferencedAssemblies $references `
    -OutputAssembly $ExePath `
    -OutputType ConsoleApplication

$manifest = [ordered]@{
    name = $HostName
    description = 'IVAC TOOLKIT Windows persistent per-profile vault'
    path = $ExePath
    type = 'stdio'
    allowed_origins = @(
        "chrome-extension://$ExtensionId/"
    )
}

$json = $manifest | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ManifestPath, $json, $utf8NoBom)

$registryPaths = @(
    "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKCU\Software\Chromium\NativeMessagingHosts\$HostName",
    "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
    "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName"
)

foreach ($registryPath in $registryPaths) {
    & reg.exe ADD $registryPath /ve /t REG_SZ /d $ManifestPath /f | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not register native messaging host at $registryPath"
    }
}

Write-Host ''
Write-Host 'IVAC TOOLKIT Windows host installed successfully.' -ForegroundColor Green
Write-Host "Extension ID : $ExtensionId"
Write-Host "Native host  : $ExePath"
Write-Host "Vault root   : $VaultDir"
Write-Host "Profile data : $ProfilesDir\<profile-vault-id>"
Write-Host ''
Write-Host 'Existing legacy vault data was not deleted or migrated.' -ForegroundColor Yellow
Write-Host 'Close and reopen all GoLogin browser windows after installation.'
