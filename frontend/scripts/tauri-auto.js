#!/usr/bin/env node
/**
 * Auto-detect GPU and run Tauri with appropriate features
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Get the command (dev or build) and optional forced feature (cuda, vulkan, none, ...)
const command = process.argv[2];
const cliFeature = process.argv[3];
if (!command || !['dev', 'build'].includes(command)) {
  console.error('Usage: node tauri-auto.js [dev|build] [cuda|vulkan|none|...]');
  process.exit(1);
}

// Detect GPU feature
let feature = '';

if (cliFeature) {
  feature = cliFeature;
  console.log(`🔧 Using GPU feature from CLI: ${feature}`);
} else if (process.env.TAURI_GPU_FEATURE) {
  feature = process.env.TAURI_GPU_FEATURE;
  console.log(`🔧 Using forced GPU feature from environment: ${feature}`);
} else {
  try {
    const result = execSync('node scripts/auto-detect-gpu.js', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit']
    });
    feature = result.trim();
  } catch (err) {
    // If detection fails, continue with no features
  }
}

console.log(''); // Empty line for spacing

// Platform-specific environment variables
const platform = os.platform();
const env = { ...process.env };

if (platform === 'linux' && feature === 'cuda') {
  console.log('🐧 Linux/CUDA detected: Setting CMAKE flags for NVIDIA GPU');
  env.CMAKE_CUDA_ARCHITECTURES = '75';
  env.CMAKE_CUDA_STANDARD = '17';
  env.CMAKE_POSITION_INDEPENDENT_CODE = 'ON';
}

if (platform === 'win32' && feature === 'cuda') {
  console.log('🪟 Windows/CUDA: setting CMAKE flags (RTX 3050 = sm_86; override CMAKE_CUDA_ARCHITECTURES if needed)');
  if (!env.CMAKE_CUDA_ARCHITECTURES) {
    env.CMAKE_CUDA_ARCHITECTURES = '86';
  }
  const cudaFlagParts = [
    '-allow-unsupported-compiler',
    '-D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH',
    '-Xcompiler=/Zc:preprocessor',
  ];
  const existing = env.CMAKE_CUDA_FLAGS || '';
  env.CMAKE_CUDA_FLAGS = [...cudaFlagParts, existing].filter(Boolean).join(' ');
  if (!env.CUDA_PATH && process.env.CUDA_PATH) {
    env.CUDA_PATH = process.env.CUDA_PATH;
  }
}

// Build the tauri command (pnpm exec so `tauri` resolves when spawned from node)
let tauriCmd = `pnpm exec tauri ${command}`;
if (feature && feature !== 'none') {
  tauriCmd += ` -- --features ${feature}`;
  console.log(`🚀 Running: tauri ${command} with features: ${feature}`);
} else {
  console.log(`🚀 Running: tauri ${command} (CPU-only mode)`);
}
console.log('');

// Execute the command
try {
  execSync(tauriCmd, { stdio: 'inherit', env, cwd: path.join(__dirname, '..') });
} catch (err) {
  process.exit(err.status || 1);
}
