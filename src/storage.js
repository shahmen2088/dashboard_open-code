import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { ACTIONS_FILE, BACKUPS, DEFAULT_SETTINGS, INDEX_FILE, REPORTS, SETTINGS_FILE, USAGE_LEDGER } from "./config.js"

export function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

export async function writeJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}`
  await writeFile(temporary, json(value), "utf8")
  await rename(temporary, file)
}

export async function ensureStorage() {
  await mkdir(REPORTS, { recursive: true })
  await mkdir(BACKUPS, { recursive: true })
  await appendFile(ACTIONS_FILE, "", { encoding: "utf8", flag: "a" })
  await appendFile(USAGE_LEDGER, "", { encoding: "utf8", flag: "a" })
}

export async function loadSettings() {
  const current = await readJson(SETTINGS_FILE, {})
  const settings = {
    ...DEFAULT_SETTINGS,
    ...current,
    ignoredSessionIds: Array.isArray(current.ignoredSessionIds) ? current.ignoredSessionIds : [],
    ignoredProjectDirectories: Array.isArray(current.ignoredProjectDirectories) ? current.ignoredProjectDirectories : [],
    manualOverrides: current.manualOverrides && typeof current.manualOverrides === "object" ? current.manualOverrides : {},
  }
  await writeJson(SETTINGS_FILE, settings)
  return settings
}

export async function loadIndex() {
  const current = await readJson(INDEX_FILE, {})
  return {
    schemaVersion: 1,
    updatedAt: current.updatedAt || null,
    projects: Array.isArray(current.projects) ? current.projects : [],
    sessions: current.sessions && typeof current.sessions === "object" ? current.sessions : {},
  }
}
