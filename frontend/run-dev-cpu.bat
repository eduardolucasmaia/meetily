@echo off
setlocal enabledelayedexpansion

echo === Freeing port 3118 ===
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3118 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

call "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1

set "CARGO_TARGET_DIR=c:\source-private\meetily\target"

echo === Cleaning whisper-rs cache ===
cd /d c:\source-private\meetily\frontend\src-tauri
cargo clean -p whisper-rs-sys -p whisper-rs
if errorlevel 1 exit /b 1

echo === Building whisper-rs-sys ===
cargo build -p whisper-rs-sys
if errorlevel 1 exit /b 1

echo === Building llama-helper ===
cd /d c:\source-private\meetily
cargo build -p llama-helper
if errorlevel 1 exit /b 1

if not exist "frontend\src-tauri\binaries" mkdir "frontend\src-tauri\binaries"
copy /Y "target\debug\llama-helper.exe" "frontend\src-tauri\binaries\llama-helper-x86_64-pc-windows-msvc.exe"
if errorlevel 1 exit /b 1

echo === Starting Tauri dev (CPU) ===
cd frontend
pnpm run tauri:dev:cpu
