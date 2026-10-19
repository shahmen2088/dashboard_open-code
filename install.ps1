param(
  [switch]$ForceSettings
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$opencode = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { Join-Path $HOME ".config\opencode" }
$pluginDir = Join-Path $opencode "plugins"
$store = if ($env:OPENCODE_SESSION_ORGANIZER_HOME) { $env:OPENCODE_SESSION_ORGANIZER_HOME } else { Join-Path $opencode "session-organizer" }

New-Item -ItemType Directory -Force -Path $pluginDir, $store | Out-Null
Copy-Item (Join-Path $repo "src\session-organizer.js") (Join-Path $pluginDir "session-organizer.js") -Force

$settings = Join-Path $store "settings.json"
if ($ForceSettings -or -not (Test-Path -LiteralPath $settings)) {
  Copy-Item (Join-Path $repo "config\settings.example.json") $settings -Force
}

Write-Output "Installed Session Organizer plugin: $(Join-Path $pluginDir 'session-organizer.js')"
Write-Output "Local data directory: $store"
Write-Output "Restart OpenCode, then run session_organizer_audit."
