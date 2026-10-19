import { writeFile } from "node:fs/promises"
import { AUDIT_CSV, AUDIT_JSON, paths, SUMMARY_FILE } from "./config.js"
import { writeJson } from "./storage.js"
import { projectGroups } from "./core/audit.js"

export async function writeReports(index, settings, errors = [], { writeDashboard, now }) {
  void settings
  const sessions = Object.values(index.sessions)
  const groups = projectGroups(index)
  const counts = {
    sessions: sessions.length,
    projects: groups.length,
    manualTitles: sessions.filter((item) => item.manualTitlePreservation).length,
    ignored: sessions.filter((item) => item.ignored).length,
    renameCandidates: sessions.filter((item) => !item.manualTitlePreservation && !item.ignored).length,
    duplicateLinks: sessions.reduce((sum, item) => sum + item.duplicateCandidateIds.length, 0),
  }
  const report = { generatedAt: now(), dryRun: true, protocol: "v1", noDatabaseAccess: true, noExternalCalls: true, noMoveOrDelete: true, counts, groups, sessions, errors, paths }
  await writeJson(AUDIT_JSON, report)
  await writeDashboard(report)
  const header = ["id", "projectDirectory", "directory", "topic", "currentTitle", "proposedTitle", "status", "manualTitlePreservation", "actionPlan"]
  const csv = [header, ...sessions.map((item) => [item.id, item.projectDirectory, item.directory, item.topic, item.currentTitle, item.proposedTitle, item.status?.type, item.manualTitlePreservation, item.actionPlan])]
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n")
  await writeFile(AUDIT_CSV, `${csv}\n`, "utf8")
  const groupsText = groups.map((group) => `- ${group.projectDirectory}: ${group.total} sessions`).join("\n") || "- No sessions found"
  await writeFile(SUMMARY_FILE, `# Session Organizer audit\n\nGenerated: ${report.generatedAt}\n\n- Sessions: ${counts.sessions}\n- Projects: ${counts.projects}\n- Manual titles preserved: ${counts.manualTitles}\n- Rename candidates: ${counts.renameCandidates}\n- Duplicate links: ${counts.duplicateLinks}\n- Database access: never\n- Moves/deletes: never\n\n## Projects\n${groupsText}\n`, "utf8")
  return report
}
