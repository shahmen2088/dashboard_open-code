param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 4177
)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$registry = Join-Path $repo "config\project-registry.json"
if (-not (Test-Path -LiteralPath $registry)) {
  throw "Create config\project-registry.json from config\project-registry.example.json before starting the control center."
}

$env:OPENCODE_SESSION_ORGANIZER_HOME = Join-Path $repo ".local\session-organizer"
$env:OPENCODE_EFFICIENCY_PROJECT_REGISTRY = $registry
$env:OPENCODE_EFFICIENCY_PORT = [string]$Port
& node (Join-Path $repo "src\efficiency-standalone.js")
