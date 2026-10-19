import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { isInside } from "../../src/actions.js"

test("source does not access forbidden database or auth files", async () => {
  const source = await readFile(new URL("../../src/session-organizer.js", import.meta.url), "utf8")
  assert.doesNotMatch(source, /opencode\.db|auth\.json/i)
})

test("backup path validation rejects paths outside the backup directory", () => {
  assert.equal(isInside(".", "./one.json"), true)
  assert.equal(isInside(".", "../one.json"), false)
})
