[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Project,
    [string]$Region = "us-central1",
    [string]$GeminiModels = "gemini-3-flash-preview,gemini-flash-lite-latest",
    [switch]$EnablePublicDocumentResearch
)

$ErrorActionPreference = "Stop"
if (-not $EnablePublicDocumentResearch) {
    throw "Pass -EnablePublicDocumentResearch to consent to permitted public datasheet retrieval and text processing by Gemini."
}
if ($Project -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw "Invalid project ID." }
if ($Region -ne "us-central1") { throw "This free-allowance demo intentionally uses us-central1." }
$models = @($GeminiModels.Split(",") | Where-Object { $_.Trim() })
if ($models.Count -lt 1 -or $models.Count -gt 2) {
    throw "Provide one or two comma-separated Gemini model IDs available to your account."
}
$gcloudCommand = Get-Command gcloud -ErrorAction SilentlyContinue
if (-not $gcloudCommand) {
    # The installer adds gcloud to PATH only for new terminals; check its standard locations.
    $installed = @(
        "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        "$env:ProgramFiles\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        "${env:ProgramFiles(x86)}\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $installed) {
        throw ("Google Cloud CLI (gcloud) is not installed. Install it with: winget install --id Google.CloudSDK -e " +
            "(or https://cloud.google.com/sdk/docs/install), open a NEW terminal, run: gcloud auth login, then rerun this script.")
    }
    $gcloudCommand = Get-Command $installed
}

function Gcloud {
    & $gcloudCommand @args --project=$Project --quiet
    if ($LASTEXITCODE -ne 0) { throw "gcloud failed. Resolve the error above and rerun; no successful deployment is claimed." }
}

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    Gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com `
        firestore.googleapis.com secretmanager.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com
    foreach ($secret in @("dropin-gemini", "dropin-presenter")) {
        # Check metadata only. Secret contents never pass through this script or build.
        $state = Gcloud secrets versions describe latest --secret=$secret --format="value(state)"
        if ($state -ne "ENABLED") { throw "Secret $secret needs an enabled latest version." }
    }
    $databases = @(Gcloud firestore databases list --format=json | ConvertFrom-Json)
    $database = $databases | Where-Object { $_.name -like "*/databases/(default)" }
    if (-not $database) {
        Gcloud firestore databases create '--database=(default)' --location=$Region --type=firestore-native
    } elseif ($database.type -ne "FIRESTORE_NATIVE") {
        throw "The default database must use Firestore Native mode. Use a compatible project; no database was changed."
    }
    $repositories = @(Gcloud artifacts repositories list --location=$Region --format=json | ConvertFrom-Json)
    if (-not ($repositories | Where-Object { $_.name -like "*/repositories/dropin-demo" })) {
        Gcloud artifacts repositories create dropin-demo --location=$Region --repository-format=docker
    }
    $accounts = @(Gcloud iam service-accounts list --format=json | ConvertFrom-Json)
    foreach ($name in @("dropin-demo", "dropin-demo-build")) {
        $email = "$name@$Project.iam.gserviceaccount.com"
        if (-not ($accounts | Where-Object { $_.email -eq $email })) {
            Gcloud iam service-accounts create $name
        }
    }
    $runtime = "dropin-demo@$Project.iam.gserviceaccount.com"
    $builder = "dropin-demo-build@$Project.iam.gserviceaccount.com"
    Gcloud projects add-iam-policy-binding $Project "--member=serviceAccount:$runtime" --role=roles/datastore.user --condition=None
    foreach ($secret in @("dropin-gemini", "dropin-presenter")) {
        Gcloud secrets add-iam-policy-binding $secret "--member=serviceAccount:$runtime" --role=roles/secretmanager.secretAccessor --condition=None
    }
    foreach ($role in @("roles/artifactregistry.writer", "roles/logging.logWriter", "roles/storage.objectViewer")) {
        Gcloud projects add-iam-policy-binding $Project "--member=serviceAccount:$builder" --role=$role --condition=None
    }
    $image = "$Region-docker.pkg.dev/$Project/dropin-demo/app:$(Get-Date -Format yyyyMMddHHmmss)"
    Gcloud builds submit . --region=$Region --config=deploy/demo-build.yaml "--substitutions=_IMAGE=$image" `
        "--service-account=projects/$Project/serviceAccounts/$builder"
    $settings = @{
        STATE_BACKEND = "firestore"; GOOGLE_CLOUD_PROJECT = $Project
        PUBLIC_DATASHEET_CONSENT = "true"; AUTO_RESEARCH_ENABLED = "true"; GEMINI_MODELS = $GeminiModels
        USER_DAILY_JOBS = "3"; GLOBAL_DAILY_JOBS = "3"; USER_DAILY_ACTIONS = "100"; GLOBAL_DAILY_ACTIONS = "100"
    }
    $file = Join-Path ([IO.Path]::GetTempPath()) ("dropin-demo-" + [guid]::NewGuid().ToString("N") + ".json")
    try {
        $settings | ConvertTo-Json | Set-Content -LiteralPath $file -Encoding ASCII
        Gcloud run deploy dropin-demo --image=$image --region=$Region --allow-unauthenticated `
            "--service-account=$runtime" --env-vars-file=$file `
            '--set-secrets=GEMINI_API_KEY=dropin-gemini:latest,DEMO_ACCESS_CODE=dropin-presenter:latest' `
            --memory=1Gi --cpu=1 --cpu-throttling --min-instances=0 --max-instances=1 `
            --concurrency=10 --timeout=480 --port=8080 `
            '--startup-probe=httpGet.path=/health,httpGet.port=8080,initialDelaySeconds=5,periodSeconds=5,failureThreshold=24'
    } finally {
        Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
    }
    $url = Gcloud run services describe dropin-demo --region=$Region '--format=value(status.url)'
    foreach ($path in @("/", "/health", "/api/inventory")) {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$url$path" -TimeoutSec 120
        if ($response.StatusCode -ne 200) { throw "Deployed service failed HTTP verification at $path." }
    }
    Write-Host ""
    Write-Host "Demo deployed: $url"
    Write-Host "Unlock presenter access using the passcode you stored in Secret Manager."
    Write-Host "Free allowances are NOT a spending cap. Check billing alerts, image storage, Firestore usage and Gemini quota."
    Write-Host "No live Gemini request was made by this script. Complete the acceptance checklist in DEPLOYMENT.md."
} finally {
    Pop-Location
}
