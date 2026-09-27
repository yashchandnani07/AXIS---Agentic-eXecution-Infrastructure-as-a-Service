# start-demo.ps1  — Run this once from the repo root.
# Starts the orchestrator (port 4000) and the Control Center UI (port 3000) in two new windows.

$root = $PSScriptRoot

Write-Host ""
Write-Host "  Starting AXIS orchestrator on http://localhost:4000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; pnpm dev:api"

Write-Host "  Starting AXIS Control Center on http://localhost:3000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; pnpm dev:ui"

Write-Host ""
Write-Host "  Both servers are starting in separate windows." -ForegroundColor Green
Write-Host "  Wait ~5 seconds, then open the URL below in your browser:" -ForegroundColor Green
Write-Host "    http://localhost:3000" -ForegroundColor Yellow
Write-Host "    (Or directly: http://localhost:3000/run?id=run_ce28447461&demo=1)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  The 'Inject Vulnerability & Notify' button is on:" -ForegroundColor White
Write-Host "  Overview tab -> DEPLOY + VERIFY panel -> bottom of each provider card" -ForegroundColor White
Write-Host ""
