// src/session-organizer.js
import { writeFile as writeFile3 } from "node:fs/promises";

// src/config.js
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var STORE = resolve(process.env.OPENCODE_SESSION_ORGANIZER_HOME || join(homedir(), ".config", "opencode", "session-organizer"));
var REPORTS = join(STORE, "reports");
var BACKUPS = join(STORE, "backups");
var INDEX_FILE = join(STORE, "index.json");
var SETTINGS_FILE = join(STORE, "settings.json");
var ACTIONS_FILE = join(STORE, "actions.log");
var AUDIT_JSON = join(REPORTS, "audit-latest.json");
var AUDIT_CSV = join(REPORTS, "audit-latest.csv");
var SUMMARY_FILE = join(REPORTS, "summary.md");
var DASHBOARD_HTML = join(REPORTS, "dashboard.html");
var DEFAULT_SETTINGS = {
  schemaVersion: 1,
  autoRename: false,
  autoMove: false,
  messagesLimit: 120,
  maxExcerptChars: 420,
  maxStoredText: 1800,
  previewMessagesLimit: 20,
  previewMessageChars: 360,
  previewMaxChars: 6e3,
  debounceMs: 1500,
  ignoredSessionIds: [],
  ignoredProjectDirectories: [],
  manualOverrides: {}
};
var paths = {
  store: STORE,
  index: INDEX_FILE,
  settings: SETTINGS_FILE,
  actions: ACTIONS_FILE,
  auditJson: AUDIT_JSON,
  auditCsv: AUDIT_CSV,
  dashboard: DASHBOARD_HTML,
  dashboardUrl: null,
  summary: SUMMARY_FILE,
  backups: BACKUPS
};
var GENERIC_TITLE = /^(new session|session(?:\s+\d+)?|untitled(?:\s+session)?|opencode session)$/i;

// src/storage.js
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
function json(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}
async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, json(value), "utf8");
  await rename(temporary, file);
}
async function ensureStorage() {
  await mkdir(REPORTS, { recursive: true });
  await mkdir(BACKUPS, { recursive: true });
  await appendFile(ACTIONS_FILE, "", { encoding: "utf8", flag: "a" });
}
async function loadSettings() {
  const current = await readJson(SETTINGS_FILE, {});
  const settings = {
    ...DEFAULT_SETTINGS,
    ...current,
    ignoredSessionIds: Array.isArray(current.ignoredSessionIds) ? current.ignoredSessionIds : [],
    ignoredProjectDirectories: Array.isArray(current.ignoredProjectDirectories) ? current.ignoredProjectDirectories : [],
    manualOverrides: current.manualOverrides && typeof current.manualOverrides === "object" ? current.manualOverrides : {}
  };
  await writeJson(SETTINGS_FILE, settings);
  return settings;
}
async function loadIndex() {
  const current = await readJson(INDEX_FILE, {});
  return {
    schemaVersion: 1,
    updatedAt: current.updatedAt || null,
    projects: Array.isArray(current.projects) ? current.projects : [],
    sessions: current.sessions && typeof current.sessions === "object" ? current.sessions : {}
  };
}

// src/text.js
var SECRET_PATTERNS = [
  /(-----BEGIN [^-]+-----)[\s\S]*?(-----END [^-]+-----)/gi,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|private[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /\bbearer\s+[a-z0-9._~+/=-]{8,}/gi,
  /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi
];
function sanitize(value, limit = 420) {
  let text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[REDACTED]");
  return text.slice(0, limit);
}
function safeError(error) {
  return sanitize(error instanceof Error ? error.message : error, 240);
}
function textParts(message) {
  if (!message || !Array.isArray(message.parts)) return "";
  return message.parts.filter((part) => part && part.type === "text" && typeof part.text === "string").map((part) => part.text).join(" ");
}
function boundedText(value, budget, limit) {
  if (budget.remaining <= 0) return "";
  const text = sanitize(value, Math.min(limit, budget.remaining));
  budget.remaining -= text.length;
  return text;
}

// src/server.js
import { readFile as readFile2 } from "node:fs/promises";
import { createServer } from "node:http";
var dashboardServer = null;
async function startDashboardServer() {
  if (dashboardServer) return;
  const server = createServer(async (request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      response.end(body);
    };
    if (request.url === "/api/report") {
      try {
        send(200, "application/json; charset=utf-8", await readFile2(AUDIT_JSON, "utf8"));
      } catch {
        send(404, "application/json; charset=utf-8", JSON.stringify({ error: "Audit has not been generated yet" }));
      }
      return;
    }
    if (request.url === "/" || request.url === "/index.html") {
      try {
        send(200, "text/html; charset=utf-8", await readFile2(DASHBOARD_HTML, "utf8"));
      } catch {
        send(404, "text/plain; charset=utf-8", "Dashboard is not generated yet");
      }
      return;
    }
    send(404, "text/plain; charset=utf-8", "Not found");
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  dashboardServer = server;
  const address = server.address();
  paths.dashboardUrl = address && typeof address === "object" ? `http://127.0.0.1:${address.port}/` : null;
}

// src/compat/opencode-v1.js
function responseData(response) {
  if (response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "error")) {
    if (response.error) throw new Error(safeError(response.error));
    if (Object.prototype.hasOwnProperty.call(response, "data")) return response.data;
  }
  return response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "data") ? response.data : response;
}
async function call(label, operation, errors) {
  try {
    return responseData(await operation());
  } catch (error) {
    errors.push({ operation: label, error: safeError(error) });
    return null;
  }
}

