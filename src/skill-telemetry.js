import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

const digest = (value) => createHash("sha256").update(String(value)).digest("hex")
const normalizeName = (value) => typeof value === "string" ? value.trim().toLocaleLowerCase() : ""
const iso = (value) => {
  if (value === null || value === undefined || value === "") return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function frontmatterValue(text, key) {
  const header = String(text).match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || ""
  const match = header.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"))
  if (!match) return null
  return match[1].trim().replace(/^["']|["']$/g, "")
}

async function walkSkillFiles(root) {
  const files = []
  const walk = async (directory) => {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const target = join(directory, entry.name)
      if (entry.isDirectory()) await walk(target)
      else if (entry.isFile() && entry.name.toLocaleLowerCase() === "skill.md") files.push(target)
    }
  }
  await walk(root)
  return files
}

export async function discoverSkillInstallations(roots = []) {
  const discovered = []
  for (const item of roots) {
    if (!item?.path) continue
    const root = resolve(item.path)
    for (const file of await walkSkillFiles(root)) {
      let content
      try { content = await readFile(file, "utf8") } catch { continue }
      const name = frontmatterValue(content, "name") || basename(resolve(file, ".."))
      if (!name) continue
      discovered.push({
        name,
        description: frontmatterValue(content, "description"),
        scope: item.scope || "unknown",
        platform: item.platform || "codex",
        version: digest(content),
        pathHash: digest(resolve(file)),
        status: "available",
      })
    }
  }
  const unique = new Map()
  for (const skill of discovered) unique.set(`${skill.platform}:${skill.scope}:${skill.pathHash}`, skill)
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function textBlocks(content) {
  if (typeof content === "string") return [content]
  if (!Array.isArray(content)) return []
  return content.flatMap((item) => typeof item === "string" ? [item] : typeof item?.text === "string" ? [item.text] : [])
}

function namesInSkillPath(value, knownByLower) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? "")
  const found = new Set()
  const pattern = /[\\/]+skills[\\/]+([^\\/"']+)[\\/]+SKILL\.md/gi
  for (const match of serialized.matchAll(pattern)) {
    const known = knownByLower.get(normalizeName(match[1]))
    if (known) found.add(known)
  }
  return [...found]
}

function explicitNames(value, knownByLower) {
  const found = new Set()
  for (const match of String(value || "").matchAll(/\$([a-z0-9_.:-]+)/gi)) {
    const known = knownByLower.get(normalizeName(match[1]))
    if (known) found.add(known)
  }
  return [...found]
}

function makeEvent({ seed, eventType, timestamp, platform, sessionExternalId, turnId = null, agentId = null, model = null, skill, invocationType, status, evidenceSource }) {
  return {
    eventId: digest(`${seed}:${eventType}`),
    eventType,
    timestamp: iso(timestamp),
    platform,
    sessionExternalId: sessionExternalId || null,
    turnId,
    agentId,
    model,
    skill,
    skillVersion: null,
    invocationType,
    status,
    evidenceSource,
  }
}

export function extractCodexSkillEvidence(records, knownSkills) {
  const knownByLower = new Map([...knownSkills].map((name) => [normalizeName(name), name]))
  const explicit = new Map()
  const loads = []
  const completedCalls = new Set()
  let sessionExternalId = null
  let currentTurnId = null
  let currentModel = null

  for (const record of records) {
    const payload = record?.payload || {}
    if (record?.type === "session_meta") sessionExternalId = payload.id || payload.session_id || sessionExternalId
    if (record?.type === "turn_context") {
      currentTurnId = payload.turn_id || payload.root_turn_id || currentTurnId
      currentModel = payload.model || currentModel
    }
    if (record?.type === "response_item" && payload.type === "message" && payload.role === "user") {
      for (const name of explicitNames(textBlocks(payload.content).join("\n"), knownByLower)) {
        explicit.set(`${currentTurnId || "unknown"}:${name}`, { name, timestamp: record.timestamp, turnId: currentTurnId, model: currentModel })
      }
    }
    if (record?.type === "response_item" && ["custom_tool_call", "function_call"].includes(payload.type)) {
      for (const name of namesInSkillPath(payload.input ?? payload.arguments, knownByLower)) {
        loads.push({ name, callId: payload.call_id || payload.id || digest(JSON.stringify(payload)), timestamp: record.timestamp, turnId: currentTurnId, model: currentModel })
      }
    }
    if (record?.type === "response_item" && ["custom_tool_call_output", "function_call_output"].includes(payload.type)) {
      if (payload.call_id) completedCalls.add(payload.call_id)
    }
  }

  const events = []
  const invoked = new Set()
  for (const item of explicit.values()) {
    const key = `${item.turnId || "unknown"}:${item.name}`
    invoked.add(key)
    events.push(makeEvent({ seed: `codex:${sessionExternalId}:${key}:explicit`, eventType: "skill.invoked", timestamp: item.timestamp, platform: "codex", sessionExternalId, turnId: item.turnId, model: item.model, skill: item.name, invocationType: "explicit", status: "observed", evidenceSource: "codex-jsonl-explicit-marker" }))
  }
  for (const item of loads) {
    const key = `${item.turnId || "unknown"}:${item.name}`
    if (!invoked.has(key)) {
      invoked.add(key)
      events.push(makeEvent({ seed: `codex:${sessionExternalId}:${key}:load`, eventType: "skill.invoked", timestamp: item.timestamp, platform: "codex", sessionExternalId, turnId: item.turnId, model: item.model, skill: item.name, invocationType: "implicit", status: "observed", evidenceSource: "codex-jsonl-skill-file-read" }))
    }
    events.push(makeEvent({ seed: `codex:${sessionExternalId}:${item.callId}:${item.name}`, eventType: completedCalls.has(item.callId) ? "skill.load_succeeded" : "skill.load_failed", timestamp: item.timestamp, platform: "codex", sessionExternalId, turnId: item.turnId, model: item.model, skill: item.name, invocationType: explicit.has(key) ? "explicit" : "implicit", status: completedCalls.has(item.callId) ? "completed" : "unknown", evidenceSource: "codex-jsonl-skill-file-read" }))
  }
  return events
}

function skillFromOpenCodeTool(part, knownByLower) {
  if (part?.type !== "tool") return null
  const input = part.state?.input || part.input || {}
  if (part.name === "skill") {
    const candidate = input.name || input.skill || input.id
    return knownByLower.get(normalizeName(candidate)) || null
  }
  if (part.name === "read") return namesInSkillPath(input.path || input.filePath || input, knownByLower)[0] || null
  return null
}

export function extractOpenCodeSkillEvidence({ session, messages = [], knownSkills }) {
  const knownByLower = new Map([...knownSkills].map((name) => [normalizeName(name), name]))
  const events = []
  const seen = new Set()
  const model = session?.model?.id || null
  for (const message of messages) {
    if (message?.type !== "assistant") continue
    for (const part of Array.isArray(message.content) ? message.content : []) {
      const skill = skillFromOpenCodeTool(part, knownByLower)
      if (!skill) continue
      const toolId = part.id || digest(JSON.stringify({ name: part.name, time: part.time, skill }))
      const invocationKey = `${toolId}:${skill}`
      if (!seen.has(invocationKey)) {
        seen.add(invocationKey)
        events.push(makeEvent({ seed: `opencode:${session?.id}:${invocationKey}`, eventType: "skill.invoked", timestamp: part.time?.start || part.time?.created || session?.time?.updated, platform: "opencode", sessionExternalId: session?.id, agentId: session?.agent || null, model, skill, invocationType: part.name === "skill" ? "explicit" : "implicit", status: "observed", evidenceSource: part.name === "skill" ? "opencode-api-skill-tool" : "opencode-api-skill-file-read" }))
      }
      const completed = part.state?.status === "completed"
      events.push(makeEvent({ seed: `opencode:${session?.id}:${invocationKey}:load`, eventType: completed ? "skill.load_succeeded" : "skill.load_failed", timestamp: part.time?.end || part.time?.start || session?.time?.updated, platform: "opencode", sessionExternalId: session?.id, agentId: session?.agent || null, model, skill, invocationType: part.name === "skill" ? "explicit" : "implicit", status: part.state?.status || "unknown", evidenceSource: part.name === "skill" ? "opencode-api-skill-tool" : "opencode-api-skill-file-read" }))
    }
  }
  return events
}
