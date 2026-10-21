param(
  [switch]$ForceSettings
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$opencode = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { Join-Path $HOME ".config\opencode" }
$pluginDir = Join-Path $opencode "plugins"
$store = if ($env:OPENCODE_SESSION_ORGANIZER_HOME) { $env:OPENCODE_SESSION_ORGANIZER_HOME } else { Join-Path $opencode "session-organizer" }

New-Item -ItemType Directory -Force -Path $pluginDir, $store | Out-Null
$desktopCliRoot = Join-Path $env:APPDATA "ai.opencode.desktop\cli"
$desktopCli = Get-ChildItem -LiteralPath $desktopCliRoot -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName "opencode-cli.exe" } |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
$isV2 = $false
if ($desktopCli) {
  $detectedVersion = & $desktopCli --version 2>$null
  $isV2 = $detectedVersion -match 'v2\.'
}

if ($isV2) {
  Write-Output "Detected $detectedVersion. The legacy V1 plugin was not copied; run 'npm run start:efficiency' for the V2 dashboard."
} else {
  Copy-Item (Join-Path $repo "src\*.js") $pluginDir -Force
  Write-Output "Installed Session Organizer V1 plugin: $(Join-Path $pluginDir 'session-organizer.js')"
}

$settings = Join-Path $store "settings.json"
if ($ForceSettings -or -not (Test-Path -LiteralPath $settings)) {
  Copy-Item (Join-Path $repo "config\settings.example.json") $settings -Force
}

Write-Output "Local data directory: $store"
if (-not $isV2) { Write-Output "Restart OpenCode, then run session_organizer_audit." }
