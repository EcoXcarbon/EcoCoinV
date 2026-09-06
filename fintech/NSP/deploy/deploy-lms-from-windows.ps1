# Uploads NSP Learning (the LMS) to the VPS and brings it up at nsp.ppmc.pk/lms
# Usage:  .\fintech\NSP\deploy\deploy-lms-from-windows.ps1 -Key E:\.env-vault\vps\talentledger-vps
param(
  [string]$Key = "E:\.env-vault\vps_key",
  [string]$Vps = "root@157.173.97.213",
  [switch]$NoBuild
)
$src = (Resolve-Path (Join-Path $PSScriptRoot "..\lms")).Path
ssh -i $Key $Vps "mkdir -p /opt/nsp-lms"

$tmp = Join-Path $env:TEMP "nsp-lms-upload"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
# Never upload node_modules, a built dist, uploaded course material or secrets:
# the images are built on the VPS and .env files there must survive a redeploy.
robocopy $src $tmp /E /XD node_modules .git dist uploads /XF .env *.log | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE - upload aborted" }
if (-not (Test-Path (Join-Path $tmp "server\src\app.js"))) {
  throw "staged copy is missing server/src - check the /XD exclusions before deploying"
}

scp -i $Key -r "$tmp\*" "${Vps}:/opt/nsp-lms/"
$build = if ($NoBuild) { "0" } else { "1" }
ssh -i $Key $Vps "BUILD=$build bash /opt/nsp-lms/install-lms-on-vps.sh"
