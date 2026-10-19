import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { AUDIT_JSON, DASHBOARD_HTML, paths } from "./config.js"

let dashboardServer = null

export async function startDashboardServer() {
  if (dashboardServer) return
  const server = createServer(async (request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store" })
      response.end(body)
    }
    if (request.url === "/api/report") {
      try { send(200, "application/json; charset=utf-8", await readFile(AUDIT_JSON, "utf8")) } catch { send(404, "application/json; charset=utf-8", JSON.stringify({ error: "Audit has not been generated yet" })) }
      return
    }
    if (request.url === "/" || request.url === "/index.html") {
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
