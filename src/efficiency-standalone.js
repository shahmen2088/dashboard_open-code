import { mkdir } from "node:fs/promises"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"

import { createEfficiencyStore, discoverOpenCodeCli, efficiencyDashboardHtml } from "./efficiency-center.js"
import { loadProjectRegistry } from "./project-registry.js"
import { discoverSkillInstallations } from "./skill-telemetry.js"

const storeDir = resolve(process.env.OPENCODE_SESSION_ORGANIZER_HOME || join(homedir(), ".config", "opencode", "session-organizer"))
const defaultRegistryFile = join(resolve(import.meta.dirname, ".."), "config", "project-registry.json")
const registryFile = process.env.OPENCODE_EFFICIENCY_PROJECT_REGISTRY || defaultRegistryFile
const registry = await loadProjectRegistry(registryFile).catch((error) => {
  if (process.env.OPENCODE_EFFICIENCY_PROJECT_REGISTRY) throw error
  return { enabled: false, projects: [], projectDirectories: [] }
})
await mkdir(storeDir, { recursive: true })
const store = await createEfficiencyStore({ storeDir, allowedProjectDirectories: registry.enabled ? registry.projectDirectories : null })

function skillRoots() {
  const roots = [
    { path: join(homedir(), ".codex", "skills"), scope: "user", platform: "codex" },
    { path: join(homedir(), ".codex", "plugins", "cache"), scope: "plugin", platform: "codex" },
    { path: join(homedir(), ".config", "opencode", "skills"), scope: "user", platform: "opencode" },
  ]
  for (const project of registry.projects || []) {
    roots.push(
      { path: join(project.directory, ".codex", "skills"), scope: "project", platform: "codex" },
      { path: join(project.directory, ".agents", "skills"), scope: "project", platform: "codex" },
      { path: join(project.directory, ".opencode", "skills"), scope: "project", platform: "opencode" },
    )
  }
  return roots
}

async function sync() {
  const result = { skills: null, opencode: null, codex: null }
  try {
    const skills = await discoverSkillInstallations(skillRoots())
    result.skills = store.importSkillCatalog(skills, { sourceKey: "skill-inventory", platform: "mixed", coverage: null })
  } catch (error) {
    store.markSourceUnavailable("skill-inventory", "skill-inventory", error.message)
    result.skills = { error: error.message }
  }
  try {
    const cli = await discoverOpenCodeCli()
    if (cli) result.opencode = await store.importOpenCodeV2Cli(cli)
    else store.markSourceUnavailable("opencode-v2", "opencode", "OpenCode V2 CLI was not found")
  } catch (error) {
    store.markSourceUnavailable("opencode-v2", "opencode", error.message)
    result.opencode = { error: error.message }
  }
  try { result.codex = await store.importCodexHome(resolve(process.env.CODEX_HOME || join(homedir(), ".codex"))) }
  catch (error) { store.markSourceUnavailable("codex-jsonl", "codex", error.message); result.codex = { error: error.message } }
  return result
}

