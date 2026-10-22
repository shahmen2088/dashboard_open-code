const input = await new Promise((resolve) => {
  const chunks = []
  process.stdin.on("data", (chunk) => chunks.push(chunk))
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
})

try {
  const payload = JSON.parse(input || "{}")
  const token = process.env.OPENCODE_EFFICIENCY_API_TOKEN || ""
  const endpoint = process.env.OPENCODE_EFFICIENCY_URL || "http://127.0.0.1:4177"
  const serialized = JSON.stringify(payload.tool_input || {})
  const skill = serialized.match(/[\\/]+skills[\\/]+([^\\/"']+)[\\/]+SKILL\.md/i)?.[1] || null
  if (token && skill && payload.hook_event_name === "PostToolUse") {
    const seed = `${payload.session_id || "unknown"}:${payload.tool_use_id || "unknown"}:${skill}`
    const base = {
      timestamp: new Date().toISOString(), platform: "codex", sessionExternalId: payload.session_id || null,
      turnId: payload.turn_id || null, model: payload.model || null, skill, invocationType: "implicit",
      status: "completed", evidenceSource: "codex-post-tool-use-hook",
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 250)
    try {
      await fetch(`${endpoint}/api/analytics/events`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceKey: "codex-hook", sourceType: "codex", coverage: null, events: [
          { ...base, eventId: `${seed}:invoked`, eventType: "skill.invoked" },
          { ...base, eventId: `${seed}:load`, eventType: "skill.load_succeeded" },
        ] }),
        signal: controller.signal,
      })
    } catch {
      // Telemetry is best-effort and must not affect the Codex tool result.
    } finally { clearTimeout(timer) }
  }
} catch {
  // Malformed hook input is ignored so Codex can continue.
}
