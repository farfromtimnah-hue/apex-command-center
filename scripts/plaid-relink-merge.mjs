#!/usr/bin/env node
/**
 * Plaid re-link merge.
 *
 * WHY THIS EXISTS
 * Re-linking a Plaid Item to widen the history window (90 -> 730 days) creates
 * a NEW Item, and plaid_transaction_id is not stable across Items. So every
 * transaction the old Item already delivered comes back with a different id
 * and inserts as a fresh row. Naively that doubles the ledger; naively
 * deleting the old rows instead throws away every categorisation, transfer
 * pair and invoice match someone made by hand.
 *
 * WHAT IT DOES
 * Matches old rows to new ones on date + amount + description, carries the
 * human work forward onto the surviving row, then removes the superseded
 * duplicate. Dry-run by default; --apply writes.
 *
 * USAGE
 *   node scripts/plaid-relink-merge.mjs            # dry run, prints a plan
 *   node scripts/plaid-relink-merge.mjs --apply    # execute
 *   node scripts/plaid-relink-merge.mjs --before   # snapshot before relink
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const DB = 'apex-command-center';
const APPLY = process.argv.includes('--apply');
const SNAP = process.argv.includes('--before');
const SNAP_PATH = '/tmp/plaid-premerge-snapshot.json';

function q(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const start = out.indexOf('[');
  return JSON.parse(out.slice(start))[0].results;
}

function run(sql) {
  if (!APPLY) return;
  execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--command', sql],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

const key = (t) => [t.date, t.amount_cents, (t.description || '').trim()].join('|');

/* ---- snapshot mode: capture the pre-relink state ---- */
if (SNAP) {
  const rows = q(`SELECT id, plaid_transaction_id, account_id, date, amount_cents, description,
                         category_id, category_source, categorized_at, categorized_by, memo,
                         is_transfer, transfer_pair_id, transfer_status
                  FROM transactions`);
  fs.writeFileSync(SNAP_PATH, JSON.stringify(rows, null, 1));
  console.log(`snapshot: ${rows.length} transactions -> ${SNAP_PATH}`);
  const withWork = rows.filter(r => r.category_id || r.transfer_pair_id || r.memo);
  console.log(`  carrying human work: ${withWork.length}`);
  process.exit(0);
}

/* ---- merge mode ---- */
if (!fs.existsSync(SNAP_PATH)) {
  console.error('No snapshot found. Run with --before BEFORE the re-link.');
  process.exit(1);
}

const old = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
const now = q(`SELECT id, plaid_transaction_id, account_id, date, amount_cents, description,
                      category_id, transfer_pair_id, memo
               FROM transactions`);

const oldIds = new Set(old.map(r => r.id));
const fresh = now.filter(r => !oldIds.has(r.id));   // rows the new Item delivered
const survivors = now.filter(r => oldIds.has(r.id)); // pre-existing rows still present

console.log(`old snapshot : ${old.length}`);
console.log(`in db now    : ${now.length}`);
console.log(`new rows     : ${fresh.length}`);
console.log(`pre-existing : ${survivors.length}\n`);

// index the new rows by merge key
const byKey = new Map();
for (const f of fresh) {
  const k = key(f);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(f);
}

const carries = [];   // human work to move onto a new row
const deletes = [];   // old rows superseded by a new one
const orphans = [];   // old rows with no new counterpart

for (const o of old) {
  const cand = byKey.get(key(o));
  if (!cand || cand.length === 0) { orphans.push(o); continue; }
  const target = cand.shift();                 // one-to-one, first come
  const hasWork = o.category_id || o.transfer_pair_id || o.memo;
  if (hasWork) carries.push({ from: o, to: target });
  deletes.push(o);
}

const untouchedNew = [...byKey.values()].flat();

console.log(`carry human work : ${carries.length}`);
console.log(`delete old dupes : ${deletes.length}`);
console.log(`old with no match: ${orphans.length}   <- kept, review these`);
console.log(`new, no old twin : ${untouchedNew.length}   <- the widened history\n`);

if (orphans.length) {
  console.log('ORPHANS (old rows the re-link did not return):');
  for (const o of orphans.slice(0, 20))
    console.log(`  ${o.date} ${String(o.amount_cents).padStart(9)}  ${(o.description||'').slice(0,58)}`);
  if (orphans.length > 20) console.log(`  ...and ${orphans.length - 20} more`);
  console.log('');
}

if (!APPLY) {
  console.log('DRY RUN — nothing written. Re-run with --apply to execute.');
  process.exit(0);
}

/* ---- write ---- */
const esc = (v) => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

let moved = 0;
for (const { from, to } of carries) {
  run(`UPDATE transactions SET
        category_id      = ${esc(from.category_id)},
        category_source  = ${esc(from.category_source)},
        categorized_at   = ${esc(from.categorized_at)},
        categorized_by   = ${esc(from.categorized_by)},
        memo             = ${esc(from.memo)},
        is_transfer      = ${from.is_transfer ?? 0},
        transfer_pair_id = ${esc(from.transfer_pair_id)},
        transfer_status  = ${esc(from.transfer_status || 'none')}
       WHERE id = ${esc(to.id)}`);
  // invoice matches point at the old row: repoint them
  run(`UPDATE invoice_payments SET transaction_id = ${esc(to.id)}
       WHERE transaction_id = ${esc(from.id)}`);
  moved++;
}
console.log(`carried work onto ${moved} rows`);

let removed = 0;
for (const d of deletes) {
  run(`DELETE FROM transactions WHERE id = ${esc(d.id)}`);
  removed++;
}
console.log(`removed ${removed} superseded rows`);
console.log('done.');
