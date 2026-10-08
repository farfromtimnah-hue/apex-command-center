// The Tasks page's sections and its Done-tab tree, against the REAL functions
// cut out of tasks.html. No network, no browser, nothing written.
//
//   node scripts/test-tasks-page-sections.mjs
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

const page = readFileSync(new URL("tasks.html", root), "utf8");
const ios = readFileSync(new URL("ios/App/App/public/tasks.html", root), "utf8");
const cutFrom = (html, name) => {
  const i = html.indexOf("\n    function " + name + "(");
  if (i < 0) { throw new Error("not in tasks.html: " + name); }
  return html.slice(i + 1, html.indexOf("\n    }\n", i) + 6);
};
const NAMES = ["rowsToTasks", "isOwnConsultantTask", "taskOwnerRole", "taskMakerRole", "taskSectionFor",
  "tasksInSection", "taskStampKey", "sortSectionTasks", "taskDoneStamp", "taskNyMonth", "archiveMonthLabel",
  "buildArchiveMonths", "buildArchiveGivenTree", "archiveSectionKeys", "givenCanCheck", "givenDoneWhen", "taskGivenBy"];
const dt = readFileSync(new URL("datetime.js", root), "utf8");
const make = (role) => new Function("sessionStorage",
  dt + "\nvar completedMap = {};\n" + NAMES.map((n) => cutFrom(page, n)).join("\n") +
  "\nreturn { completedMap, " + NAMES.join(", ") + " };")({ getItem: () => role });

