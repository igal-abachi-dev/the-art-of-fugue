<#
.SYNOPSIS
  Builds the site (if needed) and serves it at http://localhost:4173, then opens the browser.

.DESCRIPTION
  Does what README.md says, with the checks that save you from the usual traps:

    pnpm install            only when node_modules is missing or older than the lockfile
    pnpm build              only when the build is missing or older than the sources, the data or the audio
    pnpm preview --port N   in this window; Ctrl+C stops it

  It also checks Node (20.19 or newer) and pnpm, warns when the two audio files are missing (the pages
  load without them, but nothing plays), and refuses to start when the port is already taken, because
  a server left over from an earlier run would serve an OLD build while you think you are seeing the new one.

.PARAMETER Port      Port to serve on. Default 4173 (the one the browser checks use).
.PARAMETER Rebuild   Build even if the build looks up to date.
.PARAMETER SkipBuild Never build; serve whatever web\build holds.
.PARAMETER KillOld   If something already listens on the port, stop it and go on.
.PARAMETER NoOpen    Do not open the browser.

.EXAMPLE
  .\run.ps1
  .\run.ps1 -Rebuild
  .\run.ps1 -KillOld -Port 4173

  If PowerShell refuses to run scripts:  powershell -ExecutionPolicy Bypass -File .\run.ps1
#>
[CmdletBinding()]
param(
    [int]$Port = 4173,
    [switch]$Rebuild,
    [switch]$SkipBuild,
    [switch]$KillOld,
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$Web = Join-Path $PSScriptRoot 'web'
$Url = "http://localhost:$Port/"

function Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Fail([string]$Text) { Write-Host "ERROR: $Text" -ForegroundColor Red; exit 1 }
function Run([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { Fail "$What failed (exit code $LASTEXITCODE)." }
}

if (-not (Test-Path (Join-Path $Web 'package.json'))) { Fail "web\package.json not found next to this script ($PSScriptRoot)." }

# --- Node and pnpm ------------------------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node is not installed. Install it with:  winget install OpenJS.NodeJS.LTS   (then open a new terminal)" }
$nodeVersion = [version](((& node -v).Trim()).TrimStart('v'))
if ($nodeVersion -lt [version]'20.19.0') { Fail "Node $nodeVersion is too old; the site needs 20.19 or newer." }

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Fail "pnpm is not installed. Run:  corepack enable pnpm   (or: npm install -g pnpm), then open a new terminal."
}
Write-Host ("Node {0}, pnpm {1}" -f $nodeVersion, ((& pnpm -v).Trim()))

Push-Location $Web
try {
    # --- Dependencies ---------------------------------------------------------------------------------
    $marker = Join-Path $Web 'node_modules\.modules.yaml'
    $lock = Join-Path $Web 'pnpm-lock.yaml'
    if (-not (Test-Path $marker) -or (Get-Item $lock).LastWriteTime -gt (Get-Item $marker).LastWriteTime) {
        Step 'pnpm install'
        Run 'pnpm install' { pnpm install --frozen-lockfile }
    }

    # --- The audio (not in Git; generated from the recording) -----------------------------------------
    $audio = @('fugue.webm', 'fugue.m4a')
    $missing = $audio | Where-Object { -not (Test-Path (Join-Path $Web "static\audio\$_")) }
    if ($missing) {
        Write-Host ("WARNING: web\static\audio is missing: {0}." -f ($missing -join ', ')) -ForegroundColor Yellow
        Write-Host '         The pages will load, but nothing will play. To make the audio (needs data\raw, Python, ffmpeg):' -ForegroundColor Yellow
        Write-Host '         cd web; pnpm data -- --encode      (see README.md)' -ForegroundColor Yellow
    }

    # --- Build -----------------------------------------------------------------------------------------
    $index = Join-Path $Web 'build\index.html'
    $needBuild = $false
    if (-not $SkipBuild) {
        if ($Rebuild -or -not (Test-Path $index)) {
            $needBuild = $true
        } else {
            $builtAt = (Get-Item $index).LastWriteTime
            $inputs = @('src', 'static') | ForEach-Object { Join-Path $Web $_ } | Where-Object { Test-Path $_ }
            $files = @(Get-ChildItem $inputs -Recurse -File)
            foreach ($name in 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'vercel.json') {
                $f = Join-Path $Web $name
                if (Test-Path $f) { $files += Get-Item $f }
            }
            $newest = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($newest.LastWriteTime -gt $builtAt) {
                $needBuild = $true
                Write-Host ("The build is older than {0}." -f $newest.FullName.Substring($Web.Length + 1))
            }
        }
    }
    if ($needBuild) {
        Step 'pnpm build'
        Run 'pnpm build' { pnpm build }
    } elseif (-not (Test-Path $index)) {
        Fail 'web\build does not exist and -SkipBuild was given. Run .\run.ps1 without -SkipBuild.'
    } else {
        Write-Host 'The build is up to date (use -Rebuild to build anyway).'
    }

    # --- The port ---------------------------------------------------------------------------------------
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        $ids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
        $names = ($ids | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; "{0} (PID {1})" -f $p.ProcessName, $_ }) -join ', '
        if ($KillOld) {
            Step "Stopping $names on port $Port"
            $ids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
            Start-Sleep -Seconds 1
        } else {
            Fail "Port $Port is already in use by $names. That is probably an earlier server, which would show an OLD build. Run .\run.ps1 -KillOld, or pick another port with -Port 4180."
        }
    }

    # --- Serve ------------------------------------------------------------------------------------------
    # A background job waits until the server answers, then opens the browser; the server runs in this window.
    $opener = Start-Job -ArgumentList $Url, ([bool]$NoOpen) -ScriptBlock {
        param($u, $no)
        for ($i = 0; $i -lt 120; $i++) {
            try {
                $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2
                if ($r.StatusCode -eq 200) { if (-not $no) { Start-Process $u }; return }
            } catch { }
            Start-Sleep -Milliseconds 500
        }
    }
    Step "Serving $Url   (Ctrl+C stops it)"
    Write-Host 'Click Begin in the page (browsers keep the sound off until you click), then choose a piece.'
    try {
        pnpm preview --port $Port --strictPort
    } finally {
        Remove-Job -Job $opener -Force -ErrorAction SilentlyContinue
    }
} finally {
    Pop-Location
}
