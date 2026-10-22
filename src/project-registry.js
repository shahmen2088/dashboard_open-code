import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

function validationError(message) {
  return new Error(`Invalid project registry: ${message}`)
}

export function normalizeProjectDirectory(directory) {
  if (typeof directory !== "string" || !directory.trim()) return null
  return resolve(directory).replace(/[\\/]+$/, "").toLocaleLowerCase()
}

export function directoryIsWithinRoot(directory, root) {
  const candidate = normalizeProjectDirectory(directory)
  const normalizedRoot = normalizeProjectDirectory(root)
  if (!candidate || !normalizedRoot) return false
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}\\`) || candidate.startsWith(`${normalizedRoot}/`)
}

export async function loadProjectRegistry(file) {
  if (!file) return { enabled: false, projects: [], projectDirectories: [] }
  let parsed
  try {
    parsed = JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    throw new Error(`Could not read project registry ${file}: ${error.message}`)
  }
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.projects)) {
    throw validationError("schemaVersion must be 1 and projects must be an array")
  }
  const seen = new Set()
  const projects = parsed.projects.map((project, index) => {
    if (!project || typeof project.id !== "string" || !project.id.trim()) throw validationError(`projects[${index}].id is required`)
    if (seen.has(project.id)) throw validationError(`duplicate project id ${project.id}`)
    seen.add(project.id)
    const directory = normalizeProjectDirectory(project.directory)
    if (!directory) throw validationError(`projects[${index}].directory is required`)
    return { id: project.id, name: typeof project.name === "string" ? project.name : project.id, directory }
  })
  return { enabled: true, projects, projectDirectories: projects.map((project) => project.directory) }
}
