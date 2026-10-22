# Optional direct skill-event adapters

The dashboard works without these adapters by incrementally importing supported local Codex JSONL and OpenCode API records. Direct hooks reduce delay and improve evidence quality, but they are not installed automatically because both products require the user to review and trust local hooks or plugins.

## Codex

`codex/skill-event-hook.mjs` accepts the official `PostToolUse` JSON on stdin, filters locally for a `SKILL.md` path, and sends only skill-event metadata to the loopback collector. Copy the relevant entry from `codex/hooks.example.json` into a trusted Codex hook layer and replace the absolute path. Set `OPENCODE_EFFICIENCY_API_TOKEN` in both the dashboard and Codex process environments.

This adapter proves that a skill file was loaded. It does not prove that every instruction was executed or that the task succeeded. The official Codex event catalog inspected for this release does not document `codex.skill_invocation`, so the dashboard does not claim that event is available.

## OpenCode V2

`opencode-v2/ai-analytics.js` uses the V2 `ctx.tool.hook("execute.after", ...)` interface. Install it only after reviewing it, using the project or user plugin location supported by the installed OpenCode version. It sends metadata for the built-in `skill` tool and direct `read` calls targeting `SKILL.md`; it never sends tool input, output, prompts, or file contents.

Both adapters use a 250 ms best-effort timeout and swallow collector failures so analytics cannot block agent work.
