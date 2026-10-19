export const SECRET_PATTERNS = [
  /(-----BEGIN [^-]+-----)[\s\S]*?(-----END [^-]+-----)/gi,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|private[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /\bbearer\s+[a-z0-9._~+/=-]{8,}/gi,
  /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi,
]

export function sanitize(value, limit = 420) {
  let text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[REDACTED]")
  return text.slice(0, limit)
}

export function safeError(error) {
  return sanitize(error instanceof Error ? error.message : error, 240)
}

export function textParts(message) {
  if (!message || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ")
}

export function boundedText(value, budget, limit) {
  if (budget.remaining <= 0) return ""
  const text = sanitize(value, Math.min(limit, budget.remaining))
  budget.remaining -= text.length
  return text
}
