#!/usr/bin/env bash
# @file setup.sh
# @purpose One-click teammate developer onboarding on macOS/Linux

set -e

echo "============================================================"
echo "🛰️  AXIS (BobOps) - Automated Unix/macOS Setup"
echo "============================================================"

if ! command -v pnpm &> /dev/null; then
    echo "pnpm not found. Enabling via corepack..."
    corepack enable
    corepack prepare pnpm@9.15.0 --activate
fi

echo "Installing workspace dependencies..."
pnpm install

echo "Running environment configuration..."
pnpm onboard
