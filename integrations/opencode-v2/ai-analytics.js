const endpoint = process.env.OPENCODE_EFFICIENCY_URL || "http://127.0.0.1:4177"
const token = process.env.OPENCODE_EFFICIENCY_API_TOKEN || ""

export function skillFromTool(event) {
  const input = event?.input || event?.args || {}
  if (event?.tool === "skill") return String(input.name || input.skill || "").trim() || null
  if (event?.tool !== "read") return null
  const path = String(input.path || input.filePath || "")
  return path.match(/[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i)?.[1] || null
}

async function emit(events) {
  if (!token || !events.length) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 250)
  try {
    await fetch(`${endpoint}/api/analytics/events`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ sourceKey: "opencode-v2-hook", sourceType: "opencode", coverage: null, events }),
      signal: controller.signal,
    })
  } catch {
    // Analytics must never block an OpenCode tool result.
  } finally { clearTimeout(timer) }
}

export default {
  id: "ai-efficiency-analytics",
  async setup(ctx) {
    await ctx.tool.hook("execute.after", async (event) => {
      const skill = skillFromTool(event)
      if (!skill) return
      const sessionId = event.sessionID || event.sessionId || null
      const toolId = event.id || event.callID || event.callId || `${Date.now()}`
      const completed = event.status === "completed"
      const base = {
        timestamp: new Date().toISOString(), platform: "opencode", sessionExternalId: sessionId,
        agentId: event.agent || null, model: event.model || null, skill,
        invocationType: event.tool === "skill" ? "explicit" : "implicit",
        evidenceSource: event.tool === "skill" ? "opencode-v2-tool-hook" : "opencode-v2-read-hook",
      }
      await emit([
        { ...base, eventId: `${sessionId || "unknown"}:${toolId}:${skill}:invoked`, eventType: "skill.invoked", status: "observed" },
        { ...base, eventId: `${sessionId || "unknown"}:${toolId}:${skill}:load`, eventType: completed ? "skill.load_succeeded" : "skill.load_failed", status: event.status || "unknown" },
      ])
    })
  },
}
