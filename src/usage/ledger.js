import { appendFile, readFile } from "node:fs/promises"
import { USAGE_INDEX, USAGE_LEDGER } from "../config.js"
import { ensureStorage, readJson, writeJson } from "../storage.js"

function sameRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function parseLedger(text) {
  const records = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (record?.usageId) records.set(record.usageId, record)
    } catch {
      // Keep a damaged line isolated; later records remain usable.
    }
  }
  return records
}

export async function loadUsageRecords() {
  await ensureStorage()
  return parseLedger(await readFile(USAGE_LEDGER, "utf8"))
}

function totals(records) {
  const result = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, costKnown: 0, costUnknown: 0, generations: 0 }
  for (const record of records) {
    for (const key of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total"]) result[key] += Number(record.tokens?.[key]) || 0
    result.generations += 1
    if (record.cost === null || record.cost === undefined) result.costUnknown += 1
    else { result.cost += Number(record.cost) || 0; result.costKnown += 1 }
  }
  return result
}

export function buildUsageIndex(records, rebuiltAt = new Date().toISOString()) {
  const values = [...records.values()]
  const byDay = new Map()
  const byProject = new Map()
  const bySession = new Map()
  const byModel = new Map()
  for (const record of values) {
    const day = String(record.completedAt || record.capturedAt || "").slice(0, 10) || "unknown"
    const groups = [[byDay, day], [byProject, record.projectId || record.projectDirectory || "unknown"], [bySession, record.sessionId], [byModel, `${record.providerId || "unknown"}/${record.modelId || "unknown"}`]]
    for (const [map, key] of groups) {
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(record)
    }
  }
  const grouped = (map) => Object.fromEntries([...map.entries()].map(([key, items]) => [key, totals(items)]))
  return {
    schemaVersion: 2,
    lastRebuiltAt: rebuiltAt,
    records: values.length,
    minTimestamp: values.map((item) => item.completedAt || item.capturedAt).filter(Boolean).sort()[0] || null,
    maxTimestamp: values.map((item) => item.completedAt || item.capturedAt).filter(Boolean).sort().at(-1) || null,
    totals: totals(values),
    byDay: grouped(byDay),
    byProject: grouped(byProject),
    bySession: grouped(bySession),
    byModel: grouped(byModel),
  }
}

export async function upsertUsage(records) {
  if (!records.length) return { records: 0, added: 0, updated: 0 }
  const current = await loadUsageRecords()
  const changes = []
  let updated = 0
  for (const record of records) {
    const previous = current.get(record.usageId)
    if (previous && sameRecord(previous, record)) continue
    current.set(record.usageId, record)
    changes.push(JSON.stringify(record))
    if (previous) updated += 1
  }
  if (changes.length) await appendFile(USAGE_LEDGER, `${changes.join("\n")}\n`, "utf8")
  const index = buildUsageIndex(current)
  await writeJson(USAGE_INDEX, index)
  return { records: current.size, added: changes.length - updated, updated }
}

export async function loadUsageIndex() {
  const current = await readJson(USAGE_INDEX, null)
  if (current?.schemaVersion === 2) return current
  return buildUsageIndex(await loadUsageRecords())
}
