import assert from "node:assert/strict"
import test from "node:test"
import { previewDefaultModelChange } from "../../src/models/default.js"

test("default model preview rejects invalid model IDs before reading config", async () => {
  const result = await previewDefaultModelChange({ model: "invalid model", scope: "global" })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, "INVALID_MODEL_ID")
})
