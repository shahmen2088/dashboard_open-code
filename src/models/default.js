import { appendFile, readFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { ACTIONS_FILE, BACKUPS } from "../config.js"
import { loadSettings, writeJson } from "../storage.js"

const MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:@+-]+$/
const confirmations = new Map()

function hash(value) { return createHash("sha256").update(value).digest("hex") }

function targetPath(scope, directory) {
  if (scope === "project") return join(resolve(directory || process.cwd()), "opencode.json")
  const configDir = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode")
  return join(configDir, "opencode.json")
}

async function readConfig(file) {
  let text = "{}"
  try { text = await readFile(file, "utf8") } catch (error) { if (error.code !== "ENOENT") throw error }
  if (/\/\*|\/\/|,\s*[}\]]/.test(text)) return { unsupported: true, text }
  try { return { value: JSON.parse(text), text } } catch { return { unsupported: true, text } }
}

export async function previewDefaultModelChange({ model, scope = "global", directory }) {
  if (!MODEL_ID.test(String(model || ""))) return { ok: false, error: { code: "INVALID_MODEL_ID", message: "Model must use provider/model format." } }
  if (!["global", "project"].includes(scope)) return { ok: false, error: { code: "INVALID_SCOPE", message: "Scope must be global or project." } }
  const file = targetPath(scope, directory)
  const config = await readConfig(file)
  if (config.unsupported) return { ok: false, error: { code: "JSONC_UNSUPPORTED", message: "This configuration contains JSONC syntax; preview only is available until a JSONC-preserving writer is used.", path: file } }
  const value = config.value && typeof config.value === "object" ? config.value : {}
  const oldModel = typeof value.model === "string" ? value.model : null
  const next = { ...value, model }
  const payload = { file, scope, directory: directory || null, oldModel, newModel: model, beforeHash: hash(config.text), next }
  const confirmationId = randomUUID()
  const payloadHash = hash(JSON.stringify(payload))
  confirmations.set(confirmationId, { payloadHash, payload, expiresAt: Date.now() + 5 * 60 * 1000 })
  const settings = await loadSettings()
  return { ok: true, confirmationId, payloadHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), path: file, scope, oldModel, newModel: model, canApply: settings.modelSwitching.allowDefaultConfigWrite === true, diff: { model: { from: oldModel, to: model } } }
}

export async function applyDefaultModelChange({ confirmationId, payloadHash }) {
  const confirmation = confirmations.get(confirmationId)
  if (!confirmation || confirmation.expiresAt < Date.now()) return { ok: false, error: { code: "CONFIRMATION_EXPIRED", message: "Preview confirmation is missing or expired." } }
  if (confirmation.payloadHash !== payloadHash) return { ok: false, error: { code: "PAYLOAD_MISMATCH", message: "Apply payload does not match the preview." } }
  confirmations.delete(confirmationId)
  const settings = await loadSettings()
  if (settings.modelSwitching.allowDefaultConfigWrite !== true) return { ok: false, applied: false, error: { code: "DEFAULT_MODEL_WRITE_DISABLED", message: "Default model writes are disabled in settings." } }
  const { file, beforeHash, next } = confirmation.payload
  const current = await readConfig(file)
  if (current.unsupported || hash(current.text) !== beforeHash) return { ok: false, applied: false, error: { code: "CONFIG_CONFLICT", message: "Configuration changed after preview; no write performed." } }
  const backup = join(BACKUPS, `default-model-${Date.now()}.json`)
  await writeJson(backup, { type: "default-model-backup", path: file, content: current.value, createdAt: new Date().toISOString() })
  await writeJson(file, next)
  await appendFile(ACTIONS_FILE, `${JSON.stringify({ at: new Date().toISOString(), action: "default-model-updated", path: file, backup, model: next.model })}\n`, "utf8")
  return { ok: true, applied: true, path: file, backup, model: next.model }
}
