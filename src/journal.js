import { readFile } from "node:fs/promises"
import { ACTIONS_FILE } from "./config.js"
import { sanitize } from "./text.js"

export async function readJournal({ skip = 0, limit = 100 } = {}) {
  let text = ""
  try { text = await readFile(ACTIONS_FILE, "utf8") } catch { return { items: [], total: 0 } }
  const items = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const item = JSON.parse(line)
      items.push({
        at: item.at || null,
        action: sanitize(item.action, 80),
        id: sanitize(item.id, 160),
        sessionId: sanitize(item.sessionId, 160),
        model: sanitize(item.model, 160),
        result: sanitize(item.result, 80),
        errors: Number(item.errors) || 0,
        counts: item.counts || null,
      })
    } catch {
      items.push({ at: null, action: "invalid-entry", errors: 1 })
    }
  }
  items.reverse()
  return { items: items.slice(Number(skip) || 0, (Number(skip) || 0) + Math.min(Number(limit) || 100, 500)), total: items.length }
}
