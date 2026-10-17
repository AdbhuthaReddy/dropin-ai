param(
    [Parameter(Mandatory = $true)][string]$Project,
    [Parameter(Mandatory = $true)][string]$FirebaseApiKey,
    [string]$Region = "us-central1",
    [string]$AuthDomain = "",
    [string]$GeminiModels = "gemini-3-flash-preview,gemini-flash-lite-latest",
    [switch]$EnablePublicDocumentResearch
)

$ErrorActionPreference = "Stop"
if (-not $EnablePublicDocumentResearch) {
    throw "Pass -EnablePublicDocumentResearch to explicitly authorize automatic processing of permitted public datasheets."
}
if ($Project -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw "Invalid GCP project ID." }
if ($Region -notmatch '^[a-z]+-[a-z]+[0-9]$') { throw "Invalid GCP region." }
if (-not $AuthDomain) { $AuthDomain = "$Project.firebaseapp.com" }
Get-Command gcloud -ErrorAction Stop | Out-Null
Get-Command firebase -ErrorAction Stop | Out-Null
function Gcloud {
    & gcloud @args --project=$Project --quiet
    if ($LASTEXITCODE -ne 0) { throw "gcloud failed. Fix the reported error before continuing; rerun is supported." }
}
function Exists {
    & gcloud @args --project=$Project --quiet 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    Gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com `
        firestore.googleapis.com cloudtasks.googleapis.com cloudscheduler.googleapis.com `
        secretmanager.googleapis.com identitytoolkit.googleapis.com
    if (-not (Exists secrets describe dropin-gemini)) {
        throw "Create Secret Manager secret dropin-gemini and add your Gemini key securely in GCP Console first. Never pass it in this script or commit it."
    }
    if (-not (Exists firestore databases describe '--database=(default)')) {
        Gcloud firestore databases create '--database=(default)' --location=$Region --type=firestore-native
    }
    & firebase deploy --only firestore --project $Project --non-interactive
    if ($LASTEXITCODE -ne 0) { throw "Firebase rules deployment failed. Add Firebase to the project first." }
    if (-not (Exists artifacts repositories describe dropin --location=$Region)) {
        Gcloud artifacts repositories create dropin --location=$Region --repository-format=docker
    }
    foreach ($account in @("dropin-runtime", "dropin-tasks", "dropin-build", "dropin-web")) {
        if (-not (Exists iam service-accounts describe "$account@$Project.iam.gserviceaccount.com")) {
            Gcloud iam service-accounts create $account
        }
    }
    $runtime = "dropin-runtime@$Project.iam.gserviceaccount.com"
    $tasks = "dropin-tasks@$Project.iam.gserviceaccount.com"
    $builder = "dropin-build@$Project.iam.gserviceaccount.com"
    foreach ($role in @("roles/artifactregistry.writer", "roles/logging.logWriter", "roles/storage.objectViewer")) {
        Gcloud projects add-iam-policy-binding $Project "--member=serviceAccount:$builder" --role=$role
    }
    foreach ($role in @("roles/datastore.user", "roles/cloudtasks.enqueuer", "roles/firebaseauth.viewer")) {
        Gcloud projects add-iam-policy-binding $Project "--member=serviceAccount:$runtime" --role=$role
    }
    Gcloud secrets add-iam-policy-binding dropin-gemini "--member=serviceAccount:$runtime" --role=roles/secretmanager.secretAccessor
    Gcloud iam service-accounts add-iam-policy-binding $tasks "--member=serviceAccount:$runtime" --role=roles/iam.serviceAccountUser
    $number = Gcloud projects describe $Project --format=value`(projectNumber`)
    if (-not (Exists tasks queues describe research --location=$Region)) {
        Gcloud tasks queues create research --location=$Region
    }
    Gcloud tasks queues update research --location=$Region --max-concurrent-dispatches=2 `
        --max-dispatches-per-second=1 --max-attempts=8 --min-backoff=60s --max-backoff=300s --max-retry-duration=3600s
    Gcloud iam service-accounts add-iam-policy-binding $tasks `
        "--member=serviceAccount:service-$number@gcp-sa-cloudtasks.iam.gserviceaccount.com" --role=roles/iam.serviceAccountTokenCreator
    $tag = Get-Date -Format "yyyyMMddHHmmss"
    $backendImage = "$Region-docker.pkg.dev/$Project/dropin/backend:$tag"
    Gcloud builds submit . --config=deploy/backend-build.yaml "--substitutions=_IMAGE=$backendImage" `
        "--service-account=projects/$Project/serviceAccounts/$builder"
    # Bootstrap with automation off. Runtime target URLs are known only after deployment.
    $settings = @{
        STATE_BACKEND = "firestore"; GOOGLE_CLOUD_PROJECT = $Project
        TASK_REGION = $Region; TASK_QUEUE = "research"; TASK_SERVICE_ACCOUNT = $tasks
        WORKER_URL = "https://bootstrap.invalid"; WORKER_AUDIENCE = "https://bootstrap.invalid"
        PUBLIC_DATASHEET_CONSENT = "true"; AUTO_RESEARCH_ENABLED = "false"
        GEMINI_MODELS = $GeminiModels; USER_DAILY_JOBS = "3"; GLOBAL_DAILY_JOBS = "20"
        USER_DAILY_ACTIONS = "40"; GLOBAL_DAILY_ACTIONS = "400"
        FRONTEND_ORIGINS = "https://$Project.web.app,https://$Project.firebaseapp.com"
    }
    $envFile = Join-Path ([IO.Path]::GetTempPath()) ("dropin-env-" + [guid]::NewGuid().ToString("N") + ".json")
    try {
        $settings | ConvertTo-Json | Set-Content -LiteralPath $envFile -Encoding ASCII
        foreach ($service in @("dropin-api", "dropin-worker")) {
            $access = "--no-allow-unauthenticated"
            if ($service -eq "dropin-api") { $access = "--allow-unauthenticated" }
            $concurrency = "20"; $timeout = "120"; $memory = "2Gi"
            if ($service -eq "dropin-worker") { $concurrency = "1"; $timeout = "600"; $memory = "2Gi" }
            Gcloud run deploy $service --image=$backendImage --region=$Region "--service-account=$runtime" `
                $access --env-vars-file=$envFile --set-secrets=GEMINI_API_KEY=dropin-gemini:latest `
                --memory=$memory --cpu=1 --concurrency=$concurrency --max-instances=2 --timeout=$timeout
        }
        $apiUrl = Gcloud run services describe dropin-api --region=$Region --format=value`(status.url`)
        $workerUrl = Gcloud run services describe dropin-worker --region=$Region --format=value`(status.url`)
        Gcloud run services add-iam-policy-binding dropin-worker --region=$Region "--member=serviceAccount:$tasks" --role=roles/run.invoker
        $settings.WORKER_URL = $workerUrl; $settings.WORKER_AUDIENCE = $workerUrl
        $settings.AUTO_RESEARCH_ENABLED = "true"
        $settings | ConvertTo-Json | Set-Content -LiteralPath $envFile -Encoding ASCII
        foreach ($service in @("dropin-api", "dropin-worker")) {
            Gcloud run services update $service --region=$Region --env-vars-file=$envFile
        }
        $schedulerArgs = @("scheduler", "jobs", "create", "http", "dropin-outbox", "--location=$Region")
        if (Exists scheduler jobs describe dropin-outbox --location=$Region) {
            $schedulerArgs[2] = "update"
        }
        Gcloud @schedulerArgs '--schedule=*/2 * * * *' --time-zone=Etc/UTC --http-method=POST `
            "--uri=$workerUrl/internal/dispatch" "--oidc-service-account-email=$tasks" "--oidc-token-audience=$workerUrl" --attempt-deadline=120s
        $webImage = "$Region-docker.pkg.dev/$Project/dropin/web:$tag"
        Gcloud builds submit . --config=deploy/frontend-build.yaml `
            "--substitutions=_IMAGE=$webImage,_API_URL=$apiUrl,_FIREBASE_API_KEY=$FirebaseApiKey,_AUTH_DOMAIN=$AuthDomain" `
            "--service-account=projects/$Project/serviceAccounts/$builder"
        Gcloud run deploy dropin-web --image=$webImage --region=$Region --allow-unauthenticated `
            "--service-account=dropin-web@$Project.iam.gserviceaccount.com" `
            --memory=512Mi --cpu=1 --concurrency=40 --max-instances=2 --timeout=60
        $webUrl = Gcloud run services describe dropin-web --region=$Region --format=value`(status.url`)
        $settings.FRONTEND_ORIGINS += ",$webUrl"
        $settings | ConvertTo-Json | Set-Content -LiteralPath $envFile -Encoding ASCII
        Gcloud run services update dropin-api --region=$Region --env-vars-file=$envFile
        Invoke-RestMethod "$apiUrl/health" | ConvertTo-Json
        (Invoke-WebRequest $webUrl -UseBasicParsing -TimeoutSec 30).StatusCode | Write-Host
        Write-Host "Cloud Run URL: $webUrl"
        Write-Host "Finish Firebase Google sign-in/authorized domains and Hosting/rules setup in DEPLOYMENT.md."
    } finally {
        if (Test-Path -LiteralPath $envFile) { Remove-Item -LiteralPath $envFile }
    }
} finally { Pop-Location }
