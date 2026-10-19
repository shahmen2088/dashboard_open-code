import { appendFile, readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { ACTIONS_FILE, AUDIT_JSON, DASHBOARD_HTML, paths, SETTINGS_FILE } from "./config.js"
import { loadIndex, loadSettings, writeJson } from "./storage.js"
import { aggregateUsage, usageCsv } from "./usage/aggregate.js"
import { loadUsageIndex, loadUsageRecords } from "./usage/ledger.js"
import { loadModelCatalog } from "./models/catalog.js"
import { applySessionModelChange, previewSessionModelChange } from "./models/switcher.js"
import { applyDefaultModelChange, previewDefaultModelChange } from "./models/default.js"
import { injectSecurityBootstrap, readJsonBody, validWriteRequest } from "./server/security.js"
import { budgetStatus } from "./usage/budgets.js"
import { readJournal } from "./journal.js"

let dashboardServer = null

export async function startDashboardServer(client) {
  if (dashboardServer) return
  const server = createServer(async (request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" })
      response.end(body)
    }
    const url = new URL(request.url || "/", "http://127.0.0.1")
    if (url.pathname === "/api/report") {
      try { send(200, "application/json; charset=utf-8", await readFile(AUDIT_JSON, "utf8")) } catch { send(404, "application/json; charset=utf-8", JSON.stringify({ error: "Audit has not been generated yet" })) }
      return
    }
    if (url.pathname === "/api/health") {
      send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: { protocol: "v1", server: true, dashboardUrl: paths.dashboardUrl }, error: null, meta: { generatedAt: new Date().toISOString(), schemaVersion: 2 } }))
      return
    }
    if (url.pathname === "/api/settings" && request.method === "GET") {
      send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: await loadSettings(), error: null, meta: { generatedAt: new Date().toISOString(), schemaVersion: 2 } }))
      return
    }
    if (url.pathname === "/api/settings" && request.method === "PATCH") {
      if (!validWriteRequest(request, paths.dashboardUrl)) { send(403, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: "WRITE_NOT_AUTHORIZED", message: "A local request token, JSON content type, and same-origin request are required." } })); return }
      try {
        const patch = await readJsonBody(request)
        const allowed = ["dashboard", "usage", "budgets", "modelSwitching", "security"]
        if (!patch || Object.keys(patch).some((key) => !allowed.includes(key))) throw Object.assign(new Error("Only supported settings sections may be changed"), { code: "INVALID_SETTINGS" })
        const current = await loadSettings()
        const next = { ...current }
        for (const key of allowed) if (patch[key] !== undefined) next[key] = { ...current[key], ...patch[key] }
        await writeJson(SETTINGS_FILE, next)
        await appendFile(ACTIONS_FILE, `${JSON.stringify({ at: new Date().toISOString(), action: "settings-updated", sections: Object.keys(patch) })}\n`, "utf8")
        send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: next, error: null, meta: { generatedAt: new Date().toISOString(), schemaVersion: 2 } }))
      } catch (error) {
        send(error.code === "REQUEST_TOO_LARGE" ? 413 : 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: error.code || "INVALID_SETTINGS", message: String(error?.message || error) } }))
      }
      return
    }
    if (url.pathname === "/api/journal") {
      send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: await readJournal({ skip: url.searchParams.get("skip"), limit: url.searchParams.get("limit") }), error: null, meta: { generatedAt: new Date().toISOString(), schemaVersion: 2 } }))
      return
    }
    if (url.pathname === "/api/dashboard") {
      const [index, settings, usageRecords] = await Promise.all([loadIndex(), loadSettings(), loadUsageRecords()])
      const records = [...usageRecords.values()]
      send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: { activeChats: Object.values(index.sessions).filter((item) => item.status?.type !== "idle").length, sessions: Object.keys(index.sessions).length, budgets: budgetStatus(records, settings.budgets, settings.usage.timezone), usage: (await loadUsageIndex()).totals }, error: null, meta: { generatedAt: new Date().toISOString(), schemaVersion: 2 } }))
      return
    }
    if (url.pathname === "/api/models") {
      try {
        const catalog = await loadModelCatalog(client)
        send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: catalog, error: null, meta: { generatedAt: new Date().toISOString(), schemaVersion: 2 } }))
      } catch (error) {
        send(500, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: "MODEL_CATALOG_FAILED", message: String(error?.message || error) }, meta: { schemaVersion: 2 } }))
      }
      return
    }
    if (url.pathname === "/api/actions/session-model/preview" || url.pathname === "/api/actions/session-model/apply" || url.pathname === "/api/actions/default-model/preview" || url.pathname === "/api/actions/default-model/apply") {
      if (request.method !== "POST" || !validWriteRequest(request, paths.dashboardUrl)) { send(403, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: "WRITE_NOT_AUTHORIZED", message: "A local request token, JSON content type, and same-origin request are required." } })); return }
      try {
        const body = await readJsonBody(request)
        const defaultModel = url.pathname.includes("default-model")
        const result = url.pathname.endsWith("/preview")
          ? (defaultModel ? await previewDefaultModelChange(body) : await previewSessionModelChange(client, body))
          : (defaultModel ? await applyDefaultModelChange(body) : await applySessionModelChange(client, body))
        send(result.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify({ ...result, meta: { generatedAt: new Date().toISOString(), schemaVersion: 2 } }))
      } catch (error) {
        send(error.code === "REQUEST_TOO_LARGE" ? 413 : 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: error.code || "INVALID_REQUEST", message: String(error?.message || error) } }))
      }
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
      try { send(200, "text/html; charset=utf-8", injectSecurityBootstrap(await readFile(DASHBOARD_HTML, "utf8"))) } catch { send(404, "text/plain; charset=utf-8", "Dashboard is not generated yet") }
      return
    }
    send(404, "text/plain; charset=utf-8", "Not found")
  })
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen) })
  dashboardServer = server
  const address = server.address()
  paths.dashboardUrl = address && typeof address === "object" ? `http://127.0.0.1:${address.port}/` : null
}
