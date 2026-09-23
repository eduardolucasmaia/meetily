@echo off
setlocal enabledelayedexpansion

REM Locate Visual Studio (2022, 2026 / v18, Build Tools, etc.) via vswhere
set "VCVARS="
set "VSROOT="
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
    for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
        set "VSROOT=%%i"
        if exist "%%i\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%%i\VC\Auxiliary\Build\vcvars64.bat"
    )
)

REM Fallback paths when vswhere is unavailable
if not defined VCVARS if exist "C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat" (
    set "VSROOT=C:\Program Files\Microsoft Visual Studio\18\Professional"
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VCVARS if exist "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" (
    set "VSROOT=C:\Program Files\Microsoft Visual Studio\18\Community"
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VCVARS if exist "C:\Program Files\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    set "VSROOT=C:\Program Files\Microsoft Visual Studio\18\BuildTools"
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
    set "VSROOT=C:\Program Files\Microsoft Visual Studio\2022\Community"
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VCVARS if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    set "VSROOT=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
    set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    set "VSROOT=C:\Program Files\Microsoft Visual Studio\2022\BuildTools"
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)

if not defined VCVARS (
    echo ERROR: Visual Studio with C++ tools not found. Install "Desktop development with C++".
    exit /b 1
)

set "CUDA_TOOLKIT_VER="
if defined CUDA_PATH (
    for %%i in ("%CUDA_PATH%") do set "CUDA_TOOLKIT_VER=%%~nxi"
)
if not defined CUDA_TOOLKIT_VER (
    for /f "delims=" %%d in ('dir /b /ad /o-n "%ProgramFiles%\NVIDIA GPU Computing Toolkit\CUDA" 2^>nul') do (
        set "CUDA_TOOLKIT_VER=%%d"
        goto :cuda_toolkit_found
    )
)
:cuda_toolkit_found
if not defined CUDA_TOOLKIT_VER (
    echo ERROR: CUDA Toolkit not found. Install NVIDIA CUDA from https://developer.nvidia.com/cuda-downloads
    exit /b 1
)

echo !VSROOT! | findstr /i "\\Microsoft Visual Studio\\18\\" >nul
if not errorlevel 1 (
    echo !CUDA_TOOLKIT_VER! | findstr /i /r "^v1[0-2]\." >nul
    if not errorlevel 1 (
        echo.
        echo ERROR: Visual Studio 2026 requires CUDA Toolkit 13.2 or newer.
        echo Installed: !CUDA_TOOLKIT_VER! ^(incompatible with VS 18 / MSVC 14.5x^)
        echo Install CUDA 13.2+ and re-run scripts\install-cuda-vs-integration.bat as Administrator.
        echo.
        exit /b 1
    )
)

set "CUDA_PROPS_OK=0"
if exist "%VSROOT%\MSBuild\Microsoft\VC\v180\BuildCustomizations\CUDA*.props" set "CUDA_PROPS_OK=1"
if exist "%VSROOT%\MSBuild\Microsoft\VC\v170\BuildCustomizations\CUDA*.props" set "CUDA_PROPS_OK=1"
if "%CUDA_PROPS_OK%"=="0" (
    echo.
    echo ERROR: CUDA Visual Studio integration is missing ^(required for GPU / whisper-rs CUDA build^).
    echo Run once as Administrator:
    echo   %~dp0scripts\install-cuda-vs-integration.bat
    echo.
    echo Then re-run: build-prod.bat
    exit /b 1
)

echo Using Visual Studio environment: !VCVARS!
call "!VCVARS!"

set CARGO_TARGET_DIR=C:\source-private\meetily\target
set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"
set TMP=C:\source-private\meetily\.tmp
set TEMP=C:\source-private\meetily\.tmp
if not exist "%TMP%" mkdir "%TMP%"

REM Next.js downloads Google Fonts at build time; allow corp TLS proxies if needed
if "%NODE_TLS_REJECT_UNAUTHORIZED%"=="" set NODE_TLS_REJECT_UNAUTHORIZED=0

set "FRONTEND=%~dp0frontend"
cd /d "%FRONTEND%"
if not exist "package.json" (
    echo ERROR: frontend package.json not found at %FRONTEND%
    exit /b 1
)

echo === Building Meetily Production (CUDA) ===
call pnpm run tauri:build:cuda:local
exit /b %ERRORLEVEL%
