import assert from "node:assert/strict"
import test from "node:test"
import { normalizeCatalog } from "../../src/models/catalog.js"

test("model catalog normalizes provider metadata, limits, pricing, and variants", () => {
  const catalog = normalizeCatalog({
    connected: ["openai"],
    all: {
      openai: {
        models: {
          "gpt-5": {
            name: "GPT-5",
            limit: { context: 200000, output: 20000 },
            cost: { input: 1.25, output: 10, cacheRead: 0.125 },
            capabilities: { tools: true, reasoning: true },
            variants: { low: {}, high: {} },
          },
        },
      },
      anthropic: { models: { "claude-test": { name: "Claude Test" } } },
    },
  }, "2026-10-19T12:00:00.000Z")
  assert.equal(catalog.source, "sdk")
  assert.deepEqual(catalog.models[0], {
    providerId: "openai",
    modelId: "gpt-5",
    displayName: "GPT-5",
    available: true,
    local: false,
    limits: { context: 200000, input: null, output: 20000 },
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: null },
    capabilities: { tools: true, reasoning: true },
    variants: ["low", "high"],
  })
  assert.equal(catalog.models[1].available, false)
})

test("model catalog accepts a flat model list", () => {
  const catalog = normalizeCatalog({ models: [{ providerID: "local", id: "qwen", local: true }] })
  assert.equal(catalog.models[0].providerId, "local")
  assert.equal(catalog.models[0].local, true)
})