// src/core/pipeline.js
import { appendFile as appendFile2 } from "node:fs/promises";
import { resolve as resolve3 } from "node:path";

// src/classification.js
import { relative, resolve as resolve2 } from "node:path";
var TOPIC_RULES = [
  ["bug-fix", /(error|bug|fix|failure|exception|broken|ошиб|баг|исправ)/i],
  ["planning", /(plan|planning|roadmap|task|todo|план|задач|срок)/i],
  ["sales", /(sales|crm|customer|deal|order|продаж|клиент|сделк|заказ)/i],
  ["documentation", /(readme|docs?|document|инструкц|документ|описан)/i],
  ["configuration", /(config|configuration|settings?|plugin|конфиг|настро)/i],
  ["code", /(code|coding|implement|function|class|typescript|javascript|python|код|реализ)/i]
];
function topicFor(text) {
  for (const [topic, rule] of TOPIC_RULES) if (rule.test(text)) return topic;
  return "other";
}
function topicLabel(topic) {
  return topic.replace(/(^|-)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}
function projectFor(directory, projects) {
  const target = resolve2(directory || process.cwd());
  const matches = projects.filter((project) => project && project.worktree).map((project) => ({ project, worktree: resolve2(project.worktree) })).filter(({ worktree }) => {
    const value = relative(worktree, target);
    return value === "" || !value.startsWith("..") && !value.includes(":");
  }).sort((a, b) => b.worktree.length - a.worktree.length);
  if (!matches.length) return { id: null, directory: target, match: "unmatched" };
  const selected = matches[0];
  if (selected.project.id === "global") return { id: null, directory: target, match: "exact" };
  return {
    id: selected.project.id || null,
    directory: selected.worktree,
    match: selected.worktree.toLowerCase() === target.toLowerCase() ? "exact" : "nested"
  };
}
function isManualTitle(title, previous) {
  const current = sanitize(title, 160);
  if (!current || GENERIC_TITLE.test(current)) return false;
  if (previous?.manualTitlePreservation) return true;
  if (!previous) return true;
  if (current === previous.currentTitle || current === previous.proposedTitle) return false;
  return true;
}

// src/core/audit.js
async function buildRecord(session, messages, statuses, projects, previous, settings) {
  const userTexts = messages.filter((item) => item?.info?.role === "user").map(textParts).filter(Boolean);
  const assistantTexts = messages.filter((item) => item?.info?.role === "assistant").map(textParts).filter(Boolean);
  const budget = { remaining: Number(settings.maxStoredText) || 1800 };
  const previewBudget = { remaining: Number(settings.previewMaxChars) || 6e3 };
  const excerpts = userTexts.slice(-3).map((text) => boundedText(text, budget, settings.maxExcerptChars)).filter(Boolean);
  const previewMessages = messages.slice(-(Number(settings.previewMessagesLimit) || 20)).map((item) => ({
    role: item?.info?.role === "assistant" ? "assistant" : "user",
    text: boundedText(textParts(item), previewBudget, settings.previewMessageChars)
  })).filter((item) => item.text);
  const project = projectFor(session.directory, projects);
  const old = previous?.[session.id];
  const currentTitle = sanitize(session.title, 160);
  const manual = isManualTitle(currentTitle, old);
  const topic = topicFor(`${currentTitle}
${userTexts.join("\n")}`);
  const summary = boundedText(excerpts[0] || assistantTexts.at(-1) || "\u0411\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u043E\u0432\u043E\u0433\u043E \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u044F", budget, Math.min(settings.maxExcerptChars, 320)) || "\u0411\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u043E\u0432\u043E\u0433\u043E \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u044F";
  const override = settings.manualOverrides?.[session.id] || {};
  const generatedTitle = sanitize(`${topicLabel(topic)}: ${summary}`, 96).replace(/[.:;,-]+$/, "");
  const ignored = settings.ignoredSessionIds.includes(session.id) || settings.ignoredProjectDirectories.includes(project.directory);
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
    time: session.time || null
  };
}
async function collectTree(client, roots, errors) {
  const sessions = /* @__PURE__ */ new Map();
  const visited = /* @__PURE__ */ new Set();
  const add = (session) => {
    if (session?.id) sessions.set(session.id, session);
  };
  const visit = async (session) => {
    if (!session?.id || visited.has(session.id)) return;
    visited.add(session.id);
    add(session);
    const children = await call(`client.session.children:${session.id}`, () => client.session.children({ path: { id: session.id }, query: { directory: session.directory } }), errors);
    if (Array.isArray(children)) for (const child of children) await visit(child);
  };
  for (const root of roots) await visit(root);
  return [...sessions.values()];
}
function updateDuplicates(records) {
  const entries = Object.values(records);
  for (const record of entries) {
    const words = new Set(`${record.currentTitle} ${record.shortSummary}`.toLowerCase().match(/[a-zа-яё0-9]{4,}/gi) || []);
    record.duplicateCandidateIds = entries.filter((other) => {
      if (other.id === record.id || other.projectId !== record.projectId || other.topic !== record.topic) return false;
      const otherWords = new Set(`${other.currentTitle} ${other.shortSummary}`.toLowerCase().match(/[a-zа-яё0-9]{4,}/gi) || []);
      return [...words].filter((word) => otherWords.has(word)).length >= 3;
    }).map((other) => other.id).slice(0, 20);
  }
}
function projectGroups(index) {
  const groups = /* @__PURE__ */ new Map();
  for (const record of Object.values(index.sessions)) {
    const key = record.projectId || record.projectDirectory || "unmatched";
    if (!groups.has(key)) groups.set(key, { projectId: record.projectId, projectDirectory: record.projectDirectory || "Unmatched project", total: 0, topics: {} });
    const group = groups.get(key);
    group.total += 1;
    group.topics[record.topic] = (group.topics[record.topic] || 0) + 1;
  }
  return [...groups.values()].sort((a, b) => a.projectDirectory.localeCompare(b.projectDirectory));
}

