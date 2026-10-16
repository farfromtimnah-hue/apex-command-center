// "Add task": a pasted list becomes one task per item; anything else stays ONE
// task. Runs the REAL taskTypedSplit from worker/index.js.
//
//   node scripts/test-task-split.mjs
import { build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const F = build(["taskBoxMatch", "taskTypedSplit"], ["TASK_BOX_GLYPH_RE", "TASK_BOX_ASCII_RE"], baseStubs);
const split = (t) => F.taskTypedSplit(t);
const texts = (r) => r && r.map((x) => x.text);

// Alice's real paste, with line breaks.
const alice = "1. Gestão Financeira\n☐ Conferir quanto entrou de receita neste mês\n☐ Pagar a parcela do carro\n☐ Pagar a parcela do sofá\n2. Conecta Business\n☐ Enviar mensagem para todas as pessoas confirmadas no evento\n☐ Reforçar data, horário e local do encontro";
let r = split(alice);
ok(r && r.length === 5, "Alice's checklist: five tasks");
ok(r[0].text === "Gestão Financeira: Conferir quanto entrou de receita neste mês" && r[2].text === "Gestão Financeira: Pagar a parcela do sofá", "the first heading stays in front of its items");
ok(r[3].text.startsWith("Conecta Business: Enviar mensagem") && r[4].text.startsWith("Conecta Business: Reforçar"), "the second heading takes over for its items");
ok(r.every((x) => x.done === false), "unticked boxes are open tasks");

// The same paste with its line breaks already flattened (one line, glyphs inline).
r = split("1. Gestão Financeira ☐ Pagar a parcela do carro ☐ Pagar a parcela do sofá 2. Conecta Business ☐ Reforçar data, horário e local do encontro");
ok(r && r.length === 3, "a list flattened onto one line still splits on the box glyphs");
ok(texts(r)[0] === "1. Gestão Financeira: Pagar a parcela do carro".replace("1. ", "") || texts(r)[0].includes("Pagar a parcela do carro"), "flattened: the first item is kept");

// Ticked boxes are tasks that are already done.
r = split("☐ Ligar para o cliente\n✅ Enviar a proposta\n☑ Marcar reunião");
ok(r && r.length === 3 && r[0].done === false && r[1].done === true && r[2].done === true, "✅ and ☑ items come out done, ☐ items open");

// Bullets and numbered lists.
r = split("- Comprar uniformes\n- Pedir cartões de visita\n- Ver placa do jardim");
ok(r && r.length === 3 && r[0].text === "Comprar uniformes", "dash bullets split");
r = split("• Um\n• Dois");
ok(r && r.length === 2, "bullet glyphs split");
r = split("1. Ligar para o Allan\n2. Marcar com o JP\n3. Enviar documentos");
ok(r && r.length === 3 && r[1].text === "Marcar com o JP", "a plain numbered list splits");

// A line that is not an item is glued to the item before it.
r = split("☐ Ligar para o Allan\ne perguntar sobre o valor\n☐ Marcar com o JP");
ok(r && r.length === 2 && r[0].text === "Ligar para o Allan e perguntar sobre o valor", "a wrapped line stays with its item");

// Everything that is NOT a list stays one task.
ok(split("Ligar para o Allan amanhã") === null, "one sentence is not split");
ok(split("Ligar para o Allan\namanhã de manhã") === null, "two plain lines are not split");
ok(split("☐ Só um item") === null, "a single box item is not a list");
ok(split("Comprar pão - leite - ovos") === null, "dashes inside a sentence are not bullets");
ok(split("-5 graus lá fora") === null && split("") === null && split(null) === null, "odd input is never split");
ok(split("Meta de 2026: 1. crescer 2. lucrar") === null, "numbers inside a sentence are not a list");

console.log(fail ? "\n" + fail + " FAILED" : "\nAll passed.");
process.exit(fail ? 1 : 0);
