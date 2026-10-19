import assert from "node:assert/strict"
import test from "node:test"
import { call, detectCapabilities, responseData } from "../../src/compat/opencode-v1.js"

test("V1 capability detection reports only methods exposed by the client", () => {
  const capabilities = detectCapabilities({ session: { switchModel: async () => undefined }, model: { list: async () => [] } })
  assert.deepEqual(capabilities, {
    protocol: "v1",
    canListModels: true,
    canSwitchSessionModel: true,
    canUpdateDefaultModel: false,
    canReadUsage: false,
    usageLocation: "none",
  })
})

test("V1 response adapter unwraps SDK data and records failed calls", async () => {
  assert.deepEqual(responseData({ data: { ok: true } }), { ok: true })
  assert.deepEqual(responseData({ ok: true }), { ok: true })
  const errors = []
  assert.equal(await call("fixture", async () => { throw new Error("fixture failure") }, errors), null)
  assert.deepEqual(errors, [{ operation: "fixture", error: "fixture failure" }])
})