// src/core/pipeline.js
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function runAudit(client, currentDirectory, { writeReports: writeReports3 }) {
  await ensureStorage();
  const settings = await loadSettings();
  const previous = await loadIndex();
  const errors = [];
  const projectsResult = await call("client.project.list", () => client.project.list(), errors);
  const projects = Array.isArray(projectsResult) ? projectsResult : [];
  const directories = [...new Set([currentDirectory, ...projects.map((item) => item?.worktree)].filter(Boolean).map((item) => resolve3(item)))];
  const roots = [];
  for (const directory of directories) {
    const sessions2 = await call(`client.session.list:${directory}`, () => client.session.list({ query: { directory } }), errors);
    if (Array.isArray(sessions2)) roots.push(...sessions2);
  }
  const sessions = await collectTree(client, roots, errors);
  const statuses = {};
  for (const directory of [...new Set(sessions.map((item) => item.directory).filter(Boolean).map((item) => resolve3(item)))]) {
    const result = await call(`client.session.status:${directory}`, () => client.session.status({ query: { directory } }), errors);
    if (result && typeof result === "object") Object.assign(statuses, result);
  }
  const records = {};
  for (const session of sessions) {
    const messages = await call(`client.session.messages:${session.id}`, () => client.session.messages({ path: { id: session.id }, query: { directory: session.directory, limit: settings.messagesLimit } }), errors);
    records[session.id] = await buildRecord(session, Array.isArray(messages) ? messages : [], statuses, projects, previous.sessions, settings);
  }
  updateDuplicates(records);
  const index = { schemaVersion: 1, protocol: "v1", updatedAt: now(), projects: projects.filter((item) => item?.worktree).map((item) => ({ id: item.id || null, worktree: resolve3(item.worktree), vcs: item.vcs || null })), sessions: records };
  await writeJson(INDEX_FILE, index);
  const report = await writeReports3(index, settings, errors);
  await appendFile2(ACTIONS_FILE, `${JSON.stringify({ at: now(), action: "audit", mode: "full-dry-run", counts: report.counts, errors: errors.length })}
`, "utf8");
  return { ...report.counts, errors, paths };
}

// src/reports.js
import { writeFile as writeFile2 } from "node:fs/promises";
async function writeReports(index, settings, errors = [], { writeDashboard: writeDashboard2, now: now4 }) {
  void settings;
  const sessions = Object.values(index.sessions);
  const groups = projectGroups(index);
  const counts = {
    sessions: sessions.length,
    projects: groups.length,
    manualTitles: sessions.filter((item) => item.manualTitlePreservation).length,
    ignored: sessions.filter((item) => item.ignored).length,
    renameCandidates: sessions.filter((item) => !item.manualTitlePreservation && !item.ignored).length,
    duplicateLinks: sessions.reduce((sum, item) => sum + item.duplicateCandidateIds.length, 0)
  };
  const report = { generatedAt: now4(), dryRun: true, protocol: "v1", noDatabaseAccess: true, noExternalCalls: true, noMoveOrDelete: true, counts, groups, sessions, errors, paths };
  await writeJson(AUDIT_JSON, report);
  await writeDashboard2(report);
  const header = ["id", "projectDirectory", "directory", "topic", "currentTitle", "proposedTitle", "status", "manualTitlePreservation", "actionPlan"];
  const csv = [header, ...sessions.map((item) => [item.id, item.projectDirectory, item.directory, item.topic, item.currentTitle, item.proposedTitle, item.status?.type, item.manualTitlePreservation, item.actionPlan])].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  await writeFile2(AUDIT_CSV, `${csv}
`, "utf8");
  const groupsText = groups.map((group) => `- ${group.projectDirectory}: ${group.total} sessions`).join("\n") || "- No sessions found";
  await writeFile2(SUMMARY_FILE, `# Session Organizer audit

Generated: ${report.generatedAt}

- Sessions: ${counts.sessions}
- Projects: ${counts.projects}
- Manual titles preserved: ${counts.manualTitles}
- Rename candidates: ${counts.renameCandidates}
- Duplicate links: ${counts.duplicateLinks}
- Database access: never
- Moves/deletes: never

## Projects
${groupsText}
`, "utf8");
  return report;
}

// src/tools.js
import { tool as defineTool } from "@opencode-ai/plugin";

