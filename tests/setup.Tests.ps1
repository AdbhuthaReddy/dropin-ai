$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$source = [System.IO.File]::ReadAllText((Join-Path $root "setup.ps1"))
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "setup.ps1 has syntax errors: $parseErrors" }
foreach ($definition in $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $false)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ("dropin-setup-test-" + [guid]::NewGuid().ToString("N"))
$null = New-Item -ItemType Directory -Path $fixture
try {
    $shell = (Get-Process -Id $PID).Path
    Assert-True (Test-Runtime $shell @("-NoProfile", "-Command", "exit 0")) "Successful runtime probe rejected."
    Assert-True (-not (Test-Runtime $shell @("-NoProfile", "-Command", "exit 7"))) "Failed runtime probe accepted."
    $threw = $false
    try { Invoke-Checked $shell @("-NoProfile", "-Command", "exit 7") } catch {
        $threw = $_.Exception.Message -like "*exit 7*"
    }
    Assert-True $threw "External command failure was not surfaced."
    $SkipRuntimeInstall = $true
    $threw = $false
    try { Install-Runtime "unused-fixture-id" "Install the missing runtime." } catch {
        $threw = $_.Exception.Message -like "*Install the missing runtime*"
    }
    Assert-True $threw "-SkipRuntimeInstall did not reject a missing runtime."

    foreach ($directory in @("backend", "frontend", "shared", "runtime")) {
        $null = New-Item -ItemType Directory -Path (Join-Path $fixture $directory)
    }
    foreach ($relative in @("backend\requirements-dev.txt", "frontend\package-lock.json", "shared\bom.json", "runtime\npm.cmd")) {
        [System.IO.File]::WriteAllText((Join-Path $fixture $relative), "fixture")
    }
    foreach ($relative in @("backend\.env.example", "frontend\.env.local.example")) {
        Copy-Item -LiteralPath (Join-Path $root $relative) -Destination (Join-Path $fixture $relative)
    }
    $mocks = @'
function Find-Node { return (Join-Path $PSScriptRoot "runtime\node.exe") }
function Find-Python { param([string]$Requested); return "fixture-python" }
function Test-Runtime { param([string]$File, [string[]]$Arguments); return -not (Test-Path (Join-Path $PSScriptRoot "invalid-venv")) }
function Install-Runtime { throw "Unexpected real runtime installation." }
function Invoke-Checked {
    param([string]$File, [string[]]$Arguments)
    $operation = $Arguments -join " "
    Add-Content -LiteralPath (Join-Path $PSScriptRoot "calls.txt") -Value $operation
    $fail = Join-Path $PSScriptRoot "fail-command"
    if ((Test-Path $fail) -and $operation -like "*$([System.IO.File]::ReadAllText($fail))*") {
        throw "Simulated external command failure: $operation"
    }
    if ($operation -like "-m venv *") {
        $directory = Join-Path $PSScriptRoot "backend\.venv\Scripts"
        $null = New-Item -ItemType Directory -Path $directory -Force
        [System.IO.File]::WriteAllText((Join-Path $directory "python.exe"), "fixture")
    }
}
'@
    $scriptPath = Join-Path $fixture "setup.ps1"
    $testSource = $source.Replace('$root = $PSScriptRoot', $mocks + "`r`n" + '$root = $PSScriptRoot')
    [System.IO.File]::WriteAllText($scriptPath, $testSource)
    $beforePath = $env:PATH
    $beforeLocation = (Get-Location).Path
    & $scriptPath -SkipRuntimeInstall
    Assert-True (Test-Path (Join-Path $fixture "backend\.venv\Scripts\python.exe")) "Virtual environment not created."
    foreach ($relative in @("backend\.env", "frontend\.env.local")) {
        Assert-True (Test-Path (Join-Path $fixture $relative)) "$relative not created."
    }
    $calls = [System.IO.File]::ReadAllText((Join-Path $fixture "calls.txt"))
    foreach ($required in @("-m venv", "requirements-dev.txt", "ci --include=dev", "-m pip check", "typegen", "run typecheck")) {
        Assert-True ($calls.Contains($required)) "Missing setup stage: $required"
    }
    Assert-True ($env:PATH -eq $beforePath -and (Get-Location).Path -eq $beforeLocation) "Setup changed caller PATH/location."

    [System.IO.File]::WriteAllText((Join-Path $fixture "backend\.env"), "preserve-existing-config")
    [System.IO.File]::WriteAllText((Join-Path $fixture "frontend\.env.local"), "preserve-existing-frontend")
    Clear-Content -LiteralPath (Join-Path $fixture "calls.txt")
    & $scriptPath -SkipRuntimeInstall
    $calls = [System.IO.File]::ReadAllText((Join-Path $fixture "calls.txt"))
    Assert-True (-not $calls.Contains("-m venv")) "Rerun recreated the environment."
    Assert-True ([System.IO.File]::ReadAllText((Join-Path $fixture "backend\.env")) -eq "preserve-existing-config") "Existing backend config overwritten."
    Assert-True ([System.IO.File]::ReadAllText((Join-Path $fixture "frontend\.env.local")) -eq "preserve-existing-frontend") "Existing frontend config overwritten."

    foreach ($failure in @("pip install", "ci --include=dev", "typegen", "run typecheck")) {
        [System.IO.File]::WriteAllText((Join-Path $fixture "fail-command"), $failure)
        $threw = $false
        try { & $scriptPath -SkipRuntimeInstall } catch {
            $threw = $_.Exception.Message -like "*Simulated external command failure*"
        }
        Assert-True $threw "Setup swallowed failure at $failure."
        Assert-True ($env:PATH -eq $beforePath -and (Get-Location).Path -eq $beforeLocation) "Failure changed caller PATH/location."
    }
    Remove-Item -LiteralPath (Join-Path $fixture "fail-command")
    [System.IO.File]::WriteAllText((Join-Path $fixture "invalid-venv"), "true")
    $threw = $false
    try { & $scriptPath -SkipRuntimeInstall } catch {
        $threw = $_.Exception.Message -like "*incomplete or uses an unsupported Python*"
    }
    Assert-True $threw "Invalid environment was accepted."
    Assert-True (Test-Path (Join-Path $fixture "backend\.venv\Scripts\python.exe")) "Invalid environment was deleted."
    Write-Host "PASS: runtime probes, command failures, fresh setup, config preservation, rerun, failure cleanup and invalid-venv protection."
} finally {
    # Only remove the unique test fixture created by this invocation.
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
exit 0
