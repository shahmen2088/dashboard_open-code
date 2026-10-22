import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createEfficiencyStore } from "../src/efficiency-center.js"
import {
  discoverSkillInstallations,
  extractCodexSkillEvidence,
  extractOpenCodeSkillEvidence,
} from "../src/skill-telemetry.js"
import { skillFromTool } from "../integrations/opencode-v2/ai-analytics.js"

test("skill discovery inventories metadata without returning instruction bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skill-discovery-test-"))
  try {
    const skillDirectory = join(directory, "skills", "sample-skill")
    await mkdir(skillDirectory, { recursive: true })
    await writeFile(join(skillDirectory, "SKILL.md"), [
      "---",
      "name: sample-skill",
      "description: Deterministic sample skill.",
      "---",
      "# Private instructions that must not enter analytics",
    ].join("\n"), "utf8")

    const skills = await discoverSkillInstallations([{ path: join(directory, "skills"), scope: "user" }])
    assert.equal(skills.length, 1)
    assert.equal(skills[0].name, "sample-skill")
    assert.equal(skills[0].scope, "user")
    assert.equal(typeof skills[0].version, "string")
    assert.equal(JSON.stringify(skills).includes("Private instructions"), false)
    assert.equal(JSON.stringify(skills).includes(skillDirectory), false)
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

test("Codex evidence separates invocation from a successful SKILL.md load", () => {
  const records = [
    { type: "session_meta", timestamp: "2026-10-22T10:00:00Z", payload: { id: "codex-1", cwd: "C:/work/project" } },
    { type: "turn_context", timestamp: "2026-10-22T10:00:01Z", payload: { turn_id: "turn-1", model: "gpt-test" } },
    { type: "response_item", timestamp: "2026-10-22T10:00:02Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "$repo-engineering implement the feature" }] } },
    { type: "response_item", timestamp: "2026-10-22T10:00:03Z", payload: { type: "custom_tool_call", call_id: "call-1", name: "exec", status: "completed", input: JSON.stringify({ cmd: "Get-Content C:\\Users\\Khan\\.codex\\skills\\repo-engineering\\SKILL.md" }) } },
    { type: "response_item", timestamp: "2026-10-22T10:00:04Z", payload: { type: "custom_tool_call_output", call_id: "call-1", output: [{ type: "input_text", text: "redacted for fixture" }] } },
  ]

  const events = extractCodexSkillEvidence(records, new Set(["repo-engineering"]))
  assert.equal(events.filter((event) => event.eventType === "skill.invoked").length, 1)
  assert.equal(events.filter((event) => event.eventType === "skill.load_succeeded").length, 1)
  assert.equal(events.find((event) => event.eventType === "skill.invoked").invocationType, "explicit")
  assert.equal(JSON.stringify(events).includes("implement the feature"), false)
})

test("OpenCode tool evidence records a completed skill load without tool content", () => {
  const events = extractOpenCodeSkillEvidence({
    session: { id: "open-1", agent: "build", model: { providerID: "opencode", id: "free" }, time: { updated: 1000 } },
    messages: [{ type: "assistant", content: [{
      type: "tool",
      id: "tool-1",
      name: "skill",
      state: { status: "completed", input: { name: "repo-engineering" }, content: "must not persist" },
    }] }],
    knownSkills: new Set(["repo-engineering"]),
  })

  assert.deepEqual(events.map((event) => event.eventType), ["skill.invoked", "skill.load_succeeded"])
  assert.equal(JSON.stringify(events).includes("must not persist"), false)
})

test("OpenCode V2 hook recognizes only direct skill loads", () => {
  assert.equal(skillFromTool({ tool: "skill", input: { name: "repo-engineering" } }), "repo-engineering")
  assert.equal(skillFromTool({ tool: "read", input: { path: "C:/Users/Khan/.codex/skills/skill-router/SKILL.md" } }), "skill-router")
  assert.equal(skillFromTool({ tool: "read", input: { path: "C:/work/README.md" } }), null)
  assert.equal(skillFromTool({ tool: "shell", input: { command: "type SKILL.md" } }), null)
})

test("skill catalog and events are idempotent and keep unknown coverage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skill-store-test-"))
  let store
  try {
    store = await createEfficiencyStore({ storeDir: directory })
    store.importSkillCatalog([
      { name: "repo-engineering", description: "Repository work", scope: "user", platform: "codex", version: "v1", pathHash: "path-1", status: "available" },
      { name: "skill-router", description: "Routing", scope: "user", platform: "codex", version: "v1", pathHash: "path-2", status: "available" },
    ], { sourceKey: "skill-inventory", platform: "codex", coverage: null })
    const event = {
      eventId: "event-1",
      eventType: "skill.invoked",
      timestamp: "2026-10-22T10:00:00Z",
      platform: "codex",
      sessionExternalId: "codex-1",
      skill: "repo-engineering",
      invocationType: "implicit",
      status: "observed",
      evidenceSource: "codex-jsonl-skill-file-read",
    }
    const first = store.importSkillEvents([event], { sourceKey: "codex-jsonl", sourceType: "codex" })
    const second = store.importSkillEvents([event], { sourceKey: "codex-jsonl", sourceType: "codex" })

    assert.equal(first.imported, 1)
    assert.equal(second.imported, 0)
    assert.equal(second.duplicates, 1)
    assert.equal(store.getAnalyticsOverview().installedSkills, 2)
    assert.equal(store.getAnalyticsOverview().activeSkills, 1)
    assert.equal(store.getAnalyticsOverview().skillInvocations, 1)
    assert.equal(store.getAnalyticsOverview().skillCoverage, null)
    assert.equal(store.getSkills()[0].name, "repo-engineering")
  } finally {
    store?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

test("refresh jobs expose durable running and completed states", async () => {
  const directory = await mkdtemp(join(tmpdir(), "refresh-store-test-"))
  let store
  try {
    store = await createEfficiencyStore({ storeDir: directory })
    const refresh = store.startRefresh("refresh-test-1")
    assert.equal(store.getRefresh(refresh.id).status, "updating")

    store.finishRefresh(refresh.id, { status: "completed", processedEvents: 3, duplicateEvents: 1 })
    const completed = store.getRefresh(refresh.id)
    assert.equal(completed.status, "completed")
    assert.equal(completed.processedEvents, 3)
    assert.equal(completed.duplicateEvents, 1)
    assert.ok(completed.completedAt)
  } finally {
    store?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
