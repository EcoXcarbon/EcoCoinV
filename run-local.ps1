# EcoCoin Local Deployment Helper
# Run this as Administrator in PowerShell

Write-Host "=== EcoCoin Local Deploy Helper ===" -ForegroundColor Cyan

# Step 1: Increase virtual memory (page file) on D drive
Write-Host "`n[1/3] Configuring virtual memory on D drive..." -ForegroundColor Yellow
try {
    $computersys = Get-WmiObject Win32_ComputerSystem -EnableAllPrivileges
    $computersys.AutomaticManagedPagefile = $false
    $computersys.Put() | Out-Null

    # Remove existing page files on all drives first
    $existing = Get-WmiObject -Query "SELECT * FROM Win32_PageFileSetting"
    foreach ($pf in $existing) { $pf.Delete() | Out-Null }

    # Set page file on D drive: 8GB initial, 16GB max
    Set-WmiInstance -Class Win32_PageFileSetting -Arguments @{
        Name        = "D:\pagefile.sys"
        InitialSize = 8192
        MaximumSize = 16384
    } | Out-Null

    Write-Host "  Virtual memory set: D:\pagefile.sys (8GB - 16GB)" -ForegroundColor Green
} catch {
    Write-Host "  Warning: Could not set virtual memory (run as Admin). Continuing..." -ForegroundColor Red
}

# Step 2: Kill memory-hungry background processes
Write-Host "`n[2/3] Freeing RAM by closing background processes..." -ForegroundColor Yellow

$targets = @("chrome", "msedge", "firefox", "SearchHost", "SearchIndexer", "OneDrive", "Teams", "slack", "discord", "Spotify")
foreach ($proc in $targets) {
    $found = Get-Process -Name $proc -ErrorAction SilentlyContinue
    if ($found) {
        Stop-Process -Name $proc -Force -ErrorAction SilentlyContinue
        Write-Host "  Closed: $proc" -ForegroundColor DarkGray
    }
}

# Force garbage collection
[System.GC]::Collect()
Start-Sleep -Seconds 3

$freeAfter = (Get-WmiObject Win32_OperatingSystem).FreePhysicalMemory
Write-Host "  Free RAM now: $([math]::Round($freeAfter/1MB, 1)) GB" -ForegroundColor Green

# Step 3: Run deployment with maximum memory
Write-Host "`n[3/3] Starting deployment..." -ForegroundColor Yellow
Set-Location "E:\fintech\eco coin v"

$env:NODE_OPTIONS = "--max-old-space-size=5120"
node node_modules/hardhat/internal/cli/cli.js run scripts/deploy-polygon-amoy.js --network hardhat --no-compile
