import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { AUDIT_JSON, DASHBOARD_HTML, paths } from "./config.js"
import { aggregateUsage, usageCsv } from "./usage/aggregate.js"
import { loadUsageIndex, loadUsageRecords } from "./usage/ledger.js"

let dashboardServer = null

export async function startDashboardServer() {
  if (dashboardServer) return
  const server = createServer(async (request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store" })
      response.end(body)
    }
    const url = new URL(request.url || "/", "http://127.0.0.1")
    if (url.pathname === "/api/report") {
      try { send(200, "application/json; charset=utf-8", await readFile(AUDIT_JSON, "utf8")) } catch { send(404, "application/json; charset=utf-8", JSON.stringify({ error: "Audit has not been generated yet" })) }
      return
    }
    if (url.pathname === "/api/usage" || url.pathname === "/api/usage/export.csv") {
      try {
        const groupBy = ["day", "project", "session", "provider", "model"].includes(url.searchParams.get("groupBy")) ? url.searchParams.get("groupBy") : "day"
        const rows = aggregateUsage([...await loadUsageRecords().then((records) => records.values())], {
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
          timezone: url.searchParams.get("timezone") || "Europe/Moscow",
          groupBy,
          projectId: url.searchParams.get("projectId") || undefined,
          sessionId: url.searchParams.get("sessionId") || undefined,
          providerId: url.searchParams.get("providerId") || undefined,
          modelId: url.searchParams.get("modelId") || undefined,
        })
        if (url.pathname.endsWith(".csv")) { send(200, "text/csv; charset=utf-8", usageCsv(rows)); return }
        send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: { rows, index: await loadUsageIndex() }, error: null, meta: { generatedAt: new Date().toISOString(), schemaVersion: 2 } }))
      } catch (error) {
        send(500, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: "USAGE_READ_FAILED", message: String(error?.message || error) }, meta: { schemaVersion: 2 } }))
      }
      return
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      try { send(200, "text/html; charset=utf-8", await readFile(DASHBOARD_HTML, "utf8")) } catch { send(404, "text/plain; charset=utf-8", "Dashboard is not generated yet") }
      return
    }
    send(404, "text/plain; charset=utf-8", "Not found")
  })
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen) })
  dashboardServer = server
  const address = server.address()
  paths.dashboardUrl = address && typeof address === "object" ? `http://127.0.0.1:${address.port}/` : null
}
