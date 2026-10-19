import { createHash, randomUUID } from "node:crypto"
import { appendFile } from "node:fs/promises"
import { ACTIONS_FILE } from "../config.js"
import { responseData } from "../compat/opencode-v1.js"
import { loadModelCatalog } from "./catalog.js"

const MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:@+-]+$/
const confirmations = new Map()

function hashPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

function parseModel(model) {
  if (typeof model !== "string" || !MODEL_ID.test(model)) return null
  const separator = model.indexOf("/")
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1), model }
}

function modelFromSession(session) {
  const value = session?.model || session?.info?.model || session?.currentModel
  if (typeof value === "string") return value
  const provider = session?.providerID || session?.providerId || session?.info?.providerID
  const model = session?.modelID || session?.modelId || session?.info?.modelID
  return provider && model ? `${provider}/${model}` : null
}

function fallback(sessionId, model) {
  return {
    mode: "command",
    command: `opencode --session ${sessionId} --model ${model}`,
    instruction: "Откройте чат с этой моделью или выберите модель через /models. Смена через текущий SDK недоступна.",
  }
}

async function readSession(client, sessionId, directory) {
  if (typeof client?.session?.get !== "function") return null
  return responseData(await client.session.get({ path: { id: sessionId }, query: { directory } }))
}

export async function previewSessionModelChange(client, { sessionId, directory, model }) {
  const target = parseModel(model)
  if (!sessionId || !target) return { ok: false, error: { code: "INVALID_MODEL_ID", message: "Model must use provider/model format." } }
  const catalog = await loadModelCatalog(client)
  const known = catalog.models.find((item) => `${item.providerId}/${item.modelId}` === target.model)
  if (catalog.models.length && !known) return { ok: false, error: { code: "MODEL_NOT_FOUND", message: "Model is not present in the current OpenCode catalog." } }
  const session = await readSession(client, sessionId, directory)
  const oldModel = modelFromSession(session)
  const capability = typeof client?.session?.switchModel === "function" ? "SDK" : "command"
  const payload = { sessionId, directory: directory || null, oldModel, newModel: target.model, capability }
  const confirmationId = randomUUID()
  const payloadHash = hashPayload(payload)
  confirmations.set(confirmationId, { payloadHash, payload, expiresAt: Date.now() + 5 * 60 * 1000 })
  return { ok: true, confirmationId, payloadHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), ...payload, mode: capability === "SDK" ? "SDK" : "команда", fallback: capability === "SDK" ? null : fallback(sessionId, target.model) }
}

export async function applySessionModelChange(client, { confirmationId, payloadHash }) {
  const confirmation = confirmations.get(confirmationId)
  if (!confirmation || confirmation.expiresAt < Date.now()) return { ok: false, error: { code: "CONFIRMATION_EXPIRED", message: "Preview confirmation is missing or expired." } }
  if (confirmation.payloadHash !== payloadHash) return { ok: false, error: { code: "PAYLOAD_MISMATCH", message: "Apply payload does not match the preview." } }
  confirmations.delete(confirmationId)
  const { sessionId, directory, newModel } = confirmation.payload
  const target = parseModel(newModel)
  if (!target) return { ok: false, error: { code: "INVALID_MODEL_ID", message: "Model must use provider/model format." } }
  if (typeof client?.session?.switchModel !== "function") return { ok: false, applied: false, fallback: fallback(sessionId, newModel), error: { code: "MODEL_SWITCH_UNSUPPORTED", message: "OpenCode SDK does not expose session model switching." } }
  try {
    await client.session.switchModel({ path: { id: sessionId }, query: { directory }, body: { providerID: target.providerID, modelID: target.modelID } })
    const session = await readSession(client, sessionId, directory)
    const actualModel = modelFromSession(session)
    if (actualModel !== newModel) return { ok: false, applied: false, error: { code: "MODEL_SWITCH_UNCONFIRMED", message: "OpenCode did not confirm the requested model after the switch.", actualModel } }
    await appendFile(ACTIONS_FILE, `${JSON.stringify({ at: new Date().toISOString(), action: "model-switch-applied", sessionId, model: newModel })}\n`, "utf8")
    return { ok: true, applied: true, mode: "SDK", sessionId, model: actualModel }
  } catch (error) {
    return { ok: false, applied: false, error: { code: "MODEL_SWITCH_FAILED", message: String(error?.message || error) } }
  }
}
