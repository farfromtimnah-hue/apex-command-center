// The task sheet: a staff task, opened. ONE copy, loaded by dashboard.html
// and tasks.html (and their iOS copies).
//
// Inside, top to bottom: the task's words and tags, two one-click pills
// ("Em andamento" / "Aguardando cliente"), the due date, the note thread, and
// a box to add a note. It is an in-page dialog built the same way as the
// pages' pageDialog (an overlay with role="dialog"; Escape and a tap outside
// close it; focus goes back where it was). No browser pop-ups.
//
// Staff tasks only (type 'consultant'). A client's own to-do never opens it.
//
// What a page gives it:
//   taskSheetOpen({ id, description, clientName, tags, done, progress, dueDate,
//                   apiBase, getToken, onChange, onClose })
//     tags      HTML strings, the who-has-it / who-gave-it tags the row shows
//     getToken  returns a Promise of the signed-in user's token
//     onChange  called after every save with { id, progress, due_date,
//               note_count, last_note } so the page can update its own row
//     onClose   called once when the sheet closes (the page redraws its list)
// And for the row itself:
//   taskSheetMakeOpener(el, taskId, onOpen)   the row's words open the sheet
//   taskSheetRowPill(progress, className)     the pill, or null
//   taskSheetRowNote(lastNote, noteCount)     the muted latest-note line, or null
//
// Dates and times are printed by the page's own formatters (datetime.js):
// MM/DD/YYYY and 12-hour, America/New_York, in both languages.

var TASK_SHEET_NOTE_MAX = 2000;
var TASK_SHEET_ROW_NOTE_MAX = 90;
var TASK_SHEET_PROGRESS = {
  working:        { pt: "Em andamento",       en: "Working on it" },
  waiting_client: { pt: "Aguardando cliente", en: "Waiting on client" }
};

var taskSheetNow = null;     // the open sheet's state, or null
var taskSheetDrafts = {};    // words typed and not yet added, by task id

function taskSheetIsEn() {
  return window.apexIsEn ? window.apexIsEn() : document.body.classList.contains("lang-en");
}

