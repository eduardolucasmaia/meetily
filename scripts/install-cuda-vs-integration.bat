@echo off
setlocal enabledelayedexpansion

REM Installs NVIDIA CUDA MSBuild extensions into Visual Studio (required for whisper-rs CUDA on Windows).
REM Run this script once as Administrator after installing CUDA Toolkit and Visual Studio.

set "CUDA_ROOT=%ProgramFiles%\NVIDIA GPU Computing Toolkit\CUDA"
set "CUDA_VER="
if defined CUDA_PATH (
    for %%i in ("%CUDA_PATH%") do set "CUDA_VER=%%~nxi"
)
if not defined CUDA_VER (
    for /f "delims=" %%d in ('dir /b /ad /o-n "%CUDA_ROOT%" 2^>nul') do (
        set "CUDA_VER=%%d"
        goto :cuda_found
    )
)
:cuda_found
if not defined CUDA_VER (
    echo ERROR: No CUDA Toolkit found under %CUDA_ROOT%
    exit /b 1
)

set "SRC=%CUDA_ROOT%\%CUDA_VER%\extras\visual_studio_integration\MSBuildExtensions"
if not exist "%SRC%" (
    echo ERROR: CUDA integration files not found at %SRC%
    exit /b 1
)

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VSROOT="
if exist "%VSWHERE%" (
    for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSROOT=%%i"
)
if not defined VSROOT set "VSROOT=%ProgramFiles%\Microsoft Visual Studio\18\Professional"

set "DST="
if exist "%VSROOT%\MSBuild\Microsoft\VC\v180\BuildCustomizations" set "DST=%VSROOT%\MSBuild\Microsoft\VC\v180\BuildCustomizations"
if not defined DST if exist "%VSROOT%\MSBuild\Microsoft\VC\v170\BuildCustomizations" set "DST=%VSROOT%\MSBuild\Microsoft\VC\v170\BuildCustomizations"
if not defined DST (
    echo ERROR: BuildCustomizations folder not found under %VSROOT%
    exit /b 1
)

echo Using CUDA %CUDA_VER%
echo Copying CUDA MSBuild extensions...
echo   From: %SRC%
echo   To:   %DST%
copy /Y "%SRC%\*" "%DST%\" >nul
if errorlevel 1 (
    echo ERROR: Copy failed. Re-run this script as Administrator.
    exit /b 1
)

echo Done. CUDA toolset is available to Visual Studio / CMake.
exit /b 0
