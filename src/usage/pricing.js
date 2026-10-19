function price(tokens, perMillion) {
  return typeof perMillion === "number" && Number.isFinite(perMillion) ? (Number(tokens) || 0) * perMillion / 1_000_000 : 0
}

export function applyPricing(record, override, source = "calculated_from_user_override") {
  if (record.cost !== null && record.cost !== undefined) return record
  if (!override || typeof override !== "object") return record
  const cost = price(record.tokens.input, override.inputPerMillion)
    + price(record.tokens.output, override.outputPerMillion)
    + price(record.tokens.reasoning, override.outputPerMillion)
    + price(record.tokens.cacheRead, override.cacheReadPerMillion)
    + price(record.tokens.cacheWrite, override.cacheWritePerMillion)
  const hasRate = ["inputPerMillion", "outputPerMillion", "cacheReadPerMillion", "cacheWritePerMillion"].some((key) => typeof override[key] === "number")
  return hasRate ? { ...record, cost, costSource: source } : record
}

export function applyPricingOverride(record, override) {
  return applyPricing(record, override, "calculated_from_user_override")
}