function taskSheetEsc(str) {
  return String(str === null || str === undefined ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function taskSheetBoth(pt, en) {
  return '<span class="show-pt">' + pt + '</span><span class="show-en">' + en + '</span>';
}

function taskSheetStyles() {
  if (document.getElementById("taskSheetStyle")) { return; }
  var st = document.createElement("style");
  st.id = "taskSheetStyle";
  st.textContent =
    ".task-sheet-open { cursor: pointer; border-radius: 4px; }" +
    ".task-sheet-open:hover { text-decoration: underline; }" +
    ".task-sheet-open:focus-visible { outline: 2px solid var(--gold, #C9A43A); outline-offset: 2px; }" +
    ".task-sheet-rownote { font-size: 12px; color: var(--muted, #8a8275); margin: 2px 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }" +
    ".task-sheet-overlay { position: fixed; inset: 0; background: rgba(20,18,16,0.72); display: flex; align-items: center; justify-content: center; z-index: 9500; }" +
    ".task-sheet-box { background: #fdfbf7; color: #1a1712; border-radius: 12px; padding: 22px; width: min(560px, 94vw); max-height: 90vh; overflow-y: auto; box-sizing: border-box; font-family: 'Inter', sans-serif; text-align: left; }" +
    ".task-sheet-top { display: flex; align-items: flex-start; gap: 12px; }" +
    ".task-sheet-title { flex: 1; min-width: 0; font-size: 16px; font-weight: 700; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }" +
    ".task-sheet-title.is-done { text-decoration: line-through; opacity: 0.7; }" +
    ".task-sheet-btn { background: transparent; border: 1px solid #d8d2c8; color: #6b6459; border-radius: 8px; padding: 7px 12px; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }" +
    ".task-sheet-btn:focus-visible, .task-sheet-pill:focus-visible, .task-sheet-add:focus-visible, .task-sheet-link:focus-visible { outline: 2px solid #C9A43A; outline-offset: 2px; }" +
    ".task-sheet-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }" +
    ".task-sheet-meta:empty { display: none; }" +
    ".task-sheet-tag { font-size: 11px; color: #6b6459; padding: 2px 8px; border: 1px solid #d8d2c8; border-radius: 10px; background: #f6f1e7; }" +
    ".task-sheet-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }" +
    ".task-sheet-pills[hidden] { display: none; }" +
    ".task-sheet-pill { border: 1px solid #d8d2c8; background: #fff; color: #6b6459; border-radius: 16px; padding: 7px 14px; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }" +
    ".task-sheet-pill[aria-pressed=\"true\"] { background: #1a1712; border-color: #1a1712; color: #fff; }" +
    ".task-sheet-pill:disabled { opacity: 0.6; cursor: default; }" +
    ".task-sheet-duerow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; font-size: 13px; color: #6b6459; }" +
    ".task-sheet-duerow input { padding: 6px 8px; border: 1px solid #d8d2c8; border-radius: 8px; font-family: inherit; font-size: 13px; background: #fff; color: #1a1712; }" +
    ".task-sheet-dueshown { font-weight: 600; color: #1a1712; }" +
    ".task-sheet-link { background: none; border: none; padding: 2px 4px; color: #6b6459; font-family: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }" +
    ".task-sheet-link[hidden] { display: none; }" +
    ".task-sheet-status { min-height: 18px; margin-top: 8px; font-size: 12px; color: #6b6459; }" +
    ".task-sheet-status.is-error { color: #b44040; }" +
    ".task-sheet-thread { margin-top: 8px; border-top: 1px solid #e6dfd2; padding-top: 10px; max-height: 38vh; overflow-y: auto; }" +
    ".task-sheet-quiet { font-size: 13px; color: #8a8275; padding: 6px 0; }" +
    ".task-sheet-note { display: flex; gap: 10px; padding: 8px 0; }" +
    ".task-sheet-avatar { flex: 0 0 24px; width: 24px; height: 24px; border-radius: 50%; object-fit: cover; background: #e6dfd2; color: #6b6459; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }" +
    ".task-sheet-avatar.is-system { background: #6b6459; color: #fff; }" +
    ".task-sheet-notebody { flex: 1; min-width: 0; }" +
    ".task-sheet-notehead { font-size: 12px; color: #8a8275; }" +
    ".task-sheet-notehead b { color: #1a1712; font-weight: 700; margin-right: 6px; }" +
    ".task-sheet-notetext { font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 2px; }" +
    ".task-sheet-write { margin-top: 12px; }" +
    ".task-sheet-write textarea { width: 100%; box-sizing: border-box; min-height: 70px; padding: 10px; border: 1px solid #d8d2c8; border-radius: 8px; font-family: inherit; font-size: 14px; line-height: 1.4; resize: vertical; background: #fff; color: #1a1712; }" +
    ".task-sheet-add { margin-top: 8px; background: #c9a227; color: #1a1712; border: none; border-radius: 8px; padding: 9px 16px; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }" +
    ".task-sheet-add:disabled { opacity: 0.6; cursor: default; }";
  document.head.appendChild(st);
}

// -- On the row --------------------------------------------------------------

// The row's words open the sheet: a pointer, a focus ring, and Enter.
function taskSheetMakeOpener(el, taskId, onOpen) {
  if (!el || !onOpen) { return; }
  taskSheetStyles();
  el.classList.add("task-sheet-open");
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("data-task-open", String(taskId));
  el.addEventListener("click", function() { onOpen(); });
  el.addEventListener("keydown", function(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  });
}

// The pill on the row, with the same words as in the sheet. null when the
// task has none. className is the page's own pill class.
function taskSheetRowPill(progress, className) {
  var words = TASK_SHEET_PROGRESS[progress];
  if (!words) { return null; }
  var el = document.createElement("span");
  el.className = className || "";
  el.innerHTML = taskSheetBoth(words.pt, words.en);
  return el;
}

// The name printed for a note's author. The system is never a person's name.
function taskSheetAuthorHtml(role, name) {
  if (role === "developer") { return taskSheetBoth("Sistema", "System"); }
  return taskSheetEsc(name || (role === "alice" ? "Alice" : "Rafa"));
}

// One muted line under the row's words: "<name>: <first words>", and the
// count when there is more than one note. null when the task has no notes.
function taskSheetRowNote(lastNote, noteCount) {
  if (!lastNote) { return null; }
  taskSheetStyles();
  var words = String(lastNote.body || "").replace(/\s+/g, " ").trim();
  if (words.length > TASK_SHEET_ROW_NOTE_MAX) {
    words = words.slice(0, TASK_SHEET_ROW_NOTE_MAX).replace(/\s+$/, "") + "\u2026";
  }
  var n = Number(noteCount) || 0;
  var el = document.createElement("div");
  el.className = "task-sheet-rownote";
  el.innerHTML = taskSheetAuthorHtml(lastNote.author_role, lastNote.author_name) + ": " + taskSheetEsc(words) +
    (n > 1 ? " \u00b7 " + taskSheetBoth(n + " notas", n + " notes") : "");
  return el;
}

// -- The sheet ---------------------------------------------------------------

function taskSheetSetStatus(html, isError) {
  var el = document.getElementById("taskSheetStatus");
  if (!el) { return; }
  el.className = "task-sheet-status" + (isError ? " is-error" : "");
  el.innerHTML = html || "";
}

// The words of a failed answer, in both languages when the Worker sent both.
function taskSheetErrorHtml(data, pt, en) {
  if (data && data.error_pt && data.error_en) {
    return taskSheetBoth(taskSheetEsc(data.error_pt), taskSheetEsc(data.error_en));
  }
  return taskSheetBoth(pt, en);
}

function taskSheetApi(path, method, body) {
  var s = taskSheetNow;
  if (!s) { return Promise.reject(new Error("closed")); }
  return s.getToken().then(function(token) {
    var opts = { method: method || "GET", headers: { "Authorization": "Bearer " + token } };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(s.apiBase + path, opts);
  }).then(function(res) {
    return res.json().then(function(data) { return { ok: res.ok, data: data || {} }; },
                           function() { return { ok: false, data: {} }; });
  });
}

function taskSheetTellPage() {
  var s = taskSheetNow;
  if (!s || !s.onChange) { return; }
  var change = { id: s.id, progress: s.progress || null, due_date: s.dueDate || null };
  // The note line is only sent once the thread is known: a thread that did
  // not load must not empty the note line the row already shows.
  if (s.loadState === "ready") {
    var last = s.notes.length ? s.notes[s.notes.length - 1] : null;
    change.note_count = s.notes.length;
    change.last_note = last ? {
      body: String(last.body || "").slice(0, 140), author_role: last.author_role,
      author_name: last.author_name || null, created_at: last.created_at
    } : null;
  }
  s.onChange(change);
}

function taskSheetPaintPills() {
  var s = taskSheetNow;
  if (!s) { return; }
  var wrap = document.getElementById("taskSheetPills");
  if (wrap) { wrap.hidden = !!s.done; }
  var ids = { working: "taskSheetPillWorking", waiting_client: "taskSheetPillWaiting" };
  for (var key in ids) {
    if (!ids.hasOwnProperty(key)) { continue; }
    var btn = document.getElementById(ids[key]);
    if (!btn) { continue; }
    btn.setAttribute("aria-pressed", s.progress === key ? "true" : "false");
    btn.disabled = !!s.savingProgress;
  }
}

// One click turns a pill on (and the other off); a click on the lit one
// turns it off. Saved at once; put back, with a message, if the save fails.
function taskSheetPickProgress(key) {
  var s = taskSheetNow;
  if (!s || s.savingProgress || s.done) { return; }
  var before = s.progress || null;
  var next = before === key ? null : key;
  s.progress = next;
  s.savingProgress = true;
  taskSheetPaintPills();
  taskSheetSetStatus("");
  taskSheetApi("/api/tasks/" + encodeURIComponent(s.id), "PATCH", { progress: next })
    .then(function(r) {
      if (taskSheetNow !== s) { return; }
      if (!r.ok) { throw r.data; }
      s.savingProgress = false;
      s.progress = r.data.progress || null;
      taskSheetPaintPills();
      taskSheetSetStatus(taskSheetBoth("Salvo.", "Saved."));
      taskSheetTellPage();
    })
    .catch(function(data) {
      if (taskSheetNow !== s) { return; }
      s.savingProgress = false;
      s.progress = before;
      taskSheetPaintPills();
      taskSheetSetStatus(taskSheetErrorHtml(data, "N&atilde;o consegui salvar. Tente de novo.",
        "Could not save. Please try again."), true);
    });
}

function taskSheetPaintDue() {
  var s = taskSheetNow;
  if (!s) { return; }
  var input = document.getElementById("taskSheetDue");
  if (input) { input.value = s.dueDate || ""; input.disabled = !!s.savingDue; }
  var shown = document.getElementById("taskSheetDueShown");
  if (shown) {
    shown.textContent = (s.dueDate && typeof formatDate === "function") ? formatDate(s.dueDate) : "";
  }
  var clear = document.getElementById("taskSheetDueClear");
  if (clear) { clear.hidden = !s.dueDate; clear.disabled = !!s.savingDue; }
}

// The due date is saved the moment it changes. An empty value clears it.
function taskSheetSaveDue(value) {
  var s = taskSheetNow;
  if (!s || s.savingDue) { return; }
  var before = s.dueDate || null;
  var next = value ? String(value) : null;
  if (next === before) { taskSheetPaintDue(); return; }
  s.dueDate = next;
  s.savingDue = true;
  taskSheetPaintDue();
  taskSheetSetStatus("");
  taskSheetApi("/api/tasks/" + encodeURIComponent(s.id), "PATCH", { due_date: next })
    .then(function(r) {
      if (taskSheetNow !== s) { return; }
      if (!r.ok) { throw r.data; }
      s.savingDue = false;
      s.dueDate = r.data.due_date || null;
      taskSheetPaintDue();
      taskSheetSetStatus(taskSheetBoth("Salvo.", "Saved."));
      taskSheetTellPage();
    })
    .catch(function(data) {
      if (taskSheetNow !== s) { return; }
      s.savingDue = false;
      s.dueDate = before;
      taskSheetPaintDue();
      taskSheetSetStatus(taskSheetErrorHtml(data, "N&atilde;o consegui salvar. Tente de novo.",
        "Could not save. Please try again."), true);
    });
}

// A small round picture; a neutral mark with the initial when there is none
// (or the picture does not load); a neutral mark for the system.
function taskSheetAvatar(note) {
  var s = taskSheetNow;
  var mark = document.createElement("span");
  mark.className = "task-sheet-avatar";
  mark.setAttribute("aria-hidden", "true");
  if (note.author_role === "developer") {
    mark.className += " is-system";
    mark.textContent = "S";
    return mark;
  }
  var name = String(note.author_name || (note.author_role === "alice" ? "Alice" : "Rafa"));
  mark.textContent = name.charAt(0).toUpperCase();
  if (!note.author_avatar_url || !s) { return mark; }
  var img = document.createElement("img");
  img.className = "task-sheet-avatar";
  img.alt = "";
  img.width = 24;
  img.height = 24;
  img.onerror = function() { if (img.parentNode) { img.parentNode.replaceChild(mark, img); } };
  img.src = s.apiBase + note.author_avatar_url;
  return img;
}

function taskSheetNoteEl(note) {
  var row = document.createElement("div");
  row.className = "task-sheet-note";
  row.appendChild(taskSheetAvatar(note));
  var body = document.createElement("div");
  body.className = "task-sheet-notebody";
  var head = document.createElement("div");
  head.className = "task-sheet-notehead";
  var when = typeof formatDateTimeUTC === "function" ? formatDateTimeUTC(note.created_at) : "";
  head.innerHTML = "<b>" + taskSheetAuthorHtml(note.author_role, note.author_name) + "</b>" + taskSheetEsc(when);
  body.appendChild(head);
  var text = document.createElement("div");
  text.className = "task-sheet-notetext";
  text.textContent = note.body || "";
  body.appendChild(text);
  row.appendChild(body);
  return row;
}

// Oldest first, and the view scrolled to the newest.
function taskSheetPaintThread() {
  var s = taskSheetNow;
  var box = document.getElementById("taskSheetThread");
  if (!s || !box) { return; }
  box.innerHTML = "";
  if (s.loadState !== "ready") {
    var wait = document.createElement("div");
    wait.className = "task-sheet-quiet";
    wait.innerHTML = s.loadState === "failed"
      ? taskSheetBoth("N&atilde;o foi poss&iacute;vel carregar as notas.", "Could not load the notes.")
      : taskSheetBoth("Carregando...", "Loading...");
    box.appendChild(wait);
    return;
  }
  if (!s.notes.length) {
    var none = document.createElement("div");
    none.className = "task-sheet-quiet";
    none.innerHTML = taskSheetBoth("Nenhuma nota ainda.", "No notes yet.");
    box.appendChild(none);
    return;
  }
  for (var i = 0; i < s.notes.length; i++) { box.appendChild(taskSheetNoteEl(s.notes[i])); }
  box.scrollTop = box.scrollHeight;
}

// The button sends; Enter does not (a note can be several lines). While it
// is sending the button is off. If it fails the words stay in the box.
function taskSheetAddNote() {
  var s = taskSheetNow;
  var box = document.getElementById("taskSheetNoteBox");
  var btn = document.getElementById("taskSheetAdd");
  if (!s || !box || !btn || s.sending) { return; }
  var words = String(box.value || "").trim();
  if (!words) {
    taskSheetSetStatus(taskSheetBoth("Escreva a nota antes de adicionar.", "Write the note before adding it."), true);
    box.focus();
    return;
  }
  if (words.length > TASK_SHEET_NOTE_MAX) {
    taskSheetSetStatus(taskSheetBoth(
      "Nota longa demais. O limite &eacute; de " + TASK_SHEET_NOTE_MAX + " caracteres.",
      "That note is too long. The limit is " + TASK_SHEET_NOTE_MAX + " characters."), true);
    return;
  }
  s.sending = true;
  btn.disabled = true;
  taskSheetSetStatus("");
  taskSheetApi("/api/tasks/" + encodeURIComponent(s.id) + "/notes", "POST", { body: words })
    .then(function(r) {
      if (taskSheetNow !== s) { return; }
      if (!r.ok || !r.data.note) { throw r.data; }
      s.sending = false;
      btn.disabled = false;
      s.notes.push(r.data.note);
      box.value = "";
      delete taskSheetDrafts[s.id];
      // The thread had not loaded (or failed to): read it again, so the new
      // note shows in its place among the others.
      if (s.loadState !== "ready") { taskSheetLoad(s); return; }
      taskSheetPaintThread();
      taskSheetTellPage();
    })
    .catch(function(data) {
      if (taskSheetNow !== s) { return; }
      s.sending = false;
      btn.disabled = false;
      taskSheetSetStatus(taskSheetErrorHtml(data, "N&atilde;o consegui adicionar a nota. Tente de novo.",
        "Could not add the note. Please try again."), true);
    });
}

// The task as it is saved now, and its thread.
function taskSheetLoad(s) {
  if (taskSheetNow !== s) { return; }
  taskSheetApi("/api/tasks/" + encodeURIComponent(s.id) + "/notes", "GET")
    .then(function(r) {
      if (taskSheetNow !== s) { return; }
      if (!r.ok || !r.data.task) { throw r.data; }
      var t = r.data.task;
      s.done = t.status === "done";
      if (!s.savingProgress) { s.progress = t.progress || null; }
      if (!s.savingDue) { s.dueDate = t.due_date || null; }
      // A note added while the thread was on its way may not be in the
      // answer yet: it is kept, after the ones that are.
      var got = r.data.notes || [];
      var have = {};
      for (var i = 0; i < got.length; i++) { have[got[i].id] = true; }
      for (var j = 0; j < s.notes.length; j++) {
        if (!have[s.notes[j].id]) { got.push(s.notes[j]); }
      }
      s.notes = got;
      s.loadState = "ready";
      var title = document.getElementById("taskSheetTitle");
      if (title) { title.className = "task-sheet-title" + (s.done ? " is-done" : ""); }
      taskSheetPaintPills();
      taskSheetPaintDue();
      taskSheetPaintThread();
      taskSheetTellPage();
    })
    .catch(function() {
      if (taskSheetNow !== s) { return; }
      s.loadState = "failed";
      taskSheetPaintThread();
    });
}

function taskSheetClose() {
  var s = taskSheetNow;
  if (!s) { return; }
  var box = document.getElementById("taskSheetNoteBox");
  if (box && String(box.value || "").trim()) { taskSheetDrafts[s.id] = box.value; }
  else { delete taskSheetDrafts[s.id]; }
  taskSheetNow = null;
  document.removeEventListener("keydown", s.onKey, true);
  if (s.overlay && s.overlay.parentNode) { s.overlay.parentNode.removeChild(s.overlay); }
  if (s.onClose) { s.onClose(); }
  // The page has just redrawn its list: focus goes back to the same row's
  // words when they are still there, otherwise to where it was.
  var back = null;
  var openers = document.querySelectorAll("[data-task-open]");
  for (var i = 0; i < openers.length; i++) {
    if (openers[i].getAttribute("data-task-open") === String(s.id)) { back = openers[i]; break; }
  }
  if (!back && s.prevFocus && document.body.contains(s.prevFocus)) { back = s.prevFocus; }
  if (back && back.focus) { try { back.focus(); } catch (e) {} }
}

function taskSheetOpen(o) {
  if (taskSheetNow || !o || !o.id || !o.getToken) { return false; }
  taskSheetStyles();
  var en = taskSheetIsEn();
  var s = {
    id: o.id, apiBase: o.apiBase || "", getToken: o.getToken,
    onChange: o.onChange || null, onClose: o.onClose || null,
    done: !!o.done, progress: o.progress || null, dueDate: o.dueDate || null,
    notes: [], loadState: "loading", sending: false, savingProgress: false, savingDue: false,
    prevFocus: document.activeElement, overlay: null, onKey: null
  };

  var ov = document.createElement("div");
  ov.id = "taskSheet";
  ov.className = "task-sheet-overlay";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-labelledby", "taskSheetTitle");
  var box = document.createElement("div");
  box.className = "task-sheet-box";
  box.addEventListener("click", function(e) { e.stopPropagation(); });

  // The task's words, and Close.
  var top = document.createElement("div");
  top.className = "task-sheet-top";
  var title = document.createElement("div");
  title.id = "taskSheetTitle";
  title.className = "task-sheet-title" + (s.done ? " is-done" : "");
  title.textContent = o.description || "--";
  top.appendChild(title);
  var closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.id = "taskSheetClose";
  closeBtn.className = "task-sheet-btn";
  closeBtn.innerHTML = taskSheetBoth("Fechar", "Close");
  closeBtn.addEventListener("click", taskSheetClose);
  top.appendChild(closeBtn);
  box.appendChild(top);

  // The client, and the tags the row shows (who has it, who gave it).
  var meta = document.createElement("div");
  meta.id = "taskSheetMeta";
  meta.className = "task-sheet-meta";
  if (o.clientName) {
    var cl = document.createElement("span");
    cl.className = "task-sheet-tag";
    cl.textContent = o.clientName;
    meta.appendChild(cl);
  }
  var tags = o.tags || [];
  for (var i = 0; i < tags.length; i++) {
    if (!tags[i]) { continue; }
    var tg = document.createElement("span");
    tg.className = "task-sheet-tag";
    tg.innerHTML = tags[i];
    meta.appendChild(tg);
  }
  box.appendChild(meta);

  // The two pills. Hidden on a done task.
  var pills = document.createElement("div");
  pills.id = "taskSheetPills";
  pills.className = "task-sheet-pills";
  var pillIds = [["working", "taskSheetPillWorking"], ["waiting_client", "taskSheetPillWaiting"]];
  for (var p = 0; p < pillIds.length; p++) {
    (function(key, id) {
      var b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.className = "task-sheet-pill";
      b.innerHTML = taskSheetBoth(TASK_SHEET_PROGRESS[key].pt, TASK_SHEET_PROGRESS[key].en);
      b.addEventListener("click", function() { taskSheetPickProgress(key); });
      pills.appendChild(b);
    })(pillIds[p][0], pillIds[p][1]);
  }
  box.appendChild(pills);

  // The due date: a date field, the date as the site prints it, and "clear".
  var dueRow = document.createElement("div");
  dueRow.className = "task-sheet-duerow";
  var dueLabel = document.createElement("label");
  dueLabel.setAttribute("for", "taskSheetDue");
  dueLabel.innerHTML = taskSheetBoth("Prazo", "Due date");
  dueRow.appendChild(dueLabel);
  var dueInput = document.createElement("input");
  dueInput.type = "date";
  dueInput.id = "taskSheetDue";
  dueInput.addEventListener("change", function() { taskSheetSaveDue(dueInput.value); });
  dueRow.appendChild(dueInput);
  var dueShown = document.createElement("span");
  dueShown.id = "taskSheetDueShown";
  dueShown.className = "task-sheet-dueshown";
  dueRow.appendChild(dueShown);
  var dueClear = document.createElement("button");
  dueClear.type = "button";
  dueClear.id = "taskSheetDueClear";
  dueClear.className = "task-sheet-link";
  dueClear.innerHTML = taskSheetBoth("remover", "clear");
  dueClear.addEventListener("click", function() { taskSheetSaveDue(""); });
  dueRow.appendChild(dueClear);
  box.appendChild(dueRow);

  var status = document.createElement("div");
  status.id = "taskSheetStatus";
  status.className = "task-sheet-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  box.appendChild(status);

  var thread = document.createElement("div");
  thread.id = "taskSheetThread";
  thread.className = "task-sheet-thread";
  box.appendChild(thread);

  var write = document.createElement("div");
  write.className = "task-sheet-write";
  var noteBox = document.createElement("textarea");
  noteBox.id = "taskSheetNoteBox";
  noteBox.maxLength = TASK_SHEET_NOTE_MAX;
  noteBox.placeholder = en ? "Write a note" : "Escreva uma nota";
  noteBox.setAttribute("aria-label", en ? "Write a note" : "Escreva uma nota");
  noteBox.value = taskSheetDrafts[s.id] || "";
  write.appendChild(noteBox);
  var addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.id = "taskSheetAdd";
  addBtn.className = "task-sheet-add";
  addBtn.innerHTML = taskSheetBoth("Adicionar nota", "Add note");
  addBtn.addEventListener("click", taskSheetAddNote);
  write.appendChild(addBtn);
  box.appendChild(write);

  ov.appendChild(box);
  ov.addEventListener("click", function(e) { if (e.target === ov) { taskSheetClose(); } });

  // Escape closes. Tab stays inside the sheet.
  s.onKey = function(e) {
    if (taskSheetNow !== s) { return; }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      taskSheetClose();
      return;
    }
    if (e.key !== "Tab") { return; }
    var all = box.querySelectorAll("button, input, textarea, a[href]");
    var can = [];
    for (var k = 0; k < all.length; k++) {
      if (!all[k].disabled && all[k].offsetParent !== null) { can.push(all[k]); }
    }
    if (!can.length) { return; }
    var first = can[0];
    var last = can[can.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", s.onKey, true);

  s.overlay = ov;
  taskSheetNow = s;
  document.body.appendChild(ov);
  taskSheetPaintPills();
  taskSheetPaintDue();
  taskSheetPaintThread();
  closeBtn.focus();

  taskSheetLoad(s);
  return true;
}