// ── 0. The page itself ──────────────────────────────────────────────────────
{
  ok(page === ios, "tasks.html: the root and iOS copies are the same file");
  ok(NAMES.every((n) => cutFrom(page, n) === cutFrom(ios, n)), "the root and iOS copies carry the same section functions");
  let n = 0, bad = 0;
  for (const m of page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) { n++; try { new Function(m[1]); } catch (e) { bad++; console.log("      inline script " + n + ": " + e.message); } }
  ok(n > 0 && bad === 0, "tasks.html: all " + n + " inline scripts parse");
  const js = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  ok(!/\b(confirm|alert|prompt)\s*\(/.test(js), "tasks.html: no confirm(), alert() or prompt()");
  const order = ["tabBtnMine", "tabBtnClient", "tabBtnConsultant", "tabBtnDone"].map((id) => page.indexOf('id="' + id + '"'));
  ok(order.every((x) => x > 0) && order.join() === order.slice().sort((a, b) => a - b).join(), "tabs in order: My tasks, Client, Consultant, Done");
  ok(page.indexOf("tabBtnGiven") < 0 && page.indexOf("tabCountGiven") < 0, "the Given to others tab is gone");
  ok(/id="tabBtnConsultant" hidden /.test(page), "the Consultant tab is hidden until the role is known to be alice or developer");
  ok(page.indexOf('head.setAttribute("aria-expanded", open ? "true" : "false")') > 0 && page.indexOf('var head = document.createElement("button")') > 0, "a section header is a real button that carries aria-expanded");
}

// ── The rows GET /api/tasks would return ────────────────────────────────────
const row = (id, o) => Object.assign({ id, client_id: null, client_name: null, type: "consultant", description: id,
  due_date: null, status: "pending", source: "voice", created_at: "2026-10-01 12:00:00", updated_at: null,
  completed_at: null, completed_by: null, assigned_to: null, created_by_role: null,
  assignee_name: null, owner_name: null, giver_name: null }, o);
const done = (at, o) => Object.assign({ status: "done", completed_at: at }, o);
const ROWS = [
  // open
  row("r-voice",      { created_by_role: "rafa", created_at: "2026-10-05 10:00:00" }),
  row("r-manual",     { source: "manual", created_at: "2026-10-06 10:00:00" }),
  row("r-old-null",   { source: null, created_at: "2026-09-01 10:00:00" }),
  row("r-help",       { source: "help_request", client_id: "c1", client_name: "Acme", created_at: "2026-10-07 09:00:00" }),
  row("r-sess-late",  { source: "session", client_id: "c1", client_name: "Acme", due_date: "2026-10-20" }),
  row("r-sess-soon",  { source: "session", client_id: "c1", client_name: "Acme", due_date: "2026-10-09" }),
  row("r-sess-nodue", { source: "session", client_id: "gone", client_name: null }),
  row("a-own",        { assigned_to: "alice", created_by_role: "alice", assignee_name: "Alice B", created_at: "2026-10-03 10:00:00" }),
  row("r-to-a",       { assigned_to: "alice", created_by_role: "rafa", assignee_name: "Alice B", giver_name: "Rafael", created_at: "2026-10-02 10:00:00", due_date: "2026-10-12" }),
  row("r-to-a-old",   { assigned_to: "alice", created_by_role: null, assignee_name: "Alice B" }),
  row("r-to-d",       { assigned_to: "developer", created_by_role: "rafa", due_date: "2026-10-10" }),
  row("a-to-r",       { assigned_to: null, created_by_role: "alice", owner_name: "Rafael", giver_name: "Alice B" }),
  row("a-to-d",       { assigned_to: "developer", created_by_role: "alice" }),
  row("d-own",        { assigned_to: "developer", created_by_role: "developer" }),
  row("d-to-r",       { assigned_to: null, created_by_role: "developer", owner_name: "Rafael" }),
  row("d-to-a",       { assigned_to: "alice", created_by_role: "developer", assignee_name: "Alice B" }),
  row("c-open",       { type: "client", source: "session", client_id: "c1", client_name: "Acme" }),
  // done
  row("r-done-oct",   done("2026-10-07T18:00:00.000Z", { created_by_role: "rafa" })),
  row("r-done-edge",  done("2026-11-01T03:30:00Z", { created_by_role: "rafa" })),
  row("r-done-nov",   done("2026-11-02T15:00:00.000Z", { source: "manual" })),
  row("r-done-old",   done(null, { updated_at: "2026-08-15 20:00:00" })),
  row("r-done-bare",  done(null, { updated_at: null, created_at: "2026-07-04 10:00:00" })),
  row("r-sess-done",  done("2026-10-02T15:00:00.000Z", { source: "session", client_id: "c1", client_name: "Acme" })),
  row("r-undone",     done("2026-10-07T18:00:00.000Z", { completed_by: "voice-undo" })),
  row("a-undone",     done("2026-10-07T18:00:00.000Z", { completed_by: "voice-undo", assigned_to: "alice", created_by_role: "rafa" })),
  row("r-to-a-done1", done("2026-10-06T15:00:00.000Z", { assigned_to: "alice", created_by_role: "rafa", assignee_name: "Alice B" })),
  row("r-to-a-done2", done("2026-10-07T15:00:00.000Z", { assigned_to: "alice", created_by_role: null, assignee_name: "Alice B" })),
  row("r-to-d-done",  done("2026-10-07T16:00:00.000Z", { assigned_to: "developer", created_by_role: "rafa" })),
  row("r-to-a-sep",   done("2026-09-10T15:00:00.000Z", { assigned_to: "alice", created_by_role: "rafa", assignee_name: "Alice B" })),
  row("a-to-r-done",  done("2026-10-05T15:00:00.000Z", { assigned_to: null, created_by_role: "alice", owner_name: "Rafael" })),
  row("a-own-done",   done("2026-10-04T15:00:00.000Z", { assigned_to: "alice", created_by_role: "alice" })),
  row("d-own-done",   done("2026-10-04T15:00:00.000Z", { assigned_to: "developer", created_by_role: "developer" })),
  row("c-done",       done("2026-10-03T15:00:00.000Z", { type: "client", source: "session", client_id: "c1", client_name: "Acme" })),
  row("c-done-gone",  done(null, { type: "client", source: "session", client_id: "gone", client_name: null, updated_at: "2026-09-30 12:00:00" })),
];

const view = (role) => {
  const P = make(role);
  const tasks = P.rowsToTasks(ROWS);
  const ids = (section, wantDone) => P.sortSectionTasks(section, role, P.tasksInSection(tasks, role, section, wantDone, P.completedMap)).map((t) => t.key);
  return { P, tasks, ids, open: (s) => ids(s, false).join(","), done: (s) => ids(s, true).sort().join(",") };
};
const eq = (got, want, m) => ok(got === want, m + ": " + got);

// ── 1. rafa ─────────────────────────────────────────────────────────────────
{
  const v = view("rafa");
  eq(v.open("mine"), "r-help,r-manual,r-voice,a-to-r,d-to-r,r-old-null", "rafa, Mine: his own of every source but session (voice, manual, help_request, none), and the ones given to him; newest first (two made at the same moment keep the order they came in)");
  eq(v.open("sessions"), "r-sess-soon,r-sess-late,r-sess-nodue", "rafa, From sessions: soonest due first, no date last");
  eq(v.open("given"), "r-to-d,r-to-a,r-to-a-old", "rafa, Given to others: what he handed out, an old row with no created_by_role counts as his; soonest due first");
  eq(v.open("client"), "c-open", "rafa, Client: the client's open task");
  eq(v.done("mine"), "a-to-r-done,r-done-bare,r-done-edge,r-done-nov,r-done-oct,r-done-old", "rafa, Done > Mine");
  eq(v.done("sessions"), "r-sess-done", "rafa, Done > From sessions");
  eq(v.done("given"), "r-to-a-done1,r-to-a-done2,r-to-a-sep,r-to-d-done", "rafa, Done > Given to others");
  eq(v.done("client"), "c-done,c-done-gone", "rafa, Done > Client, a missing client included");
  eq(v.P.archiveSectionKeys("rafa").join(","), "mine,sessions,given,client", "rafa: four Done sections");
  // Every row his Consultant tab listed (open, consultant, not handed out) is in Mine or From sessions.
  const wasConsultantTab = v.tasks.filter((t) => v.P.isOwnConsultantTask(t) && !v.P.completedMap[t.key]).map((t) => t.key).sort().join(",");
  const nowMineSess = v.ids("mine", false).concat(v.ids("sessions", false)).sort().join(",");
  eq(nowMineSess, wasConsultantTab, "rafa: Mine + From sessions is exactly what the Consultant tab listed");
  const all = ["mine", "sessions", "given", "client"].flatMap((s) => v.ids(s, false).concat(v.ids(s, true)));
  ok(all.indexOf("r-undone") < 0 && all.indexOf("a-undone") < 0, "rafa: a task closed by voice undo is in no section, open or done");
  ok(new Set(all).size === all.length, "rafa: no task is in two sections");
  eq(v.tasks.filter((t) => all.indexOf(t.key) < 0).map((t) => t.key).sort().join(","), "a-own,a-own-done,a-to-d,a-undone,d-own,d-own-done,d-to-a,r-undone", "rafa: the rows in none of his sections are other people's own tasks, tasks passed between other people, and the undone ones");
}

// ── 2. alice ────────────────────────────────────────────────────────────────
{
  const v = view("alice");
  eq(v.open("mine"), "r-to-a-old,d-to-a,r-to-a,a-own", "alice, Mine: what she owns, her own and the ones given to her; oldest first");
  eq(v.open("sessions"), "", "alice, From sessions: none");
  eq(v.open("given"), "a-to-r,a-to-d", "alice, Given to others: to the consultant and to the system");
  eq(v.done("mine"), "a-own-done,r-to-a-done1,r-to-a-done2,r-to-a-sep", "alice, Done > Mine");
  eq(v.done("given"), "a-to-r-done", "alice, Done > Given to others");
  eq(v.done("client"), "c-done,c-done-gone", "alice, Done > Client");
  eq(v.open("consultant").split(",").sort().join(","), "a-to-r,d-to-r,r-help,r-manual,r-old-null,r-sess-late,r-sess-nodue,r-sess-soon,r-voice", "alice, Consultant tab: the consultant's open list as before");
  eq(v.done("consultant"), "a-to-r-done,r-done-bare,r-done-edge,r-done-nov,r-done-oct,r-done-old,r-sess-done", "alice, Done > Consultant: his done list, never one undone by voice");
  eq(v.P.archiveSectionKeys("alice").join(","), "mine,sessions,given,client,consultant", "alice: the four Done sections and the consultant's");
  ok(v.P.givenCanCheck(v.tasks.find((t) => t.key === "a-own")) && !v.P.givenCanCheck(v.tasks.find((t) => t.key === "d-own")), "alice: a checkbox on her own task, not on the system's");
  eq(String(v.P.taskGivenBy(v.tasks.find((t) => t.key === "r-to-a"))) + "/" + String(v.P.taskGivenBy(v.tasks.find((t) => t.key === "a-own"))) + "/" + String(v.P.taskGivenBy(v.tasks.find((t) => t.key === "d-to-a"))), "rafa/null/developer", "alice: a From tag on a task rafa or the system gave her, none on her own");
}

// ── 3. developer ────────────────────────────────────────────────────────────
{
  const v = view("developer");
  eq(v.open("mine"), "r-to-d,a-to-d,d-own", "developer, Mine: the system's tasks (same created_at keeps the list order after the older one)");
  eq(v.open("given"), "d-to-r,d-to-a", "developer, Given to others");
  eq(v.done("mine"), "d-own-done,r-to-d-done", "developer, Done > Mine");
  eq(v.done("given"), "", "developer, Done > Given to others: none");
  eq(v.P.archiveSectionKeys("developer").join(","), "mine,sessions,given,client,consultant", "developer: the four Done sections and the consultant's");
}

// ── 4. No role, or another role ─────────────────────────────────────────────
{
  const v = view("");
  eq(v.open("mine") + "|" + v.open("sessions") + "|" + v.open("given"), "||", "no role: the three sections are empty, nothing throws");
  eq(v.open("client"), "c-open", "no role: client tasks are still client tasks");
}

// ── 5. The month, in New York ───────────────────────────────────────────────
{
  const P = make("rafa");
  eq(P.taskNyMonth("2026-11-01T03:30:00Z"), "2026-10", "2026-11-01T03:30:00Z is still October in New York");
  eq(P.taskNyMonth("2026-11-01T04:00:00Z"), "2026-11", "midnight in New York on 11/01 is November");
  eq(P.taskNyMonth("2027-01-01 04:59:59"), "2026-12", "a bare database time is UTC; winter (UTC-5), 11:59 PM on 12/31");
  eq(P.taskNyMonth("2027-01-01 05:00:00"), "2027-01", "and a second later it is January 2027");
  eq(P.taskNyMonth("2026-10-07"), "2026-10", "a plain date is its own month");
  eq(P.taskNyMonth("") + "|" + P.taskNyMonth(null) + "|" + P.taskNyMonth("nonsense"), "||", "nothing readable: no month");
  eq(P.archiveMonthLabel("2026-10").pt + " / " + P.archiveMonthLabel("2026-10").en, "Outubro 2026 / October 2026", "the month label");
  eq(P.archiveMonthLabel("2026-03").pt + " / " + P.archiveMonthLabel("2026-03").en, "Mar&ccedil;o 2026 / March 2026", "the month label with an accent is an HTML entity, plain ASCII in the code");
  eq(P.archiveMonthLabel("").pt + " / " + P.archiveMonthLabel("").en, "Sem data / No date", "the label of the group with no readable date");
}

// ── 6. The Done tree ────────────────────────────────────────────────────────
{
  const v = view("rafa");
  const mineDone = v.P.tasksInSection(v.tasks, "rafa", "mine", true, v.P.completedMap);
  const months = v.P.buildArchiveMonths(mineDone);
  eq(months.map((m) => m.key + "(" + m.tasks.length + ")").join(" "), "2026-11(1) 2026-10(3) 2026-08(1) 2026-07(1)", "rafa, Done > Mine: months newest first with their counts");
  eq(months[1].tasks.map((t) => t.key).join(","), "r-done-edge,r-done-oct,a-to-r-done", "October: newest done first, and the 11/01 03:30 UTC task is in it");
  eq(months[2].tasks[0].key + "/" + months[3].tasks[0].key, "r-done-old/r-done-bare", "no completed_at: the month of updated_at; neither: the month of created_at");
  eq(v.P.givenDoneWhen(months[1].tasks[0]) + " | " + v.P.givenDoneWhen(months[2].tasks[0]) + " | " + v.P.givenDoneWhen(months[3].tasks[0]), "10/31/2026 11:30 PM | 08/15/2026 | ", "the done tag: date and time; the date alone with no completed_at; none when only created_at is known");

  const tree = v.P.buildArchiveGivenTree(v.P.tasksInSection(v.tasks, "rafa", "given", true, v.P.completedMap));
  eq(tree.map((m) => m.key + "(" + m.tasks.length + ")").join(" "), "2026-10(3) 2026-09(1)", "rafa, Done > Given to others: months newest first");
  eq(tree[0].people.map((p) => p.key + ":" + p.name + "(" + p.tasks.length + ")").join(" "), "alice:Alice B(2) developer:null(1)", "October: one group per person; Alice by assignee_name, the developer with no name (shown as Sistema / System)");
  eq(tree[0].people[0].tasks.map((t) => t.key).join(","), "r-to-a-done2,r-to-a-done1", "inside a person: newest done first");
  eq(tree[1].people.map((p) => p.key + "(" + p.tasks.length + ")").join(" "), "alice(1)", "September: only Alice");

  const a = view("alice");
  const aTree = a.P.buildArchiveGivenTree(a.P.tasksInSection(a.tasks, "alice", "given", true, a.P.completedMap));
  eq(aTree[0].people.map((p) => p.key + ":" + p.name).join(" "), "rafa:Rafael", "alice, Done > Given to others: the consultant by owner_name");
  const noName = a.P.buildArchiveGivenTree(a.P.rowsToTasks([row("x", done("2026-10-05T15:00:00.000Z", { created_by_role: "alice" })), row("y", done("2026-10-05T16:00:00.000Z", { created_by_role: "developer", assigned_to: "alice" }))]));
  eq(noName[0].people.map((p) => p.key + ":" + p.name).join(" "), "rafa:Rafa alice:Alice", "no name sent: Rafa and Alice");
  eq(JSON.stringify(v.P.buildArchiveMonths([])) + JSON.stringify(v.P.buildArchiveGivenTree([])), "[][]", "an empty section has no months");
  const undated = v.P.buildArchiveMonths([{ key: "u" }, { key: "k", completedAt: "2026-10-05T15:00:00.000Z" }]);
  eq(undated.map((m) => "[" + m.key + "]").join(""), "[2026-10][]", "a done task with no date at all is still listed, in a last group");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
