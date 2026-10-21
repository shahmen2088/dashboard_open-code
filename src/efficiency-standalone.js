import { mkdir } from "node:fs/promises"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { createEfficiencyStore, discoverOpenCodeCli, efficiencyDashboardHtml } from "./efficiency-center.js"

const storeDir = resolve(process.env.OPENCODE_SESSION_ORGANIZER_HOME || join(homedir(), ".config", "opencode", "session-organizer"))
await mkdir(storeDir, { recursive: true })
const store = await createEfficiencyStore({ storeDir })

async function sync() {
  const result = { opencode: null, codex: null }
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

await sync()
const json = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(value))
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
    if (request.method === "GET" && url.pathname === "/api/efficiency/overview") value = store.getOverview(query)
    else if (request.method === "GET" && url.pathname === "/api/efficiency/models") value = store.getModels(query)
    else if (request.method === "GET" && url.pathname === "/api/efficiency/sessions") value = store.getSessions(query)
    else if (request.method === "GET" && /^\/api\/efficiency\/sessions\/\d+$/.test(url.pathname)) value = store.getSession(Number(url.pathname.split("/").at(-1)))
    else if (request.method === "GET" && url.pathname === "/api/efficiency/projects") value = store.getProjects()
    else if (request.method === "GET" && url.pathname === "/api/efficiency/health") value = store.getHealth()
    else if (request.method === "GET" && url.pathname === "/api/efficiency/benchmarks") value = store.getBenchmarks()
    else if (request.method === "GET" && url.pathname === "/api/efficiency/experiments") value = store.getExperiments()
    else if (request.method === "GET" && url.pathname === "/api/efficiency/budgets") value = store.getBudgets()
    else if (request.method === "POST" && url.pathname === "/api/efficiency/sync") {
      const expected = process.env.OPENCODE_EFFICIENCY_API_TOKEN
      const provided = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "")
      if (!expected || provided !== expected) { json(response, 403, { error: "Protected operation. Configure OPENCODE_EFFICIENCY_API_TOKEN and send it as a Bearer token." }); return }
      value = await sync()
    } else { json(response, 404, { error: "Not found" }); return }
    json(response, value === null ? 404 : 200, value ?? { error: "Not found" })
  } catch (error) { json(response, 500, { error: String(error.message || error).slice(0, 240) }) }
})

const port = Number(process.env.OPENCODE_EFFICIENCY_PORT) || 4177
server.listen(port, "127.0.0.1", () => console.log(`AI Efficiency Control Center: http://127.0.0.1:${port}/efficiency`))
const timer = setInterval(() => void sync(), 60000)
const close = () => { clearInterval(timer); server.close(); server.closeAllConnections?.(); store.close(); process.exit(0) }
process.on("SIGINT", close)
process.on("SIGTERM", close)
