$ErrorActionPreference = 'Stop'

$ProfilesDir = Join-Path $env:LOCALAPPDATA 'IVACToolkit\Vault\profiles'

if (-not (Test-Path $ProfilesDir)) {
    Write-Host 'No profile vault directory exists yet.' -ForegroundColor Yellow
    exit 0
}

$items = Get-ChildItem -Path $ProfilesDir -Directory | Sort-Object Name
if (-not $items) {
    Write-Host 'No profile vaults exist yet.' -ForegroundColor Yellow
    exit 0
}

Write-Host 'Saved profile vaults:' -ForegroundColor Green
foreach ($item in $items) {
    $state = Join-Path $item.FullName 'state.dat'
    $files = Join-Path $item.FullName 'files'
    $fileCount = 0

    if (Test-Path $files) {
        $fileCount = @(Get-ChildItem -Path $files -Directory -ErrorAction SilentlyContinue).Count
    }

    Write-Host ("{0}  state={1}  fileEntries={2}" -f $item.Name, (Test-Path $state), $fileCount)
}
