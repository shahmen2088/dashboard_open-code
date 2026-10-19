import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { isManualTitle, projectFor, topicFor } from "../../src/classification.js"
import { boundedText, safeError, sanitize } from "../../src/text.js"

test("v0.1 report fixture keeps the read-only contract", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/report-v0.1.json", import.meta.url), "utf8"))
  assert.equal(fixture.protocol, "v1")
  assert.equal(fixture.noDatabaseAccess, true)
  assert.equal(fixture.noMoveOrDelete, true)
  assert.equal(fixture.sessions.length, fixture.counts.sessions)
})

test("sanitize removes common secrets and control characters", () => {
  assert.equal(sanitize("api_key=secret\nhello"), "[REDACTED] hello")
  assert.equal(safeError(new Error("password=hidden")), "[REDACTED]")
})

test("boundedText respects the shared budget", () => {
  const budget = { remaining: 5 }
  assert.equal(boundedText("123456789", budget, 100), "12345")
  assert.equal(budget.remaining, 0)
  assert.equal(boundedText("x", budget, 1), "")
})

test("classification preserves topic and project matching behavior", () => {
  assert.equal(topicFor("Fix the broken function"), "bug-fix")
  assert.deepEqual(projectFor("C:\\work\\demo\\src", [{ id: "p", worktree: "C:\\work\\demo" }]), {
    id: "p",
    directory: "C:\\work\\demo",
    match: "nested",
  })
  assert.equal(isManualTitle("New session", undefined), false)
  assert.equal(isManualTitle("My release plan", undefined), true)
})
