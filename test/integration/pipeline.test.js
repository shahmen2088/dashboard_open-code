import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import test from "node:test"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("audit pipeline indexes a root session and its message preview", async () => {
  const store = await mkdtemp(join(tmpdir(), "session-organizer-test-"))
  const previousStore = process.env.OPENCODE_SESSION_ORGANIZER_HOME
  process.env.OPENCODE_SESSION_ORGANIZER_HOME = store
  try {
    const { runAudit } = await import(`../../src/core/pipeline.js?integration=${Date.now()}`)
    const projectDirectory = join(store, "project")
    const session = { id: "ses_fixture", directory: projectDirectory, title: "New session", time: { updated: 1 } }
    const client = {
      project: { list: async () => [{ id: "project_fixture", worktree: projectDirectory }] },
      session: {
        list: async () => [session],
        children: async () => [],
        status: async () => ({ [session.id]: { type: "idle" } }),
        messages: async () => [{ info: { role: "user" }, parts: [{ type: "text", text: "Implement a fixture" }] }],
      },
    }
    let writtenIndex
    const result = await runAudit(client, projectDirectory, {
      writeReports: async (index) => {
        writtenIndex = index
        return { counts: { sessions: Object.keys(index.sessions).length }, generatedAt: "fixture" }
      },
    })
    assert.equal(result.sessions, 1)
    assert.equal(writtenIndex.sessions.ses_fixture.topic, "code")
    const stored = JSON.parse(await readFile(join(store, "index.json"), "utf8"))
    assert.equal(stored.sessions.ses_fixture.shortSummary, "Implement a fixture")
  } finally {
    if (previousStore === undefined) delete process.env.OPENCODE_SESSION_ORGANIZER_HOME
    else process.env.OPENCODE_SESSION_ORGANIZER_HOME = previousStore
    await rm(store, { recursive: true, force: true })
  }
})
