@echo off
echo === Cleaning Next.js cache ===
if exist ".next" rd /s /q ".next"

echo === Starting dev server ===
pnpm dev
