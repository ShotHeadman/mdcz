$ErrorActionPreference = "Stop"

$RequiredMajor = 24
$Root = $PSScriptRoot
Set-Location $Root

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodeMajor = [int](& node -p "Number(process.versions.node.split('.')[0])")
  $nodeVersion = & node -v
  if ($nodeMajor -ge $RequiredMajor) {
    Write-Host "Node $nodeVersion detected; skipping Node installation."
  } else {
    Write-Error "Node $nodeVersion detected, but MDCz WebUI requires Node $RequiredMajor or newer. Install Node $RequiredMajor+ and run this script again."
    exit 1
  }
} else {
  Write-Error "Node.js is not installed. Install Node $RequiredMajor+ and run this script again."
  exit 1
}

$envPath = Join-Path $Root ".env"
$examplePath = Join-Path $Root ".env.example"
if (-not (Test-Path -LiteralPath $envPath) -and (Test-Path -LiteralPath $examplePath)) {
  Copy-Item -LiteralPath $examplePath -Destination $envPath
  Write-Host "Created .env from .env.example."
}

corepack pnpm@10.28.2 install --prod --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Runtime dependency installation failed" }

Write-Host "MDCz WebUI dependencies are ready. Start with: .\start.bat"
