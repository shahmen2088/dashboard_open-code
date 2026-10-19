# OpenCode Session Organizer

Reusable OpenCode V1 plugin that builds a local, read-only index and dashboard for the current user's sessions.

## What It Does

- Reads projects, sessions, child sessions, statuses, and limited message previews through the official OpenCode SDK.
- Generates a searchable local dashboard organized as projects and chats, with topic, status, duplicate, archive, and preview information.
- Refreshes after session events arrive with a short debounce and polls the dashboard endpoint every five seconds.
- Keeps all data local and redacts common secrets before storing excerpts.
- Never accesses `opencode.db` directly.
- Never moves or deletes sessions.
- Never renames sessions automatically. Any rename workflow must be implemented as an explicit confirmed action.

The project is designed so every user has an independent store. No machine-specific paths, session snapshots, logs, or secrets belong in this repository.

## Requirements

- OpenCode with the V1 plugin API.
- Node.js 18 or newer for syntax checks and the local HTTP server.
- The OpenCode runtime must provide `@opencode-ai/plugin`.

## Install

Windows PowerShell:

```powershell
& .\install.ps1
```

macOS/Linux:

```sh
sh ./install.sh
```

The installer copies the plugin to the user's OpenCode plugin directory and creates a settings file only when one does not already exist. It does not overwrite existing user settings unless PowerShell is called with `-ForceSettings`.

Restart OpenCode after installation and run the `session_organizer_audit` tool. Then run `session_organizer_status` or `session_organizer_diagnose` to get the local dashboard URL.

The dashboard searches chat title, chat description, project path, and chat ID. Select a project first when working with a large workspace. Each chat detail panel shows a Windows command and a macOS/Linux command in the form `opencode -s <chat-id>`, plus the exact project directory and step-by-step instructions for opening the chat.

The same index is available through six local views: `Карта`, `Таблица`, `Канбан`, `Хронология`, `Связи`, and `Техника`. The selected view is stored only in browser `localStorage`; switching views does not modify sessions or projects.

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
- `reports/audit-latest.json` - structured report;
- `reports/dashboard.html` - generated dashboard;
- `actions.log` - short local audit entries;
- `backups/` - local backups for explicit settings changes.

## Safety Model

- Default mode is dry-run and read-only.
- `autoRename` and `autoMove` are false and are not used by the plugin.
- Session content is limited by settings and sanitized before persistence.
- The dashboard server binds to `127.0.0.1` on a random local port.
- The dashboard is not an authentication boundary. Do not expose its port outside the local machine.

## Configuration

Copy `config/settings.example.json` only if a new settings file is needed. Important limits include `messagesLimit`, `previewMessagesLimit`, `previewMessageChars`, and `previewMaxChars`.

Use `ignoredSessionIds` and `ignoredProjectDirectories` to exclude local records from proposed actions. Use `manualOverrides` for explicit local metadata; overrides do not modify the source session.

## Tools

- `session_organizer_audit` - build a full local snapshot and regenerate the dashboard;
- `session_organizer_dashboard_reload` - regenerate the local dashboard without restarting OpenCode;
- `session_organizer_status` - show local paths, settings, and index size;
- `session_organizer_diagnose` - check SDK reachability and dashboard availability;
- `session_organizer_override` - save local metadata after `confirm=true`;
- `session_organizer_apply` - rename selected records only after `confirm=true`;
- `session_organizer_undo` - restore titles from explicit backup files after `confirm=true`.

## Development

```sh
npm run check
```

The repository intentionally has no runtime dependency installation step. OpenCode supplies the plugin API when it loads the installed plugin.

The dashboard also exposes a localhost-only `GET`/`POST /api/reload` endpoint. It refreshes the current read-only snapshot and dashboard without restarting OpenCode. Changing the plugin source itself still requires a restart because OpenCode loads plugin modules once per process.
