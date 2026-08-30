<#
.SYNOPSIS
Switch workhub between your real config and the demo config used for the
README screenshots.

.DESCRIPTION
The vault is only half of what a screenshot shows: the registered repositories
live in the machine config at ~/.workhub/config.json, not in the vault. This
script swaps that file for one pointing at demo-vault/ and at three throwaway
repositories, and puts your own config back afterwards.

Close workhub before running it — the app writes config.json on exit and would
overwrite whatever this script just put there.

.EXAMPLE
./demo-mode.ps1 -On
Back up the real config, create the throwaway repos, install the demo config.

.EXAMPLE
./demo-mode.ps1 -Off
Restore the real config. The throwaway repos are left alone; pass -Clean to
delete them too.
#>
[CmdletBinding(DefaultParameterSetName = 'On')]
param(
    [Parameter(ParameterSetName = 'On')][switch]$On,
    [Parameter(ParameterSetName = 'Off')][switch]$Off,
    [Parameter(ParameterSetName = 'Off')][switch]$Clean,
    # Where the throwaway repositories are created.
    [string]$ReposDir = (Join-Path $env:TEMP 'workhub-demo-repos')
)

$ErrorActionPreference = 'Stop'

$demoDir   = $PSScriptRoot
$vaultDir  = (Resolve-Path (Join-Path $demoDir '..')).Path
$configDir = Join-Path $HOME '.workhub'
$config    = Join-Path $configDir 'config.json'
$backup    = Join-Path $configDir 'config.real.json'

function Assert-AppClosed {
    if (Get-Process -Name 'workhub' -ErrorAction SilentlyContinue) {
        throw 'workhub is running. Close it first — it rewrites config.json on exit.'
    }
}

function New-DemoRepo {
    param([string]$Path, [string[]]$Branches, [bool]$Dirty)

    if (Test-Path (Join-Path $Path '.git')) { return }
    New-Item -ItemType Directory -Force $Path | Out-Null
    Push-Location $Path
    try {
        git init -q -b main
        git config user.name  'Demo User'
        git config user.email 'demo@example.invalid'
        Set-Content -Path 'README.md' -Value "# $(Split-Path $Path -Leaf)`n`nThrowaway repository for workhub screenshots.`n"
        git add -A
        git commit -q -m 'chore: initial commit'
        foreach ($b in $Branches) {
            git checkout -q -b $b
            Add-Content -Path 'README.md' -Value "`n- work on $b`n"
            git commit -q -am "feat: work on $b"
            git checkout -q main
        }
        if ($Dirty) {
            Add-Content -Path 'README.md' -Value "`nuncommitted line`n"
        }
    } finally {
        Pop-Location
    }
}

if ($PSCmdlet.ParameterSetName -eq 'Off') {
    Assert-AppClosed
    if (-not (Test-Path $backup)) {
        throw "No backup at $backup — demo mode does not look active. Nothing was changed."
    }
    Move-Item -Force $backup $config
    Write-Host "Restored your config from config.real.json."
    if ($Clean -and (Test-Path $ReposDir)) {
        Remove-Item -Recurse -Force $ReposDir
        Write-Host "Removed $ReposDir."
    }
    return
}

Assert-AppClosed

if (Test-Path $backup) {
    throw "$backup already exists — demo mode is already on (or a previous run did not finish). Run with -Off first."
}

New-Item -ItemType Directory -Force $configDir | Out-Null
if (Test-Path $config) {
    Copy-Item $config $backup
    Write-Host "Backed up your config to $backup."
} else {
    '{}' | Set-Content -Path $backup -Encoding utf8
    Write-Host "No existing config; wrote an empty placeholder backup."
}

New-DemoRepo -Path (Join-Path $ReposDir 'demo-app')   -Branches @('feature/search', 'fix/upload-flake') -Dirty $true
New-DemoRepo -Path (Join-Path $ReposDir 'demo-site')  -Branches @('feature/onboarding')                 -Dirty $false
New-DemoRepo -Path (Join-Path $ReposDir 'demo-infra') -Branches @()                                     -Dirty $false

$json = Get-Content (Join-Path $demoDir 'config.sample.json') -Raw
$json = $json.Replace('{VAULT}', $vaultDir.Replace('\', '/'))
$json = $json.Replace('{REPOS}', $ReposDir.Replace('\', '/'))
$json | Set-Content -Path $config -Encoding utf8

Write-Host "Demo mode is on."
Write-Host "  vault : $vaultDir"
Write-Host "  repos : $ReposDir"
Write-Host "Start workhub, take the screenshots, then run: ./demo-mode.ps1 -Off"
