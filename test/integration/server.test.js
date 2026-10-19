import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import test from "node:test"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("local API serves models, dashboard data, settings, and protects PATCH", async () => {
  const store = await mkdtemp(join(tmpdir(), "session-organizer-server-"))
  const previousStore = process.env.OPENCODE_SESSION_ORGANIZER_HOME
  process.env.OPENCODE_SESSION_ORGANIZER_HOME = store
  const { startDashboardServer, stopDashboardServer } = await import("../../src/server.js")
  const { paths } = await import("../../src/config.js")
  const { getRequestToken } = await import("../../src/server/security.js")
  try {
    await startDashboardServer({ provider: { list: async () => ({ connected: ["fixture"], all: { fixture: { models: { model: { name: "Fixture" } } } } }) } })
    const base = paths.dashboardUrl
    const models = await fetch(`${base}api/models`).then((response) => response.json())
    assert.equal(models.data.models[0].modelId, "model")
    const dashboard = await fetch(`${base}api/dashboard`).then((response) => response.json())
    assert.equal(typeof dashboard.data.sessions, "number")
    const denied = await fetch(`${base}api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ budgets: { daily: 1 } }) })
    assert.equal(denied.status, 403)
    const updated = await fetch(`${base}api/settings`, { method: "PATCH", headers: { "content-type": "application/json", origin: new URL(base).origin, "x-session-organizer-token": getRequestToken() }, body: JSON.stringify({ budgets: { daily: 1 } }) }).then((response) => response.json())
    assert.equal(updated.data.budgets.daily, 1)
  } finally {
    await stopDashboardServer()
    if (previousStore === undefined) delete process.env.OPENCODE_SESSION_ORGANIZER_HOME
    else process.env.OPENCODE_SESSION_ORGANIZER_HOME = previousStore
    await rm(store, { recursive: true, force: true })
  }
})
