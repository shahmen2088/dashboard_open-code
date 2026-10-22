# Workspace control-center integration

## Delivered scope

The standalone AI Efficiency dashboard is installed in scoped local mode for these workspaces:

- `dashboard-open-code` — Project Control Center;
- `project-agent-os` — shared agent operating system;
- `knowledge-intelligence` — selective Graphify knowledge layer;
- `ai-content-factory` — product repository.

`config/project-registry.json` is intentionally local and ignored by Git because it contains machine-specific paths. The dashboard stores its SQLite state under `.local/session-organizer`, also ignored by Git.

## Data boundary

Only OpenCode and Codex telemetry whose project directory is equal to, or nested below, a registered root is imported. Prompt, response, reasoning, and tool-output bodies are not stored. The dashboard binds to `127.0.0.1` only.

Historical coverage and costs must remain marked unknown or partial unless a source confirms them. An empty dashboard after installation means no recorded session belongs to the configured project roots; it is not treated as zero usage or a successful benchmark.

## Operations

Run `& .\start-local.ps1` from this repository. The service listens on `http://127.0.0.1:4177/efficiency` and refreshes telemetry every minute. Update the local registry to connect an additional project, then restart the service.

## Deferred work

The upstream repository has no project-task, idea, automation, or Telegram connector. Those require a separate data model and an explicit bot credential/permission design. No Telegram integration, external message delivery, or global skill installation is part of this migration.

## Skills review

The repository contains no `SKILL.md` packages. It therefore contributes no skills to install or update. Workspace work continues to use the previously audited Project Agent OS skill set.
