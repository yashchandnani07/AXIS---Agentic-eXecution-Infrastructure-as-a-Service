# @file setup.ps1
# @purpose One-click teammate developer onboarding on Windows

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "🛰️  AXIS (BobOps) - Automated Windows Setup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Check pnpm
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Installing pnpm via corepack..." -ForegroundColor Yellow
    corepack enable
    corepack prepare pnpm@9.15.0 --activate
}

Write-Host "`nInstalling dependencies..." -ForegroundColor Green
pnpm install

Write-Host "`nRunning automated configuration..." -ForegroundColor Green
pnpm onboard
