# Uploads the NSP folder to the VPS and installs it as nsp.ppmc.pk
# Usage (PowerShell, from the repo root):  .\fintech\NSP\deploy\deploy-from-windows.ps1 -Key E:\.env-vault\vps_key
param(
  [string]$Key = "E:\.env-vault\vps_key",
  [string]$Vps = "root@157.173.97.213",
  [string]$Domain = "nsp.ppmc.pk"
)
$src = Join-Path $PSScriptRoot ".."
ssh -i $Key $Vps "mkdir -p /opt/nsp"
# copy sources only (no node_modules, data, previews)
$tmp = Join-Path $env:TEMP "nsp-upload"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
robocopy $src $tmp /E /XD node_modules data previews .git /XF *.db *.db-* *.pem .env | Out-Null
scp -i $Key -r "$tmp\*" "${Vps}:/opt/nsp/"
ssh -i $Key $Vps "DOMAIN=$Domain bash /opt/nsp/deploy/install-on-vps.sh"
