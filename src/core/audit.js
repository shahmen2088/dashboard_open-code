import { isManualTitle, projectFor, topicFor, topicLabel } from "../classification.js"
import { boundedText, safeError, sanitize, textParts } from "../text.js"

export function responseData(response) {
  if (response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "error")) {
    if (response.error) throw new Error(safeError(response.error))
    if (Object.prototype.hasOwnProperty.call(response, "data")) return response.data
  }
  return response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "data") ? response.data : response
}

export async function call(label, operation, errors) {
  try {
    return responseData(await operation())
  } catch (error) {
    errors.push({ operation: label, error: safeError(error) })
    return null
  }
}

export async function buildRecord(session, messages, statuses, projects, previous, settings) {
  const userTexts = messages.filter((item) => item?.info?.role === "user").map(textParts).filter(Boolean)
  const assistantTexts = messages.filter((item) => item?.info?.role === "assistant").map(textParts).filter(Boolean)
  const budget = { remaining: Number(settings.maxStoredText) || 1800 }
  const previewBudget = { remaining: Number(settings.previewMaxChars) || 6000 }
  const excerpts = userTexts.slice(-3).map((text) => boundedText(text, budget, settings.maxExcerptChars)).filter(Boolean)
  const previewMessages = messages.slice(-(Number(settings.previewMessagesLimit) || 20)).map((item) => ({
    role: item?.info?.role === "assistant" ? "assistant" : "user",
    text: boundedText(textParts(item), previewBudget, settings.previewMessageChars),
  })).filter((item) => item.text)
  const project = projectFor(session.directory, projects)
  const old = previous?.[session.id]
  const currentTitle = sanitize(session.title, 160)
  const manual = isManualTitle(currentTitle, old)
  const topic = topicFor(`${currentTitle}\n${userTexts.join("\n")}`)
  const summary = boundedText(excerpts[0] || assistantTexts.at(-1) || "Без текстового описания", budget, Math.min(settings.maxExcerptChars, 320)) || "Без текстового описания"
  const override = settings.manualOverrides?.[session.id] || {}
  const generatedTitle = sanitize(`${topicLabel(topic)}: ${summary}`, 96).replace(/[.:;,-]+$/, "")
  const ignored = settings.ignoredSessionIds.includes(session.id) || settings.ignoredProjectDirectories.includes(project.directory)
  return {
    id: session.id,
    projectId: project.id,
    projectDirectory: project.directory,
    projectMatch: project.match,
    directory: session.directory || null,
    parentId: session.parentID || null,
    currentTitle,
    proposedTitle: override.title || (manual ? currentTitle : generatedTitle),
    explicitTitleOverride: Boolean(override.title),
    topic: override.topic || topic,
    shortSummary: override.summary || summary,
    status: statuses[session.id] || { type: "unknown" },
    duplicateCandidateIds: old?.duplicateCandidateIds || [],
    archiveSuggestion: override.archiveSuggestion || "keep",
    manualTitlePreservation: manual,
    actionPlan: ignored ? "ignored-by-user; no-change" : manual ? "preserve-manual-title; review-only" : "rename-on-explicit-confirmation; no-move; no-delete",
    previewMessages,
    excerpts: { user: excerpts, lastAssistantResult: boundedText(assistantTexts.at(-1), budget, settings.maxExcerptChars) },
    ignored,
    time: session.time || null,
  }
}

export async function collectTree(client, roots, errors) {
  const sessions = new Map()
  const visited = new Set()
  const add = (session) => { if (session?.id) sessions.set(session.id, session) }
  const visit = async (session) => {
    if (!session?.id || visited.has(session.id)) return
    visited.add(session.id)
    add(session)
    const children = await call(`client.session.children:${session.id}`, () => client.session.children({ path: { id: session.id }, query: { directory: session.directory } }), errors)
    if (Array.isArray(children)) for (const child of children) await visit(child)
  }
  for (const root of roots) await visit(root)
  return [...sessions.values()]
}

export function updateDuplicates(records) {
  const entries = Object.values(records)
  for (const record of entries) {
    const words = new Set(`${record.currentTitle} ${record.shortSummary}`.toLowerCase().match(/[a-zа-яё0-9]{4,}/gi) || [])
    record.duplicateCandidateIds = entries.filter((other) => {
      if (other.id === record.id || other.projectId !== record.projectId || other.topic !== record.topic) return false
      const otherWords = new Set(`${other.currentTitle} ${other.shortSummary}`.toLowerCase().match(/[a-zа-яё0-9]{4,}/gi) || [])
      return [...words].filter((word) => otherWords.has(word)).length >= 3
    }).map((other) => other.id).slice(0, 20)
  }
}

export function projectGroups(index) {
  const groups = new Map()
  for (const record of Object.values(index.sessions)) {
    const key = record.projectId || record.projectDirectory || "unmatched"
    if (!groups.has(key)) groups.set(key, { projectId: record.projectId, projectDirectory: record.projectDirectory || "Unmatched project", total: 0, topics: {} })
    const group = groups.get(key)
    group.total += 1
    group.topics[record.topic] = (group.topics[record.topic] || 0) + 1
  }
  return [...groups.values()].sort((a, b) => a.projectDirectory.localeCompare(b.projectDirectory))
}
