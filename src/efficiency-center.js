import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"

import { EFFICIENCY_MIGRATIONS } from "./efficiency-migrations.js"
import { directoryIsWithinRoot, normalizeProjectDirectory } from "./project-registry.js"
import { extractCodexSkillEvidence, extractOpenCodeSkillEvidence } from "./skill-telemetry.js"

const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const nonNegative = (value) => Math.max(0, numberOrNull(value) ?? 0)
const SKILL_EVENT_TYPES = new Set(["skill.discovered", "skill.recommended", "skill.invoked", "skill.load_succeeded", "skill.load_failed", "skill.execution_evidenced", "skill.outcome_verified"])
const iso = (value) => {
  if (value === null || value === undefined || value === "") return null
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
const hash = (value) => createHash("sha256").update(String(value)).digest("hex")
const statusText = (value) => typeof value === "string" ? value : value?.type || null

function execFileText(file, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}${stderr ? `: ${String(stderr).slice(0, 240)}` : ""}`
        rejectPromise(error)
        return
      }
      resolvePromise(String(stdout))
    })
  })
}

export async function discoverOpenCodeCli() {
  const explicit = process.env.OPENCODE_CLI_PATH
  if (explicit) {
    try { if ((await stat(explicit)).isFile()) return resolve(explicit) } catch { /* continue */ }
  }
  if (process.platform === "win32") {
    const root = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "ai.opencode.desktop", "cli")
    try {
      const versions = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const version of versions) {
        const candidate = join(root, version, "opencode-cli.exe")
        try { if ((await stat(candidate)).isFile()) return candidate } catch { /* continue */ }
      }
    } catch { /* desktop CLI is not installed */ }
  }
  return null
}

async function openCodeJson(cliPath, args) {
  const output = await execFileText(cliPath, args)
  return JSON.parse(output)
}

export async function collectOpenCodeV2Snapshot(cliPath) {
  if (!cliPath) throw new Error("OpenCode V2 CLI was not found")
  const versionText = await execFileText(cliPath, ["--version"])
  const version = versionText.match(/v?([0-9]+(?:\.[0-9]+)+)/)?.[1] || null
  const sessionEnvelope = await openCodeJson(cliPath, ["api", "GET", "/api/session", "--param", "roots=true"])
  const sessions = Array.isArray(sessionEnvelope?.data) ? sessionEnvelope.data : []
  const messagesBySession = new Map()
  for (const session of sessions) {
    if (!session?.id) continue
    const envelope = await openCodeJson(cliPath, ["api", "GET", `/api/session/${session.id}/message`])
    messagesBySession.set(session.id, Array.isArray(envelope?.data) ? envelope.data : [])
  }
  let stats = null
  try { stats = await openCodeJson(cliPath, ["stats", "--all", "--full", "--json"]) } catch { /* session API remains usable */ }
  return { version, sessions, messagesBySession, stats }
}

export function normalizeOpenCodeMessage(message) {
  const info = message?.info || {}
  if (info.role !== "assistant") return null
  const tokens = info.tokens || {}
  const cache = tokens.cache || {}
  const input = nonNegative(tokens.input)
  const output = nonNegative(tokens.output)
  const reasoning = nonNegative(tokens.reasoning)
  const cached = nonNegative(cache.read)
  const cacheWrite = nonNegative(cache.write)
  const parts = Array.isArray(message.parts) ? message.parts : []
  const tools = parts.filter((part) => part?.type === "tool")
  return {
    externalId: info.id || hash(JSON.stringify({ session: info.sessionID, time: info.time, tokens, cost: info.cost })),
    provider: info.providerID || "unknown",
    model: info.modelID || "unknown",
    agent: info.agent || null,
    occurredAt: iso(info.time?.created),
    durationMs: info.time?.created && info.time?.completed ? Math.max(0, Number(info.time.completed) - Number(info.time.created)) : null,
    inputTokens: input + cached + cacheWrite,
    uncachedInputTokens: input,
    cachedInputTokens: cached,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
    reasoningTokens: reasoning,
    totalTokens: numberOrNull(tokens.total) ?? input + cached + cacheWrite + output + reasoning,
    reportedCost: numberOrNull(info.cost),
    toolCalls: tools.length,
    errorEvents: (info.error ? 1 : 0) + tools.filter((part) => part?.state?.status === "error").length,
    retryEvents: parts.filter((part) => part?.type === "retry").length,
    compactionEvents: parts.filter((part) => part?.type === "compaction").length,
    status: info.error ? "error" : info.finish || (info.time?.completed ? "completed" : "unknown"),
    rawAccountingKind: "opencode-v1-assistant-message",
  }
}

export function normalizeCodexUsage(usage = {}) {
  const input = nonNegative(usage.input_tokens)
  const cached = Math.min(input, nonNegative(usage.cached_input_tokens))
  const cacheWrite = Math.min(Math.max(0, input - cached), nonNegative(usage.cache_write_input_tokens))
  const output = nonNegative(usage.output_tokens)
  return {
    inputTokens: input,
    uncachedInputTokens: Math.max(0, input - cached - cacheWrite),
    cachedInputTokens: cached,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
    reasoningTokens: Math.min(output, nonNegative(usage.reasoning_output_tokens)),
    totalTokens: numberOrNull(usage.total_tokens) ?? input + output,
    rawAccountingKind: "codex-token-usage-record",
  }
}

async function sqliteModule() {
  try {
    return await import("node:sqlite")
  } catch (nodeError) {
    try {
      const { Database } = await import("bun:sqlite")
      return { DatabaseSync: class {
        constructor(file) { this.database = new Database(file, { create: true }) }
        exec(sql) { return this.database.exec(sql) }
        prepare(sql) { return this.database.query(sql) }
        close() { return this.database.close() }
      } }
    } catch {
      throw new Error(`SQLite telemetry requires Node.js 22.5+ or the OpenCode Bun runtime: ${nodeError.message}`)
    }
  }
}

function runMigrations(database) {
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
  const applied = new Set(database.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version))
  for (const migration of EFFICIENCY_MIGRATIONS) {
    if (applied.has(migration.version)) continue
    database.exec("BEGIN IMMEDIATE")
    try {
      database.exec(migration.sql)
      database.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, new Date().toISOString())
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  }
}

async function listJsonlFiles(root) {
  const files = []
  const walk = async (directory) => {
    let entries = []
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full)
    }
  }
  await walk(root)
  return files
}

function periodClause(query = {}, column = "mc.occurred_at") {
  const conditions = []
  const params = []
  if (query.from) { conditions.push(`${column} >= ?`); params.push(iso(query.from) || query.from) }
  if (query.to) { conditions.push(`${column} <= ?`); params.push(iso(query.to) || query.to) }
  if (query.project) { conditions.push("p.external_id = ?"); params.push(query.project) }
  if (query.model) { conditions.push("m.model = ?"); params.push(query.model) }
  if (query.provider) { conditions.push("m.provider = ?"); params.push(query.provider) }
  return { sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params }
}

export async function createEfficiencyStore({ storeDir, databaseFile = join(storeDir, "efficiency.sqlite"), allowedProjectDirectories = null }) {
  const { DatabaseSync } = await sqliteModule()
  const database = new DatabaseSync(databaseFile)
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
  runMigrations(database)
  const projectRoots = allowedProjectDirectories === null ? null : [...new Set(allowedProjectDirectories.map(normalizeProjectDirectory).filter(Boolean))]
  const allowsProjectDirectory = (directory) => projectRoots === null || projectRoots.some((root) => directoryIsWithinRoot(directory, root))

  const sourceId = (key, type) => {
    database.prepare("INSERT INTO sources(source_key, source_type) VALUES (?, ?) ON CONFLICT(source_key) DO UPDATE SET source_type=excluded.source_type").run(key, type)
    return database.prepare("SELECT id FROM sources WHERE source_key=?").get(key).id
  }
  const projectId = (source, externalId, directory) => {
    const id = externalId || directory || "unknown"
    database.prepare(`INSERT INTO projects(source_id, external_id, name, directory) VALUES (?, ?, ?, ?)
      ON CONFLICT(source_id, external_id) DO UPDATE SET name=excluded.name, directory=excluded.directory`).run(source, id, basename(directory || id), directory || null)
    return database.prepare("SELECT id FROM projects WHERE source_id=? AND external_id=?").get(source, id).id
  }
  const sessionId = (source, project, session) => {
    const created = iso(session.startedAt ?? session.time?.created)
    const updated = iso(session.updatedAt ?? session.time?.updated) || created
    database.prepare(`INSERT INTO sessions(source_id, project_id, external_id, agent_id, status, started_at, updated_at, ended_at, duration_ms, data_coverage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, external_id) DO UPDATE SET project_id=excluded.project_id, agent_id=COALESCE(excluded.agent_id,sessions.agent_id), status=COALESCE(excluded.status,sessions.status), started_at=COALESCE(excluded.started_at,sessions.started_at), updated_at=COALESCE(excluded.updated_at,sessions.updated_at), ended_at=COALESCE(excluded.ended_at,sessions.ended_at), duration_ms=COALESCE(excluded.duration_ms,sessions.duration_ms), data_coverage=excluded.data_coverage`)
      .run(source, project, session.externalId || session.id, session.agent || null, statusText(session.status), created, updated, iso(session.endedAt), numberOrNull(session.durationMs), Object.prototype.hasOwnProperty.call(session, "dataCoverage") ? session.dataCoverage : 1)
    return database.prepare("SELECT id FROM sessions WHERE source_id=? AND external_id=?").get(source, session.externalId || session.id).id
  }
  const modelId = (provider, model) => {
    database.prepare("INSERT INTO models(provider, model, display_name) VALUES (?, ?, ?) ON CONFLICT(provider, model) DO NOTHING").run(provider || "unknown", model || "unknown", model || "unknown")
    return database.prepare("SELECT id FROM models WHERE provider=? AND model=?").get(provider || "unknown", model || "unknown").id
  }
  const skillId = (skill) => {
    const name = String(skill?.name || skill || "").trim()
    if (!name) return null
    const key = name.toLocaleLowerCase()
    database.prepare(`INSERT INTO skills(skill_key, name, description, source_repository, version, status, last_discovered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skill_key) DO UPDATE SET name=excluded.name, description=COALESCE(excluded.description,skills.description), source_repository=COALESCE(excluded.source_repository,skills.source_repository), version=COALESCE(excluded.version,skills.version), status=CASE WHEN excluded.status='available' THEN 'available' ELSE skills.status END, last_discovered_at=COALESCE(excluded.last_discovered_at,skills.last_discovered_at)`)
      .run(key, name, skill?.description || null, skill?.sourceRepository || null, skill?.version || null, skill?.status || "observed", skill?.lastDiscoveredAt || null)
    return database.prepare("SELECT id FROM skills WHERE skill_key=?").get(key).id
  }
  const knownSkillNames = () => new Set(database.prepare("SELECT name FROM skills").all().map((row) => row.name))
  const importSkillEventsInternal = (events, { sourceKey, sourceType, coverage = null } = {}) => {
    const source = sourceId(sourceKey || "collector", sourceType || "collector")
    let imported = 0
    let duplicates = 0
    for (const event of events) {
      if (!event?.eventId || !SKILL_EVENT_TYPES.has(event?.eventType) || !event?.skill || !event?.evidenceSource) continue
      if (String(event.eventId).length > 240 || String(event.skill).length > 160 || String(event.evidenceSource).length > 160) continue
      const skill = skillId(event.skill)
      if (!skill) continue
      const session = event.sessionExternalId
        ? database.prepare("SELECT id, project_id FROM sessions WHERE source_id=? AND external_id=?").get(source, event.sessionExternalId)
          || database.prepare("SELECT sessions.id, sessions.project_id FROM sessions JOIN sources ON sources.id=sessions.source_id WHERE sessions.external_id=? AND sources.source_type=? ORDER BY sessions.updated_at DESC LIMIT 1").get(event.sessionExternalId, sourceType)
        : null
      const model = event.model ? modelId(event.provider || sourceType || "unknown", event.model) : null
      const result = database.prepare(`INSERT INTO skill_events(source_id, project_id, session_id, event_id, event_type, occurred_at, platform, run_id, turn_id, agent_id, model_id, skill_id, skill_version, invocation_type, status, evidence_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, event_id) DO NOTHING`)
        .run(source, session?.project_id || null, session?.id || null, event.eventId, event.eventType, iso(event.timestamp), event.platform || sourceType || "unknown", event.runId || null, event.turnId || null, event.agentId || null, model, skill, event.skillVersion || null, event.invocationType || null, event.status || "unknown", event.evidenceSource)
      if (Number(result.changes || 0)) imported += 1
      else duplicates += 1
    }
    database.prepare(`UPDATE sources SET status=?, coverage=?, last_sync_at=?, last_error=NULL,
      records_imported=(SELECT COUNT(*) FROM skill_events WHERE source_id=?) WHERE id=?`)
      .run(events.length ? "partial" : "unavailable", coverage, new Date().toISOString(), source, source)
    return { imported, duplicates, received: events.length, coverage }
  }
  const insertCall = (source, session, call) => {
    const model = modelId(call.provider, call.model)
    database.prepare(`INSERT INTO model_calls(source_id, session_id, model_id, external_id, occurred_at, input_tokens, uncached_input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, reasoning_tokens, total_tokens, reported_cost, api_equivalent_cost, actual_spend, duration_ms, tool_calls, error_events, retry_events, compaction_events, status, raw_accounting_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, external_id) DO UPDATE SET session_id=excluded.session_id, model_id=excluded.model_id, occurred_at=excluded.occurred_at, input_tokens=excluded.input_tokens, uncached_input_tokens=excluded.uncached_input_tokens, cached_input_tokens=excluded.cached_input_tokens, cache_write_tokens=excluded.cache_write_tokens, output_tokens=excluded.output_tokens, reasoning_tokens=excluded.reasoning_tokens, total_tokens=excluded.total_tokens, reported_cost=excluded.reported_cost, duration_ms=excluded.duration_ms, tool_calls=excluded.tool_calls, error_events=excluded.error_events, retry_events=excluded.retry_events, compaction_events=excluded.compaction_events, status=excluded.status, raw_accounting_kind=excluded.raw_accounting_kind`)
      .run(source, session, model, call.externalId, call.occurredAt, call.inputTokens, call.uncachedInputTokens, call.cachedInputTokens, call.cacheWriteTokens, call.outputTokens, call.reasoningTokens, call.totalTokens, call.reportedCost ?? null, call.apiEquivalentCost ?? null, call.actualSpend ?? null, call.durationMs ?? null, call.toolCalls || 0, call.errorEvents || 0, call.retryEvents || 0, call.compactionEvents || 0, call.status || null, call.rawAccountingKind)
  }
  const updateSource = (source, status, coverage, error = null) => database.prepare("UPDATE sources SET status=?, coverage=?, last_sync_at=?, last_error=?, records_imported=(SELECT COUNT(*) FROM model_calls WHERE source_id=?) WHERE id=?")
    .run(status, coverage, new Date().toISOString(), error, source, source)

  return {
    databaseFile,
    importSkillCatalog(skills, { sourceKey = "skill-inventory", platform = "codex", coverage = null } = {}) {
      const source = sourceId(sourceKey, "skill-inventory")
      const observedAt = new Date().toISOString()
      let imported = 0
      for (const item of skills) {
        const skill = skillId({ ...item, status: item.status || "available", lastDiscoveredAt: observedAt })
        if (!skill || !item.pathHash) continue
        database.prepare(`INSERT INTO skill_installations(skill_id, platform, installation_scope, path_hash, version, status, discovered_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(skill_id, platform, installation_scope, path_hash) DO UPDATE SET version=excluded.version, status=excluded.status, last_seen_at=excluded.last_seen_at`)
          .run(skill, item.platform || platform, item.scope || "unknown", item.pathHash, item.version || null, item.status || "available", observedAt, observedAt)
        imported += 1
      }
      database.prepare(`UPDATE sources SET status=?, coverage=?, last_sync_at=?, last_error=NULL,
        records_imported=(SELECT COUNT(*) FROM skill_installations) WHERE id=?`)
        .run(skills.length ? "healthy" : "unavailable", coverage, observedAt, source)
      return { discovered: skills.length, installations: imported, coverage }
    },
    importSkillEvents(events, options = {}) { return importSkillEventsInternal(events, options) },
    getKnownSkillNames() { return [...knownSkillNames()] },
    importOpenCodeV2Snapshot({ version = null, sessions = [], messagesBySession = new Map(), stats = null }) {
      const source = sourceId("opencode-v2", "opencode")
      let calls = 0
      let skipped = 0
      let skillEvents = 0
      let duplicateSkillEvents = 0
      const knownSkills = knownSkillNames()
      for (const session of sessions) {
        if (!session?.id) continue
        const directory = session.location?.directory || null
        if (!allowsProjectDirectory(directory)) { skipped += 1; continue }
        const project = projectId(source, session.projectID || directory || "unknown", directory)
        const messages = messagesBySession instanceof Map ? messagesBySession.get(session.id) || [] : messagesBySession?.[session.id] || []
        const assistantMessages = messages.filter((message) => message?.type === "assistant")
        const tools = assistantMessages.flatMap((message) => Array.isArray(message.content) ? message.content : []).filter((part) => part?.type === "tool")
        const compactions = messages.filter((message) => message?.type === "compaction").length
        const errors = assistantMessages.filter((message) => message?.error).length + tools.filter((part) => ["error", "failed"].includes(part?.state?.status)).length
        const retries = messages.filter((message) => message?.type === "retry").length
        const tokens = session.tokens || {}
        const cache = tokens.cache || {}
        const input = nonNegative(tokens.input)
        const cached = nonNegative(cache.read)
        const cacheWrite = nonNegative(cache.write)
        const output = nonNegative(tokens.output)
        const reasoning = nonNegative(tokens.reasoning)
        const internalSession = sessionId(source, project, {
          externalId: session.id,
          agent: session.agent || null,
          status: session.outcome || (session.time?.idle ? "idle" : "unknown"),
          startedAt: session.time?.created,
          updatedAt: session.time?.updated || session.time?.idle,
          endedAt: session.time?.idle,
          durationMs: session.time?.created && session.time?.idle ? Math.max(0, Number(session.time.idle) - Number(session.time.created)) : null,
          dataCoverage: 1,
        })
        insertCall(source, internalSession, {
          externalId: `session-aggregate:${session.id}`,
          provider: session.model?.providerID || "unknown",
          model: session.model?.id || "unknown",
          occurredAt: iso(session.time?.updated || session.time?.idle || session.time?.created),
          inputTokens: input + cached + cacheWrite,
          uncachedInputTokens: input,
          cachedInputTokens: cached,
          cacheWriteTokens: cacheWrite,
          outputTokens: output,
          reasoningTokens: reasoning,
          totalTokens: input + cached + cacheWrite + output + reasoning,
          reportedCost: numberOrNull(session.cost),
          durationMs: session.time?.created && session.time?.idle ? Math.max(0, Number(session.time.idle) - Number(session.time.created)) : null,
          toolCalls: tools.length,
          errorEvents: errors,
          retryEvents: retries,
          compactionEvents: compactions,
          status: statusText(session.outcome) || (errors ? "error" : "completed"),
          rawAccountingKind: "opencode-v2-session-aggregate",
        })
        const detected = extractOpenCodeSkillEvidence({ session, messages, knownSkills }).map((event) => ({ ...event, provider: session.model?.providerID || "opencode" }))
        if (detected.length) {
          const result = importSkillEventsInternal(detected, { sourceKey: "opencode-v2", sourceType: "opencode", coverage: null })
          skillEvents += result.imported
          duplicateSkillEvents += result.duplicates
        }
        calls += 1
      }
      database.prepare("UPDATE sources SET version=? WHERE id=?").run(version, source)
      const note = stats?.sessions !== undefined && Number(stats.sessions) !== sessions.length ? `Session API returned ${sessions.length}; stats reported ${stats.sessions}. Scope may differ by project.` : null
      updateSource(source, sessions.length ? "healthy" : "unavailable", sessions.length ? 1 : 0, note)
      return { sessions: sessions.length - skipped, skipped, calls, skillEvents, duplicateSkillEvents, version, statsSessions: stats?.sessions ?? null, note }
    },
    async importOpenCodeV2Cli(cliPath) {
      return this.importOpenCodeV2Snapshot(await collectOpenCodeV2Snapshot(cliPath))
    },
    importOpenCodeSession({ session, messages = [], status }) {
      const source = sourceId("opencode-v1", "opencode")
      if (!allowsProjectDirectory(session.directory)) return { skipped: true, calls: 0, coverage: 0 }
      const project = projectId(source, session.projectID || session.projectId || session.directory, session.directory)
      const calls = messages.map(normalizeOpenCodeMessage).filter(Boolean)
      const coverage = calls.length ? calls.filter((call) => call.totalTokens !== null).length / calls.length : 0
      const internalSession = sessionId(source, project, { ...session, externalId: session.id, status, dataCoverage: coverage })
      for (const call of calls) insertCall(source, internalSession, call)
      updateSource(source, "healthy", coverage)
      return { sessionId: internalSession, calls: calls.length, coverage }
    },
    async importCodexFiles(files) {
      const source = sourceId("codex-jsonl", "codex")
      let imported = 0
      let parseErrors = 0
      let skipped = 0
      let skillEvents = 0
      let duplicateSkillEvents = 0
      const knownSkills = knownSkillNames()
      for (const file of files) {
        let lines
        try { lines = (await readFile(file, "utf8")).split(/\r?\n/) } catch { parseErrors += 1; continue }
        let meta = { id: null, cwd: null, provider: "openai", startedAt: null, updatedAt: null }
        const turns = new Map()
        const records = []
        const parsedItems = []
        let pending = { toolCalls: 0, errorEvents: 0, retryEvents: 0, compactionEvents: 0 }
        for (const line of lines) {
          if (!line.trim()) continue
          let item
          try { item = JSON.parse(line) } catch { parseErrors += 1; continue }
          parsedItems.push(item)
          if (item.type === "session_meta") {
            meta = { id: item.payload?.id || item.payload?.session_id || meta.id, cwd: item.payload?.cwd || meta.cwd, provider: item.payload?.model_provider || meta.provider, startedAt: item.timestamp || item.payload?.timestamp || meta.startedAt, updatedAt: item.timestamp || meta.updatedAt }
          } else if (item.type === "turn_context") {
            const turn = item.payload?.turn_id || item.payload?.root_turn_id
            if (turn) turns.set(turn, { model: item.payload?.model || "unknown", effort: item.payload?.effort || null, at: item.timestamp })
            meta.updatedAt = item.timestamp || meta.updatedAt
          } else if (item.type === "token_usage_record" && item.payload?.usage) {
            records.push({ item, events: pending })
            pending = { toolCalls: 0, errorEvents: 0, retryEvents: 0, compactionEvents: 0 }
            meta.id ||= item.payload?.session_id || item.payload?.thread_id
            meta.updatedAt = item.timestamp || meta.updatedAt
          } else if (item.type === "response_item" && ["custom_tool_call", "function_call"].includes(item.payload?.type)) {
            pending.toolCalls += 1
          } else if (item.type === "response_item" && item.payload?.type === "compaction") {
            pending.compactionEvents += 1
          } else if (item.type === "event_msg" && item.payload?.type === "turn_aborted") {
            pending.errorEvents += 1
          }
        }
        const detectedSkillEvents = extractCodexSkillEvidence(parsedItems, knownSkills).map((event) => ({ ...event, provider: meta.provider }))
        if (!meta.id || (!records.length && !detectedSkillEvents.length)) continue
        if (!allowsProjectDirectory(meta.cwd)) { skipped += 1; continue }
        const project = projectId(source, meta.cwd || "unknown", meta.cwd)
        const internalSession = sessionId(source, project, { externalId: meta.id, startedAt: meta.startedAt, updatedAt: meta.updatedAt, status: "imported-partial", dataCoverage: null })
        for (const record of records) {
          const { item, events } = record
          const turn = turns.get(item.payload?.turn_id) || turns.get(item.payload?.root_turn_id) || {}
          const usage = normalizeCodexUsage(item.payload.usage)
          insertCall(source, internalSession, {
            ...usage,
            externalId: item.payload?.response_id || hash(`${resolve(file)}:${item.ordinal ?? item.timestamp}:${JSON.stringify(item.payload.usage)}`),
            provider: meta.provider,
            model: turn.model || "unknown",
            occurredAt: iso(item.timestamp),
            reportedCost: null,
            toolCalls: events.toolCalls,
            errorEvents: events.errorEvents,
            retryEvents: events.retryEvents,
            compactionEvents: events.compactionEvents,
            status: "completed",
          })
          imported += 1
        }
        if (detectedSkillEvents.length) {
          const result = importSkillEventsInternal(detectedSkillEvents, { sourceKey: "codex-jsonl", sourceType: "codex", coverage: null })
          skillEvents += result.imported
          duplicateSkillEvents += result.duplicates
        }
        const fileInfo = await stat(file)
        database.prepare(`INSERT INTO telemetry_checkpoints(source_id, checkpoint_key, checkpoint_value, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(source_id, checkpoint_key) DO UPDATE SET checkpoint_value=excluded.checkpoint_value, updated_at=excluded.updated_at`)
          .run(source, hash(resolve(file)), JSON.stringify({ size: fileInfo.size, modified: fileInfo.mtime.toISOString() }), new Date().toISOString())
      }
      updateSource(source, parseErrors ? "degraded" : files.length ? "partial" : "unavailable", null, parseErrors ? `${parseErrors} malformed or unreadable JSONL records` : files.length ? "Codex Desktop/CLI does not document local JSONL as a complete account history." : "No Codex session JSONL files found.")
      return { files: files.length, skipped, imported, skillEvents, duplicateSkillEvents, parseErrors, coverage: null }
    },
    async importCodexHome(codexHome) {
      return this.importCodexFiles(await listJsonlFiles(join(codexHome, "sessions")))
    },
    markSourceUnavailable(key, type, error) {
      const source = sourceId(key, type)
      updateSource(source, "unavailable", 0, String(error).slice(0, 240))
    },
    getOverview(query = {}) {
      const clause = periodClause(query)
      const row = database.prepare(`SELECT COUNT(*) calls, COUNT(DISTINCT mc.session_id) sessions, COUNT(DISTINCT s.project_id) projects,
        COALESCE(SUM(mc.total_tokens),0) total_tokens, SUM(mc.reported_cost) reported_cost, SUM(mc.api_equivalent_cost) api_cost, SUM(mc.actual_spend) actual_spend,
        COALESCE(SUM(mc.cached_input_tokens),0) cached_tokens, COALESCE(SUM(mc.input_tokens),0) input_tokens,
        COALESCE(SUM(mc.retry_events),0) retries, COALESCE(SUM(mc.error_events),0) errors, AVG(src.coverage) source_coverage,
        SUM(CASE WHEN mc.total_tokens IS NOT NULL THEN 1 ELSE 0 END) covered_calls
        FROM model_calls mc JOIN sessions s ON s.id=mc.session_id JOIN sources src ON src.id=mc.source_id LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN models m ON m.id=mc.model_id ${clause.sql}`).get(...clause.params)
      const calls = Number(row.calls || 0)
      return {
        calls,
        sessions: Number(row.sessions || 0),
        projects: Number(row.projects || 0),
        totalTokens: Number(row.total_tokens || 0),
        reportedCost: row.reported_cost === null ? null : Number(row.reported_cost),
        apiEquivalentCost: row.api_cost === null ? null : Number(row.api_cost),
        actualSpend: row.actual_spend === null ? null : Number(row.actual_spend),
        cacheHitRate: Number(row.input_tokens || 0) ? Number(row.cached_tokens || 0) / Number(row.input_tokens) : null,
        retryRate: calls ? Number(row.retries || 0) / calls : null,
        errorRate: calls ? Number(row.errors || 0) / calls : null,
        dataCoverage: row.source_coverage === null ? null : Number(row.source_coverage),
        metricCoverage: calls ? Number(row.covered_calls || 0) / calls : 0,
        costPerVerifiedSuccessfulTask: null,
        estimatedSavings: null,
        notes: ["Codex historical coverage is unknown because local JSONL is not documented as a complete account export.", "Verified task success is unavailable until Sprint 3 evidence is collected.", "Estimated savings is unavailable without a comparable baseline."],
      }
    },
    getAnalyticsOverview(query = {}) {
      const usage = this.getOverview(query)
      const skills = database.prepare(`SELECT
        (SELECT COUNT(DISTINCT skill_id) FROM skill_installations WHERE status='available') installed,
        (SELECT COUNT(DISTINCT skill_id) FROM skill_events WHERE event_type='skill.invoked') active,
        (SELECT COUNT(*) FROM skill_events WHERE event_type='skill.invoked') invocations,
        (SELECT COUNT(DISTINCT agent_id) FROM skill_events WHERE agent_id IS NOT NULL) agents,
        (SELECT COUNT(*) FROM tasks) tasks`).get()
      const refresh = database.prepare("SELECT external_id id, status, started_at startedAt, completed_at completedAt, processed_events processedEvents, duplicate_events duplicateEvents, warning, error FROM analytics_refreshes ORDER BY id DESC LIMIT 1").get() || null
      return {
        ...usage,
        installedSkills: Number(skills.installed || 0),
        activeSkills: Number(skills.active || 0),
        skillInvocations: Number(skills.invocations || 0),
        activeAgents: Number(skills.agents || 0),
        tasks: Number(skills.tasks || 0),
        skillCoverage: null,
        lastRefresh: refresh,
        notes: [...usage.notes, "Skill invocation coverage is unknown until direct hooks are enabled for every agent surface."],
      }
    },
    getSkills() {
      return database.prepare(`SELECT sk.id, sk.name, sk.description, sk.version, sk.status,
        COUNT(DISTINCT si.id) installations, GROUP_CONCAT(DISTINCT si.platform) platforms,
        COUNT(DISTINCT CASE WHEN se.event_type='skill.invoked' THEN se.id END) invocations,
        COUNT(DISTINCT CASE WHEN se.event_type='skill.invoked' THEN se.session_id END) sessions,
        MAX(CASE WHEN se.event_type='skill.invoked' THEN se.occurred_at END) lastInvokedAt,
        COUNT(DISTINCT CASE WHEN se.event_type='skill.invoked' AND se.invocation_type='explicit' THEN se.id END) explicitInvocations,
        COUNT(DISTINCT CASE WHEN se.event_type='skill.invoked' AND se.invocation_type='implicit' THEN se.id END) implicitInvocations,
        COUNT(DISTINCT CASE WHEN se.event_type='skill.load_failed' THEN se.id END) loadFailures,
        GROUP_CONCAT(DISTINCT se.platform) eventPlatforms, GROUP_CONCAT(DISTINCT p.external_id) projects,
        GROUP_CONCAT(DISTINCT m.model) models, GROUP_CONCAT(DISTINCT se.agent_id) agents
        FROM skills sk LEFT JOIN skill_installations si ON si.skill_id=sk.id LEFT JOIN skill_events se ON se.skill_id=sk.id
        LEFT JOIN projects p ON p.id=se.project_id LEFT JOIN models m ON m.id=se.model_id
        GROUP BY sk.id ORDER BY invocations DESC, sk.name COLLATE NOCASE`).all().map((row) => ({
          ...row,
          installations: Number(row.installations || 0),
          invocations: Number(row.invocations || 0),
          sessions: Number(row.sessions || 0),
          uniqueTasks: null,
          explicitInvocations: Number(row.explicitInvocations || 0),
          implicitInvocations: Number(row.implicitInvocations || 0),
          loadFailures: Number(row.loadFailures || 0),
          observationStatus: Number(row.invocations || 0) ? "active" : "coverage_unknown",
          coverage: null,
        }))
    },
    getSkill(id) {
      const skill = database.prepare("SELECT id, name, description, version, status, last_discovered_at lastDiscoveredAt FROM skills WHERE id=?").get(Number(id))
      if (!skill) return null
      skill.installations = database.prepare("SELECT platform, installation_scope scope, version, status, discovered_at discoveredAt, last_seen_at lastSeenAt FROM skill_installations WHERE skill_id=? ORDER BY platform, scope").all(skill.id)
      skill.events = database.prepare(`SELECT se.event_id eventId, se.event_type eventType, se.occurred_at occurredAt, se.platform, se.run_id runId, se.turn_id turnId,
        se.agent_id agentId, se.invocation_type invocationType, se.status, se.evidence_source evidenceSource, p.name project, s.external_id sessionId, m.model
        FROM skill_events se LEFT JOIN projects p ON p.id=se.project_id LEFT JOIN sessions s ON s.id=se.session_id LEFT JOIN models m ON m.id=se.model_id
        WHERE se.skill_id=? ORDER BY se.occurred_at DESC LIMIT 500`).all(skill.id)
      return skill
    },
    getAgents() {
      return database.prepare(`SELECT agent_id agentId, platform, COUNT(DISTINCT session_id) sessions,
        SUM(CASE WHEN event_type='skill.invoked' THEN 1 ELSE 0 END) skillInvocations,
        MAX(occurred_at) lastSeenAt FROM skill_events WHERE agent_id IS NOT NULL GROUP BY agent_id, platform ORDER BY lastSeenAt DESC`).all()
    },
    getSkillEvents(limit = 1000) {
      return database.prepare(`SELECT se.event_id eventId, se.event_type eventType, se.occurred_at occurredAt, se.platform, se.run_id runId, se.turn_id turnId,
        se.agent_id agentId, se.invocation_type invocationType, se.status, se.evidence_source evidenceSource, sk.name skill, p.name project, s.external_id sessionId, m.model
        FROM skill_events se JOIN skills sk ON sk.id=se.skill_id LEFT JOIN projects p ON p.id=se.project_id LEFT JOIN sessions s ON s.id=se.session_id LEFT JOIN models m ON m.id=se.model_id
        ORDER BY se.occurred_at DESC LIMIT ?`).all(Math.max(1, Math.min(10000, Number(limit) || 1000)))
    },
    startRefresh(externalId) {
      const now = new Date().toISOString()
      database.prepare("INSERT INTO analytics_refreshes(external_id, status, started_at) VALUES (?, 'updating', ?)").run(externalId, now)
      return this.getRefresh(externalId)
    },
    finishRefresh(externalId, { status = "completed", processedEvents = 0, duplicateEvents = 0, warning = null, error = null } = {}) {
      database.prepare(`UPDATE analytics_refreshes SET status=?, completed_at=?, processed_events=?, duplicate_events=?, warning=?, error=? WHERE external_id=?`)
        .run(status, new Date().toISOString(), processedEvents, duplicateEvents, warning, error, externalId)
      return this.getRefresh(externalId)
    },
    getRefresh(externalId) {
      return database.prepare("SELECT external_id id, status, started_at startedAt, completed_at completedAt, processed_events processedEvents, duplicate_events duplicateEvents, warning, error FROM analytics_refreshes WHERE external_id=?").get(externalId) || null
    },
    getModels(query = {}) {
      const clause = periodClause(query)
      return database.prepare(`SELECT m.provider, m.model, COUNT(*) calls, COALESCE(SUM(mc.total_tokens),0) totalTokens,
        SUM(mc.reported_cost) reportedCost, SUM(mc.api_equivalent_cost) apiEquivalentCost,
        COALESCE(SUM(mc.cached_input_tokens),0) cachedTokens, COALESCE(SUM(mc.input_tokens),0) inputTokens,
        COALESCE(SUM(mc.retry_events),0) retries, COALESCE(SUM(mc.error_events),0) errors
        FROM model_calls mc JOIN models m ON m.id=mc.model_id JOIN sessions s ON s.id=mc.session_id LEFT JOIN projects p ON p.id=s.project_id
        ${clause.sql} GROUP BY m.id ORDER BY totalTokens DESC`).all(...clause.params)
    },
    getSessions(query = {}) {
      const clause = periodClause(query, "s.updated_at")
      return database.prepare(`SELECT s.id, src.source_type source, s.external_id externalId, s.status, s.started_at startedAt, s.updated_at updatedAt,
        p.name project, p.external_id projectId, COUNT(mc.id) calls, COALESCE(SUM(mc.total_tokens),0) totalTokens, SUM(mc.reported_cost) reportedCost,
        COALESCE(SUM(mc.retry_events),0) retries, COALESCE(SUM(mc.error_events),0) errors, s.data_coverage dataCoverage
        FROM sessions s JOIN sources src ON src.id=s.source_id LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN model_calls mc ON mc.session_id=s.id LEFT JOIN models m ON m.id=mc.model_id
        ${clause.sql} GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 500`).all(...clause.params)
    },
    getSession(sourceOrId, externalId) {
      const row = externalId === undefined
        ? database.prepare("SELECT s.*, src.source_type source, p.name project, p.directory FROM sessions s JOIN sources src ON src.id=s.source_id LEFT JOIN projects p ON p.id=s.project_id WHERE s.id=?").get(Number(sourceOrId))
        : database.prepare("SELECT s.*, src.source_type source, p.name project, p.directory FROM sessions s JOIN sources src ON src.id=s.source_id LEFT JOIN projects p ON p.id=s.project_id WHERE src.source_type=? AND s.external_id=?").get(sourceOrId, externalId)
      if (!row) return null
      const calls = database.prepare(`SELECT mc.id, m.provider, m.model, mc.occurred_at occurredAt, mc.input_tokens inputTokens, mc.uncached_input_tokens uncachedInputTokens,
        mc.cached_input_tokens cachedInputTokens, mc.cache_write_tokens cacheWriteTokens, mc.output_tokens outputTokens, mc.reasoning_tokens reasoningTokens,
        mc.total_tokens totalTokens, mc.reported_cost reportedCost, mc.duration_ms durationMs, mc.tool_calls toolCalls, mc.error_events errors,
        mc.retry_events retries, mc.compaction_events compactions, mc.status
        FROM model_calls mc LEFT JOIN models m ON m.id=mc.model_id WHERE mc.session_id=? ORDER BY mc.occurred_at`).all(row.id)
      return { ...row, calls }
    },
    getProjects() {
      return database.prepare(`SELECT p.external_id id, p.name, src.source_type source, COUNT(DISTINCT s.id) sessions, COALESCE(SUM(mc.total_tokens),0) totalTokens,
        SUM(mc.reported_cost) reportedCost FROM projects p JOIN sources src ON src.id=p.source_id LEFT JOIN sessions s ON s.project_id=p.id LEFT JOIN model_calls mc ON mc.session_id=s.id GROUP BY p.id ORDER BY totalTokens DESC`).all()
    },
    getHealth() { return database.prepare("SELECT source_key sourceKey, source_type sourceType, version, status, coverage, last_sync_at lastSyncAt, last_error lastError, records_imported recordsImported FROM sources ORDER BY source_type").all() },
    getBenchmarks() { return database.prepare("SELECT * FROM benchmarks ORDER BY name, version").all() },
    getExperiments() { return database.prepare("SELECT * FROM experiments ORDER BY created_at DESC").all() },
    getBudgets() { return database.prepare("SELECT b.*, p.name project FROM budgets b LEFT JOIN projects p ON p.id=b.project_id ORDER BY b.id DESC").all() },
    backup(destinationFile) {
      const target = resolve(destinationFile)
      database.prepare("VACUUM INTO ?").run(target)
      return target
    },
    close() { database.close() },
  }
}

function legacyEfficiencyDashboardHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Efficiency Control Center</title><style>
  :root{color-scheme:dark;--bg:#071018;--panel:#101d28;--line:#294257;--text:#edf7ff;--muted:#91a8b8;--mint:#65e0b2;--blue:#7ab7ff;--warn:#f1bd72}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,#143329 0,transparent 32%),var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}.shell{max-width:1500px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;gap:20px;align-items:center}.eyebrow{color:var(--mint);font-weight:700;letter-spacing:.12em;font-size:12px}a{color:var(--blue)}nav{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}button,select,input{background:#162633;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:9px 12px}nav button.active{border-color:var(--mint);background:#173a34}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.card,.panel{background:rgba(16,29,40,.94);border:1px solid var(--line);border-radius:14px}.card{padding:16px}.card strong,.card span{display:block}.card strong{font-size:25px}.card span,.muted{color:var(--muted)}.panel{padding:16px;margin-top:14px;overflow:auto}table{width:100%;border-collapse:collapse;min-width:760px}th,td{text-align:left;padding:10px;border-bottom:1px solid #243949}th{color:var(--muted);font-size:11px;text-transform:uppercase}.unknown{color:var(--warn)}.bar{height:7px;background:#203444;border-radius:9px;overflow:hidden}.bar i{display:block;height:100%;background:var(--mint)}[hidden]{display:none!important}@media(max-width:650px){.shell{padding:18px 12px}.top{display:block}.top a{display:inline-block;margin-top:12px}}
  </style></head><body><main class="shell"><header class="top"><div><div class="eyebrow">LOCAL-FIRST TELEMETRY</div><h1>AI Efficiency Control Center</h1><p class="muted">Токены, модели, стоимость и полнота данных — без сохранения промптов.</p></div><a href="/">← OpenCode Chats</a></header><nav><button data-view="overview" class="active">Overview</button><button data-view="models">Models</button><button data-view="sessions">Sessions</button><button data-view="health">Data Sources</button></nav><section id="overview"><div class="cards" id="cards"></div><div class="panel"><h2>Проекты</h2><table><thead><tr><th>Проект</th><th>Источник</th><th>Сессии</th><th>Токены</th><th>Reported cost</th></tr></thead><tbody id="projects"></tbody></table></div></section><section id="models" hidden class="panel"><h2>Model Analytics</h2><table><thead><tr><th>Модель</th><th>Провайдер</th><th>Вызовы</th><th>Токены</th><th>Cache rate</th><th>Reported cost</th><th>Ошибки</th></tr></thead><tbody id="modelRows"></tbody></table></section><section id="sessions" hidden class="panel"><h2>Sessions Explorer</h2><input id="search" placeholder="Поиск по ID, проекту, источнику"><table><thead><tr><th>Сессия</th><th>Проект</th><th>Источник</th><th>Токены</th><th>Вызовы</th><th>Ошибки</th><th>Обновлена</th></tr></thead><tbody id="sessionRows"></tbody></table></section><section id="health" hidden class="panel"><h2>Data Source Health</h2><table><thead><tr><th>Источник</th><th>Статус</th><th>Покрытие</th><th>Записей</th><th>Последняя синхронизация</th><th>Ограничения</th></tr></thead><tbody id="healthRows"></tbody></table></section><p class="muted">Actual Spend и API-equivalent cost показываются отдельно и остаются неизвестными, пока нет подтверждённого биллинга или версионированного тарифа.</p></main><script>
  const $=id=>document.getElementById(id),esc=v=>String(v??"—").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])),num=v=>Number(v||0).toLocaleString("ru-RU"),money=v=>v==null?'<span class="unknown">неизвестно</span>':"$"+Number(v).toFixed(4),pct=v=>v==null?"—":(Number(v)*100).toFixed(1)+"%";let sessions=[];
  async function load(){const [o,m,s,p,h]=await Promise.all(["overview","models","sessions","projects","health"].map(x=>fetch("/api/efficiency/"+x,{cache:"no-store"}).then(r=>r.json())));sessions=s;$('cards').innerHTML=[[num(o.totalTokens),'токенов'],[num(o.sessions),'сессий'],[money(o.actualSpend),'Actual spend'],[money(o.reportedCost),'Reported cost'],[money(o.apiEquivalentCost),'API-equivalent'],[pct(o.cacheHitRate),'Cache hit rate'],[pct(o.retryRate),'Retry rate'],[pct(o.dataCoverage),'Historical coverage'],[pct(o.metricCoverage),'Metric coverage'],['—','Cost / verified success']].map(x=>'<div class="card"><strong>'+x[0]+'</strong><span>'+x[1]+'</span></div>').join('');$('projects').innerHTML=p.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.source)+'</td><td>'+num(x.sessions)+'</td><td>'+num(x.totalTokens)+'</td><td>'+money(x.reportedCost)+'</td></tr>').join('');$('modelRows').innerHTML=m.map(x=>'<tr><td>'+esc(x.model)+'</td><td>'+esc(x.provider)+'</td><td>'+num(x.calls)+'</td><td>'+num(x.totalTokens)+'</td><td>'+pct(x.inputTokens?x.cachedTokens/x.inputTokens:null)+'</td><td>'+money(x.reportedCost)+'</td><td>'+num(x.errors)+'</td></tr>').join('');renderSessions();$('healthRows').innerHTML=h.map(x=>'<tr><td>'+esc(x.sourceType)+'</td><td>'+esc(x.status)+'</td><td><div class="bar"><i style="width:'+Math.round((x.coverage||0)*100)+'%"></i></div>'+pct(x.coverage)+'</td><td>'+num(x.recordsImported)+'</td><td>'+esc(x.lastSyncAt?new Date(x.lastSyncAt).toLocaleString():null)+'</td><td>'+esc(x.lastError)+'</td></tr>').join('')}
  function renderSessions(){const q=$('search').value.toLowerCase();$('sessionRows').innerHTML=sessions.filter(x=>!q||[x.externalId,x.project,x.source].join(' ').toLowerCase().includes(q)).map(x=>'<tr><td><a href="/api/efficiency/sessions/'+x.id+'">'+esc(x.externalId)+'</a></td><td>'+esc(x.project)+'</td><td>'+esc(x.source)+'</td><td>'+num(x.totalTokens)+'</td><td>'+num(x.calls)+'</td><td>'+num(x.errors)+'</td><td>'+esc(x.updatedAt?new Date(x.updatedAt).toLocaleString():null)+'</td></tr>').join('')}$('search').oninput=renderSessions;document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));['overview','models','sessions','health'].forEach(id=>$(id).hidden=id!==b.dataset.view)});load();setInterval(load,15000);
  </script></body></html>`
}

export function efficiencyDashboardHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Analytics</title><style>
  :root{color-scheme:dark;--bg:#071018;--panel:#101d28;--line:#294257;--text:#edf7ff;--muted:#91a8b8;--mint:#65e0b2;--blue:#7ab7ff;--warn:#f1bd72;--bad:#ff8e8e}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,#143329 0,transparent 32%),var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}.shell{max-width:1500px;margin:auto;padding:26px}.top,.actions,.filters,nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.top{justify-content:space-between}.eyebrow{color:var(--mint);font-weight:750;letter-spacing:.12em;font-size:12px}h1{margin:.2em 0}a{color:var(--blue)}button,select,input{background:#162633;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:9px 12px}button{cursor:pointer}button:disabled{opacity:.55;cursor:wait}nav{margin:18px 0}nav button.active{border-color:var(--mint);background:#173a34}.filters{padding:12px;background:#0d1821;border:1px solid var(--line);border-radius:12px}.filters label{display:grid;gap:4px;color:var(--muted);font-size:11px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:14px}.card,.panel{background:rgba(16,29,40,.94);border:1px solid var(--line);border-radius:14px}.card{padding:15px}.card strong,.card span{display:block}.card strong{font-size:24px}.card span,.muted{color:var(--muted)}.panel{padding:16px;margin-top:14px;overflow:auto}.status{padding:8px 11px;border:1px solid var(--line);border-radius:9px;color:var(--muted)}.status.ok{color:var(--mint)}.status.bad{color:var(--bad)}table{width:100%;border-collapse:collapse;min-width:840px}th,td{text-align:left;padding:10px;border-bottom:1px solid #243949}th{color:var(--muted);font-size:11px;text-transform:uppercase}.unknown{color:var(--warn)}.badge{display:inline-block;padding:3px 7px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:11px}.badge.active{border-color:#2d8f6f;color:var(--mint)}.bar{height:7px;background:#203444;border-radius:9px;overflow:hidden}.bar i{display:block;height:100%;background:var(--mint)}[hidden]{display:none!important}.detail{white-space:pre-wrap}.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.42fr);gap:14px}@media(max-width:850px){.split{grid-template-columns:1fr}}@media(max-width:650px){.shell{padding:16px 10px}.top{align-items:flex-start}.actions{align-items:stretch}.actions>*{flex:1 1 auto}.filters>*{flex:1 1 140px}}
  </style></head><body><main class="shell"><header class="top"><div><div class="eyebrow">PROJECT AGENT OS · LOCAL TELEMETRY</div><h1>AI Analytics</h1><p class="muted">Скиллы, модели, сессии и покрытие источников без сохранения промптов и ответов.</p></div><div class="actions"><span id="refreshStatus" class="status">Ожидание</span><button id="refresh">Обновить аналитику</button><a href="/api/analytics/export?entity=skills&format=csv">CSV</a><a href="/api/analytics/export?entity=events&format=json">JSON</a></div></header>
  <div class="filters"><label>Период<select id="period"><option value="all">Всё время</option><option value="7">7 дней</option><option value="30">30 дней</option></select></label><label>Проект<select id="project"><option value="">Все</option></select></label><label>Платформа<select id="platform"><option value="">Все</option><option value="codex">Codex</option><option value="opencode">OpenCode</option></select></label><label>Агент<select id="agent"><option value="">Все</option></select></label><label>Модель<select id="model"><option value="">Все</option></select></label></div>
  <nav><button data-view="overview" class="active">Overview</button><button data-view="skills">Skill Analytics</button><button data-view="models">Model Analytics</button><button data-view="sessions">Sessions</button><button data-view="agents">Agents</button><button data-view="sources">Sources</button></nav>
  <section id="overview"><div class="cards" id="cards"></div><div class="panel"><h2>Ограничения данных</h2><div id="notes" class="muted"></div></div></section>
  <section id="skills" hidden><div class="split"><div class="panel"><h2>Skill Analytics</h2><table><thead><tr><th>Skill</th><th>Вызовы</th><th>Сессии</th><th>Явные</th><th>Неявные</th><th>Последний вызов</th><th>Статус</th></tr></thead><tbody id="skillRows"></tbody></table></div><aside class="panel"><h2>Детали</h2><div id="skillDetail" class="detail muted">Выберите скилл.</div></aside></div></section>
  <section id="models" hidden class="panel"><h2>Model Analytics</h2><table><thead><tr><th>Модель</th><th>Провайдер</th><th>Вызовы</th><th>Токены</th><th>Cache rate</th><th>Reported cost</th><th>Ошибки</th></tr></thead><tbody id="modelRows"></tbody></table></section>
  <section id="sessions" hidden class="panel"><h2>Sessions</h2><input id="search" placeholder="Поиск по ID, проекту, источнику"><table><thead><tr><th>Сессия</th><th>Проект</th><th>Источник</th><th>Токены</th><th>Вызовы</th><th>Ошибки</th><th>Обновлена</th></tr></thead><tbody id="sessionRows"></tbody></table></section>
  <section id="agents" hidden class="panel"><h2>Agent Performance</h2><table><thead><tr><th>Агент</th><th>Платформа</th><th>Сессии</th><th>Скиллы</th><th>Последнее событие</th></tr></thead><tbody id="agentRows"></tbody></table><p class="muted">Успешность задач не вычисляется без тестов или подтверждённого результата.</p></section>
  <section id="sources" hidden class="panel"><h2>Data Sources</h2><table><thead><tr><th>Источник</th><th>Статус</th><th>Покрытие</th><th>Записей</th><th>Последняя синхронизация</th><th>Ограничения</th></tr></thead><tbody id="sourceRows"></tbody></table></section>
  <p class="muted">Actual spend и API-equivalent cost разделены. Неизвестные значения не заменяются нулями.</p></main><script>
  const $=id=>document.getElementById(id),esc=v=>String(v??'—').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c])),num=v=>v==null?'—':Number(v).toLocaleString('ru-RU'),money=v=>v==null?'<span class="unknown">Нет данных</span>':'$'+Number(v).toFixed(4),pct=v=>v==null?'Нет данных':(Number(v)*100).toFixed(1)+'%',when=v=>v?new Date(v).toLocaleString('ru-RU'):'Нет данных';let state={skills:[],models:[],sessions:[],agents:[]};
  function params(){const q=new URLSearchParams(),days=$('period').value;if(days!=='all')q.set('from',new Date(Date.now()-Number(days)*86400000).toISOString());for(const key of ['project','model'])if($(key).value)q.set(key,$(key).value);return q.toString()?'?'+q:''}
  function includesCsv(value,needle){return !needle||String(value||'').split(',').some(item=>item===needle)}
  function filteredSkills(){const platform=$('platform').value,project=$('project').value,model=$('model').value,agent=$('agent').value,days=$('period').value,cutoff=days==='all'?null:Date.now()-Number(days)*86400000;return state.skills.filter(item=>includesCsv((item.platforms||'')+','+(item.eventPlatforms||''),platform)&&includesCsv(item.projects,project)&&includesCsv(item.models,model)&&includesCsv(item.agents,agent)&&(!cutoff||!item.lastInvokedAt||new Date(item.lastInvokedAt).getTime()>=cutoff))}
  function renderSkills(){const rows=filteredSkills();$('skillRows').innerHTML=rows.length?rows.map(item=>'<tr data-skill="'+item.id+'"><td><a href="#">'+esc(item.name)+'</a></td><td>'+num(item.invocations)+'</td><td>'+num(item.sessions)+'</td><td>'+num(item.explicitInvocations)+'</td><td>'+num(item.implicitInvocations)+'</td><td>'+when(item.lastInvokedAt)+'</td><td><span class="badge '+(item.observationStatus==='active'?'active':'')+'">'+(item.observationStatus==='active'?'Активен':'Покрытие неизвестно')+'</span></td></tr>').join(''):'<tr><td colspan="7" class="muted">Нет данных для выбранных фильтров.</td></tr>';document.querySelectorAll('[data-skill]').forEach(row=>row.onclick=async event=>{event.preventDefault();const data=await fetch('/api/analytics/skills/'+row.dataset.skill,{cache:'no-store'}).then(r=>r.json());$('skillDetail').textContent=[data.name,'Версия: '+(data.version||'Нет данных'),'Установки: '+data.installations.length,'События: '+data.events.length,...data.events.slice(0,12).map(x=>(x.occurredAt||'без времени')+' · '+x.eventType+' · '+x.evidenceSource)].join('\\n')})}
  function renderSessions(){const q=$('search').value.toLowerCase();const rows=state.sessions.filter(x=>!q||[x.externalId,x.project,x.source].join(' ').toLowerCase().includes(q));$('sessionRows').innerHTML=rows.map(x=>'<tr><td><a href="/api/efficiency/sessions/'+x.id+'">'+esc(x.externalId)+'</a></td><td>'+esc(x.project)+'</td><td>'+esc(x.source)+'</td><td>'+num(x.totalTokens)+'</td><td>'+num(x.calls)+'</td><td>'+num(x.errors)+'</td><td>'+when(x.updatedAt)+'</td></tr>').join('')}
  function setOptions(id,values,label){const current=$(id).value;$(id).innerHTML='<option value="">'+label+'</option>'+values.filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).sort().map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');$(id).value=current}
  async function load(){const q=params();const [o,skills,models,sessions,projects,sources,agents]=await Promise.all(['/api/analytics/overview'+q,'/api/analytics/skills'+q,'/api/analytics/models'+q,'/api/analytics/sessions'+q,'/api/efficiency/projects','/api/analytics/sources','/api/analytics/agents'].map(url=>fetch(url,{cache:'no-store'}).then(r=>r.json())));state={skills,models,sessions,agents};$('cards').innerHTML=[[o.installedSkills,'установлено скиллов'],[o.activeSkills,'активных скиллов'],[o.skillInvocations,'вызовов скиллов'],[o.activeAgents,'активных агентов'],[o.sessions,'сессий'],[o.tasks,'подтверждённых задач'],[o.totalTokens,'токенов'],[o.skillCoverage==null?'Нет данных':pct(o.skillCoverage),'покрытие скиллов']].map(x=>'<div class="card"><strong>'+(typeof x[0]==='number'?num(x[0]):esc(x[0]))+'</strong><span>'+x[1]+'</span></div>').join('');$('notes').innerHTML=(o.notes||[]).map(x=>'<div>• '+esc(x)+'</div>').join('');$('modelRows').innerHTML=models.map(x=>'<tr><td>'+esc(x.model)+'</td><td>'+esc(x.provider)+'</td><td>'+num(x.calls)+'</td><td>'+num(x.totalTokens)+'</td><td>'+pct(x.inputTokens?x.cachedTokens/x.inputTokens:null)+'</td><td>'+money(x.reportedCost)+'</td><td>'+num(x.errors)+'</td></tr>').join('');$('agentRows').innerHTML=agents.length?agents.map(x=>'<tr><td>'+esc(x.agentId)+'</td><td>'+esc(x.platform)+'</td><td>'+num(x.sessions)+'</td><td>'+num(x.skillInvocations)+'</td><td>'+when(x.lastSeenAt)+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">Нет достоверных данных об агентах.</td></tr>';$('sourceRows').innerHTML=sources.map(x=>'<tr><td>'+esc(x.sourceKey)+'</td><td>'+esc(x.status)+'</td><td>'+pct(x.coverage)+'</td><td>'+num(x.recordsImported)+'</td><td>'+when(x.lastSyncAt)+'</td><td>'+esc(x.lastError)+'</td></tr>').join('');setOptions('project',projects.map(x=>x.projectId),'Все проекты');setOptions('model',models.map(x=>x.model),'Все модели');setOptions('agent',agents.map(x=>x.agentId),'Все агенты');renderSkills();renderSessions();if(o.lastRefresh){$('refreshStatus').textContent=o.lastRefresh.status+' · '+when(o.lastRefresh.completedAt||o.lastRefresh.startedAt);$('refreshStatus').className='status '+(o.lastRefresh.status==='completed'?'ok':o.lastRefresh.status==='error'?'bad':'')}}
  async function refresh(){const button=$('refresh');button.disabled=true;$('refreshStatus').textContent='Обновление…';$('refreshStatus').className='status';try{const response=await fetch('/api/analytics/refresh',{method:'POST',headers:{'X-AI-Analytics-Action':'refresh'}}),job=await response.json();if(!response.ok&&response.status!==409)throw new Error(job.error||'Refresh failed');for(let i=0;i<120;i++){const current=await fetch('/api/analytics/refresh/'+job.id,{cache:'no-store'}).then(r=>r.json());$('refreshStatus').textContent=current.status;if(['completed','partial','error'].includes(current.status)){if(current.status==='error')throw new Error(current.error||'Refresh failed');await load();return}await new Promise(resolve=>setTimeout(resolve,500))}throw new Error('Обновление не завершилось вовремя')}catch(error){$('refreshStatus').textContent=error.message;$('refreshStatus').className='status bad'}finally{button.disabled=false}}
  $('refresh').onclick=refresh;$('search').oninput=renderSessions;for(const id of ['period','project','platform','agent','model'])$(id).onchange=()=>{if(id==='platform'||id==='agent')renderSkills();else load()};document.querySelectorAll('nav button').forEach(button=>button.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===button));['overview','skills','models','sessions','agents','sources'].forEach(id=>$(id).hidden=id!==button.dataset.view)});load();setInterval(load,30000);
  </script></body></html>`
}