// src/actions.js
import { appendFile as appendFile3 } from "node:fs/promises";
import { join as join2, relative as relative2, resolve as resolve4 } from "node:path";
function now2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function saveOverride(args) {
  await ensureStorage();
  if (args.confirm !== true) return { applied: false, reason: "Explicit confirm=true is required; no settings changed." };
  if (!args.sessionId) return { applied: false, reason: "sessionId is required; no settings changed." };
  const settings = await loadSettings();
  const backup = join2(BACKUPS, `override-${Date.now()}.json`);
  await writeJson(backup, { type: "settings-backup", settings, createdAt: now2() });
  settings.manualOverrides[args.sessionId] = { ...settings.manualOverrides[args.sessionId] || {}, ...args.title ? { title: sanitize(args.title, 96) } : {}, ...args.topic ? { topic: sanitize(args.topic, 40) } : {}, ...args.archiveSuggestion ? { archiveSuggestion: sanitize(args.archiveSuggestion, 80) } : {} };
  await writeJson(SETTINGS_FILE, settings);
  return { applied: true, sessionId: args.sessionId, backup, paths };
}
function isInside(directory, file) {
  const base = resolve4(directory);
  const candidate = resolve4(file);
  const value = relative2(base, candidate);
  return value === "" || !value.startsWith("..") && !value.includes(":");
}
async function applyRenames(client, currentDirectory, args, writeReports3) {
  await ensureStorage();
  if (args.confirm !== true) return { applied: false, reason: "Explicit confirm=true is required; no sessions changed." };
  if (args.move === true) return { applied: false, refusedMove: true, reason: "Move refused: V1 has no supported session.move operation." };
  const index = await loadIndex();
  const selected = Array.isArray(args.sessionIds) ? new Set(args.sessionIds) : null;
  if (!args.all && !selected) return { applied: false, reason: "Provide all=true or sessionIds; no sessions changed." };
  const records = Object.values(index.sessions).filter((record) => (args.all || selected.has(record.id)) && !record.ignored);
  const results = [];
  for (const record of records) {
    if (record.manualTitlePreservation && !record.explicitTitleOverride) {
      results.push({ id: record.id, result: "skipped", reason: "manual title preserved" });
      continue;
    }
    if (!record.proposedTitle || record.proposedTitle === record.currentTitle) {
      results.push({ id: record.id, result: "skipped", reason: "title unchanged" });
      continue;
    }
    const backup = join2(BACKUPS, `${Date.now()}-${record.id}.json`);
    await writeJson(backup, { type: "session-organizer-backup", before: record, proposedTitle: record.proposedTitle, createdAt: now2() });
    try {
      const updated = responseData(await client.session.update({ path: { id: record.id }, query: { directory: record.directory || currentDirectory }, body: { title: record.proposedTitle } }));
      record.currentTitle = sanitize(updated?.title || record.proposedTitle, 160);
      record.manualTitlePreservation = false;
      results.push({ id: record.id, result: "renamed", title: record.currentTitle, backup });
      await appendFile3(ACTIONS_FILE, `${JSON.stringify({ at: now2(), action: "rename", id: record.id, backup })}
`, "utf8");
    } catch (error) {
      results.push({ id: record.id, result: "failed", error: safeError(error), backup });
    }
  }
  index.updatedAt = now2();
  await writeJson(INDEX_FILE, index);
  await writeReports3(index, await loadSettings(), []);
  return { applied: true, renamed: results.filter((item) => item.result === "renamed").length, results, move: "skipped/refused: V1 has no session.move", paths };
}
async function undoRenames(client, currentDirectory, args, writeReports3) {
  await ensureStorage();
  if (args.confirm !== true) return { applied: false, reason: "Explicit confirm=true is required; no sessions changed." };
  const files = Array.isArray(args.backupFiles) ? args.backupFiles : [];
  if (!files.length) return { applied: false, reason: "backupFiles is required; no sessions changed." };
  const index = await loadIndex();
  const results = [];
  for (const file of files) {
    const resolved = resolve4(file);
    if (!isInside(BACKUPS, resolved)) {
      results.push({ file, result: "refused", reason: "backup is outside the organizer backup directory" });
      continue;
    }
    const backup = await readJson(resolved, null);
    const before = backup?.before;
    if (!before?.id || !before.currentTitle) {
      results.push({ file, result: "refused", reason: "invalid session backup" });
      continue;
    }
    try {
      await client.session.update({ path: { id: before.id }, query: { directory: before.directory || currentDirectory }, body: { title: before.currentTitle } });
      if (index.sessions[before.id]) {
        index.sessions[before.id].currentTitle = before.currentTitle;
        index.sessions[before.id].proposedTitle = before.currentTitle;
      }
      results.push({ file, id: before.id, result: "restored", title: before.currentTitle });
      await appendFile3(ACTIONS_FILE, `${JSON.stringify({ at: now2(), action: "undo-rename", id: before.id, backup: file })}
`, "utf8");
    } catch (error) {
      results.push({ file, id: before.id, result: "failed", error: safeError(error) });
    }
  }
  index.updatedAt = now2();
  await writeJson(INDEX_FILE, index);
  await writeReports3(index, await loadSettings(), []);
  return { applied: true, results, paths };
}

