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

# Use Continue so git's stderr progress lines don't become fatal errors.
# We check $LASTEXITCODE manually after each git call instead.
$ErrorActionPreference = "Continue"
$RepoRoot = $PSScriptRoot

function Write-Step($msg) {
    Write-Host ""
    Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function Invoke-Git {
    # Runs a git command, suppresses stderr progress noise, and throws on non-zero exit.
    param([string[]]$Args)
    $result = & git @Args 2>&1
    if ($LASTEXITCODE -ne 0) {
        # Print only actual error lines (not progress/warning noise)
        $result | Where-Object { $_ -notmatch "^\s*(Cloning|Filtering|remote:|Enumerating|Counting|Compressing|Writing|Total|Delta|Resolving)" } | Write-Host
        throw "git $($Args[0]) failed with exit code $LASTEXITCODE"
    }
    return $result
}

# ─── Step 1: Push to GitHub ───────────────────────────────────────────────────
if (-not $HuggingFaceOnly) {
    Write-Step "Step 1: Pushing to GitHub (origin/$Branch)"
    & git -C $RepoRoot push origin $Branch
    if ($LASTEXITCODE -ne 0) { throw "GitHub push failed." }
    Write-Host "✅ GitHub push complete." -ForegroundColor Green
}

# ─── Step 2: Sync backend/ to Hugging Face ────────────────────────────────────
Write-Step "Syncing backend/ to Hugging Face"

$HfUrl = (& git -C $RepoRoot remote get-url hf)
$TmpDir = Join-Path $env:TEMP "hf-sync-$(Get-Random)"
$ArchivePath = Join-Path $env:TEMP "backend-export-$(Get-Random).zip"
$ExtractDir = Join-Path $env:TEMP "backend-extract-$(Get-Random)"

try {
    # Clone HF repo (shallow) — suppress progress noise to stdout
    Write-Host "Cloning Hugging Face repo..."
    & git clone --depth=1 $HfUrl $TmpDir 2>&1 | Out-String | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git clone failed." }
    Write-Host "Clone complete."

    # Export only git-tracked files from backend/ — respects .gitignore
    # No venv/, __pycache__, etc. Uses zip format for native PowerShell extraction.
    Write-Host "Exporting tracked backend/ files..."
    Push-Location $RepoRoot
    & git archive HEAD backend/ --format=zip -o $ArchivePath
    $archiveExit = $LASTEXITCODE
    Pop-Location
    if ($archiveExit -ne 0) { throw "git archive failed." }

    # Extract zip using PowerShell's native Expand-Archive (no tar/path issues)
    # Strip the top-level 'backend/' folder by extracting to a staging dir first
    New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force

    # Copy contents of backend/ subfolder into HF clone root
    $BackendExtracted = Join-Path $ExtractDir "backend"
    if (Test-Path $BackendExtracted) {
        Get-ChildItem -Path $BackendExtracted -Force | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $TmpDir -Recurse -Force
        }
    } else {
        # Fallback: contents already at root of zip
        Get-ChildItem -Path $ExtractDir -Force | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $TmpDir -Recurse -Force
        }
    }

    # Stage all changes
    & git -C $TmpDir add -A

    # Commit and push only if there are changes
    $status = & git -C $TmpDir status --porcelain
    if (-not $status) {
        Write-Host "ℹ️  No changes — Hugging Face is already up to date." -ForegroundColor Yellow
    } else {
        $shortHash = (& git -C $RepoRoot rev-parse --short HEAD)
        & git -C $TmpDir commit -m "sync: update from GitHub commit $shortHash"
        & git -C $TmpDir push origin main 2>&1 | Out-String | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "git push to Hugging Face failed." }
        Write-Host "✅ Hugging Face sync complete." -ForegroundColor Green
    }
} catch {
    Write-Host ""
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
} finally {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
    Remove-Item -Force $ArchivePath -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $ExtractDir -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "🎉 All done! Both GitHub and Hugging Face are up to date." -ForegroundColor Magenta
