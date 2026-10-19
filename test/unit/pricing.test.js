import assert from "node:assert/strict"
import test from "node:test"
import { applyPricingOverride } from "../../src/usage/pricing.js"

test("pricing override estimates unknown cost and marks provenance", () => {
  const result = applyPricingOverride({ cost: null, tokens: { input: 1000000, output: 100000, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }, { inputPerMillion: 1, outputPerMillion: 10 })
  assert.equal(result.cost, 2)
  assert.equal(result.costSource, "calculated_from_user_override")
})
