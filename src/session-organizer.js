import { writeFile } from "node:fs/promises"
import { DASHBOARD_HTML, paths } from "./config.js"
import { ensureStorage, loadIndex, loadSettings } from "./storage.js"
import { safeError, sanitize } from "./text.js"
import { startDashboardServer } from "./server.js"
import { call } from "./compat/opencode-v1.js"
import { runAudit } from "./core/pipeline.js"
import { writeReports as writeReportFiles } from "./reports.js"
import { createTools } from "./tools.js"

function now() {
  return new Date().toISOString()
}

function html(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
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
</style></head>`)
}

async function writeDashboardLegacy(report) {
  const data = { generatedAt: report.generatedAt, counts: report.counts, sessions: report.sessions }
  const htmlPage = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenCode Chats</title>
<style>body{font:14px/1.45 system-ui,sans-serif;background:#0b1016;color:#edf4fa;margin:0}.shell{max-width:1500px;margin:auto;padding:28px 24px 48px}.top{display:flex;justify-content:space-between;gap:20px}.muted{color:#91a2b3}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.stat,.toolbar,.table,.detail{background:#111923;border:1px solid #263646;border-radius:12px}.stat{padding:14px 18px}.stat strong,.stat span{display:block}.stat strong{font-size:24px}.stat span{color:#91a2b3;font-size:12px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:12px;margin-bottom:16px}.toolbar input,.toolbar select,.toolbar button{background:#172330;color:#edf4fa;border:1px solid #314457;border-radius:8px;padding:9px}.toolbar input{flex:1 1 280px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px}.table{overflow:auto}table{border-collapse:collapse;width:100%;min-width:820px}th,td{text-align:left;padding:11px;border-bottom:1px solid #263646}th{color:#91a2b3;font-size:11px;text-transform:uppercase}tr[data-id]{cursor:pointer}tr[data-id]:hover,tr.selected{background:#18382f}.detail{padding:18px;min-height:320px}.badge{color:#7ab7ff}.message{padding:8px;border-left:2px solid #69d2a7;background:#0e171f;margin:7px 0}.footer{color:#91a2b3;padding:12px}.danger{color:#f1bd72}</style></head><body><main class="shell"><div class="top"><div><div class="muted">LOCAL READ-ONLY INDEX</div><h1>OpenCode Chats</h1><p class="muted">Local session navigation. No data is sent outside this machine.</p></div><button id="refresh">Refresh snapshot</button></div><section class="stats" id="stats"></section><section class="toolbar"><input id="search" placeholder="Search title, summary, project or ID"><select id="topic"><option value="all">All topics</option></select><select id="status"><option value="all">All statuses</option></select><select id="scope"><option value="all">All sessions</option><option value="favorites">Favorites</option><option value="archived">Archived</option><option value="active">Not archived</option></select><button id="sort">Sort: newest</button></section><section class="layout"><div class="table"><table><thead><tr><th>Session</th><th>Topic</th><th>Status</th><th>Project</th><th>Updated</th></tr></thead><tbody id="rows"></tbody></table><div class="footer" id="result"></div></div><aside class="detail" id="detail"><span class="muted">Select a session to see details.</span></aside></section><p class="footer">Snapshot: <span id="generated"></span>. Run <code>session_organizer_audit</code> to refresh.</p></main><script>
const DATA=${scriptJson(data)};
const state={query:"",topic:"all",status:"all",scope:"all",sort:"updated",selected:null,favorites:JSON.parse(localStorage.getItem("osc:favorites")||"[]"),archived:JSON.parse(localStorage.getItem("osc:archived")||"[]")};
const $=id=>document.getElementById(id); const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;"); const mark=(key,id)=>state[key].includes(id); const status=x=>x.status&&x.status.type||"unknown"; const project=x=>x.projectDirectory||"Unmatched project";
function save(){localStorage.setItem("osc:favorites",JSON.stringify(state.favorites));localStorage.setItem("osc:archived",JSON.stringify(state.archived))} function date(v){return v?new Date(Number(v)).toLocaleString():"No data"};
function filtered(){const q=state.query.toLowerCase();return DATA.sessions.filter(x=>(!q||[x.id,x.currentTitle,x.shortSummary,x.topic,x.projectDirectory,x.directory].join(" ").toLowerCase().includes(q))&&(state.topic==="all"||x.topic===state.topic)&&(state.status==="all"||status(x)===state.status)&&(state.scope==="all"||(state.scope==="favorites"&&mark("favorites",x.id))||(state.scope==="archived"&&mark("archived",x.id))||(state.scope==="active"&&!mark("archived",x.id)))).sort((a,b)=>state.sort==="title"?String(a.currentTitle||"").localeCompare(String(b.currentTitle||"")):state.sort==="topic"?String(a.topic||"").localeCompare(String(b.topic||"")):(Number(b.time?.updated)||0)-(Number(a.time?.updated)||0))}
function render(){const list=filtered();$("stats").innerHTML=[[DATA.counts.sessions,"sessions"],[DATA.counts.projects,"projects"],[DATA.counts.duplicateLinks,"duplicate links"],[state.favorites.length,"favorites"]].map(x=>"<div class=stat><strong>"+esc(x[0])+"</strong><span>"+esc(x[1])+"</span></div>").join("");$("rows").innerHTML=list.length?list.map(x=>"<tr data-id=\""+esc(x.id)+"\"><td><strong>"+(mark("favorites",x.id)?"★ ":"")+esc(x.currentTitle||"Untitled")+"</strong><br><span class=muted>"+esc(x.shortSummary)+"</span></td><td class=badge>"+esc(x.topic)+"</td><td>"+esc(status(x))+(mark("archived",x.id)?" <span class=danger>archived</span>":"")+"</td><td>"+esc(project(x))+"</td><td>"+esc(date(x.time?.updated))+"</td></tr>").join(""):"<tr><td colspan=5>No sessions found</td></tr>";$("result").textContent="Showing "+list.length+" of "+DATA.sessions.length;document.querySelectorAll("tr[data-id]").forEach(row=>row.onclick=()=>show(row.dataset.id))}
function show(id){const x=DATA.sessions.find(item=>item.id===id);if(!x)return;state.selected=id;const fav=mark("favorites",id),arch=mark("archived",id);$("detail").innerHTML="<h2>"+esc(x.currentTitle||"Untitled")+"</h2><p class=badge>"+esc(x.topic)+" · "+esc(status(x))+"</p><p>"+esc(x.shortSummary)+"</p><p class=muted>"+esc(x.directory||x.projectDirectory||"")+"</p><h3>Latest messages</h3>"+(x.previewMessages||[]).map(m=>"<div class=message><small>"+esc(m.role)+"</small><br>"+esc(m.text)+"</div>").join("")+"<p><button id=fav>"+(fav?"Remove favorite":"Add favorite")+"</button> <button id=arc>"+(arch?"Unarchive":"Archive")+"</button></p><p class=muted>Session ID: "+esc(x.id)+"</p>";$("fav").onclick=()=>{state.favorites=fav?state.favorites.filter(v=>v!==id):[...state.favorites,id];save();render();show(id)};$("arc").onclick=()=>{state.archived=arch?state.archived.filter(v=>v!==id):[...state.archived,id];save();render();show(id)}}
["search","topic","status","scope"].forEach(id=>$(id).oninput=()=>{state[id==="search"?"query":id]=$(id).value;render()});$("sort").onclick=()=>{state.sort=state.sort==="updated"?"title":"updated";render()};$("refresh").onclick=()=>location.reload();$("generated").textContent=date(new Date(DATA.generatedAt).getTime());[...new Set(DATA.sessions.map(x=>x.topic))].sort().forEach(v=>$("topic").insertAdjacentHTML("beforeend","<option>"+esc(v)+"</option>"));[...new Set(DATA.sessions.map(status))].sort().forEach(v=>$("status").insertAdjacentHTML("beforeend","<option>"+esc(v)+"</option>"));render();setInterval(()=>fetch("/api/report",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(x=>x&&x.generatedAt!==DATA.generatedAt&&location.reload()).catch(()=>{}),5000);
</script></body></html>`
  await writeFile(DASHBOARD_HTML, polishDashboard(htmlPage), "utf8")
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
      unixCommand: `cd "${item.directory || item.projectDirectory || "."}" && opencode -s ${item.id}`,
    })),
  }
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
</script></body></html>`
  await writeFile(DASHBOARD_HTML, polishDashboard(htmlPage), "utf8")
}

async function writeReports(index, settings, errors = []) {
  return writeReportFiles(index, settings, errors, { writeDashboard, now })
}

async function diagnose(client) {
  await ensureStorage()
  const errors = []
  const pathInfo = await call("client.path.get", () => client.path.get(), errors)
  const index = await loadIndex()
  return { protocol: "v1", server: { reachable: Boolean(pathInfo) }, indexedSessions: Object.keys(index.sessions).length, dashboardUrl: paths.dashboardUrl, paths, errors }
}

export const SessionOrganizer = async ({ client, directory }) => {
  await ensureStorage()
  await startDashboardServer()
  let operation = Promise.resolve()
  const enqueue = (work) => { operation = operation.then(work, work); return operation }
  void enqueue(() => runAudit(client, directory, { writeReports })).catch(() => undefined)
  let refreshTimer = null
  const scheduleRefresh = async () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    const settings = await loadSettings()
     refreshTimer = setTimeout(() => { refreshTimer = null; void enqueue(() => runAudit(client, directory, { writeReports })).catch(() => undefined) }, Number(settings.debounceMs) || 1500)
  }

  const tool = createTools({ client, directory, enqueue, writeReports, diagnose })

  const event = async ({ event: incoming }) => {
    const actual = incoming?.payload?.type ? incoming.payload : incoming || {}
    if (["session.created", "session.updated", "session.idle"].includes(actual.type)) void scheduleRefresh()
  }

  return { event, tool }
}
