param(
    [string]$Python,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
if (-not $Python) {
    $localPython = Join-Path $PSScriptRoot "backend\.venv\Scripts\python.exe"
    $Python = if (Test-Path -LiteralPath $localPython) { $localPython } else { "python" }
}
$pythonPath = (Get-Command $Python -ErrorAction Stop).Source
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$npmPath = if ($npmCommand) { $npmCommand.Source } else {
    @(
        (Join-Path $env:ProgramFiles "nodejs\npm.cmd"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\npm.cmd")
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $npmPath) { throw "npm is unavailable. Run .\setup.ps1 first." }
$env:PATH = "$(Split-Path -Parent $npmPath);$env:PATH"
$backendPath = Join-Path $PSScriptRoot "backend"
$frontendPath = Join-Path $PSScriptRoot "frontend"

& $pythonPath -c "import fastapi, uvicorn, pypdf, google.genai"
if ($LASTEXITCODE -ne 0) {
    throw "Install backend dependencies into the selected Python environment first."
}
if (-not (Test-Path (Join-Path $frontendPath "node_modules"))) {
    throw "Run npm ci in frontend before starting the demo."
}

function Test-HttpReady([string]$Url) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
        return $response.StatusCode -eq 200
    } catch [System.Net.WebException] {
        return $false
    }
}

function Test-PortListening([int]$Port) {
    return [bool]([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -eq $Port })
}

$started = @()
try {
    if (-not (Test-PortListening 8080)) {
        $started += Start-Process -FilePath $pythonPath -WorkingDirectory $backendPath `
            -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8080" -PassThru
    }
    if (-not (Test-PortListening 3000)) {
        $started += Start-Process -FilePath $env:ComSpec -WorkingDirectory $frontendPath `
            -ArgumentList "/c", "`"$npmPath`" run dev" -PassThru
    }
    $deadline = (Get-Date).AddSeconds(90)
    do {
        foreach ($process in $started) {
            if ($process.HasExited) { throw "A service exited before becoming ready (PID $($process.Id))." }
        }
        $ready = (Test-HttpReady "http://localhost:8080/health") -and (Test-HttpReady "http://localhost:3000")
        if (-not $ready) { Start-Sleep -Milliseconds 500 }
    } until ($ready -or (Get-Date) -gt $deadline)
    if (-not $ready) { throw "Services did not become responsive within 90 seconds. Inspect their console output." }
    Write-Host "Demo ready at http://localhost:3000 (local-only; no SAP or distributor integration)."
    if ($started.Count) {
        Write-Host "Started process IDs: $($started.Id -join ', '). Close those service windows when finished."
    } else {
        Write-Host "Reused existing services; no processes started."
    }
    if (-not $NoBrowser) { Start-Process "http://localhost:3000" }
} catch {
    Write-Error "Startup failed. Started process IDs: $($started.Id -join ', '). $($_.Exception.Message)"
    throw
}
