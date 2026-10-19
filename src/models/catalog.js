import { MODELS_FILE, paths } from "../config.js"
import { ensureStorage, readJson, writeJson } from "../storage.js"
import { responseData } from "../compat/opencode-v1.js"

function objectEntries(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : []
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function modelCost(raw = {}) {
  const cost = raw.cost || raw.pricing || {}
  return {
    input: numberOrNull(cost.input ?? cost.inputPerMillion),
    output: numberOrNull(cost.output ?? cost.outputPerMillion),
    cacheRead: numberOrNull(cost.cacheRead ?? cost.cacheReadPerMillion ?? cost.cache_read),
    cacheWrite: numberOrNull(cost.cacheWrite ?? cost.cacheWritePerMillion ?? cost.cache_write),
  }
}

function modelLimits(raw = {}) {
  const limits = raw.limits || raw.limit || {}
  return {
    context: numberOrNull(limits.context ?? raw.contextLength ?? raw.context),
    input: numberOrNull(limits.input),
    output: numberOrNull(limits.output ?? raw.maxOutput),
  }
}

function modelVariants(raw = {}) {
  if (Array.isArray(raw.variants)) return raw.variants.map(String)
  return raw.variants && typeof raw.variants === "object" ? Object.keys(raw.variants) : []
}

function providerModels(payload) {
  if (Array.isArray(payload?.models)) return payload.models.map((model) => ({ providerId: model.providerID || model.providerId || model.provider || "unknown", modelId: model.id || model.modelID || model.modelId, raw: model }))
  const all = payload?.all || payload?.providers || payload
  const result = []
  for (const [providerId, provider] of objectEntries(all)) {
    const models = provider?.models || provider?.model || {}
    for (const [modelId, raw] of objectEntries(models)) result.push({ providerId, modelId, raw: raw || {} })
  }
  return result.filter((item) => item.modelId)
}

function connectedProviders(payload) {
  const connected = payload?.connected || payload?.enabled || []
  return new Set(Array.isArray(connected) ? connected.map((item) => typeof item === "string" ? item : item?.id || item?.providerID).filter(Boolean) : [])
}

export function normalizeCatalog(payload, updatedAt = new Date().toISOString()) {
  const connected = connectedProviders(payload)
  const models = providerModels(payload).map(({ providerId, modelId, raw }) => ({
    providerId,
    modelId,
    displayName: raw.name || raw.displayName || modelId,
    available: raw.available !== false && (connected.size === 0 || connected.has(providerId)),
    local: Boolean(raw.local || providerId === "local"),
    limits: modelLimits(raw),
    cost: modelCost(raw),
    capabilities: {
      tools: Boolean(raw.capabilities?.tools ?? raw.tool_call ?? raw.toolCalling),
      reasoning: Boolean(raw.capabilities?.reasoning ?? raw.reasoning),
    },
    variants: modelVariants(raw),
  }))
  return { schemaVersion: 2, updatedAt, source: models.length ? "sdk" : "none", models }
}

export async function loadModelCatalog(client) {
  await ensureStorage()
  if (typeof client?.provider?.list === "function") {
    try {
      const payload = responseData(await client.provider.list())
      const catalog = normalizeCatalog(payload)
      if (catalog.models.length) {
        await writeJson(MODELS_FILE, catalog)
        return { ...catalog, paths }
      }
    } catch {
      // Fall through to the last successful cache.
    }
  }
  const cached = await readJson(MODELS_FILE, null)
  if (cached?.schemaVersion === 2) return { ...cached, source: "cache", paths }
  return { schemaVersion: 2, updatedAt: null, source: "none", models: [], paths }
}
