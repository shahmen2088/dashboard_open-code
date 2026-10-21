# OpenCode Session Organizer

Reusable OpenCode V1 plugin that builds a local, read-only index and dashboard for the current user's sessions.

The project now includes **AI Efficiency Control Center v0.1**: a local SQLite telemetry layer for OpenCode and Codex, with token/model analytics, project and session drill-down, and explicit data-coverage indicators. OpenCode V2 is collected through its supported CLI/API; the legacy organizer plugin remains available for OpenCode V1.

## What It Does

- Reads projects, sessions, child sessions, statuses, and limited message previews through the official OpenCode SDK.
- Generates a searchable local dashboard organized as projects and chats, with topic, status, duplicate, archive, and preview information.
- Refreshes after session events arrive with a short debounce and polls the dashboard endpoint every five seconds.
- Keeps all data local and redacts common secrets before storing excerpts.
- Never accesses `opencode.db` directly.
- Never moves or deletes sessions.
- Never renames sessions automatically. Any rename workflow must be implemented as an explicit confirmed action.
- Imports OpenCode V2 session telemetry through `opencode api` and `opencode stats`, OpenCode V1 assistant usage through the legacy plugin, and available Codex JSONL token records without storing prompt or response bodies in the efficiency database.
- Deduplicates every model call, preserves unknown financial values as unknown, and keeps actual, reported, and API-equivalent cost separate.

The project is designed so every user has an independent store. No machine-specific paths, session snapshots, logs, or secrets belong in this repository.

## Requirements

- OpenCode with the V1 plugin API.
- Node.js 18 or newer for the OpenCode plugin. The standalone Codex-only dashboard requires Node.js 22.5+ (`node:sqlite`).
- OpenCode V2 Desktop is auto-detected from its bundled CLI on Windows. The legacy V1 plugin requires `@opencode-ai/plugin` from the OpenCode runtime.

## Install

Windows PowerShell for the legacy OpenCode V1 plugin:

```powershell
& .\install.ps1
```

macOS/Linux:

```sh
sh ./install.sh
```

The installer copies the plugin to the user's OpenCode plugin directory and creates a settings file only when one does not already exist. It does not overwrite existing user settings unless PowerShell is called with `-ForceSettings`.

The installer detects OpenCode V2 and does not copy the incompatible V1 plugin. For V2, use the local dashboard command below; it automatically connects to the running Desktop service.

After a V1 installation, restart OpenCode and run the `session_organizer_audit` tool. Then run `session_organizer_status` or `session_organizer_diagnose` to get the local dashboard URL.

Open the returned dashboard and select **AI Efficiency**, or append `/efficiency` to its URL.

### OpenCode V2 and Codex dashboard

The standalone server imports the running OpenCode V2 service and local Codex history into the same dashboard:

```powershell
npm run start:efficiency
```

Open `http://127.0.0.1:4177/efficiency`. Set `OPENCODE_EFFICIENCY_PORT` to choose another port. The server binds only to `127.0.0.1`.

The dashboard searches chat title, chat description, project path, and chat ID. Select a project first when working with a large workspace. Each chat detail panel shows a Windows command and a macOS/Linux command in the form `opencode -s <chat-id>`, plus the exact project directory and step-by-step instructions for opening the chat.

## Local Storage

Default storage:

```text
~/.config/opencode/session-organizer/
```

Override it per user with:

```text
OPENCODE_SESSION_ORGANIZER_HOME=/path/to/private/store
```

The generated files are intentionally ignored by Git:

- `index.json` - local session index;
- `settings.json` - local preferences and explicit overrides;
- `efficiency.sqlite` - normalized usage, source health, migrations, and future benchmark/budget records;
- `reports/audit-latest.json` - structured report;
- `reports/dashboard.html` - generated dashboard;
- `actions.log` - short local audit entries;
- `backups/` - local backups for explicit settings changes.

## Safety Model

- Default mode is dry-run and read-only.
- `autoRename` and `autoMove` are false and are not used by the plugin.
- Session content is limited by settings and sanitized before persistence.
- The dashboard server binds to `127.0.0.1` on a random local port.
- Standalone mode binds to `127.0.0.1:4177` by default.
- Mutating API sync requires `OPENCODE_EFFICIENCY_API_TOKEN`; without it, `POST /api/efficiency/sync` returns `403`.
- The dashboard is not an authentication boundary. Do not expose its port outside the local machine.

## Configuration

Copy `config/settings.example.json` only if a new settings file is needed. Important limits include `messagesLimit`, `previewMessagesLimit`, `previewMessageChars`, and `previewMaxChars`.

Use `ignoredSessionIds` and `ignoredProjectDirectories` to exclude local records from proposed actions. Use `manualOverrides` for explicit local metadata; overrides do not modify the source session.

Efficiency settings:

- `efficiencyEnabled` enables the integrated SQLite collector;
- `codexImportEnabled` enables local Codex JSONL import;
- `efficiencySyncMs` controls incremental refresh (minimum 15 seconds, default 60 seconds).

## Efficiency API

Read-only endpoints:

- `GET /api/efficiency/overview`
- `GET /api/efficiency/models`
- `GET /api/efficiency/sessions`
- `GET /api/efficiency/sessions/:id`
- `GET /api/efficiency/projects`
- `GET /api/efficiency/health`
- `GET /api/efficiency/benchmarks`
- `GET /api/efficiency/experiments`
- `GET /api/efficiency/budgets`
- `GET /api/efficiency/events` (integrated OpenCode server)

Optional filters for overview, model, and session queries are `from`, `to`, `project`, `model`, and `provider`.

Current Sprint 1 boundary: Codex does not expose confirmed per-call spend in local JSONL, and no price table is guessed. OpenCode reported cost is imported as reported by the source. Therefore Actual Spend, API-equivalent cost, verified-success cost, and savings remain visibly unknown until authoritative billing, prices, and task evidence are connected in later sprints.

## Tools

- `session_organizer_audit` - build a full local snapshot and regenerate the dashboard;
- `session_organizer_status` - show local paths, settings, and index size;
- `session_organizer_diagnose` - check SDK reachability and dashboard availability;
- `session_organizer_efficiency_backup` - create a consistent SQLite backup under the local `backups/` directory;
- `session_organizer_override` - save local metadata after `confirm=true`;
- `session_organizer_apply` - rename selected records only after `confirm=true`;
- `session_organizer_undo` - restore titles from explicit backup files after `confirm=true`.

## Development

```sh
npm run check
npm test
```

The repository intentionally has no runtime dependency installation step. OpenCode supplies the plugin API when it loads the installed plugin.
