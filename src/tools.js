import { tool as defineTool } from "@opencode-ai/plugin"
import { applyRenames, saveOverride, undoRenames } from "./actions.js"
import { paths } from "./config.js"
import { loadIndex, loadSettings } from "./storage.js"
import { runAudit } from "./core/pipeline.js"

export function createTools({ client, directory, enqueue, writeReports, diagnose }) {
  return {
    session_organizer_audit: defineTool({
      description: "Generate a full local read-only audit of OpenCode V1 sessions and refresh the dashboard.",
      args: { refresh: defineTool.schema.boolean().optional() },
      async execute() { const result = await enqueue(() => runAudit(client, directory, { writeReports })); return { title: "Session Organizer audit", output: JSON.stringify(result, null, 2), metadata: result } },
    }),
    session_organizer_status: defineTool({
      description: "Show local Session Organizer paths, settings, and indexed session count.",
      args: {},
      async execute() { const index = await loadIndex(); const settings = await loadSettings(); const result = { updatedAt: index.updatedAt, sessions: Object.keys(index.sessions).length, settings, paths }; return { title: "Session Organizer status", output: JSON.stringify(result, null, 2), metadata: result } },
    }),
    session_organizer_diagnose: defineTool({
      description: "Check OpenCode V1 connectivity, local storage, and dashboard availability.",
      args: {},
      async execute() { const result = await enqueue(() => diagnose(client)); return { title: "Session Organizer diagnostics", output: JSON.stringify(result, null, 2), metadata: result } },
    }),
    session_organizer_override: defineTool({
      description: "Save an explicit local title, topic, or archive override. Requires confirm=true and never changes the source session.",
      args: { confirm: defineTool.schema.boolean(), sessionId: defineTool.schema.string(), title: defineTool.schema.string().optional(), topic: defineTool.schema.string().optional(), archiveSuggestion: defineTool.schema.string().optional() },
      async execute(args) { const result = await enqueue(() => saveOverride(args)); return { title: "Session Organizer override", output: JSON.stringify(result, null, 2), metadata: result } },
    }),
    session_organizer_apply: defineTool({
      description: "Rename selected or all non-manual sessions after explicit confirm=true. Never moves or deletes sessions.",
      args: { confirm: defineTool.schema.boolean(), all: defineTool.schema.boolean().optional(), sessionIds: defineTool.schema.array(defineTool.schema.string()).optional(), move: defineTool.schema.boolean().optional() },
      async execute(args) { const result = await enqueue(() => applyRenames(client, directory, args, writeReports)); return { title: "Session Organizer apply", output: JSON.stringify(result, null, 2), metadata: result } },
    }),
    session_organizer_undo: defineTool({
      description: "Restore titles from explicit Session Organizer backup files. Requires confirm=true.",
      args: { confirm: defineTool.schema.boolean(), backupFiles: defineTool.schema.array(defineTool.schema.string()) },
      async execute(args) { const result = await enqueue(() => undoRenames(client, directory, args, writeReports)); return { title: "Session Organizer undo", output: JSON.stringify(result, null, 2), metadata: result } },
    }),
  }
}