// src/tools.js
function createTools({ client, directory, enqueue, writeReports: writeReports3, diagnose: diagnose2 }) {
  return {
    session_organizer_audit: defineTool({
      description: "Generate a full local read-only audit of OpenCode V1 sessions and refresh the dashboard.",
      args: { refresh: defineTool.schema.boolean().optional() },
      async execute() {
        const result = await enqueue(() => runAudit(client, directory, { writeReports: writeReports3 }));
        return { title: "Session Organizer audit", output: JSON.stringify(result, null, 2), metadata: result };
      }
    }),
    session_organizer_status: defineTool({
      description: "Show local Session Organizer paths, settings, and indexed session count.",
      args: {},
      async execute() {
        const index = await loadIndex();
        const settings = await loadSettings();
        const result = { updatedAt: index.updatedAt, sessions: Object.keys(index.sessions).length, settings, paths };
        return { title: "Session Organizer status", output: JSON.stringify(result, null, 2), metadata: result };
      }
    }),
    session_organizer_diagnose: defineTool({
      description: "Check OpenCode V1 connectivity, local storage, and dashboard availability.",
      args: {},
      async execute() {
        const result = await enqueue(() => diagnose2(client));
        return { title: "Session Organizer diagnostics", output: JSON.stringify(result, null, 2), metadata: result };
      }
    }),
    session_organizer_override: defineTool({
      description: "Save an explicit local title, topic, or archive override. Requires confirm=true and never changes the source session.",
      args: { confirm: defineTool.schema.boolean(), sessionId: defineTool.schema.string(), title: defineTool.schema.string().optional(), topic: defineTool.schema.string().optional(), archiveSuggestion: defineTool.schema.string().optional() },
      async execute(args) {
        const result = await enqueue(() => saveOverride(args));
        return { title: "Session Organizer override", output: JSON.stringify(result, null, 2), metadata: result };
      }
    }),
    session_organizer_apply: defineTool({
      description: "Rename selected or all non-manual sessions after explicit confirm=true. Never moves or deletes sessions.",
      args: { confirm: defineTool.schema.boolean(), all: defineTool.schema.boolean().optional(), sessionIds: defineTool.schema.array(defineTool.schema.string()).optional(), move: defineTool.schema.boolean().optional() },
      async execute(args) {
        const result = await enqueue(() => applyRenames(client, directory, args, writeReports3));
        return { title: "Session Organizer apply", output: JSON.stringify(result, null, 2), metadata: result };
      }
    }),
    session_organizer_undo: defineTool({
      description: "Restore titles from explicit Session Organizer backup files. Requires confirm=true.",
      args: { confirm: defineTool.schema.boolean(), backupFiles: defineTool.schema.array(defineTool.schema.string()) },
      async execute(args) {
        const result = await enqueue(() => undoRenames(client, directory, args, writeReports3));
        return { title: "Session Organizer undo", output: JSON.stringify(result, null, 2), metadata: result };
      }
    })
  };
}

