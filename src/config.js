import { homedir } from "node:os"
import { join, resolve } from "node:path"

export const STORE = resolve(process.env.OPENCODE_SESSION_ORGANIZER_HOME || join(homedir(), ".config", "opencode", "session-organizer"))
export const REPORTS = join(STORE, "reports")
export const BACKUPS = join(STORE, "backups")
export const INDEX_FILE = join(STORE, "index.json")
export const SETTINGS_FILE = join(STORE, "settings.json")
export const ACTIONS_FILE = join(STORE, "actions.log")
export const AUDIT_JSON = join(REPORTS, "audit-latest.json")
export const AUDIT_CSV = join(REPORTS, "audit-latest.csv")
export const SUMMARY_FILE = join(REPORTS, "summary.md")
export const DASHBOARD_HTML = join(REPORTS, "dashboard.html")
export const USAGE_LEDGER = join(STORE, "usage-ledger.jsonl")
export const USAGE_INDEX = join(STORE, "usage-index.json")

export const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  autoRename: false,
  autoMove: false,
  messagesLimit: 120,
  maxExcerptChars: 420,
  maxStoredText: 1800,
  previewMessagesLimit: 20,
  previewMessageChars: 360,
  previewMaxChars: 6000,
  debounceMs: 1500,
  ignoredSessionIds: [],
  ignoredProjectDirectories: [],
  manualOverrides: {},
}

export const paths = {
  store: STORE,
  index: INDEX_FILE,
  settings: SETTINGS_FILE,
  actions: ACTIONS_FILE,
  auditJson: AUDIT_JSON,
  auditCsv: AUDIT_CSV,
  dashboard: DASHBOARD_HTML,
  dashboardUrl: null,
  summary: SUMMARY_FILE,
  backups: BACKUPS,
  usageLedger: USAGE_LEDGER,
  usageIndex: USAGE_INDEX,
}

export const GENERIC_TITLE = /^(new session|session(?:\s+\d+)?|untitled(?:\s+session)?|opencode session)$/i
