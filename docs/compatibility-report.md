# Compatibility Report — AI Efficiency Control Center v0.1

Date: 2026-10-21

## Existing architecture

`dashboard_open-code` is a dependency-free OpenCode V1 plugin. It already provides a local HTTP server, generated HTML dashboard, per-user storage, secret redaction, and SDK-based session/message collection. Extending this server and dashboard is smaller and safer than creating a second application.

## Verified interfaces

### OpenCode

- OpenCode Desktop **v2.0.32** is installed and was running during the audit. Its bundled CLI is under `%APPDATA%\ai.opencode.desktop\cli\2.0.32-x64\opencode-cli.exe`; it is not registered as `opencode` in the system `PATH`.
- The V2 adapter uses supported read-only commands: `opencode api GET /api/session`, `opencode api GET /api/session/:id/message`, and `opencode stats --all --full --json`.
- The live V2 API exposes session-level model, provider, cost, input/output/reasoning/cache tokens, tool states, compaction events, and outcomes. Message text is discarded and never inserted into the efficiency database.
- Live verification imported one OpenCode session, three OpenCode models in source statistics, tool success/failure totals, and a reported cost of zero for the free models used.
- The existing V1 plugin adapter remains for older installations, but it is not installed into V2 because the plugin contract differs.
- The implementation never queries `opencode.db` directly.

References:

- https://docs.opencode.ai/docs/sdk/
- https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/v1/session.ts

### Codex

- Installed CLI: `codex-cli 0.163.0-alpha.10.2`.
- Local session JSONL under `%USERPROFILE%\.codex\sessions` contains `session_meta`, `turn_context`, and `token_usage_record` records.
- `usage.input_tokens` includes cached input; `reasoning_output_tokens` is a subset of output; `total_tokens` equals input plus output in the inspected records. The adapter therefore derives uncached input and does not add cached or reasoning tokens a second time.
- Prompt, response, reasoning, and tool output bodies are ignored. Only telemetry fields and local project identity are stored.
- Desktop/CLI history completeness is not guaranteed; historical coverage is reported as unknown/partial until a documented complete export exists. Token-field completeness is tracked separately.

## Storage decision

SQLite is provided without third-party dependencies:

- Node.js standalone mode uses `node:sqlite` and therefore requires Node.js 22.5+.
- OpenCode's Bun runtime can use the `bun:sqlite` compatibility adapter.
- Versioned migration 1 creates the Sprint 1 core plus forward-compatible Sprint 2–5 tables.

## Compatibility and limits

- Existing chat organizer behavior and URLs are preserved.
- The efficiency UI is mounted at `/efficiency` on the same local server. On V2 the server is started with `npm run start:efficiency` and connects to the Desktop background service.
- The database is local and not an authentication boundary; the server remains bound to `127.0.0.1`.
- No API prices are bundled because price data is time-dependent. Unknown cost is not converted to zero.
- Codex local logs do not provide confirmed billing amounts or verified task outcomes.
- Benchmark and experiment tables/endpoints exist, but paid runs and Sprint 2–5 behavior are intentionally not implemented.
