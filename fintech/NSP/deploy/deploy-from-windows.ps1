# Uploads the NSP folder to the VPS and installs it as nsp.ppmc.pk
# Usage (PowerShell, from the repo root):  .\fintech\NSP\deploy\deploy-from-windows.ps1 -Key E:\.env-vault\vps_key
param(
  [string]$Key = "E:\.env-vault\vps_key",
  [string]$Vps = "root@157.173.97.213",
  [string]$Domain = "nsp.ppmc.pk"
)
$src = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
ssh -i $Key $Vps "mkdir -p /opt/nsp"
# copy sources only (no node_modules, runtime data, generated previews)
$tmp = Join-Path $env:TEMP "nsp-upload"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
# /XD with a bare name excludes every matching directory at ANY depth. Passing
# "data" therefore also dropped server/data — the countries, education and
# occupation reference files the app loads at boot — leaving the service in a
# crash loop on "Cannot find module '../data/countries.json'". Exclude the
# runtime directories by full path so only the top-level ones are skipped;
# node_modules and .git stay bare because those should go at any depth.
robocopy $src $tmp /E /XD node_modules .git (Join-Path $src "data") (Join-Path $src "previews") /XF *.db *.db-* *.pem .env | Out-Null
# robocopy exits 0-7 on success and >=8 on failure; anything else means the
# staged copy is incomplete and must not be uploaded.
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE - upload aborted" }
if (-not (Test-Path (Join-Path $tmp "server\data\countries.json"))) {
  throw "staged copy is missing server/data - check the /XD exclusions before deploying"
}
scp -i $Key -r "$tmp\*" "${Vps}:/opt/nsp/"
ssh -i $Key $Vps "DOMAIN=$Domain bash /opt/nsp/deploy/install-on-vps.sh"
