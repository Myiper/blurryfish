# push-all.ps1 — Push to GitHub AND sync backend/ to Hugging Face
#
# Usage (from repo root in PowerShell):
#   .\push-all.ps1                    # Push to both GitHub and Hugging Face
#   .\push-all.ps1 -Branch develop    # Push specific branch to GitHub, then sync HF
#   .\push-all.ps1 -HuggingFaceOnly   # Only sync backend/ to Hugging Face (used by git hook)
#
# Requirements: git and git-lfs must be installed and authenticated for both remotes.

param(
    [string]$Branch = "main",
    [switch]$HuggingFaceOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot

function Write-Step($msg) {
    Write-Host ""
    Write-Host "=== $msg ===" -ForegroundColor Cyan
}

# ─── Step 1: Push to GitHub ───────────────────────────────────────────────────
if (-not $HuggingFaceOnly) {
    Write-Step "Step 1: Pushing to GitHub (origin/$Branch)"
    git -C $RepoRoot push origin $Branch
    Write-Host "✅ GitHub push complete." -ForegroundColor Green
}

# ─── Step 2: Sync backend/ to Hugging Face ────────────────────────────────────
Write-Step "Syncing backend/ to Hugging Face"

$HfUrl = (git -C $RepoRoot remote get-url hf)
$TmpDir = Join-Path $env:TEMP "hf-sync-$(Get-Random)"
$ArchivePath = Join-Path $env:TEMP "backend-export-$(Get-Random).tar"

try {
    # Clone HF repo (shallow, just to get latest state and history)
    # Redirect stderr->stdout so PowerShell doesn't treat git progress as an error
    Write-Host "Cloning Hugging Face repo to temp dir..."
    git clone --depth=1 $HfUrl $TmpDir 2>&1 | Out-Null
    Write-Host "Clone complete."

    # Export only git-tracked files from backend/ using git archive
    # This respects .gitignore and excludes venv/, __pycache__, etc.
    Write-Host "Exporting tracked backend/ files (respects .gitignore)..."
    # Run from repo root so pathspec 'backend/' resolves correctly
    Push-Location $RepoRoot
    git archive HEAD backend/ -o $ArchivePath
    Pop-Location

    # Extract the archive into the HF clone root, stripping the 'backend/' prefix
    # tar is available in Windows 10+ and Git for Windows
    tar -xf "$ArchivePath" -C "$TmpDir" --strip-components=1

    # Stage all changes (additions, modifications, deletions)
    git -C $TmpDir add -A

    # Check if there's anything to commit
    $status = git -C $TmpDir status --porcelain
    if (-not $status) {
        Write-Host "ℹ️  No changes — Hugging Face is already up to date." -ForegroundColor Yellow
    } else {
        $shortHash = git -C $RepoRoot rev-parse --short HEAD
        git -C $TmpDir commit -m "sync: update from GitHub commit $shortHash"
        git -C $TmpDir push origin main 2>&1 | Out-Null
        Write-Host "✅ Hugging Face sync complete." -ForegroundColor Green
    }
} finally {
    Write-Host "Cleaning up temp files..."
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
    Remove-Item -Force $ArchivePath -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "🎉 All done! Both GitHub and Hugging Face are up to date." -ForegroundColor Magenta
