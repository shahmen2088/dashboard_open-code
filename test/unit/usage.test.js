import assert from "node:assert/strict"
import test from "node:test"
import { extractUsage, normalizeTokens } from "../../src/usage/extract.js"
import { aggregateUsage, usageCsv } from "../../src/usage/aggregate.js"

test("usage extraction normalizes token buckets and reported cost", () => {
  const record = extractUsage({
    info: { id: "msg_1", role: "assistant", providerID: "openai", modelID: "gpt-5", cost: 0.42, tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 4, write: 0 } } },
  }, { id: "ses_1", projectId: "project_1", projectDirectory: "C:\\work" }, "2026-10-19T12:00:00.000Z")
  assert.deepEqual(record.tokens, { input: 10, output: 2, reasoning: 1, cacheRead: 4, cacheWrite: 0, total: 17 })
  assert.equal(record.cost, 0.42)
  assert.equal(record.costSource, "reported_by_opencode")
})

test("step-finish is a fallback and zero cost remains unknown", () => {
  const record = extractUsage({
    info: { id: "msg_2", role: "assistant", providerID: "local", modelID: "local-model" },
    parts: [{ type: "step-finish", providerID: "local", modelID: "local-model", tokens: { input: 3, output: 1 }, cost: 0 }],
  }, { id: "ses_2" })
  assert.equal(record.tokens.total, 4)
  assert.equal(record.cost, null)
  assert.equal(record.costSource, "unknown")
})

test("missing usage is not recorded as zero-cost usage", () => {
  assert.equal(extractUsage({ info: { id: "msg_3", role: "assistant", modelID: "gpt-5" } }, { id: "ses_3" }), null)
  assert.deepEqual(normalizeTokens({ input: 2, output: 3 }), { input: 2, output: 3, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 5 })
})

test("usage aggregation supports model filters and CSV export", () => {
  const rows = aggregateUsage([
    { completedAt: "2026-10-19T10:00:00.000Z", providerId: "p", modelId: "m", sessionId: "s1", tokens: { input: 2, output: 1, total: 3 }, cost: 0.2 },
    { completedAt: "2026-10-19T11:00:00.000Z", providerId: "other", modelId: "m2", sessionId: "s2", tokens: { input: 5, output: 1, total: 6 }, cost: null },
  ], { groupBy: "model", modelId: "m" })
  assert.deepEqual(rows.map((row) => row.key), ["p/m"])
  assert.match(usageCsv(rows), /"p\/m","1","2","1"/)
})
