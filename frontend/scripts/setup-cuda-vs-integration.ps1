# Copies NVIDIA CUDA MSBuild integration files into Visual Studio BuildCustomizations.
# Run once after installing CUDA (or after upgrading VS). Requires Administrator.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-cuda-vs-integration.ps1

$ErrorActionPreference = "Stop"

$cudaPath = $env:CUDA_PATH
if (-not $cudaPath) {
    Write-Error "CUDA_PATH is not set. Install the CUDA Toolkit and reopen the terminal."
}

$src = Join-Path $cudaPath "extras\visual_studio_integration\MSBuildExtensions"
if (-not (Test-Path $src)) {
    Write-Error "MSBuild integration not found at: $src"
}

$vsRoots = @(
    "${env:ProgramFiles}\Microsoft Visual Studio\18",
    "${env:ProgramFiles}\Microsoft Visual Studio\2022",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022"
)

$destDirs = @()
foreach ($root in $vsRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $custom = Join-Path $_.FullName "MSBuild\Microsoft\VC"
        if (Test-Path $custom) {
            Get-ChildItem -Path $custom -Directory -Filter "v*" | ForEach-Object {
                $bc = Join-Path $_.FullName "BuildCustomizations"
                if (Test-Path $bc) { $destDirs += $bc }
            }
        }
    }
}

$destDirs = $destDirs | Select-Object -Unique
if ($destDirs.Count -eq 0) {
    Write-Error "No Visual Studio BuildCustomizations folders found."
}

Write-Host "Source: $src"
foreach ($dest in $destDirs) {
    Write-Host "Copying CUDA integration -> $dest"
    Copy-Item -Path (Join-Path $src "*") -Destination $dest -Force
    $dll = Get-ChildItem $dest -Filter "Nvda.Build.CudaTasks*.dll" | Select-Object -First 1
    if (-not $dll) {
        Write-Warning "Missing Nvda.Build.CudaTasks*.dll in $dest - CUDA MSBuild may fail."
    }
}

Write-Host ""
Write-Host "Done. Close terminals, then from frontend:"
Write-Host "  cargo clean"
Write-Host '  pnpm run tauri:dev:cuda'
