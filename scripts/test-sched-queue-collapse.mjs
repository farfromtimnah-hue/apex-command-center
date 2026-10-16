// The dashboard's "Waiting on a time" card folds booked rows into one collapsed
// group and shows "waiting of total". calendar.html (no collapseDone) is untouched.
import { readFileSync } from "node:fs";
import vm from "node:vm";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { bad++; } };
const src = readFileSync(new URL("../scheduling-queue.js", import.meta.url), "utf8");
function run(rows, extra) {
  const els = {};
  const mk = (id) => (els[id] = els[id] || { id, innerHTML: "", textContent: "", hidden: false, querySelectorAll: () => [] });
  const doc = { getElementById: mk, addEventListener() {}, body: {} };
  const win = { document: doc };
  const ctx = vm.createContext({ window: win, document: doc, console });
  vm.runInContext(src, ctx);
  const c = Object.assign({ containerId: "q", blockId: "b", countId: "n", apiFetch: () => Promise.resolve({ json: () => ({ queue: rows }) }), isEn: () => true }, extra);
  return win.SchedulingQueue.init(c).then(() => els);
}
const waiting = (i) => ({ id: "w" + i, status: "sent", client_name: "W" + i, business_hours_waiting: 5, created_at: "2026-10-15 12:00:00" });
const booked = (i) => ({ id: "b" + i, status: "booked", client_name: "B" + i, booked_at: "2026-10-15 12:00:00", created_at: "2026-10-14 12:00:00" });
const many = [waiting(1)].concat(Array.from({ length: 11 }, (_, i) => booked(i)));
let els = await run(many, { collapseDone: true });
ok(els.n.textContent === "1 of 12", "count reads 1 of 12");
ok(els.q.innerHTML.includes('data-id="w1"'), "the waiting row is shown");
ok(els.q.innerHTML.includes("Scheduled (11)") && els.q.innerHTML.includes('class="sq-done-group" hidden'), "the 11 booked rows sit in a collapsed group");
els = await run(Array.from({ length: 12 }, (_, i) => booked(i)), { collapseDone: true });
ok(els.n.textContent === "0 of 12", "all booked: 0 of 12");
ok(els.q.innerHTML.includes("Nothing is waiting.") && els.q.innerHTML.includes("hidden"), "all booked: collapsed, no rows in front");
els = await run(many, { collapseDone: true, isEn: () => false });
ok(els.n.textContent === "1 de 12" && els.q.innerHTML.includes("Agendados (11)"), "Portuguese: 1 de 12, Agendados (11)");
els = await run(many, {});
ok(!els.q.innerHTML.includes("sq-toggle") && els.n.textContent === "", "calendar.html mode: no collapse, no count");
els = await run([], { collapseDone: true });
ok(els.b.hidden === true, "empty queue still hides the whole block");
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
