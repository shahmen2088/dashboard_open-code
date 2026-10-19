import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("source does not access forbidden database or auth files", async () => {
  const source = await readFile(new URL("../../src/session-organizer.js", import.meta.url), "utf8")
  assert.doesNotMatch(source, /opencode\.db|auth\.json/i)
})
