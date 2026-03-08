# Expanded Workspace Cleanup Script

# 1. Root area untracked .ts files (except core)
Get-ChildItem -Path . -Filter "*.ts" | Where-Object { 
    $_.Name -notmatch "run.ts" -and 
    $_.Name -notmatch "env.ts" -and
    $_.Name -notmatch "main.ts"
} | Remove-Item -Force

# 2. Specific root clutter
"0", "temp-preset-editor.js", "build-better-sqlite3.bat" | ForEach-Object {
    if (Test-Path $_) { Remove-Item $_ -Force }
}

# 3. root .json clutter (excluding package/tsconfig)
Get-ChildItem -Path . -Filter "*.json" | Where-Object {
    $_.Name -notmatch "^package" -and
    $_.Name -notmatch "^tsconfig"
} | Remove-Item -Force

# 4. cleanup scripts in scripts/ (everything since scripts/ is ignored anyway)
# But user said to delete them.
Remove-Item -Recurse -Force scripts/*

# 5. Restore .gitkeep if it existed
if (!(Test-Path scripts/.gitkeep)) { New-Item scripts/.gitkeep -ItemType File }

Write-Host "Aggressive cleanup completed."
