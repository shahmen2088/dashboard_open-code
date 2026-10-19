import assert from "node:assert/strict"
import test from "node:test"
import { budgetStatus } from "../../src/usage/budgets.js"

test("budget status reports local spend, remaining amount, and warning threshold", () => {
  const result = budgetStatus([{ completedAt: "2026-10-19T08:00:00.000Z", cost: 7, tokens: {} }, { completedAt: "2026-10-19T09:00:00.000Z", cost: null, tokens: {} }], { daily: 10, warningThresholds: [0.7, 0.9, 1] }, "Europe/Moscow", new Date("2026-10-19T10:00:00.000Z"))[0]
  assert.equal(result.amount, 7)
  assert.equal(result.remaining, 3)
  assert.equal(result.warningAt, 0.7)
  assert.equal(result.unknownCost, 1)
})
