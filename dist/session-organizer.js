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
var USAGE_LEDGER = join(STORE, "usage-ledger.jsonl");
var USAGE_INDEX = join(STORE, "usage-index.json");
var MODELS_FILE = join(STORE, "models.json");
var DEFAULT_SETTINGS = {
  schemaVersion: 2,
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
  manualOverrides: {},
  dashboard: { language: "ru", currency: "USD", refreshSeconds: 5 },
  usage: { enabled: true, retentionDays: 365, timezone: "Europe/Moscow", pricingOverrides: {} },
  budgets: { daily: null, weekly: null, monthly: null, warningThresholds: [0.7, 0.9, 1], hardStop: false },
  modelSwitching: { enabled: true, allowDefaultConfigWrite: false, requireConfirmation: true },
  security: { requireRequestToken: true }
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
  backups: BACKUPS,
  usageLedger: USAGE_LEDGER,
  usageIndex: USAGE_INDEX,
  models: MODELS_FILE
};
var GENERIC_TITLE = /^(new session|session(?:\s+\d+)?|untitled(?:\s+session)?|opencode session)$/i;

// src/storage.js
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
function json(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}
async function readJson(file, fallback2) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback2;
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
  await appendFile(USAGE_LEDGER, "", { encoding: "utf8", flag: "a" });
}
async function loadSettings() {
  const current = await readJson(SETTINGS_FILE, {});
  const currentUsage = current.usage && typeof current.usage === "object" ? current.usage : {};
  const currentBudgets = current.budgets && typeof current.budgets === "object" ? current.budgets : {};
  const currentDashboard = current.dashboard && typeof current.dashboard === "object" ? current.dashboard : {};
  const currentSwitching = current.modelSwitching && typeof current.modelSwitching === "object" ? current.modelSwitching : {};
  const currentSecurity = current.security && typeof current.security === "object" ? current.security : {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...current,
    schemaVersion: 2,
    dashboard: { ...DEFAULT_SETTINGS.dashboard, ...currentDashboard },
    usage: { ...DEFAULT_SETTINGS.usage, ...currentUsage, pricingOverrides: currentUsage.pricingOverrides && typeof currentUsage.pricingOverrides === "object" ? currentUsage.pricingOverrides : {} },
    budgets: { ...DEFAULT_SETTINGS.budgets, ...currentBudgets, warningThresholds: Array.isArray(currentBudgets.warningThresholds) ? currentBudgets.warningThresholds : DEFAULT_SETTINGS.budgets.warningThresholds },
    modelSwitching: { ...DEFAULT_SETTINGS.modelSwitching, ...currentSwitching },
    security: { ...DEFAULT_SETTINGS.security, ...currentSecurity },
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
import { appendFile as appendFile5, readFile as readFile5 } from "node:fs/promises";
import { createServer } from "node:http";

// src/usage/aggregate.js
function dayInTimezone(value, timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  } catch {
    return String(value || "").slice(0, 10);
  }
}
function inRange(record, from, to) {
  const value = new Date(record.completedAt || record.capturedAt || 0).getTime();
  return (!from || value >= new Date(from).getTime()) && (!to || value <= new Date(to).getTime());
}
function matchesFilters(record, options) {
  return (!options.projectId || record.projectId === options.projectId) && (!options.sessionId || record.sessionId === options.sessionId) && (!options.providerId || record.providerId === options.providerId) && (!options.modelId || record.modelId === options.modelId);
}
function aggregateUsage(records, { from, to, timezone = "Europe/Moscow", groupBy = "day", projectId, sessionId, providerId, modelId } = {}) {
  const groups = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (!inRange(record, from, to) || !matchesFilters(record, { projectId, sessionId, providerId, modelId })) continue;
    const key = groupBy === "project" ? record.projectId || record.projectDirectory || "unknown" : groupBy === "session" ? record.sessionId : groupBy === "provider" ? record.providerId || "unknown" : groupBy === "model" ? `${record.providerId || "unknown"}/${record.modelId || "unknown"}` : dayInTimezone(record.completedAt || record.capturedAt, timezone);
    if (!groups.has(key)) groups.set(key, { key, records: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, unknownCost: 0 });
    const target = groups.get(key);
    target.records += 1;
    for (const field of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total"]) target[field] += Number(record.tokens?.[field]) || 0;
    if (record.cost === null || record.cost === void 0) target.unknownCost += 1;
    else target.cost += Number(record.cost) || 0;
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
function usageCsv(rows) {
  const header = ["key", "records", "input", "output", "reasoning", "cacheRead", "cacheWrite", "total", "cost", "unknownCost"];
  return `${[header, ...rows.map((row) => header.map((field) => row[field]))].map((line) => line.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")}
`;
}

// src/usage/ledger.js
import { appendFile as appendFile2, readFile as readFile2 } from "node:fs/promises";
function sameRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function parseLedger(text) {
  const records = /* @__PURE__ */ new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record?.usageId) records.set(record.usageId, record);
    } catch {
    }
  }
  return records;
}
async function loadUsageRecords() {
  await ensureStorage();
  return parseLedger(await readFile2(USAGE_LEDGER, "utf8"));
}
function totals(records) {
  const result = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, costKnown: 0, costUnknown: 0, generations: 0 };
  for (const record of records) {
    for (const key of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total"]) result[key] += Number(record.tokens?.[key]) || 0;
    result.generations += 1;
    if (record.cost === null || record.cost === void 0) result.costUnknown += 1;
    else {
      result.cost += Number(record.cost) || 0;
      result.costKnown += 1;
    }
  }
  return result;
}
function buildUsageIndex(records, rebuiltAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const values = [...records.values()];
  const byDay = /* @__PURE__ */ new Map();
  const byProject = /* @__PURE__ */ new Map();
  const bySession = /* @__PURE__ */ new Map();
  const byModel = /* @__PURE__ */ new Map();
  for (const record of values) {
    const day = String(record.completedAt || record.capturedAt || "").slice(0, 10) || "unknown";
    const groups = [[byDay, day], [byProject, record.projectId || record.projectDirectory || "unknown"], [bySession, record.sessionId], [byModel, `${record.providerId || "unknown"}/${record.modelId || "unknown"}`]];
    for (const [map, key] of groups) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(record);
    }
  }
  const grouped = (map) => Object.fromEntries([...map.entries()].map(([key, items]) => [key, totals(items)]));
  return {
    schemaVersion: 2,
    lastRebuiltAt: rebuiltAt,
    records: values.length,
    minTimestamp: values.map((item) => item.completedAt || item.capturedAt).filter(Boolean).sort()[0] || null,
    maxTimestamp: values.map((item) => item.completedAt || item.capturedAt).filter(Boolean).sort().at(-1) || null,
    totals: totals(values),
    byDay: grouped(byDay),
    byProject: grouped(byProject),
    bySession: grouped(bySession),
    byModel: grouped(byModel)
  };
}
async function upsertUsage(records) {
  if (!records.length) return { records: 0, added: 0, updated: 0 };
  const current = await loadUsageRecords();
  const changes = [];
  let updated = 0;
  for (const record of records) {
    const previous = current.get(record.usageId);
    if (previous && sameRecord(previous, record)) continue;
    current.set(record.usageId, record);
    changes.push(JSON.stringify(record));
    if (previous) updated += 1;
  }
  if (changes.length) await appendFile2(USAGE_LEDGER, `${changes.join("\n")}
`, "utf8");
  const index = buildUsageIndex(current);
  await writeJson(USAGE_INDEX, index);
  return { records: current.size, added: changes.length - updated, updated };
}
async function loadUsageIndex() {
  const current = await readJson(USAGE_INDEX, null);
  if (current?.schemaVersion === 2) return current;
  return buildUsageIndex(await loadUsageRecords());
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

// src/models/catalog.js
function objectEntries(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
}
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function modelCost(raw = {}) {
  const cost = raw.cost || raw.pricing || {};
  return {
    input: numberOrNull(cost.input ?? cost.inputPerMillion),
    output: numberOrNull(cost.output ?? cost.outputPerMillion),
    cacheRead: numberOrNull(cost.cacheRead ?? cost.cacheReadPerMillion ?? cost.cache_read),
    cacheWrite: numberOrNull(cost.cacheWrite ?? cost.cacheWritePerMillion ?? cost.cache_write)
  };
}
function modelLimits(raw = {}) {
  const limits = raw.limits || raw.limit || {};
  return {
    context: numberOrNull(limits.context ?? raw.contextLength ?? raw.context),
    input: numberOrNull(limits.input),
    output: numberOrNull(limits.output ?? raw.maxOutput)
  };
}
function modelVariants(raw = {}) {
  if (Array.isArray(raw.variants)) return raw.variants.map(String);
  return raw.variants && typeof raw.variants === "object" ? Object.keys(raw.variants) : [];
}
function providerModels(payload) {
  if (Array.isArray(payload?.models)) return payload.models.map((model) => ({ providerId: model.providerID || model.providerId || model.provider || "unknown", modelId: model.id || model.modelID || model.modelId, raw: model }));
  const all = payload?.all || payload?.providers || payload;
  const result = [];
  for (const [providerId, provider] of objectEntries(all)) {
    const models = provider?.models || provider?.model || {};
    for (const [modelId, raw] of objectEntries(models)) result.push({ providerId, modelId, raw: raw || {} });
  }
  return result.filter((item) => item.modelId);
}
function connectedProviders(payload) {
  const connected = payload?.connected || payload?.enabled || [];
  return new Set(Array.isArray(connected) ? connected.map((item) => typeof item === "string" ? item : item?.id || item?.providerID).filter(Boolean) : []);
}
function normalizeCatalog(payload, updatedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const connected = connectedProviders(payload);
  const models = providerModels(payload).map(({ providerId, modelId, raw }) => ({
    providerId,
    modelId,
    displayName: raw.name || raw.displayName || modelId,
    available: raw.available !== false && (connected.size === 0 || connected.has(providerId)),
    local: Boolean(raw.local || providerId === "local"),
    limits: modelLimits(raw),
    cost: modelCost(raw),
    capabilities: {
      tools: Boolean(raw.capabilities?.tools ?? raw.tool_call ?? raw.toolCalling),
      reasoning: Boolean(raw.capabilities?.reasoning ?? raw.reasoning)
    },
    variants: modelVariants(raw)
  }));
  return { schemaVersion: 2, updatedAt, source: models.length ? "sdk" : "none", models };
}
async function loadModelCatalog(client) {
  await ensureStorage();
  if (typeof client?.provider?.list === "function") {
    try {
      const payload = responseData(await client.provider.list());
      const catalog = normalizeCatalog(payload);
      if (catalog.models.length) {
        await writeJson(MODELS_FILE, catalog);
        return { ...catalog, paths };
      }
    } catch {
    }
  }
  const cached = await readJson(MODELS_FILE, null);
  if (cached?.schemaVersion === 2) return { ...cached, source: "cache", paths };
  return { schemaVersion: 2, updatedAt: null, source: "none", models: [], paths };
}

// src/models/switcher.js
import { createHash, randomUUID } from "node:crypto";
import { appendFile as appendFile3 } from "node:fs/promises";
var MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:@+-]+$/;
var confirmations = /* @__PURE__ */ new Map();
function hashPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
function parseModel(model) {
  if (typeof model !== "string" || !MODEL_ID.test(model)) return null;
  const separator = model.indexOf("/");
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1), model };
}
function modelFromSession(session) {
  const value = session?.model || session?.info?.model || session?.currentModel;
  if (typeof value === "string") return value;
  const provider = session?.providerID || session?.providerId || session?.info?.providerID;
  const model = session?.modelID || session?.modelId || session?.info?.modelID;
  return provider && model ? `${provider}/${model}` : null;
}
function fallback(sessionId, model) {
  return {
    mode: "command",
    command: `opencode --session ${sessionId} --model ${model}`,
    instruction: "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0447\u0430\u0442 \u0441 \u044D\u0442\u043E\u0439 \u043C\u043E\u0434\u0435\u043B\u044C\u044E \u0438\u043B\u0438 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043C\u043E\u0434\u0435\u043B\u044C \u0447\u0435\u0440\u0435\u0437 /models. \u0421\u043C\u0435\u043D\u0430 \u0447\u0435\u0440\u0435\u0437 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 SDK \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430."
  };
}
async function readSession(client, sessionId, directory) {
  if (typeof client?.session?.get !== "function") return null;
  return responseData(await client.session.get({ path: { id: sessionId }, query: { directory } }));
}
async function previewSessionModelChange(client, { sessionId, directory, model }) {
  const target = parseModel(model);
  if (!sessionId || !target) return { ok: false, error: { code: "INVALID_MODEL_ID", message: "Model must use provider/model format." } };
  const catalog = await loadModelCatalog(client);
  const known = catalog.models.find((item) => `${item.providerId}/${item.modelId}` === target.model);
  if (catalog.models.length && !known) return { ok: false, error: { code: "MODEL_NOT_FOUND", message: "Model is not present in the current OpenCode catalog." } };
  const session = await readSession(client, sessionId, directory);
  const oldModel = modelFromSession(session);
  const capability = typeof client?.session?.switchModel === "function" ? "SDK" : "command";
  const payload = { sessionId, directory: directory || null, oldModel, newModel: target.model, capability };
  const confirmationId = randomUUID();
  const payloadHash = hashPayload(payload);
  confirmations.set(confirmationId, { payloadHash, payload, expiresAt: Date.now() + 5 * 60 * 1e3 });
  return { ok: true, confirmationId, payloadHash, expiresAt: new Date(Date.now() + 5 * 60 * 1e3).toISOString(), ...payload, mode: capability === "SDK" ? "SDK" : "\u043A\u043E\u043C\u0430\u043D\u0434\u0430", fallback: capability === "SDK" ? null : fallback(sessionId, target.model) };
}
async function applySessionModelChange(client, { confirmationId, payloadHash }) {
  const confirmation = confirmations.get(confirmationId);
  if (!confirmation || confirmation.expiresAt < Date.now()) return { ok: false, error: { code: "CONFIRMATION_EXPIRED", message: "Preview confirmation is missing or expired." } };
  if (confirmation.payloadHash !== payloadHash) return { ok: false, error: { code: "PAYLOAD_MISMATCH", message: "Apply payload does not match the preview." } };
  confirmations.delete(confirmationId);
  const { sessionId, directory, newModel } = confirmation.payload;
  const target = parseModel(newModel);
  if (!target) return { ok: false, error: { code: "INVALID_MODEL_ID", message: "Model must use provider/model format." } };
  if (typeof client?.session?.switchModel !== "function") return { ok: false, applied: false, fallback: fallback(sessionId, newModel), error: { code: "MODEL_SWITCH_UNSUPPORTED", message: "OpenCode SDK does not expose session model switching." } };
  try {
    await client.session.switchModel({ path: { id: sessionId }, query: { directory }, body: { providerID: target.providerID, modelID: target.modelID } });
    const session = await readSession(client, sessionId, directory);
    const actualModel = modelFromSession(session);
    if (actualModel !== newModel) return { ok: false, applied: false, error: { code: "MODEL_SWITCH_UNCONFIRMED", message: "OpenCode did not confirm the requested model after the switch.", actualModel } };
    await appendFile3(ACTIONS_FILE, `${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), action: "model-switch-applied", sessionId, model: newModel })}
`, "utf8");
    return { ok: true, applied: true, mode: "SDK", sessionId, model: actualModel };
  } catch (error) {
    return { ok: false, applied: false, error: { code: "MODEL_SWITCH_FAILED", message: String(error?.message || error) } };
  }
}

