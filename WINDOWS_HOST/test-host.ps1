$ErrorActionPreference = 'Stop'

$HostName = 'com.atikhasan.ivac_toolkit'
$ExePath = Join-Path $env:LOCALAPPDATA 'IVACToolkit\NativeHost\ivac-toolkit-native-host.exe'
$ManifestPath = Join-Path $env:LOCALAPPDATA "IVACToolkit\NativeHost\$HostName.json"

if (-not (Test-Path $ExePath)) {
    throw 'Native host executable was not found. Run install.bat first.'
}

if (-not (Test-Path $ManifestPath)) {
    throw 'Native host manifest was not found. Run install.bat first.'
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ExePath
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi
[void]$process.Start()

$request = '{"action":"ping"}'
$payload = [System.Text.Encoding]::UTF8.GetBytes($request)
$length = [System.BitConverter]::GetBytes([int]$payload.Length)

$inputStream = $process.StandardInput.BaseStream
$inputStream.Write($length, 0, $length.Length)
$inputStream.Write($payload, 0, $payload.Length)
$inputStream.Flush()
$inputStream.Close()

$outputStream = $process.StandardOutput.BaseStream
$lengthBuffer = New-Object byte[] 4
$read = $outputStream.Read($lengthBuffer, 0, 4)
if ($read -ne 4) {
    $errorText = $process.StandardError.ReadToEnd()
    throw "Native host did not return a valid response. $errorText"
}

$responseLength = [System.BitConverter]::ToInt32($lengthBuffer, 0)
if ($responseLength -lt 1 -or $responseLength -gt 1048576) {
    throw "Unexpected native host response length: $responseLength"
}

$responseBuffer = New-Object byte[] $responseLength
$offset = 0
while ($offset -lt $responseLength) {
    $count = $outputStream.Read($responseBuffer, $offset, $responseLength - $offset)
    if ($count -le 0) {
        throw 'Native host response ended unexpectedly.'
    }
    $offset += $count
}

$response = [System.Text.Encoding]::UTF8.GetString($responseBuffer)
$process.WaitForExit()

Write-Host "Native host response: $response"
if ($response -notmatch '"ok"\s*:\s*true') {
    exit 1
}

Write-Host 'Native host test passed.' -ForegroundColor Green
Write-Host "Manifest: $ManifestPath"
