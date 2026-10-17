[CmdletBinding()]
param(
    [string]$Python,
    [switch]$SkipRuntimeInstall
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param([string]$File, [string[]]$Arguments)
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "'$File $($Arguments -join ' ')' failed (exit $LASTEXITCODE). Resolve the error above, then rerun setup.ps1."
    }
}

function Test-Runtime {
    param([string]$File, [string[]]$Arguments)
    try {
        & $File @Arguments *> $null
        return $LASTEXITCODE -eq 0
    } catch [System.Management.Automation.CommandNotFoundException] {
        return $false
    }
}

function Find-Python {
    param([string]$Requested)
    $versionCheck = "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"
    if ($Requested) {
        $command = Get-Command $Requested -ErrorAction Stop
        if (-not (Test-Runtime $command.Source @("-c", $versionCheck))) {
            throw "Selected Python must be a working Python 3.12+ interpreter: $Requested"
        }
        return $command.Source
    }
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher -and (Test-Runtime $launcher.Source @("-3", "-c", $versionCheck))) {
        $resolved = & $launcher.Source -3 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $resolved -and (Test-Runtime $resolved @("-c", $versionCheck))) {
            return $resolved
        }
    }
    foreach ($name in @("python.exe", "python3.exe")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        # Windows Store aliases are not installed interpreters and can open an interactive store window.
        if ($command -and $command.Source -notlike "*\Microsoft\WindowsApps\*" -and
            (Test-Runtime $command.Source @("-c", $versionCheck))) {
            return $command.Source
        }
    }
    foreach ($root in @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python"),
        $env:ProgramFiles
    )) {
        foreach ($version in @("314", "313", "312")) {
            $candidate = Join-Path $root "Python$version\python.exe"
            if ((Test-Path -LiteralPath $candidate) -and (Test-Runtime $candidate @("-c", $versionCheck))) {
                return $candidate
            }
        }
    }
    return $null
}

function Find-Node {
    $candidates = @()
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $candidates += Join-Path $env:ProgramFiles "nodejs\node.exe"
    $candidates += Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"
    foreach ($candidate in $candidates) {
        if ((Test-Path -LiteralPath $candidate) -and
            (Test-Runtime $candidate @("-e", "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"))) {
            return $candidate
        }
    }
    return $null
}

function Install-Runtime {
    param([string]$Id, [string]$Instructions, [switch]$UserScope)
    if ($SkipRuntimeInstall) { throw "$Instructions Then rerun setup.ps1." }
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Windows Package Manager (winget) is unavailable. $Instructions Then rerun setup.ps1."
    }
    Write-Host "Installing $Id using winget. Windows may request installer approval."
    $arguments = @("install", "--id", $Id, "--exact", "--source", "winget", "--silent",
        "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity")
    if ($UserScope) { $arguments += @("--scope", "user") }
    Invoke-Checked $winget.Source $arguments
}

function Initialize-LocalConfig {
    param([string]$Root)
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    foreach ($entry in @(
        @{ Template = "backend\.env.example"; Destination = "backend\.env" },
        @{ Template = "frontend\.env.local.example"; Destination = "frontend\.env.local" }
    )) {
        $destination = Join-Path $Root $entry.Destination
        if (Test-Path -LiteralPath $destination) {
            Write-Host "Keeping existing $($entry.Destination)"
        } else {
            $template = Join-Path $Root $entry.Template
            [System.IO.File]::WriteAllText($destination, [System.IO.File]::ReadAllText($template), $utf8)
            Write-Host "Created $($entry.Destination) from the local-mode template."
        }
    }
}

$root = $PSScriptRoot
foreach ($relative in @("backend\requirements-dev.txt", "frontend\package-lock.json", "shared\bom.json",
    "backend\.env.example", "frontend\.env.local.example")) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relative))) {
        throw "Missing $relative. Run setup.ps1 from a complete DropIn.ai checkout."
    }
}

$venvDirectory = Join-Path $root "backend\.venv"
$venvPython = Join-Path $venvDirectory "Scripts\python.exe"
if (Test-Path -LiteralPath $venvDirectory) {
    if (-not (Test-Path -LiteralPath $venvPython) -or
        -not (Test-Runtime $venvPython @("-c", "import sys; sys.exit(0 if sys.version_info >= (3, 12) and sys.prefix != sys.base_prefix else 1)"))) {
        throw "backend\.venv is incomplete or uses an unsupported Python. Rename it and rerun setup.ps1; existing environments are never deleted."
    }
    if ($Python) {
        $null = Find-Python $Python
        Write-Host "Reusing backend\.venv; -Python only selects the interpreter when creating a new environment."
    }
}

$nodePath = Find-Node
if (-not $nodePath) {
    Install-Runtime "OpenJS.NodeJS.LTS" "Install Node.js 22+ with npm from https://nodejs.org/."
    $nodePath = Find-Node
    if (-not $nodePath) { throw "Node.js is still unavailable. Open a new PowerShell window and rerun setup.ps1." }
}
$nodeDirectory = Split-Path -Parent $nodePath
$npmPath = Join-Path $nodeDirectory "npm.cmd"
if (-not (Test-Path -LiteralPath $npmPath)) {
    throw "npm.cmd was not found beside $nodePath. Repair your Node.js installation with npm included."
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    $pythonPath = Find-Python $Python
    if (-not $pythonPath) {
        Install-Runtime "Python.Python.3.12" "Install Python 3.12+ from https://www.python.org/downloads/windows/." -UserScope
        $pythonPath = Find-Python
        if (-not $pythonPath) { throw "Python is still unavailable. Rerun setup.ps1 -Python C:\path\to\python.exe." }
    }
    Write-Host "Creating backend\.venv using $pythonPath"
    Invoke-Checked $pythonPath @("-m", "venv", $venvDirectory)
}

$originalPath = $env:PATH
try {
    # npm lifecycle scripts must use the checked Node, even if PATH contains an older version.
    $env:PATH = "$nodeDirectory;$originalPath"
    Write-Host "Installing backend runtime and test dependencies in backend\.venv..."
    Invoke-Checked $venvPython @("-m", "pip", "install", "--upgrade", "pip")
    Invoke-Checked $venvPython @("-m", "pip", "install", "-r", (Join-Path $root "backend\requirements-dev.txt"))
    Write-Host "Installing frontend dependencies from package-lock.json..."
    Push-Location (Join-Path $root "frontend")
    try { Invoke-Checked $npmPath @("ci", "--include=dev") } finally { Pop-Location }
    Initialize-LocalConfig $root

    Write-Host "Verifying installed dependencies..."
    Invoke-Checked $venvPython @("-m", "pip", "check")
    Invoke-Checked $venvPython @("-c", "import fastapi, uvicorn, pypdf, dotenv, google.genai, firebase_admin, google.cloud.firestore, google.cloud.tasks_v2, httpx")
    Push-Location (Join-Path $root "frontend")
    try {
        Invoke-Checked $nodePath @((Join-Path $root "frontend\node_modules\next\dist\bin\next"), "typegen")
        Invoke-Checked $npmPath @("run", "typecheck")
    } finally { Pop-Location }
} finally {
    $env:PATH = $originalPath
}

Write-Host ""
Write-Host "Local setup complete. Start the app from the repository root:"
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1"
Write-Host "Optional Gemini research: set GEMINI_API_KEY in backend\.env (never commit it)."
Write-Host "No key is needed for inventory or local PDF extraction. No cloud resources were provisioned."
Write-Host "Existing configuration was preserved; cloud-configured settings must be adjusted manually for local mode."
