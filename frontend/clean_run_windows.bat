@echo off
cd /d "%~dp0"

echo Cleaning npm dependencies...
rd /s /q node_modules
del /f /q package-lock.json

echo Installing npm dependencies...
pnpm install

echo Building the project...
REM If CUDA/CMake fails, uncomment: set TAURI_GPU_FEATURE=none
pnpm run tauri dev
