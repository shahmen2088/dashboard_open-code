import assert from "node:assert/strict"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  createEfficiencyStore,
  normalizeCodexUsage,
  normalizeOpenCodeMessage,
} from "../src/efficiency-center.js"

test("OpenCode accounting keeps cache and reasoning separate without losing total", () => {
  const call = normalizeOpenCodeMessage({
    info: {
      id: "msg-1",
      role: "assistant",
      providerID: "openai",
      modelID: "gpt-test",
      cost: 0.25,
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 40, write: 10 } },
    },
    parts: [{ type: "tool", state: { status: "error" } }, { type: "retry" }, { type: "compaction" }],
  })

  assert.equal(call.uncachedInputTokens, 100)
  assert.equal(call.cachedInputTokens, 40)
  assert.equal(call.cacheWriteTokens, 10)
  assert.equal(call.outputTokens, 20)
  assert.equal(call.reasoningTokens, 5)
  assert.equal(call.totalTokens, 175)
  assert.equal(call.toolCalls, 1)
  assert.equal(call.errorEvents, 1)
  assert.equal(call.retryEvents, 1)
  assert.equal(call.compactionEvents, 1)
})

test("Codex accounting treats cached input and reasoning as subsets", () => {
  const call = normalizeCodexUsage({
    input_tokens: 100,
    cached_input_tokens: 60,
    cache_write_input_tokens: 4,
    output_tokens: 20,
    reasoning_output_tokens: 7,
    total_tokens: 120,
  })

  assert.equal(call.inputTokens, 100)
  assert.equal(call.uncachedInputTokens, 36)
  assert.equal(call.cachedInputTokens, 60)
  assert.equal(call.reasoningTokens, 7)
  assert.equal(call.totalTokens, 120)
})

test("re-import is idempotent and aggregates remain stable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "efficiency-test-"))
  let store
  try {
    store = await createEfficiencyStore({ storeDir: directory })
    const payload = {
      session: { id: "s-1", directory: "C:/work/project", time: { created: 1, updated: 2 } },
      messages: [{
        info: {
          id: "m-1", sessionID: "s-1", role: "assistant", providerID: "openai", modelID: "gpt-test", cost: 0.2,
          tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 0 } },
        },
        parts: [],
      }],
      status: { type: "idle" },
    }
    store.importOpenCodeSession(payload)
    store.importOpenCodeSession(payload)
    const overview = store.getOverview({})
    assert.equal(overview.calls, 1)
    assert.equal(overview.totalTokens, 20)
    assert.equal(overview.reportedCost, 0.2)
    await access(store.backup(join(directory, "backup.sqlite")))
  } finally {
    store?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

test("Codex JSONL import stores only telemetry and survives duplicate sync", async () => {
  const directory = await mkdtemp(join(tmpdir(), "efficiency-codex-test-"))
  let store
  try {
    const file = join(directory, "session.jsonl")
    await writeFile(file, [
      JSON.stringify({ type: "session_meta", timestamp: "2026-10-21T01:00:00Z", payload: { id: "c-1", cwd: "C:/private/project", model_provider: "openai" } }),
      JSON.stringify({ type: "turn_context", timestamp: "2026-10-21T01:00:01Z", payload: { turn_id: "t-1", model: "gpt-test", effort: "high" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", content: [{ text: "must not be stored" }] } }),
      JSON.stringify({ type: "token_usage_record", timestamp: "2026-10-21T01:00:02Z", payload: { response_id: "r-1", session_id: "c-1", turn_id: "t-1", usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 7, total_tokens: 120 } } }),
    ].join("\n"), "utf8")

    store = await createEfficiencyStore({ storeDir: directory })
    await store.importCodexFiles([file])
    await store.importCodexFiles([file])
    const overview = store.getOverview({})
    const detail = store.getSession("codex", "c-1")
    const health = store.getHealth()[0]
    assert.equal(overview.calls, 1)
    assert.equal(overview.totalTokens, 120)
    assert.equal(overview.dataCoverage, null)
    assert.equal(overview.metricCoverage, 1)
    assert.equal(health.status, "partial")
    assert.equal(health.coverage, null)
    assert.equal(JSON.stringify(detail).includes("must not be stored"), false)
  } finally {
    store?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

test("OpenCode V2 session aggregates import through the supported API shape", async () => {
  const directory = await mkdtemp(join(tmpdir(), "efficiency-opencode-v2-test-"))
  let store
  try {
    store = await createEfficiencyStore({ storeDir: directory })
    const snapshot = {
      version: "2.0.32",
      sessions: [{
        id: "oc-1",
        projectID: "project-1",
        agent: "build",
        model: { providerID: "opencode", id: "test-free", variant: "default" },
        location: { directory: "C:/work/opencode-project" },
        time: { created: 1000, updated: 2000, idle: 2000 },
        outcome: "completed",
        cost: 0,
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 40, write: 10 } },
      }],
      messagesBySession: new Map([["oc-1", [
        { type: "assistant", content: [{ type: "tool", state: { status: "completed" } }, { type: "tool", state: { status: "error" } }] },
        { type: "compaction", tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 4, write: 0 } } },
      ]]]),
    }

    store.importOpenCodeV2Snapshot(snapshot)
    store.importOpenCodeV2Snapshot(snapshot)
    const overview = store.getOverview({})
    const session = store.getSession("opencode", "oc-1")
    const health = store.getHealth()[0]
    assert.equal(overview.calls, 1)
    assert.equal(overview.totalTokens, 175)
    assert.equal(overview.reportedCost, 0)
    assert.equal(session.calls[0].toolCalls, 2)
    assert.equal(session.calls[0].errors, 1)
    assert.equal(session.calls[0].compactions, 1)
    assert.equal(health.status, "healthy")
  } finally {
    store?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