// src/session-organizer.js
function now3() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
function polishDashboard(page) {
  return page.replace("</style></head>", `<style>
 :root{color-scheme:dark;--ink:#071018;--panel:#0d1923;--panel-raised:#122330;--line:#223949;--line-bright:#31566a;--text:#edf6f8;--muted:#8ea6b4;--mint:#65e0b2;--blue:#79b9ff;--amber:#f5c775;--shadow:0 22px 70px rgba(0,0,0,.3)}
*{scrollbar-color:#29485a var(--ink);scrollbar-width:thin}
body{background:radial-gradient(circle at 8% -8%,rgba(43,112,102,.34),transparent 28rem),radial-gradient(circle at 100% 8%,rgba(38,87,145,.22),transparent 32rem),var(--ink);font-family:Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:-.01em}
.shell{max-width:1640px;padding:34px 34px 60px}
.top{position:relative;overflow:hidden;align-items:flex-end;padding:30px 32px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(120deg,rgba(15,31,43,.96),rgba(10,20,29,.86));box-shadow:var(--shadow)}
.top:after{content:"";position:absolute;right:8%;bottom:-80px;width:240px;height:180px;border-radius:50%;background:rgba(101,224,178,.1);filter:blur(30px);pointer-events:none}
.top>div{position:relative;z-index:1}.eyebrow{font-size:11px;letter-spacing:.2em;color:var(--mint);text-transform:uppercase}.top h1{margin:8px 0 10px;font-size:clamp(30px,4vw,52px);line-height:1;letter-spacing:-.06em}.top p{margin:0;max-width:600px;font-size:14px;color:#a8bdc7}
button{font:inherit;cursor:pointer;transition:background .18s ease,border-color .18s ease,transform .18s ease,box-shadow .18s ease}
#refresh{position:relative;z-index:1;border:1px solid #3c6879;border-radius:12px;background:linear-gradient(135deg,#214456,#173047);color:var(--text);padding:12px 17px;font-weight:700;box-shadow:0 10px 24px rgba(0,0,0,.2)}
#refresh:hover{border-color:var(--mint);background:#17473f;transform:translateY(-2px);box-shadow:0 14px 30px rgba(0,0,0,.28)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px;margin:18px 0}
.stat{position:relative;overflow:hidden;padding:18px 19px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(145deg,rgba(18,35,48,.95),rgba(11,24,34,.95));box-shadow:0 10px 28px rgba(0,0,0,.14)}
.stat:after{content:"";position:absolute;right:-26px;bottom:-42px;width:90px;height:90px;border-radius:50%;background:rgba(101,224,178,.08)}.stat strong{position:relative;z-index:1;font-size:30px;letter-spacing:-.06em;color:var(--text)}.stat span{position:relative;z-index:1;margin-top:4px;color:var(--muted);font-size:11px;letter-spacing:.05em;text-transform:uppercase}
.projectbar{gap:10px;margin:0 0 18px;padding:1px 1px 5px}.project-card{min-width:260px;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:rgba(13,25,35,.86);color:var(--text);box-shadow:0 10px 25px rgba(0,0,0,.12)}.project-card:hover,.project-card.active{border-color:var(--mint);background:linear-gradient(135deg,#163b37,#112b36);box-shadow:0 12px 30px rgba(23,108,91,.18);transform:translateY(-1px)}.project-card strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}.project-card span{display:block;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);font-size:12px}
.toolbar{gap:8px;padding:10px;border:1px solid var(--line);border-radius:16px;background:rgba(13,25,35,.9);box-shadow:0 12px 32px rgba(0,0,0,.14)}.toolbar input,.toolbar select,.toolbar button,.actions button{min-height:40px;border:1px solid #294458;border-radius:10px;background:var(--panel-raised);color:var(--text);padding:9px 12px}.toolbar input{box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}.toolbar input:focus,.toolbar select:focus{outline:2px solid rgba(101,224,178,.35);border-color:var(--mint)}.toolbar button:hover,.actions button:hover{border-color:var(--mint);background:#163b37;transform:translateY(-1px)}
.layout{gap:18px}.table,.detail{border:1px solid var(--line);border-radius:18px;background:rgba(13,25,35,.94);box-shadow:var(--shadow)}.table{overflow:hidden}.table table{min-width:900px}.table th{padding:13px 15px;background:#0b1721;color:#71909f;font-size:10px;letter-spacing:.14em}.table td{padding:14px 15px;border-bottom:1px solid rgba(34,57,73,.75)}.table tbody tr[data-id]{transition:background .16s ease,box-shadow .16s ease}.table tbody tr[data-id]:hover{background:linear-gradient(90deg,rgba(28,72,67,.65),rgba(18,38,50,.4));box-shadow:inset 3px 0 var(--mint)}.table strong{font-size:13px;letter-spacing:-.015em}.table .muted{display:inline-block;max-width:360px;margin-top:4px;line-height:1.35}.badge{font-weight:700;color:var(--blue)}.detail{padding:24px;background:linear-gradient(160deg,rgba(17,38,51,.96),rgba(11,23,33,.96))}.detail h2{margin-top:0;font-size:24px;letter-spacing:-.04em}.detail h3{margin:24px 0 9px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mint)}.detail .command{border-color:#2b5362;background:#09151e;box-shadow:inset 0 1px rgba(255,255,255,.03)}.actions{margin-top:14px}.footer{padding:14px 2px;color:#7893a1;font-size:12px}.danger{color:var(--amber)}
@media(max-width:980px){.layout{grid-template-columns:1fr}.detail{min-height:260px}.top{align-items:flex-start}.top button{flex:0 0 auto}}
@media(max-width:620px){.shell{padding:16px 12px 36px}.top{display:block;padding:24px 20px;border-radius:19px}.top button{margin-top:20px;width:100%}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.stat{padding:14px}.stat strong{font-size:25px}.toolbar input,.toolbar select,.toolbar button{width:100%;flex-basis:100%}.project-card{min-width:calc(100vw - 48px)}.detail{padding:18px}}
</style></head>`);
}
async function writeDashboard(report) {
  const data = {
    generatedAt: report.generatedAt,
    counts: report.counts,
    groups: report.groups,
    sessions: report.sessions.map((item) => ({
      id: item.id,
      projectDirectory: item.projectDirectory,
      directory: item.directory,
      topic: item.topic,
      currentTitle: item.currentTitle,
      shortSummary: item.shortSummary,
      status: item.status,
      previewMessages: item.previewMessages,
      time: item.time,
      windowsCommand: `cd /d "${item.directory || item.projectDirectory || "."}" && opencode -s ${item.id}`,
      unixCommand: `cd "${item.directory || item.projectDirectory || "."}" && opencode -s ${item.id}`
    }))
  };
  const htmlPage = String.raw`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenCode Chats</title>
<style>body{font:14px/1.45 system-ui,sans-serif;background:#0b1016;color:#edf4fa;margin:0}.shell{max-width:1500px;margin:auto;padding:28px 24px 48px}.top{display:flex;justify-content:space-between;gap:20px}.eyebrow{color:#69d2a7;font-size:12px;letter-spacing:.12em;font-weight:700}.muted{color:#91a2b3}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.stat,.toolbar,.table,.detail,.project-card{background:#111923;border:1px solid #263646;border-radius:12px}.stat{padding:14px 18px}.stat strong,.stat span{display:block}.stat strong{font-size:24px}.stat span{color:#91a2b3;font-size:12px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:12px;margin-bottom:16px}.toolbar input,.toolbar select,.toolbar button,.actions button{background:#172330;color:#edf4fa;border:1px solid #314457;border-radius:8px;padding:9px}.toolbar input{flex:1 1 300px}.projectbar{display:flex;gap:8px;overflow:auto;margin-bottom:16px}.project-card{min-width:220px;padding:11px;text-align:left;color:#edf4fa;cursor:pointer}.project-card:hover,.project-card.active{border-color:#69d2a7;background:#163129}.project-card strong,.project-card span{display:block}.project-card span{color:#91a2b3;font-size:12px;margin-top:3px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:16px}.table{overflow:auto}table{border-collapse:collapse;width:100%;min-width:900px}th,td{text-align:left;padding:11px;border-bottom:1px solid #263646}th{color:#91a2b3;font-size:11px;text-transform:uppercase}tr[data-id]{cursor:pointer}tr[data-id]:hover,tr.selected{background:#18382f}.detail{padding:18px;min-height:420px}.badge{color:#7ab7ff}.message{padding:8px;border-left:2px solid #69d2a7;background:#0e171f;margin:7px 0}.command{display:block;white-space:pre-wrap;word-break:break-word;background:#0e171f;border:1px solid #263646;border-radius:8px;padding:10px;font:12px ui-monospace,monospace}.actions{display:flex;flex-wrap:wrap;gap:8px}.footer{color:#91a2b3;padding:12px}.danger{color:#f1bd72}ol{padding-left:22px}</style></head><body><main class="shell"><div class="top"><div><div class="eyebrow">PROJECTS → CHATS → OPENCODE</div><h1>OpenCode Chats</h1><p class="muted">Поиск по чатам и проектам. Данные остаются на этом компьютере.</p></div><button id="refresh">Обновить снимок</button></div><section class="stats" id="stats"></section><section class="projectbar" id="projects"></section><section class="toolbar"><input id="search" placeholder="Поиск по чатам, проектам, описанию или ID"><select id="topic"><option value="all">Все темы</option></select><select id="status"><option value="all">Все статусы</option></select><select id="project"><option value="all">Все проекты</option></select><select id="scope"><option value="all">Все чаты</option><option value="favorites">Избранные</option><option value="archived">Архив</option><option value="active">Без архива</option></select><button id="sort">Сначала новые</button></section><section class="layout"><div class="table"><table><thead><tr><th>Чат</th><th>Проект</th><th>Тема</th><th>Статус</th><th>Обновлён</th></tr></thead><tbody id="rows"></tbody></table><div class="footer" id="result"></div></div><aside class="detail" id="detail"><span class="muted">Выберите проект или чат.</span></aside></section><p class="footer">Снимок создан: <span id="generated"></span>. После нового аудита страница обновится автоматически.</p></main><script>
const DATA=${scriptJson(data)};const state={query:"",topic:"all",status:"all",project:"all",scope:"all",sort:"updated",selected:null,favorites:JSON.parse(localStorage.getItem("opencode-session-organizer:favorites")||"[]"),archived:JSON.parse(localStorage.getItem("opencode-session-organizer:archived")||"[]")};const $=id=>document.getElementById(id);const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");const status=x=>x.status&&x.status.type||"unknown";const project=x=>x.projectDirectory||"Без проекта";const marked=(key,id)=>state[key].includes(id);const save=()=>{localStorage.setItem("opencode-session-organizer:favorites",JSON.stringify(state.favorites));localStorage.setItem("opencode-session-organizer:archived",JSON.stringify(state.archived))};const date=v=>v?new Date(Number(v)).toLocaleString("ru-RU"):"нет данных";
function filtered(){const q=state.query.toLowerCase();const list=DATA.sessions.filter(x=>(!q||[x.id,x.currentTitle,x.shortSummary,x.topic,x.projectDirectory,x.directory].join(" ").toLowerCase().includes(q))&&(state.topic==="all"||x.topic===state.topic)&&(state.status==="all"||status(x)===state.status)&&(state.project==="all"||project(x)===state.project)&&(state.scope==="all"||(state.scope==="favorites"&&marked("favorites",x.id))||(state.scope==="archived"&&marked("archived",x.id))||(state.scope==="active"&&!marked("archived",x.id))));return list.sort((a,b)=>state.sort==="title"?String(a.currentTitle||"").localeCompare(String(b.currentTitle||""),"ru"):state.sort==="project"?project(a).localeCompare(project(b),"ru"):(Number(b.time&&b.time.updated)||0)-(Number(a.time&&a.time.updated)||0))}
function renderStats(){const c=DATA.counts;$("stats").innerHTML=[[c.sessions,"чатов"],[c.projects,"проектов"],[c.duplicateLinks,"связей дубликатов"],[state.favorites.length,"избранных"]].map(x=>"<div class=stat><strong>"+esc(x[0])+"</strong><span>"+esc(x[1])+"</span></div>").join("")}
function renderProjects(){const groups=DATA.groups||[];$("projects").innerHTML=groups.map(g=>"<button class=project-card data-project=\""+esc(g.projectDirectory)+"\"><strong>"+esc(g.projectDirectory)+"</strong><span>"+esc(g.total)+" чатов</span></button>").join("");document.querySelectorAll(".project-card").forEach(card=>card.onclick=()=>{state.project=card.dataset.project;$("project").value=state.project;render()})}
function renderRows(){const list=filtered();$("rows").innerHTML=list.length?list.map(x=>"<tr data-id=\""+esc(x.id)+"\"><td><strong>"+(marked("favorites",x.id)?"★ ":"")+esc(x.currentTitle||"Без названия")+"</strong><br><span class=muted>"+esc(x.shortSummary)+"</span></td><td>"+esc(project(x))+"</td><td class=badge>"+esc(x.topic)+"</td><td>"+esc(status(x))+(marked("archived",x.id)?" <span class=danger>архив</span>":"")+"</td><td>"+esc(date(x.time&&x.time.updated))+"</td></tr>").join(""):"<tr><td colspan=5>Чаты не найдены</td></tr>";$("result").textContent="Показано "+list.length+" из "+DATA.sessions.length;document.querySelectorAll("tr[data-id]").forEach(row=>row.onclick=()=>show(row.dataset.id))}
function show(id){const x=DATA.sessions.find(item=>item.id===id);if(!x)return;state.selected=id;const fav=marked("favorites",id),arch=marked("archived",id);$("detail").innerHTML="<h2>"+esc(x.currentTitle||"Без названия")+"</h2><p class=badge>"+esc(project(x))+" · "+esc(x.topic)+" · "+esc(status(x))+"</p><p>"+esc(x.shortSummary)+"</p><h3>Как открыть этот чат в OpenCode</h3><ol><li>Откройте терминал в проекте: <code>"+esc(x.directory||x.projectDirectory||"нет каталога")+"</code>.</li><li>Выполните команду для вашей системы.</li><li>Если OpenCode уже открыт, найдите проект и сравните ID чата.</li></ol><p class=muted>Windows</p><code class=command>"+esc(x.windowsCommand)+"</code><p><button id=copywin>Скопировать Windows-команду</button></p><p class=muted>macOS / Linux</p><code class=command>"+esc(x.unixCommand)+"</code><p><button id=copyunix>Скопировать Unix-команду</button></p><p class=muted>ID чата: "+esc(x.id)+"</p><div class=actions><button id=fav>"+(fav?"Убрать из избранного":"В избранное")+"</button><button id=arc>"+(arch?"Вернуть из архива":"В архив")+"</button></div><h3>Последние сообщения</h3>"+(x.previewMessages||[]).map(m=>"<div class=message><small>"+esc(m.role)+"</small><br>"+esc(m.text)+"</div>").join("");$("copywin").onclick=()=>navigator.clipboard&&navigator.clipboard.writeText(x.windowsCommand);$("copyunix").onclick=()=>navigator.clipboard&&navigator.clipboard.writeText(x.unixCommand);$("fav").onclick=()=>{state.favorites=fav?state.favorites.filter(v=>v!==id):[...state.favorites,id];save();render();show(id)};$("arc").onclick=()=>{state.archived=arch?state.archived.filter(v=>v!==id):[...state.archived,id];save();render();show(id)}}
function render(){renderStats();renderProjects();renderRows()}["search","topic","status","project","scope"].forEach(id=>$(id).oninput=()=>{state[id==="search"?"query":id]=$(id).value;renderRows()});$("sort").onclick=()=>{state.sort=state.sort==="updated"?"title":state.sort==="title"?"project":"updated";$("sort").textContent=state.sort==="updated"?"Сначала новые":state.sort==="title"?"По названию":"По проекту";renderRows()};$("refresh").onclick=()=>location.reload();$("generated").textContent=date(new Date(DATA.generatedAt).getTime());[...new Set(DATA.sessions.map(x=>x.topic))].sort().forEach(v=>$("topic").insertAdjacentHTML("beforeend","<option>"+esc(v)+"</option>"));[...new Set(DATA.sessions.map(status))].sort().forEach(v=>$("status").insertAdjacentHTML("beforeend","<option>"+esc(v)+"</option>"));[...new Set(DATA.sessions.map(project))].sort((a,b)=>a.localeCompare(b,"ru")).forEach(v=>$("project").insertAdjacentHTML("beforeend","<option>"+esc(v)+"</option>"));render();setInterval(()=>fetch("/api/report",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(x=>x&&x.generatedAt!==DATA.generatedAt&&location.reload()).catch(()=>{}),5000);
</script></body></html>`;
  await writeFile3(DASHBOARD_HTML, polishDashboard(htmlPage), "utf8");
}
async function writeReports2(index, settings, errors = []) {
  return writeReports(index, settings, errors, { writeDashboard, now: now3 });
}
async function diagnose(client) {
  await ensureStorage();
  const errors = [];
  const pathInfo = await call("client.path.get", () => client.path.get(), errors);
  const index = await loadIndex();
  return { protocol: "v1", server: { reachable: Boolean(pathInfo) }, indexedSessions: Object.keys(index.sessions).length, dashboardUrl: paths.dashboardUrl, paths, errors };
}
var SessionOrganizer = async ({ client, directory }) => {
  await ensureStorage();
  await startDashboardServer();
  let operation = Promise.resolve();
  const enqueue = (work) => {
    operation = operation.then(work, work);
    return operation;
  };
  void enqueue(() => runAudit(client, directory, { writeReports: writeReports2 })).catch(() => void 0);
  let refreshTimer = null;
  const scheduleRefresh = async () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    const settings = await loadSettings();
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void enqueue(() => runAudit(client, directory, { writeReports: writeReports2 })).catch(() => void 0);
    }, Number(settings.debounceMs) || 1500);
  };
  const tool = createTools({ client, directory, enqueue, writeReports: writeReports2, diagnose });
  const event = async ({ event: incoming }) => {
    const actual = incoming?.payload?.type ? incoming.payload : incoming || {};
    if (["session.created", "session.updated", "session.idle"].includes(actual.type)) void scheduleRefresh();
  };
  return { event, tool };
};
export {
  SessionOrganizer
};
