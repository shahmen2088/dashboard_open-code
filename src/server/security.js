import { randomBytes } from "node:crypto"

const requestToken = randomBytes(32).toString("hex")

export function getRequestToken() {
  return requestToken
}

export function validWriteRequest(request, dashboardUrl) {
  const origin = request.headers.origin
  const expectedOrigin = dashboardUrl ? new URL(dashboardUrl).origin : null
  return request.headers["x-session-organizer-token"] === requestToken
    && (!origin || origin === expectedOrigin)
    && request.headers["content-type"]?.toLowerCase().startsWith("application/json")
}

export function injectSecurityBootstrap(page) {
  return page.replace("</head>", `<meta name="session-organizer-request-token" content="${requestToken}"></head>`)
}

export async function readJsonBody(request, maxBytes = 64 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw Object.assign(new Error("Request body is too large"), { code: "REQUEST_TOO_LARGE" })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}
