import assert from "node:assert/strict"
import test from "node:test"
import { enhanceDashboard } from "../../src/ui/control-center.js"

test("control center enhancement adds panels and keeps the document structure valid", () => {
  const page = enhanceDashboard("<html><head></head><body><section class=\"toolbar\"></section></body></html>")
  assert.match(page, /class="control-center"/)
  assert.match(page, /api\/dashboard/)
  assert.equal((page.match(/<style>/g) || []).length, (page.match(/<\/style>/g) || []).length)
  assert.equal((page.match(/<script>/g) || []).length, (page.match(/<\/script>/g) || []).length)
})
