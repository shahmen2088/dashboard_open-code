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
  const currentUsage = current.usage && typeof current.usage === "object" ? current.usage : {}
  const currentBudgets = current.budgets && typeof current.budgets === "object" ? current.budgets : {}
  const currentDashboard = current.dashboard && typeof current.dashboard === "object" ? current.dashboard : {}
  const currentSwitching = current.modelSwitching && typeof current.modelSwitching === "object" ? current.modelSwitching : {}
  const currentSecurity = current.security && typeof current.security === "object" ? current.security : {}
  const settings = {
    ...DEFAULT_SETTINGS,
    ...current,
    schemaVersion: 2,
    dashboard: { ...DEFAULT_SETTINGS.dashboard, ...currentDashboard },
    usage: { ...DEFAULT_SETTINGS.usage, ...currentUsage, pricingOverrides: currentUsage.pricingOverrides && typeof currentUsage.pricingOverrides === "object" ? currentUsage.pricingOverrides : {} },
    budgets: { ...DEFAULT_SETTINGS.budgets, ...currentBudgets, warningThresholds: Array.isArray(currentBudgets.warningThresholds) ? currentBudgets.warningThresholds : DEFAULT_SETTINGS.budgets.warningThresholds },
    modelSwitching: { ...DEFAULT_SETTINGS.modelSwitching, ...currentSwitching },
    security: { ...DEFAULT_SETTINGS.security, ...currentSecurity },
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