let syncPromise = null
function runSync() {
  if (syncPromise) return syncPromise
  syncPromise = sync().finally(() => { syncPromise = null })
  return syncPromise
}
const json = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(value))
}
const readJson = async (request, maxBytes = 262144) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw new Error("Request body is too large")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}
const csv = (rows) => {
  if (!rows.length) return ""
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`
  return [fields.map(cell).join(","), ...rows.map((row) => fields.map((field) => cell(row[field])).join(","))].join("\r\n")
}
let activeRefreshId = null
function refreshSummary(result) {
  const sources = [result.skills, result.opencode, result.codex]
  const processedEvents = sources.reduce((sum, item) => sum + Number(item?.skillEvents || item?.installations || 0), 0)
  const duplicateEvents = sources.reduce((sum, item) => sum + Number(item?.duplicateSkillEvents || 0), 0)
  const failures = sources.filter((item) => item?.error).map((item) => item.error)
  return { status: failures.length ? "partial" : "completed", processedEvents, duplicateEvents, warning: failures.length ? failures.join("; ").slice(0, 500) : null }
}
function startRefresh() {
  if (activeRefreshId) return { conflict: true, refresh: store.getRefresh(activeRefreshId) }
  const id = randomUUID()
  store.startRefresh(id)
  activeRefreshId = id
  void runSync().then((result) => store.finishRefresh(id, refreshSummary(result))).catch((error) => {
    store.finishRefresh(id, { status: "error", error: String(error.message || error).slice(0, 500) })
  }).finally(() => { activeRefreshId = null })
  return { conflict: false, refresh: store.getRefresh(id) }
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1")
  if (url.pathname === "/" || url.pathname === "/efficiency") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    response.end(efficiencyDashboardHtml())
    return
  }
  try {
    const query = Object.fromEntries(url.searchParams)
    let value
    if (request.method === "GET" && ["/api/efficiency/overview", "/api/analytics/overview"].includes(url.pathname)) value = store.getAnalyticsOverview(query)
    else if (request.method === "GET" && url.pathname === "/api/efficiency/models") value = store.getModels(query)
    else if (request.method === "GET" && url.pathname === "/api/efficiency/sessions") value = store.getSessions(query)
    else if (request.method === "GET" && /^\/api\/efficiency\/sessions\/\d+$/.test(url.pathname)) value = store.getSession(Number(url.pathname.split("/").at(-1)))
    else if (request.method === "GET" && url.pathname === "/api/efficiency/projects") value = store.getProjects()
    else if (request.method === "GET" && url.pathname === "/api/efficiency/health") value = store.getHealth()
    else if (request.method === "GET" && url.pathname === "/api/efficiency/benchmarks") value = store.getBenchmarks()
    else if (request.method === "GET" && url.pathname === "/api/efficiency/experiments") value = store.getExperiments()
    else if (request.method === "GET" && url.pathname === "/api/efficiency/budgets") value = store.getBudgets()
    else if (request.method === "GET" && url.pathname === "/api/analytics/skills") value = store.getSkills(query)
    else if (request.method === "GET" && /^\/api\/analytics\/skills\/\d+$/.test(url.pathname)) value = store.getSkill(Number(url.pathname.split("/").at(-1)))
    else if (request.method === "GET" && url.pathname === "/api/analytics/models") value = store.getModels(query)
    else if (request.method === "GET" && url.pathname === "/api/analytics/agents") value = store.getAgents(query)
    else if (request.method === "GET" && url.pathname === "/api/analytics/sessions") value = store.getSessions(query)
    else if (request.method === "GET" && url.pathname === "/api/analytics/sources") value = store.getHealth()
    else if (request.method === "GET" && /^\/api\/analytics\/refresh\/[a-f0-9-]+$/i.test(url.pathname)) value = store.getRefresh(url.pathname.split("/").at(-1))
    else if (request.method === "GET" && url.pathname === "/api/analytics/export") {
      const rows = query.entity === "events" ? store.getSkillEvents(10000) : store.getSkills(query)
      if (query.format === "csv") {
        response.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ai-analytics-${query.entity === "events" ? "events" : "skills"}.csv"`, "cache-control": "no-store" })
        response.end(csv(rows))
      } else json(response, 200, rows)
      return
    }
    else if (request.method === "POST" && url.pathname === "/api/analytics/refresh") {
      if (request.headers["x-ai-analytics-action"] !== "refresh") { json(response, 403, { error: "Refresh requires the same-origin analytics action header." }); return }
      const started = startRefresh()
      json(response, started.conflict ? 409 : 202, started.refresh)
      return
    }
    else if (request.method === "POST" && url.pathname === "/api/analytics/events") {
      const expected = process.env.OPENCODE_EFFICIENCY_API_TOKEN
      const provided = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "")
      if (!expected || provided !== expected) { json(response, 403, { error: "Event ingestion requires OPENCODE_EFFICIENCY_API_TOKEN." }); return }
      const body = await readJson(request)
      const events = Array.isArray(body.events) ? body.events : body.event ? [body.event] : []
      value = store.importSkillEvents(events, { sourceKey: body.sourceKey || "collector", sourceType: body.sourceType || "collector", coverage: body.coverage ?? null })
    }
    else if (request.method === "POST" && url.pathname === "/api/efficiency/sync") {
      const expected = process.env.OPENCODE_EFFICIENCY_API_TOKEN
      const provided = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "")
      if (!expected || provided !== expected) { json(response, 403, { error: "Protected operation. Configure OPENCODE_EFFICIENCY_API_TOKEN and send it as a Bearer token." }); return }
      value = await runSync()
    } else { json(response, 404, { error: "Not found" }); return }
    json(response, value === null ? 404 : 200, value ?? { error: "Not found" })
  } catch (error) { json(response, 500, { error: String(error.message || error).slice(0, 240) }) }
})

const port = Number(process.env.OPENCODE_EFFICIENCY_PORT) || 4177
server.listen(port, "127.0.0.1", () => {
  console.log(`AI Efficiency Control Center: http://127.0.0.1:${port}/efficiency`)
  void runSync()
})
const timer = setInterval(() => void runSync(), 60000)
const close = () => { clearInterval(timer); server.close(); server.closeAllConnections?.(); store.close(); process.exit(0) }
process.on("SIGINT", close)
process.on("SIGTERM", close)
