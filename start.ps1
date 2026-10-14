Write-Host ">>> Orchestrating DropIn.ai Architecture..." -ForegroundColor Cyan

# 1. Boot Backend in a minimized background shell
Write-Host "Booting FastAPI Backend (Conda)..." -ForegroundColor Green
Start-Process powershell -WindowStyle Minimized -ArgumentList "-NoExit", "-Command", "conda activate dropin-ai; if (-not $?) { conda activate base }; cd backend; uvicorn app.main:app --reload --port 8080"

# 2. Boot Frontend in a minimized background shell
Write-Host "Booting Next.js Frontend..." -ForegroundColor Blue
Start-Process powershell -WindowStyle Minimized -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

# 3. Wait for the Next.js and Uvicorn servers to bind to their ports
Write-Host "Waiting for servers to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 6

# 4. Launch the dashboard
Write-Host "Launching Command Center..." -ForegroundColor Magenta
Start-Process "http://localhost:3000"

Write-Host "System is live. Close the minimized PowerShell windows on your taskbar to kill the servers later." -ForegroundColor White