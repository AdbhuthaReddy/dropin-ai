$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $root "deploy\demo.ps1"
$global:DropinDeployCalls = New-Object System.Collections.Generic.List[string]
function global:gcloud {
    $line = $args -join " "
    $global:DropinDeployCalls.Add($line)
    if ($line -like "*$global:DropinDeployFailure*" -and $global:DropinDeployFailure) {
        $global:LASTEXITCODE = 1
        return
    }
    $global:LASTEXITCODE = 0
    if ($line -like "secrets versions describe*") { return "ENABLED" }
    if ($line -like "firestore databases list*") {
        if ($global:DropinDatabaseType) {
            return "[{`"name`":`"projects/fixture-project/databases/(default)`",`"type`":`"$global:DropinDatabaseType`"}]"
        }
        return "[]"
    }
    if ($line -like "artifacts repositories list*") { return "[]" }
    if ($line -like "iam service-accounts list*") { return "[]" }
    if ($line -like "run services describe*") { return "https://demo.example.invalid" }
}
function global:Invoke-WebRequest {
    param($Uri, [switch]$UseBasicParsing, $TimeoutSec)
    if ($Uri -notlike "https://demo.example.invalid*") { throw "Unexpected live HTTP request." }
    return @{ StatusCode = 200 }
}
try {
    $location = (Get-Location).Path
    & $scriptPath -Project "fixture-project" -EnablePublicDocumentResearch
    if ((Get-Location).Path -ne $location) { throw "Deployment changed caller location." }
    $calls = $global:DropinDeployCalls -join "`n"
    foreach ($expected in @("builds submit", "deploy/demo-build.yaml", "run deploy dropin-demo",
        "--max-instances=1", "--min-instances=0", "--cpu-throttling", "DEMO_ACCESS_CODE=dropin-presenter:latest",
        "firestore databases create", "dropin-demo-build")) {
        if (-not $calls.Contains($expected)) { throw "Missing deployment setting: $expected" }
    }
    foreach ($forbidden in @("cloudtasks", "cloudscheduler", "identitytoolkit", "secrets versions access")) {
        if ($calls.Contains($forbidden)) { throw "Unwanted dependency/secret disclosure: $forbidden" }
    }
    foreach ($failure in @("builds submit", "firestore databases list", "run deploy")) {
        $global:DropinDeployFailure = $failure
        $failed = $false
        try { & $scriptPath -Project "fixture-project" -EnablePublicDocumentResearch } catch {
            $failed = $_.Exception.Message -like "*gcloud failed*"
        }
        if (-not $failed) { throw "Deployment swallowed failure at $failure." }
        if ((Get-Location).Path -ne $location) { throw "Failed deployment changed caller location." }
    }
    $global:DropinDeployFailure = $null
    $global:DropinDatabaseType = "FIRESTORE_NATIVE"
    $global:DropinDeployCalls.Clear()
    & $scriptPath -Project "fixture-project" -EnablePublicDocumentResearch
    if (($global:DropinDeployCalls -join "`n").Contains("firestore databases create")) {
        throw "Redeployment attempted to recreate an existing Native database."
    }
    $global:DropinDatabaseType = "DATASTORE_MODE"
    $global:DropinDeployCalls.Clear()
    $failed = $false
    try { & $scriptPath -Project "fixture-project" -EnablePublicDocumentResearch } catch {
        $failed = $_.Exception.Message -like "*Firestore Native mode*"
    }
    if (-not $failed -or ($global:DropinDeployCalls -join "`n").Contains("builds submit")) {
        throw "Deployment did not reject an incompatible database before building."
    }
    $failed = $false
    try { & $scriptPath -Project "fixture-project" } catch {
        $failed = $_.Exception.Message -like "*consent*"
    }
    if (-not $failed) { throw "Deployment did not require public document consent." }
    Write-Host "PASS: single-service provisioning, database compatibility/preservation, cost settings, no secret reads, consent and failure propagation."
} finally {
    Remove-Item Function:\gcloud
    Remove-Item Function:\Invoke-WebRequest
    Remove-Variable DropinDeployCalls,DropinDeployFailure,DropinDatabaseType -Scope Global -ErrorAction SilentlyContinue
}
exit 0
