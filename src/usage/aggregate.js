function dayInTimezone(value, timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value))
  } catch {
    return String(value || "").slice(0, 10)
  }
}

function inRange(record, from, to) {
  const value = new Date(record.completedAt || record.capturedAt || 0).getTime()
  return (!from || value >= new Date(from).getTime()) && (!to || value <= new Date(to).getTime())
}

function matchesFilters(record, options) {
  return (!options.projectId || record.projectId === options.projectId)
    && (!options.sessionId || record.sessionId === options.sessionId)
    && (!options.providerId || record.providerId === options.providerId)
    && (!options.modelId || record.modelId === options.modelId)
}

export function aggregateUsage(records, { from, to, timezone = "Europe/Moscow", groupBy = "day", projectId, sessionId, providerId, modelId } = {}) {
  const groups = new Map()
  for (const record of records) {
    if (!inRange(record, from, to) || !matchesFilters(record, { projectId, sessionId, providerId, modelId })) continue
    const key = groupBy === "project" ? record.projectId || record.projectDirectory || "unknown"
      : groupBy === "session" ? record.sessionId
        : groupBy === "provider" ? record.providerId || "unknown"
          : groupBy === "model" ? `${record.providerId || "unknown"}/${record.modelId || "unknown"}`
            : dayInTimezone(record.completedAt || record.capturedAt, timezone)
    if (!groups.has(key)) groups.set(key, { key, records: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, unknownCost: 0 })
    const target = groups.get(key)
    target.records += 1
    for (const field of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total"]) target[field] += Number(record.tokens?.[field]) || 0
    if (record.cost === null || record.cost === undefined) target.unknownCost += 1
    else target.cost += Number(record.cost) || 0
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function usageCsv(rows) {
  const header = ["key", "records", "input", "output", "reasoning", "cacheRead", "cacheWrite", "total", "cost", "unknownCost"]
  return `${[header, ...rows.map((row) => header.map((field) => row[field]))].map((line) => line.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")}\n`
}
