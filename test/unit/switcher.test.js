import assert from "node:assert/strict"
import test from "node:test"
import { applySessionModelChange, previewSessionModelChange } from "../../src/models/switcher.js"

test("model switch preview validates provider/model IDs", async () => {
  const result = await previewSessionModelChange({}, { sessionId: "ses_1", model: "not valid" })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "INVALID_MODEL_ID")
})

test("model apply does not execute without a valid one-time confirmation", async () => {
  const result = await applySessionModelChange({}, { confirmationId: "missing", payloadHash: "missing" })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "CONFIRMATION_EXPIRED")
})
