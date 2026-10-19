function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function tokenValue(tokens, ...keys) {
  for (const key of keys) {
    const value = numberOrNull(tokens?.[key])
    if (value !== null) return value
  }
  return 0
}

export function normalizeTokens(tokens = {}) {
  const cache = tokens.cache || {}
  const result = {
    input: tokenValue(tokens, "input", "prompt"),
    output: tokenValue(tokens, "output", "completion"),
    reasoning: tokenValue(tokens, "reasoning", "reasoningTokens"),
    cacheRead: tokenValue(tokens, "cacheRead", "cache_read", "cachedInput") || tokenValue(cache, "read"),
    cacheWrite: tokenValue(tokens, "cacheWrite", "cache_write") || tokenValue(cache, "write"),
  }
  result.total = tokenValue(tokens, "total") || Object.values(result).reduce((sum, value) => sum + value, 0)
  return result
}

function hasUsage(value) {
  return Boolean(value && typeof value === "object" && (value.tokens || value.usage || value.cost !== undefined))
}

function usageSource(value) {
  return value?.usage && typeof value.usage === "object" ? value.usage : value || {}
}

function mergeParts(parts) {
  const candidates = (Array.isArray(parts) ? parts : []).filter((part) => part?.type === "step-finish" && hasUsage(part))
  if (!candidates.length) return null
  const merged = { tokens: {}, cost: null, providerID: null, modelID: null, variant: null }
  for (const part of candidates) {
    const source = usageSource(part)
    const tokens = normalizeTokens(source.tokens || source)
    for (const key of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total"]) merged.tokens[key] = (merged.tokens[key] || 0) + tokens[key]
    if (numberOrNull(source.cost) !== null) merged.cost = (merged.cost || 0) + source.cost
    merged.providerID ||= source.providerID || source.providerId || null
    merged.modelID ||= source.modelID || source.modelId || null
    merged.variant ||= source.variant || null
  }
  return merged
}

export function extractUsage(message, session, capturedAt = new Date().toISOString()) {
  const info = message?.info || message
  if (!info || info.role !== "assistant") return null
  const messageId = info.id || message?.id
  if (!messageId) return null
  const direct = hasUsage(info) ? usageSource(info) : null
  const fallback = direct ? null : mergeParts(message?.parts)
  const source = direct || fallback
  if (!source) return null
  const tokens = normalizeTokens(source.tokens || source)
  const reportedCost = numberOrNull(source.cost)
  const cost = reportedCost !== null && reportedCost > 0 ? reportedCost : null
  return {
    schemaVersion: 2,
    usageId: `${session.id}:${messageId}`,
    capturedAt,
    completedAt: info.time?.completed || info.completedAt || null,
    projectId: session.projectId || null,
    projectDirectory: session.projectDirectory || session.directory || null,
    sessionId: session.id,
    messageId,
    providerId: source.providerID || source.providerId || info.providerID || info.providerId || null,
    modelId: source.modelID || source.modelId || info.modelID || info.modelId || null,
    variant: source.variant || info.variant || null,
    tokens,
    cost,
    currency: "USD",
    costSource: cost === null ? "unknown" : "reported_by_opencode",
    status: "complete",
  }
}

export function extractMessageUsage(messages, session, capturedAt) {
  return (Array.isArray(messages) ? messages : []).map((message) => extractUsage(message, session, capturedAt)).filter(Boolean)
}
