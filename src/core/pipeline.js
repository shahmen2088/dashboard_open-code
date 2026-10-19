import { appendFile } from "node:fs/promises"
import { resolve } from "node:path"
import { ACTIONS_FILE, INDEX_FILE, paths } from "../config.js"
import { ensureStorage, loadIndex, loadSettings, writeJson } from "../storage.js"
import { buildRecord, call, collectTree, updateDuplicates } from "./audit.js"
import { extractMessageUsage } from "../usage/extract.js"
import { upsertUsage } from "../usage/ledger.js"

function now() {
  return new Date().toISOString()
}

export async function runAudit(client, currentDirectory, { writeReports }) {
  await ensureStorage()
  const settings = await loadSettings()
  const previous = await loadIndex()
  const errors = []
  const projectsResult = await call("client.project.list", () => client.project.list(), errors)
  const projects = Array.isArray(projectsResult) ? projectsResult : []
  const directories = [...new Set([currentDirectory, ...projects.map((item) => item?.worktree)].filter(Boolean).map((item) => resolve(item)))]
  const roots = []
  for (const directory of directories) {
    const sessions = await call(`client.session.list:${directory}`, () => client.session.list({ query: { directory } }), errors)
    if (Array.isArray(sessions)) roots.push(...sessions)
  }
  const sessions = await collectTree(client, roots, errors)
  const statuses = {}
  const usageRecords = []
  for (const directory of [...new Set(sessions.map((item) => item.directory).filter(Boolean).map((item) => resolve(item)))]) {
    const result = await call(`client.session.status:${directory}`, () => client.session.status({ query: { directory } }), errors)
    if (result && typeof result === "object") Object.assign(statuses, result)
  }
  const records = {}
  for (const session of sessions) {
    const messages = await call(`client.session.messages:${session.id}`, () => client.session.messages({ path: { id: session.id }, query: { directory: session.directory, limit: settings.messagesLimit } }), errors)
    const safeMessages = Array.isArray(messages) ? messages : []
    records[session.id] = await buildRecord(session, safeMessages, statuses, projects, previous.sessions, settings)
    usageRecords.push(...extractMessageUsage(safeMessages, { ...session, projectId: records[session.id].projectId, projectDirectory: records[session.id].projectDirectory }, now()))
  }
  updateDuplicates(records)
  const index = { schemaVersion: 1, protocol: "v1", updatedAt: now(), projects: projects.filter((item) => item?.worktree).map((item) => ({ id: item.id || null, worktree: resolve(item.worktree), vcs: item.vcs || null })), sessions: records }
  await writeJson(INDEX_FILE, index)
  const report = await writeReports(index, settings, errors)
  await appendFile(ACTIONS_FILE, `${JSON.stringify({ at: now(), action: "audit", mode: "full-dry-run", counts: report.counts, errors: errors.length })}\n`, "utf8")
  return { ...report.counts, usage: await upsertUsage(usageRecords), errors, paths }
}