// src/models/default.js
import { appendFile as appendFile4, readFile as readFile3 } from "node:fs/promises";
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { homedir as homedir2 } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";
var MODEL_ID2 = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:@+-]+$/;
var confirmations2 = /* @__PURE__ */ new Map();
function hash(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function targetPath(scope, directory) {
  if (scope === "project") return join2(resolve2(directory || process.cwd()), "opencode.json");
  const configDir = process.env.OPENCODE_CONFIG_DIR || join2(homedir2(), ".config", "opencode");
  return join2(configDir, "opencode.json");
}
async function readConfig(file) {
  let text = "{}";
  try {
    text = await readFile3(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (/\/\*|\/\/|,\s*[}\]]/.test(text)) return { unsupported: true, text };
  try {
    return { value: JSON.parse(text), text };
  } catch {
    return { unsupported: true, text };
  }
}
async function previewDefaultModelChange({ model, scope = "global", directory }) {
  if (!MODEL_ID2.test(String(model || ""))) return { ok: false, error: { code: "INVALID_MODEL_ID", message: "Model must use provider/model format." } };
  if (!["global", "project"].includes(scope)) return { ok: false, error: { code: "INVALID_SCOPE", message: "Scope must be global or project." } };
  const file = targetPath(scope, directory);
  const config = await readConfig(file);
  if (config.unsupported) return { ok: false, error: { code: "JSONC_UNSUPPORTED", message: "This configuration contains JSONC syntax; preview only is available until a JSONC-preserving writer is used.", path: file } };
  const value = config.value && typeof config.value === "object" ? config.value : {};
  const oldModel = typeof value.model === "string" ? value.model : null;
  const next = { ...value, model };
  const payload = { file, scope, directory: directory || null, oldModel, newModel: model, beforeHash: hash(config.text), next };
  const confirmationId = randomUUID2();
  const payloadHash = hash(JSON.stringify(payload));
  confirmations2.set(confirmationId, { payloadHash, payload, expiresAt: Date.now() + 5 * 60 * 1e3 });
  const settings = await loadSettings();
  return { ok: true, confirmationId, payloadHash, expiresAt: new Date(Date.now() + 5 * 60 * 1e3).toISOString(), path: file, scope, oldModel, newModel: model, canApply: settings.modelSwitching.allowDefaultConfigWrite === true, diff: { model: { from: oldModel, to: model } } };
}
async function applyDefaultModelChange({ confirmationId, payloadHash }) {
  const confirmation = confirmations2.get(confirmationId);
  if (!confirmation || confirmation.expiresAt < Date.now()) return { ok: false, error: { code: "CONFIRMATION_EXPIRED", message: "Preview confirmation is missing or expired." } };
  if (confirmation.payloadHash !== payloadHash) return { ok: false, error: { code: "PAYLOAD_MISMATCH", message: "Apply payload does not match the preview." } };
  confirmations2.delete(confirmationId);
  const settings = await loadSettings();
  if (settings.modelSwitching.allowDefaultConfigWrite !== true) return { ok: false, applied: false, error: { code: "DEFAULT_MODEL_WRITE_DISABLED", message: "Default model writes are disabled in settings." } };
  const { file, beforeHash, next } = confirmation.payload;
  const current = await readConfig(file);
  if (current.unsupported || hash(current.text) !== beforeHash) return { ok: false, applied: false, error: { code: "CONFIG_CONFLICT", message: "Configuration changed after preview; no write performed." } };
  const backup = join2(BACKUPS, `default-model-${Date.now()}.json`);
  await writeJson(backup, { type: "default-model-backup", path: file, content: current.value, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
  await writeJson(file, next);
  await appendFile4(ACTIONS_FILE, `${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), action: "default-model-updated", path: file, backup, model: next.model })}
`, "utf8");
  return { ok: true, applied: true, path: file, backup, model: next.model };
}

// src/server/security.js
import { randomBytes } from "node:crypto";
var requestToken = randomBytes(32).toString("hex");
function validWriteRequest(request, dashboardUrl) {
  const origin = request.headers.origin;
  const expectedOrigin = dashboardUrl ? new URL(dashboardUrl).origin : null;
  return request.headers["x-session-organizer-token"] === requestToken && (!origin || origin === expectedOrigin) && request.headers["content-type"]?.toLowerCase().startsWith("application/json");
}
function injectSecurityBootstrap(page) {
  return page.replace("</head>", `<meta name="session-organizer-request-token" content="${requestToken}"></head>`);
}
async function readJsonBody(request, maxBytes = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Request body is too large"), { code: "REQUEST_TOO_LARGE" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// src/usage/budgets.js
function parts(date, timezone) {
  const values = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date);
  return Object.fromEntries(values.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}
function dateKey(date, timezone) {
  const value = parts(date, timezone);
  return `${value.year}-${value.month}-${value.day}`;
}
function monthKey(date, timezone) {
  const value = parts(date, timezone);
  return `${value.year}-${value.month}`;
}
function weekKey(date, timezone) {
  const value = parts(date, timezone);
  const current = /* @__PURE__ */ new Date(`${value.year}-${value.month}-${value.day}T00:00:00Z`);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value.weekday);
  current.setUTCDate(current.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return current.toISOString().slice(0, 10);
}
function matches(record, period, now4, timezone) {
  const date = new Date(record.completedAt || record.capturedAt || 0);
  if (period === "daily") return dateKey(date, timezone) === dateKey(now4, timezone);
  if (period === "weekly") return weekKey(date, timezone) === weekKey(now4, timezone);
  return monthKey(date, timezone) === monthKey(now4, timezone);
}
function budgetStatus(records, budgets = {}, timezone = "Europe/Moscow", now4 = /* @__PURE__ */ new Date()) {
  return ["daily", "weekly", "monthly"].map((period) => {
    const limit = typeof budgets[period] === "number" && Number.isFinite(budgets[period]) && budgets[period] >= 0 ? budgets[period] : null;
    const selected = records.filter((record) => matches(record, period, now4, timezone));
    const amount = selected.reduce((sum, record) => sum + (typeof record.cost === "number" ? record.cost : 0), 0);
    const unknownCost = selected.filter((record) => record.cost === null || record.cost === void 0).length;
    const ratio = limit && limit > 0 ? amount / limit : null;
    const thresholds = Array.isArray(budgets.warningThresholds) ? budgets.warningThresholds.filter((value) => typeof value === "number").sort((a, b) => a - b) : [0.7, 0.9, 1];
    return { period, limit, amount, remaining: limit === null ? null : Math.max(0, limit - amount), ratio, unknownCost, warningAt: ratio === null ? null : thresholds.filter((threshold) => ratio >= threshold).at(-1) || null, hardStop: Boolean(budgets.hardStop) };
  });
}

// src/journal.js
import { readFile as readFile4 } from "node:fs/promises";
async function readJournal({ skip = 0, limit = 100 } = {}) {
  let text = "";
  try {
    text = await readFile4(ACTIONS_FILE, "utf8");
  } catch {
    return { items: [], total: 0 };
  }
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      items.push({
        at: item.at || null,
        action: sanitize(item.action, 80),
        id: sanitize(item.id, 160),
        sessionId: sanitize(item.sessionId, 160),
        model: sanitize(item.model, 160),
        result: sanitize(item.result, 80),
        errors: Number(item.errors) || 0,
        counts: item.counts || null
      });
    } catch {
      items.push({ at: null, action: "invalid-entry", errors: 1 });
    }
  }
  items.reverse();
  return { items: items.slice(Number(skip) || 0, (Number(skip) || 0) + Math.min(Number(limit) || 100, 500)), total: items.length };
}

// src/server.js
var dashboardServer = null;
function validateSettingsPatch(patch) {
  if (patch.security?.requireRequestToken === false) throw Object.assign(new Error("Request token protection cannot be disabled"), { code: "INVALID_SETTINGS" });
  for (const key of ["daily", "weekly", "monthly"]) {
    const value = patch.budgets?.[key];
    if (value !== void 0 && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw Object.assign(new Error(`Invalid ${key} budget`), { code: "INVALID_SETTINGS" });
  }
  if (patch.budgets?.warningThresholds !== void 0 && (!Array.isArray(patch.budgets.warningThresholds) || patch.budgets.warningThresholds.some((value) => typeof value !== "number" || value < 0 || value > 1))) throw Object.assign(new Error("Invalid warning thresholds"), { code: "INVALID_SETTINGS" });
  if (patch.usage?.retentionDays !== void 0 && (!Number.isInteger(patch.usage.retentionDays) || patch.usage.retentionDays < 1)) throw Object.assign(new Error("Invalid retentionDays"), { code: "INVALID_SETTINGS" });
}
async function startDashboardServer(client) {
  if (dashboardServer) return;
  const server = createServer(async (request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      response.end(body);
    };
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/report") {
      try {
        send(200, "application/json; charset=utf-8", await readFile5(AUDIT_JSON, "utf8"));
      } catch {
        send(404, "application/json; charset=utf-8", JSON.stringify({ error: "Audit has not been generated yet" }));
      }
      return;
    }
    if (url.pathname === "/api/health") {
      send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: { protocol: "v1", server: true, dashboardUrl: paths.dashboardUrl }, error: null, meta: { generatedAt: (/* @__PURE__ */ new Date()).toISOString(), schemaVersion: 2 } }));
      return;
    }
    if (url.pathname === "/api/settings" && request.method === "GET") {
      send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: await loadSettings(), error: null, meta: { generatedAt: (/* @__PURE__ */ new Date()).toISOString(), schemaVersion: 2 } }));
      return;
    }
    if (url.pathname === "/api/settings" && request.method === "PATCH") {
      if (!validWriteRequest(request, paths.dashboardUrl)) {
        send(403, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: "WRITE_NOT_AUTHORIZED", message: "A local request token, JSON content type, and same-origin request are required." } }));
        return;
      }
      try {
        const patch = await readJsonBody(request);
        const allowed = ["dashboard", "usage", "budgets", "modelSwitching", "security"];
        if (!patch || Object.keys(patch).some((key) => !allowed.includes(key))) throw Object.assign(new Error("Only supported settings sections may be changed"), { code: "INVALID_SETTINGS" });
        validateSettingsPatch(patch);
        const current = await loadSettings();
        const next = { ...current };
        for (const key of allowed) if (patch[key] !== void 0) next[key] = { ...current[key], ...patch[key] };
        await writeJson(SETTINGS_FILE, next);
        await appendFile5(ACTIONS_FILE, `${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), action: "settings-updated", sections: Object.keys(patch) })}
`, "utf8");
        send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: next, error: null, meta: { generatedAt: (/* @__PURE__ */ new Date()).toISOString(), schemaVersion: 2 } }));
      } catch (error) {
        send(error.code === "REQUEST_TOO_LARGE" ? 413 : 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: error.code || "INVALID_SETTINGS", message: String(error?.message || error) } }));
      }
      return;
    }
    if (url.pathname === "/api/journal") {
      send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: await readJournal({ skip: url.searchParams.get("skip"), limit: url.searchParams.get("limit") }), error: null, meta: { generatedAt: (/* @__PURE__ */ new Date()).toISOString(), schemaVersion: 2 } }));
      return;
    }
    if (url.pathname === "/api/dashboard") {
      const [index, settings, usageRecords] = await Promise.all([loadIndex(), loadSettings(), loadUsageRecords()]);
      const records = [...usageRecords.values()];
      send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: { activeChats: Object.values(index.sessions).filter((item) => item.status?.type !== "idle").length, sessions: Object.keys(index.sessions).length, budgets: budgetStatus(records, settings.budgets, settings.usage.timezone), usage: (await loadUsageIndex()).totals }, error: null, meta: { generatedAt: (/* @__PURE__ */ new Date()).toISOString(), schemaVersion: 2 } }));
      return;
    }
    if (url.pathname === "/api/models") {
      try {
        const catalog = await loadModelCatalog(client);
        send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: catalog, error: null, meta: { generatedAt: (/* @__PURE__ */ new Date()).toISOString(), schemaVersion: 2 } }));
      } catch (error) {
        send(500, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: "MODEL_CATALOG_FAILED", message: String(error?.message || error) }, meta: { schemaVersion: 2 } }));
      }
      return;
    }
    if (url.pathname === "/api/actions/session-model/preview" || url.pathname === "/api/actions/session-model/apply" || url.pathname === "/api/actions/default-model/preview" || url.pathname === "/api/actions/default-model/apply") {
      if (request.method !== "POST" || !validWriteRequest(request, paths.dashboardUrl)) {
        send(403, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: "WRITE_NOT_AUTHORIZED", message: "A local request token, JSON content type, and same-origin request are required." } }));
        return;
      }
      try {
        const body = await readJsonBody(request);
        const defaultModel = url.pathname.includes("default-model");
        const result = url.pathname.endsWith("/preview") ? defaultModel ? await previewDefaultModelChange(body) : await previewSessionModelChange(client, body) : defaultModel ? await applyDefaultModelChange(body) : await applySessionModelChange(client, body);
        send(result.ok ? 200 : 400, "application/json; charset=utf-8", JSON.stringify({ ...result, meta: { generatedAt: (/* @__PURE__ */ new Date()).toISOString(), schemaVersion: 2 } }));
      } catch (error) {
        send(error.code === "REQUEST_TOO_LARGE" ? 413 : 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: error.code || "INVALID_REQUEST", message: String(error?.message || error) } }));
      }
      return;
    }
    if (url.pathname === "/api/usage" || url.pathname === "/api/usage/export.csv") {
      try {
        const groupBy = ["day", "project", "session", "provider", "model"].includes(url.searchParams.get("groupBy")) ? url.searchParams.get("groupBy") : "day";
        const rows = aggregateUsage([...await loadUsageRecords().then((records) => records.values())], {
          from: url.searchParams.get("from") || void 0,
          to: url.searchParams.get("to") || void 0,
          timezone: url.searchParams.get("timezone") || "Europe/Moscow",
          groupBy,
          projectId: url.searchParams.get("projectId") || void 0,
          sessionId: url.searchParams.get("sessionId") || void 0,
          providerId: url.searchParams.get("providerId") || void 0,
          modelId: url.searchParams.get("modelId") || void 0
        });
        if (url.pathname.endsWith(".csv")) {
          send(200, "text/csv; charset=utf-8", usageCsv(rows));
          return;
        }
        send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, data: { rows, index: await loadUsageIndex() }, error: null, meta: { generatedAt: (/* @__PURE__ */ new Date()).toISOString(), schemaVersion: 2 } }));
      } catch (error) {
        send(500, "application/json; charset=utf-8", JSON.stringify({ ok: false, data: null, error: { code: "USAGE_READ_FAILED", message: String(error?.message || error) }, meta: { schemaVersion: 2 } }));
      }
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      try {
        send(200, "text/html; charset=utf-8", injectSecurityBootstrap(await readFile5(DASHBOARD_HTML, "utf8")));
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

// src/core/pipeline.js
import { appendFile as appendFile6 } from "node:fs/promises";
import { resolve as resolve4 } from "node:path";

// src/classification.js
import { relative, resolve as resolve3 } from "node:path";
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
  const target = resolve3(directory || process.cwd());
  const matches2 = projects.filter((project) => project && project.worktree).map((project) => ({ project, worktree: resolve3(project.worktree) })).filter(({ worktree }) => {
    const value = relative(worktree, target);
    return value === "" || !value.startsWith("..") && !value.includes(":");
  }).sort((a, b) => b.worktree.length - a.worktree.length);
  if (!matches2.length) return { id: null, directory: target, match: "unmatched" };
  const selected = matches2[0];
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

// src/usage/extract.js
function numberOrNull2(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function tokenValue(tokens, ...keys) {
  for (const key of keys) {
    const value = numberOrNull2(tokens?.[key]);
    if (value !== null) return value;
  }
  return 0;
}
function normalizeTokens(tokens = {}) {
  const cache = tokens.cache || {};
  const result = {
    input: tokenValue(tokens, "input", "prompt"),
    output: tokenValue(tokens, "output", "completion"),
    reasoning: tokenValue(tokens, "reasoning", "reasoningTokens"),
    cacheRead: tokenValue(tokens, "cacheRead", "cache_read", "cachedInput") || tokenValue(cache, "read"),
    cacheWrite: tokenValue(tokens, "cacheWrite", "cache_write") || tokenValue(cache, "write")
  };
  result.total = tokenValue(tokens, "total") || Object.values(result).reduce((sum, value) => sum + value, 0);
  return result;
}
function hasUsage(value) {
  return Boolean(value && typeof value === "object" && (value.tokens || value.usage || value.cost !== void 0));
}
function usageSource(value) {
  return value?.usage && typeof value.usage === "object" ? value.usage : value || {};
}
function mergeParts(parts2) {
  const candidates = (Array.isArray(parts2) ? parts2 : []).filter((part) => part?.type === "step-finish" && hasUsage(part));
  if (!candidates.length) return null;
  const merged = { tokens: {}, cost: null, providerID: null, modelID: null, variant: null };
  for (const part of candidates) {
    const source = usageSource(part);
    const tokens = normalizeTokens(source.tokens || source);
    for (const key of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total"]) merged.tokens[key] = (merged.tokens[key] || 0) + tokens[key];
    if (numberOrNull2(source.cost) !== null) merged.cost = (merged.cost || 0) + source.cost;
    merged.providerID ||= source.providerID || source.providerId || null;
    merged.modelID ||= source.modelID || source.modelId || null;
    merged.variant ||= source.variant || null;
  }
  return merged;
}
function extractUsage(message, session, capturedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const info = message?.info || message;
  if (!info || info.role !== "assistant") return null;
  const messageId = info.id || message?.id;
  if (!messageId) return null;
  const direct = hasUsage(info) ? usageSource(info) : null;
  const fallback2 = direct ? null : mergeParts(message?.parts);
  const source = direct || fallback2;
  if (!source) return null;
  const tokens = normalizeTokens(source.tokens || source);
  const reportedCost = numberOrNull2(source.cost);
  const cost = reportedCost !== null && reportedCost > 0 ? reportedCost : null;
  return {
    schemaVersion: 2,
    usageId: `${session.id}:${messageId}`,
    capturedAt,
    completedAt: info.time?.completed || info.completedAt || null,
    projectId: session.projectId || null,
    projectDirectory: session.projectDirectory || session.directory || null,
    sessionId: session.id,
    messageId,
    providerId: source.providerID || source.providerId || info.providerID || info.providerId || null,
    modelId: source.modelID || source.modelId || info.modelID || info.modelId || null,
    variant: source.variant || info.variant || null,
    tokens,
    cost,
    currency: "USD",
    costSource: cost === null ? "unknown" : "reported_by_opencode",
    status: "complete"
  };
}
function extractMessageUsage(messages, session, capturedAt) {
  return (Array.isArray(messages) ? messages : []).map((message) => extractUsage(message, session, capturedAt)).filter(Boolean);
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
  const directories = [...new Set([currentDirectory, ...projects.map((item) => item?.worktree)].filter(Boolean).map((item) => resolve4(item)))];
  const roots = [];
  for (const directory of directories) {
    const sessions2 = await call(`client.session.list:${directory}`, () => client.session.list({ query: { directory } }), errors);
    if (Array.isArray(sessions2)) roots.push(...sessions2);
  }
  const sessions = await collectTree(client, roots, errors);
  const statuses = {};
  const usageRecords = [];
  for (const directory of [...new Set(sessions.map((item) => item.directory).filter(Boolean).map((item) => resolve4(item)))]) {
    const result = await call(`client.session.status:${directory}`, () => client.session.status({ query: { directory } }), errors);
    if (result && typeof result === "object") Object.assign(statuses, result);
  }
  const records = {};
  for (const session of sessions) {
    const messages = await call(`client.session.messages:${session.id}`, () => client.session.messages({ path: { id: session.id }, query: { directory: session.directory, limit: settings.messagesLimit } }), errors);
    const safeMessages = Array.isArray(messages) ? messages : [];
    records[session.id] = await buildRecord(session, safeMessages, statuses, projects, previous.sessions, settings);
    usageRecords.push(...extractMessageUsage(safeMessages, { ...session, projectId: records[session.id].projectId, projectDirectory: records[session.id].projectDirectory }, now()));
  }
  updateDuplicates(records);
  const index = { schemaVersion: 1, protocol: "v1", updatedAt: now(), projects: projects.filter((item) => item?.worktree).map((item) => ({ id: item.id || null, worktree: resolve4(item.worktree), vcs: item.vcs || null })), sessions: records };
  await writeJson(INDEX_FILE, index);
  const report = await writeReports3(index, settings, errors);
  await appendFile6(ACTIONS_FILE, `${JSON.stringify({ at: now(), action: "audit", mode: "full-dry-run", counts: report.counts, errors: errors.length })}
`, "utf8");
  return { ...report.counts, usage: await upsertUsage(usageRecords), errors, paths };
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
import { appendFile as appendFile7 } from "node:fs/promises";
import { join as join3, relative as relative2, resolve as resolve5 } from "node:path";
function now2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function saveOverride(args) {
  await ensureStorage();
  if (args.confirm !== true) return { applied: false, reason: "Explicit confirm=true is required; no settings changed." };
  if (!args.sessionId) return { applied: false, reason: "sessionId is required; no settings changed." };
  const settings = await loadSettings();
  const backup = join3(BACKUPS, `override-${Date.now()}.json`);
  await writeJson(backup, { type: "settings-backup", settings, createdAt: now2() });
  settings.manualOverrides[args.sessionId] = { ...settings.manualOverrides[args.sessionId] || {}, ...args.title ? { title: sanitize(args.title, 96) } : {}, ...args.topic ? { topic: sanitize(args.topic, 40) } : {}, ...args.archiveSuggestion ? { archiveSuggestion: sanitize(args.archiveSuggestion, 80) } : {} };
  await writeJson(SETTINGS_FILE, settings);
  return { applied: true, sessionId: args.sessionId, backup, paths };
}
function isInside(directory, file) {
  const base = resolve5(directory);
  const candidate = resolve5(file);
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
    const backup = join3(BACKUPS, `${Date.now()}-${record.id}.json`);
    await writeJson(backup, { type: "session-organizer-backup", before: record, proposedTitle: record.proposedTitle, createdAt: now2() });
    try {
      const updated = responseData(await client.session.update({ path: { id: record.id }, query: { directory: record.directory || currentDirectory }, body: { title: record.proposedTitle } }));
      record.currentTitle = sanitize(updated?.title || record.proposedTitle, 160);
      record.manualTitlePreservation = false;
      results.push({ id: record.id, result: "renamed", title: record.currentTitle, backup });
      await appendFile7(ACTIONS_FILE, `${JSON.stringify({ at: now2(), action: "rename", id: record.id, backup })}
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
    const resolved = resolve5(file);
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
      await appendFile7(ACTIONS_FILE, `${JSON.stringify({ at: now2(), action: "undo-rename", id: before.id, backup: file })}
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

// src/ui/control-center.js
function enhanceDashboard(page) {
  const panels = `<section class="control-center" aria-label="\u0426\u0435\u043D\u0442\u0440 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F"><div class="cc-header"><div><div class="eyebrow">CONTROL CENTER</div><h2>\u0420\u0430\u0441\u0445\u043E\u0434\u044B, \u043C\u043E\u0434\u0435\u043B\u0438 \u0438 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435</h2></div><button id="cc-refresh" type="button">\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435</button></div><div class="cc-grid"><article class="cc-card"><span>\u0420\u0430\u0441\u0445\u043E\u0434 \u0441\u0435\u0433\u043E\u0434\u043D\u044F</span><strong id="cc-cost">\u041D/\u0414</strong><small id="cc-cost-meta">\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...</small></article><article class="cc-card"><span>\u0422\u043E\u043A\u0435\u043D\u044B \u0441\u0435\u0433\u043E\u0434\u043D\u044F</span><strong id="cc-tokens">\u041D/\u0414</strong><small id="cc-token-meta">\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 ledger</small></article><article class="cc-card"><span>\u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u0431\u044E\u0434\u0436\u0435\u0442</span><strong id="cc-budget">\u041D\u0435 \u0437\u0430\u0434\u0430\u043D</strong><small id="cc-budget-meta">\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u0440\u043E\u0433</small></article><article class="cc-card"><span>\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C</span><strong id="cc-unknown">\u041D/\u0414</strong><small>\u041D\u0435 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E\u0439</small></article></div><div class="cc-columns"><section class="cc-panel"><h3>\u041C\u043E\u0434\u0435\u043B\u0438</h3><div id="cc-models" class="cc-list">\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...</div><div class="cc-default"><h3>\u041C\u043E\u0434\u0435\u043B\u044C \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E</h3><select id="cc-default-model"></select><select id="cc-default-scope"><option value="global">\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u043E</option><option value="project">\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0440\u043E\u0435\u043A\u0442</option></select><button id="cc-default-apply" type="button">\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C preview</button><div class="cc-status" id="cc-default-status">\u0417\u0430\u043F\u0438\u0441\u044C \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u044F.</div></div></section><section class="cc-panel"><h3>\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F</h3><div id="cc-journal" class="cc-list">\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...</div></section></div></section>`;
  const styles = `<style>.control-center{margin:0 0 18px;padding:18px;border:1px solid #263646;border-radius:16px;background:linear-gradient(145deg,#111d29,#0d151e)}.cc-header{display:flex;justify-content:space-between;align-items:center;gap:12px}.cc-header h2{margin:5px 0 0;font-size:20px;letter-spacing:-.04em}.cc-header button,.cc-panel button{background:#172f3b;color:#edf4fa;border:1px solid #31566a;border-radius:8px;padding:8px 11px;cursor:pointer}.cc-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:15px}.cc-card,.cc-panel{border:1px solid #263646;border-radius:11px;background:#0d1822;padding:12px}.cc-card span,.cc-card small{display:block;color:#91a2b3;font-size:11px}.cc-card strong{display:block;margin:5px 0;font-size:22px;color:#edf4fa}.cc-columns{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:9px}.cc-panel h3{margin:0 0 9px;color:#69d2a7;font-size:11px;letter-spacing:.12em;text-transform:uppercase}.cc-list{display:grid;gap:6px;color:#b9c8d0;font-size:12px}.cc-item{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #1e2d3a}.cc-item:last-child{border-bottom:0}.cc-item strong{color:#edf4fa}.cc-switch{margin-top:16px;padding-top:14px;border-top:1px solid #263646}.cc-switch select{max-width:100%;background:#172330;color:#edf4fa;border:1px solid #314457;border-radius:8px;padding:8px}.cc-switch .cc-status{margin:8px 0;color:#91a2b3;font-size:12px}@media(max-width:720px){.cc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-columns{grid-template-columns:1fr}.cc-header{align-items:flex-start;flex-direction:column}.cc-header button{width:100%}}</style>`;
  const script = `<script>(function(){const token=document.querySelector('meta[name="session-organizer-request-token"]')?.content||"";const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");let ccModels=[],ccReport=null,currentSession=null;const get=async url=>{const response=await fetch(url,{cache:"no-store"});return response.ok?response.json():null};const write=async(url,body)=>{const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-session-organizer-token":token},body:JSON.stringify(body)});return response.json()};function set(id,value){const node=document.getElementById(id);if(node)node.textContent=value}function renderModels(){const node=document.getElementById("cc-models");if(!node)return;node.innerHTML=ccModels.length?ccModels.slice(0,8).map(model=>"<div class=cc-item><span>"+esc(model.providerId+"/"+model.modelId)+"</span><strong>"+esc(model.limits.context?Math.round(model.limits.context/1000)+"k":"\u043D\u0435\u0442 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0430")+"</strong></div>").join(""):"<span>\u041A\u0430\u0442\u0430\u043B\u043E\u0433 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D</span>";const defaults=document.getElementById("cc-default-model");if(defaults)defaults.innerHTML=ccModels.map(model=>"<option value=""+esc(model.providerId+"/"+model.modelId)+"">"+esc(model.displayName||model.modelId)+"</option>").join("")}function renderSwitch(){const detail=document.getElementById("detail");if(!detail||!currentSession||detail.querySelector(".cc-switch"))return;const select=ccModels.map(model=>"<option value=""+esc(model.providerId+"/"+model.modelId)+"">"+esc(model.displayName||model.modelId)+" ("+esc(model.providerId)+")</option>").join("");const panel=document.createElement("div");panel.className="cc-switch";panel.innerHTML="<h3>\u041C\u043E\u0434\u0435\u043B\u044C \u0447\u0430\u0442\u0430</h3><select id="cc-session-model">"+select+"</select> <button id="cc-apply-model" type="button">\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C</button><div class=cc-status id="cc-switch-status">\u0421\u043C\u0435\u043D\u0430 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F.</div>";detail.append(panel);document.getElementById("cc-apply-model")?.addEventListener("click",async()=>{const model=document.getElementById("cc-session-model")?.value;const item=(ccReport?.sessions||[]).find(session=>session.id===currentSession);const status=document.getElementById("cc-switch-status");if(!item||!model){if(status)status.textContent="\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0447\u0430\u0442\u0430 \u0438\u043B\u0438 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0430.";return}const preview=await write("/api/actions/session-model/preview",{sessionId:currentSession,directory:item.directory,model});if(!preview.ok){if(status)status.textContent=preview.error?.message||"Preview \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D.";return}if(!window.confirm((preview.oldModel||"\u0442\u0435\u043A\u0443\u0449\u0430\u044F \u043C\u043E\u0434\u0435\u043B\u044C")+" \u2192 "+preview.newModel+". \u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C?")){if(status)status.textContent="\u041E\u0442\u043C\u0435\u043D\u0435\u043D\u043E \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u043C.";return}const result=await write("/api/actions/session-model/apply",{confirmationId:preview.confirmationId,payloadHash:preview.payloadHash});if(status)status.textContent=result.ok?"\u041C\u043E\u0434\u0435\u043B\u044C \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430 \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0447\u0438\u0442\u044B\u0432\u0430\u043D\u0438\u044F \u0441\u0435\u0441\u0441\u0438\u0438.":(result.fallback?.command||result.error?.message||"\u0421\u043C\u0435\u043D\u0430 \u043D\u0435 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0430.")})}async function loadCC(){const [dashboard,models,journal,report]=await Promise.all([get("/api/dashboard"),get("/api/models"),get("/api/journal?limit=6"),get("/api/report")]);ccModels=models?.data?.models||[];ccReport=report;const usage=dashboard?.data?.usage||{};set("cc-cost",typeof usage.cost==="number"?"$"+usage.cost.toFixed(4):"\u041D/\u0414");set("cc-tokens",typeof usage.total==="number"?usage.total.toLocaleString("ru-RU"):"\u041D/\u0414");const daily=(dashboard?.data?.budgets||[]).find(item=>item.period==="daily");set("cc-budget",daily?.limit===null||daily?.limit===undefined?"\u041D\u0435 \u0437\u0430\u0434\u0430\u043D":"$"+daily.amount.toFixed(4)+" / $"+daily.limit.toFixed(2));set("cc-budget-meta",daily?.ratio===null?"\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u0440\u043E\u0433 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D":Math.round(daily.ratio*100)+"% \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u043E");set("cc-unknown",usage.costUnknown??"\u041D/\u0414");const journalNode=document.getElementById("cc-journal");if(journalNode)journalNode.innerHTML=journal?.data?.items?.length?journal.data.items.map(item=>"<div class=cc-item><span>"+esc(item.action||"event")+"</span><strong>"+esc(item.at?new Date(item.at).toLocaleTimeString("ru-RU"):"-")+"</strong></div>").join(""):"<span>\u0421\u043E\u0431\u044B\u0442\u0438\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442</span>";renderModels();renderSwitch()}document.getElementById("cc-refresh")?.addEventListener("click",loadCC);document.addEventListener("click",event=>{const row=event.target.closest("tr[data-id]");if(row){currentSession=row.dataset.id;setTimeout(renderSwitch,0)}if(event.target.id==="cc-default-apply"){(async()=>{const status=document.getElementById("cc-default-status"),model=document.getElementById("cc-default-model")?.value,scope=document.getElementById("cc-default-scope")?.value;const preview=await write("/api/actions/default-model/preview",{model,scope});if(!preview.ok){if(status)status.textContent=preview.error?.message||"Preview \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D.";return}if(!preview.canApply){if(status)status.textContent="Preview \u0433\u043E\u0442\u043E\u0432: \u0437\u0430\u043F\u0438\u0441\u044C \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u0430 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u043E\u0439 allowDefaultConfigWrite.";return}if(window.confirm((preview.oldModel||"\u043D\u0435\u0442 \u043C\u043E\u0434\u0435\u043B\u0438")+" \u2192 "+preview.newModel+". \u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C?")){const result=await write("/api/actions/default-model/apply",{confirmationId:preview.confirmationId,payloadHash:preview.payloadHash});if(status)status.textContent=result.ok?"\u041C\u043E\u0434\u0435\u043B\u044C \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430.":result.error?.message||"\u0417\u0430\u043F\u0438\u0441\u044C \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430."}})()}});new MutationObserver(renderSwitch).observe(document.getElementById("detail")||document.body,{childList:true});loadCC().catch(()=>{});setInterval(loadCC,5000)})()</script>`;
  return page.replace("</head>", `${styles}</head>`).replace('<section class="toolbar"', `${panels}<section class="toolbar"`).replace("</body>", `${script}</body>`);
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
  await writeFile3(DASHBOARD_HTML, enhanceDashboard(polishDashboard(htmlPage)), "utf8");
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
  await startDashboardServer(client);
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
