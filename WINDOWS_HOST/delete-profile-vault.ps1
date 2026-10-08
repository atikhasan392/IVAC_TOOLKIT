param(
    [Parameter(Mandatory = $true)]
    [string]$VaultId
)

$ErrorActionPreference = 'Stop'

if ($VaultId -match '^[1-9][0-9]*$') {
    $number = 0L
    if (-not [long]::TryParse($VaultId, [ref]$number)) { throw 'Numeric VaultId is out of range.' }
    $normalized = $number.ToString()
} else {
    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParse($VaultId, [ref]$parsed)) {
        throw 'VaultId must be a positive integer or legacy UUID.'
    }
    $normalized = $parsed.ToString('D').ToLowerInvariant()
}
$ProfilesDir = Join-Path $env:LOCALAPPDATA 'IVACToolkit\Vault\profiles'
$Target = Join-Path $ProfilesDir $normalized

if (-not (Test-Path $Target)) {
    throw "Profile vault was not found: $normalized"
}

Write-Host "This permanently deletes profile vault: $normalized" -ForegroundColor Red
$confirmation = Read-Host 'Type DELETE to continue'
if ($confirmation -cne 'DELETE') {
    Write-Host 'Cancelled.' -ForegroundColor Yellow
    exit 0
}

Remove-Item -Recurse -Force $Target
Write-Host 'Profile vault deleted.' -ForegroundColor Green
