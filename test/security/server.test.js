import assert from "node:assert/strict"
import test from "node:test"
import { getRequestToken, injectSecurityBootstrap, validWriteRequest } from "../../src/server/security.js"

test("write request security requires the in-memory token and same origin", () => {
  const token = getRequestToken()
  const headers = { "x-session-organizer-token": token, origin: "http://127.0.0.1:1234", "content-type": "application/json" }
  assert.equal(validWriteRequest({ headers }, "http://127.0.0.1:1234/"), true)
  assert.equal(validWriteRequest({ headers: { ...headers, origin: "http://localhost:1234" } }, "http://127.0.0.1:1234/"), false)
  assert.match(injectSecurityBootstrap("<head></head>"), /session-organizer-request-token/)
})
