// Apex Club "Editar msg": the one-send WhatsApp message edit sheet.
//   node scripts/test-club-msg-edit.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("../apex-club.js", import.meta.url), "utf8");
const a = src.indexOf("var CLUB_MSG = null;"), b = src.indexOf("// Plus-one Adicionar/Editar sheet");
const els = {}; const mk = (id) => els[id] || (els[id] = { id, value: "", textContent: "", hidden: true, disabled: false });
const opened = [], marked = [];
const ctx = {
  t: (p, e) => e, clubTip: () => "",
  CLUB_EVENTS: [{ event: { id: "e1", name: "Dinner" }, registrations: [
    { id: "r1", name: "Maria Silva", phone: "18135550100", plus_one: true, plus_one_name: "Joao Silva", plus_one_phone: "18135550111" },
    { id: "r2", name: "No Phone", phone: "123" }] }],
  buildClubWhatsAppText: (ev, g) => "Oi " + g.name.split(" ")[0] + " - " + ev.name,
  markClubConfirmed: (id) => marked.push(id),
  document: { getElementById: mk, createElement: () => ({ click() { opened.push(this.href); } }), body: { appendChild() {}, removeChild() {} } },
};
vm.createContext(ctx); vm.runInContext(src.slice(a, b), ctx);
let fail = 0; const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
ctx.openClubMsgEdit("r1", "guest");
ok(els.cmText.value === "Oi Maria - Dinner", "guest: sheet starts with the standard text");
els.cmText.value = "Edited text & more"; ctx.openClubMsgWhatsApp();
ok(opened[0] === "https://wa.me/18135550100?text=" + encodeURIComponent("Edited text & more"), "guest: link uses the EDITED text and the phone digits");
ok(marked.length === 1 && marked[0] === "r1", "guest: marked confirmed once");
ctx.openClubMsgEdit("r1", "plus");
ok(els.cmText.value === "Oi Joao - Dinner", "plus one: starts with the plus one's own name");
ctx.openClubMsgWhatsApp();
ok(opened[1].startsWith("https://wa.me/18135550111?text=") && marked.length === 1, "plus one: opens, marks nothing");
ctx.openClubMsgEdit("r2", "guest");
ok(els.cmOpenBtn.disabled === true && els.cmErr.hidden === false, "bad phone: button disabled, message shown");
ctx.openClubMsgWhatsApp(); ok(opened.length === 2, "bad phone: nothing opened");
ctx.openClubMsgEdit("r1", "guest"); els.cmText.value = "   "; ctx.openClubMsgWhatsApp();
ok(opened.length === 2 && els.cmErr.hidden === false, "empty text: nothing opened");
els.cmText.value = "x"; ctx.resetClubMsgEdit(); ok(els.cmText.value === "Oi Maria - Dinner", "reset restores the standard text");
ctx.closeClubMsgEdit(); ok(els.clubMsgOverlay.hidden === true, "close hides the sheet");
process.exit(fail ? 1 : 0);
