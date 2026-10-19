function parts(date, timezone) {
  const values = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date)
  return Object.fromEntries(values.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]))
}

function dateKey(date, timezone) {
  const value = parts(date, timezone)
  return `${value.year}-${value.month}-${value.day}`
}

function monthKey(date, timezone) {
  const value = parts(date, timezone)
  return `${value.year}-${value.month}`
}

function weekKey(date, timezone) {
  const value = parts(date, timezone)
  const current = new Date(`${value.year}-${value.month}-${value.day}T00:00:00Z`)
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value.weekday)
  current.setUTCDate(current.getUTCDate() - (weekday === 0 ? 6 : weekday - 1))
  return current.toISOString().slice(0, 10)
}

function matches(record, period, now, timezone) {
  const date = new Date(record.completedAt || record.capturedAt || 0)
  if (period === "daily") return dateKey(date, timezone) === dateKey(now, timezone)
  if (period === "weekly") return weekKey(date, timezone) === weekKey(now, timezone)
  return monthKey(date, timezone) === monthKey(now, timezone)
}

export function budgetStatus(records, budgets = {}, timezone = "Europe/Moscow", now = new Date()) {
  return ["daily", "weekly", "monthly"].map((period) => {
    const limit = typeof budgets[period] === "number" && Number.isFinite(budgets[period]) && budgets[period] >= 0 ? budgets[period] : null
    const selected = records.filter((record) => matches(record, period, now, timezone))
    const amount = selected.reduce((sum, record) => sum + (typeof record.cost === "number" ? record.cost : 0), 0)
    const unknownCost = selected.filter((record) => record.cost === null || record.cost === undefined).length
    const ratio = limit && limit > 0 ? amount / limit : null
    const thresholds = Array.isArray(budgets.warningThresholds) ? budgets.warningThresholds.filter((value) => typeof value === "number").sort((a, b) => a - b) : [0.7, 0.9, 1]
    return { period, limit, amount, remaining: limit === null ? null : Math.max(0, limit - amount), ratio, unknownCost, warningAt: ratio === null ? null : thresholds.filter((threshold) => ratio >= threshold).at(-1) || null, hardStop: Boolean(budgets.hardStop) }
  })
}
