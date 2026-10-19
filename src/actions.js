import { appendFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { ACTIONS_FILE, BACKUPS, INDEX_FILE, paths, SETTINGS_FILE } from "./config.js"
import { ensureStorage, loadIndex, loadSettings, readJson, writeJson } from "./storage.js"
import { responseData } from "./core/audit.js"
import { safeError, sanitize } from "./text.js"

function now() {
  return new Date().toISOString()
}

export async function saveOverride(args) {
  await ensureStorage()
  if (args.confirm !== true) return { applied: false, reason: "Explicit confirm=true is required; no settings changed." }
  if (!args.sessionId) return { applied: false, reason: "sessionId is required; no settings changed." }
  const settings = await loadSettings()
  const backup = join(BACKUPS, `override-${Date.now()}.json`)
  await writeJson(backup, { type: "settings-backup", settings, createdAt: now() })
  settings.manualOverrides[args.sessionId] = { ...(settings.manualOverrides[args.sessionId] || {}), ...(args.title ? { title: sanitize(args.title, 96) } : {}), ...(args.topic ? { topic: sanitize(args.topic, 40) } : {}), ...(args.archiveSuggestion ? { archiveSuggestion: sanitize(args.archiveSuggestion, 80) } : {}) }
  await writeJson(SETTINGS_FILE, settings)
  return { applied: true, sessionId: args.sessionId, backup, paths }
}

export function isInside(directory, file) {
  const base = resolve(directory)
  const candidate = resolve(file)
  const value = relative(base, candidate)
  return value === "" || (!value.startsWith("..") && !value.includes(":"))
}

export async function applyRenames(client, currentDirectory, args, writeReports) {
  await ensureStorage()
  if (args.confirm !== true) return { applied: false, reason: "Explicit confirm=true is required; no sessions changed." }
  if (args.move === true) return { applied: false, refusedMove: true, reason: "Move refused: V1 has no supported session.move operation." }
  const index = await loadIndex()
  const selected = Array.isArray(args.sessionIds) ? new Set(args.sessionIds) : null
  if (!args.all && !selected) return { applied: false, reason: "Provide all=true or sessionIds; no sessions changed." }
  const records = Object.values(index.sessions).filter((record) => (args.all || selected.has(record.id)) && !record.ignored)
  const results = []
  for (const record of records) {
    if (record.manualTitlePreservation && !record.explicitTitleOverride) {
      results.push({ id: record.id, result: "skipped", reason: "manual title preserved" })
      continue
    }
    if (!record.proposedTitle || record.proposedTitle === record.currentTitle) {
      results.push({ id: record.id, result: "skipped", reason: "title unchanged" })
      continue
    }
    const backup = join(BACKUPS, `${Date.now()}-${record.id}.json`)
    await writeJson(backup, { type: "session-organizer-backup", before: record, proposedTitle: record.proposedTitle, createdAt: now() })
    try {
      const updated = responseData(await client.session.update({ path: { id: record.id }, query: { directory: record.directory || currentDirectory }, body: { title: record.proposedTitle } }))
      record.currentTitle = sanitize(updated?.title || record.proposedTitle, 160)
      record.manualTitlePreservation = false
      results.push({ id: record.id, result: "renamed", title: record.currentTitle, backup })
      await appendFile(ACTIONS_FILE, `${JSON.stringify({ at: now(), action: "rename", id: record.id, backup })}\n`, "utf8")
    } catch (error) {
      results.push({ id: record.id, result: "failed", error: safeError(error), backup })
    }
  }
  index.updatedAt = now()
  await writeJson(INDEX_FILE, index)
  await writeReports(index, await loadSettings(), [])
  return { applied: true, renamed: results.filter((item) => item.result === "renamed").length, results, move: "skipped/refused: V1 has no session.move", paths }
}

export async function undoRenames(client, currentDirectory, args, writeReports) {
  await ensureStorage()
  if (args.confirm !== true) return { applied: false, reason: "Explicit confirm=true is required; no sessions changed." }
  const files = Array.isArray(args.backupFiles) ? args.backupFiles : []
  if (!files.length) return { applied: false, reason: "backupFiles is required; no sessions changed." }
  const index = await loadIndex()
  const results = []
  for (const file of files) {
    const resolved = resolve(file)
    if (!isInside(BACKUPS, resolved)) {
      results.push({ file, result: "refused", reason: "backup is outside the organizer backup directory" })
      continue
    }
    const backup = await readJson(resolved, null)
    const before = backup?.before
    if (!before?.id || !before.currentTitle) {
      results.push({ file, result: "refused", reason: "invalid session backup" })
      continue
    }
    try {
      await client.session.update({ path: { id: before.id }, query: { directory: before.directory || currentDirectory }, body: { title: before.currentTitle } })
      if (index.sessions[before.id]) {
        index.sessions[before.id].currentTitle = before.currentTitle
        index.sessions[before.id].proposedTitle = before.currentTitle
      }
      results.push({ file, id: before.id, result: "restored", title: before.currentTitle })
      await appendFile(ACTIONS_FILE, `${JSON.stringify({ at: now(), action: "undo-rename", id: before.id, backup: file })}\n`, "utf8")
    } catch (error) {
      results.push({ file, id: before.id, result: "failed", error: safeError(error) })
    }
  }
  index.updatedAt = now()
  await writeJson(INDEX_FILE, index)
  await writeReports(index, await loadSettings(), [])
  return { applied: true, results, paths }
}
