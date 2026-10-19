import { relative, resolve } from "node:path"
import { GENERIC_TITLE } from "./config.js"
import { sanitize } from "./text.js"

export const TOPIC_RULES = [
  ["bug-fix", /(error|bug|fix|failure|exception|broken|ошиб|баг|исправ)/i],
  ["planning", /(plan|planning|roadmap|task|todo|план|задач|срок)/i],
  ["sales", /(sales|crm|customer|deal|order|продаж|клиент|сделк|заказ)/i],
  ["documentation", /(readme|docs?|document|инструкц|документ|описан)/i],
  ["configuration", /(config|configuration|settings?|plugin|конфиг|настро)/i],
  ["code", /(code|coding|implement|function|class|typescript|javascript|python|код|реализ)/i],
]

export function topicFor(text) {
  for (const [topic, rule] of TOPIC_RULES) if (rule.test(text)) return topic
  return "other"
}

export function topicLabel(topic) {
  return topic.replace(/(^|-)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
}

export function projectFor(directory, projects) {
  const target = resolve(directory || process.cwd())
  const matches = projects
    .filter((project) => project && project.worktree)
    .map((project) => ({ project, worktree: resolve(project.worktree) }))
    .filter(({ worktree }) => {
      const value = relative(worktree, target)
      return value === "" || (!value.startsWith("..") && !value.includes(":"))
    })
    .sort((a, b) => b.worktree.length - a.worktree.length)
  if (!matches.length) return { id: null, directory: target, match: "unmatched" }
  const selected = matches[0]
  if (selected.project.id === "global") return { id: null, directory: target, match: "exact" }
  return {
    id: selected.project.id || null,
    directory: selected.worktree,
    match: selected.worktree.toLowerCase() === target.toLowerCase() ? "exact" : "nested",
  }
}

export function isManualTitle(title, previous) {
  const current = sanitize(title, 160)
  if (!current || GENERIC_TITLE.test(current)) return false
  if (previous?.manualTitlePreservation) return true
  if (!previous) return true
  if (current === previous.currentTitle || current === previous.proposedTitle) return false
  return true
}
