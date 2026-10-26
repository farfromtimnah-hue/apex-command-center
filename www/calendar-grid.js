// Shared month-calendar mechanics — the GRID ONLY.
//
// Extracted from calendar.html (the Apex-tier session calendar) so the client
// portal's own company calendar does not reimplement it. calendar.html has
// been in production and in daily use, and a long list of fixes exists only
// as the current state of that file: mobile layout, event-name truncation,
// time formatting, the grid's leading/trailing days. A fresh month grid
// reintroduces every one of them, so this module carries them across.
//
// WHAT IS HERE: the six-week grid, day cells, event chips, the mobile
// mini-calendar + agenda pattern, and the resize handling that switches
// between them.
//
// WHAT IS DELIBERATELY NOT HERE: anything about Apex sessions. Google Meet
// links, Fireflies transcripts, meeting categories, recurring series, the
// Apex client roster — all of that is the consulting business's own calendar
// and none of it belongs to a pool builder scheduling an installation.
// Callers supply their own events and their own chip renderer.
//
// THE MOBILE PATTERN IS NOT A NARROWER GRID. At 768px and below, calendar.html
// switches to a mini month + an agenda list for the selected day, because a
// seven-column grid with readable chips does not fit a phone. That behaviour
// lives inside calendar.html's own <style> block rather than mobile.css, so a
// page that relies on the shared stylesheet ships a broken mobile calendar.
// The matching CSS for this module is in calendar-grid.css.
//
// Dates are handled as local YYYY-MM-DD strings, never as Date objects across
// a boundary: an event on the 5th must render on the 5th regardless of the
// reader's timezone. Formatting helpers come from datetime.js — do not add
// new ones here.

(function (global) {
  "use strict";

  var DAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  var DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
                   "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  var MONTHS_EN = ["January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"];

  function padZ(n) { return n < 10 ? "0" + n : String(n); }

  // Local date key. Deliberately not toISOString(), which converts to UTC and
  // shifts an evening event onto the next day for anyone west of Greenwich.
  function dateKey(d) {
    return d.getFullYear() + "-" + padZ(d.getMonth() + 1) + "-" + padZ(d.getDate());
  }

  // A YYYY-MM-DD string to a LOCAL Date. new Date("2026-08-05") parses as UTC
  // midnight and renders as the 4th in the Americas; this does not.
  function parseDateStr(s) {
    var p = String(s || "").split("-");
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }

  function isMobileWidth() {
    return !!(global.matchMedia && global.matchMedia("(max-width: 768px)").matches);
  }

  function dayNames(en) { return en ? DAYS_EN : DAYS_PT; }
  function monthNames(en) { return en ? MONTHS_EN : MONTHS_PT; }

  // Group events by their date key. Each event needs a `date` (YYYY-MM-DD);
  // everything else is the caller's business.
  function buildDateMap(events) {
    var map = {};
    (events || []).forEach(function (ev) {
      if (!ev || !ev.date) { return; }
      if (!map[ev.date]) { map[ev.date] = []; }
      map[ev.date].push(ev);
    });
    return map;
  }

  // Events for a day, all-day first then by start time. A stable order matters:
  // without it the same day reshuffles on every re-render.
  // `time` is accepted alongside `start_time` because the Apex session rows
  // carry the former. Without it every session in a day would look untimed and
  // the day's order would change on migration — a silent behaviour change is
  // exactly what a shared module must not introduce.
  function eventStart(e) { return e.start_time || e.time || ""; }

  function sortDayEvents(list) {
    return (list || []).slice().sort(function (a, b) {
      var ta = eventStart(a);
      var tb = eventStart(b);
      if (ta === tb) { return 0; }
      if (!ta) { return -1; }   // all-day sits at the top
      if (!tb) { return 1; }
      return ta < tb ? -1 : 1;
    });
  }

  // ── Desktop: the six-week month grid ──────────────────────────────────
  //
  // opts: { anchor: Date, events: [], en: bool, renderChip: fn(ev) -> Node,
  //         onDayClick: fn(dateStr) }
  function renderMonthGrid(host, opts) {
    var anchor = opts.anchor;
    var map = buildDateMap(opts.events);
    var days = dayNames(opts.en);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    // Class names, so a page that already has grid CSS can adopt this renderer
    // without restyling a single rule. calendar.html passes its own map and
    // keeps every .cal-* rule it already had — including the two fixes that
    // exist nowhere else (chips wrap rather than ellipsis; mobile is a
    // different layout). An EXPLICIT MAP rather than a prefix, because the
    // existing names are not uniformly prefixed: the wrapper is
    // .cal-grid-wrap, not .cal-wrap, and a derived prefix would silently emit
    // a class no stylesheet matches.
    var C = opts.classes || {};
    var cWrap    = C.wrap       || "cgrid-wrap";
    var cHeaders = C.headers    || "cgrid-day-headers";
    var cHeader  = C.header     || "cgrid-day-header";
    var cGrid    = C.grid       || "cgrid";
    var cCell    = C.cell       || "cgrid-cell";
    var cDayNum  = C.dayNum     || "cgrid-day-num";

    var firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    // The grid starts on the Sunday of the week containing day 1, so the
    // month's first row is complete rather than ragged.
    var gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());

    var wrap = document.createElement("div");
    wrap.className = cWrap;

    var headers = document.createElement("div");
    headers.className = cHeaders;
    for (var d = 0; d < 7; d++) {
      var h = document.createElement("div");
      h.className = cHeader;
      h.textContent = days[d];
      headers.appendChild(h);
    }
    wrap.appendChild(headers);

    var grid = document.createElement("div");
    grid.className = cGrid;

    var cur = new Date(gridStart);
    for (var w = 0; w < 6; w++) {
      for (var dw = 0; dw < 7; dw++) {
        var inMonth = cur.getMonth() === anchor.getMonth();
        var key = dateKey(cur);

        var cell = document.createElement("div");
        cell.className = cCell + (inMonth ? "" : " other-month") +
                         (cur.getTime() === today.getTime() ? " today" : "");
        cell.setAttribute("data-date", key);

        var num = document.createElement("div");
        num.className = cDayNum;
        num.textContent = cur.getDate();
        cell.appendChild(num);

        sortDayEvents(map[key]).forEach(function (ev) {
          var chip = opts.renderChip(ev);
          if (chip) { cell.appendChild(chip); }
        });

        if (opts.onDayClick) {
          (function (k) {
            cell.onclick = function () { opts.onDayClick(k); };
          })(key);
        }

        grid.appendChild(cell);
        // +1 day via ms arithmetic, which stays correct across DST changes
        // in a way setDate(getDate()+1) does not always.
        cur = new Date(cur.getTime() + 86400000);
      }
      // Stop once the month is finished and the row is complete, so a month
      // that fits in five weeks does not render a sixth empty one.
      if (cur.getMonth() !== anchor.getMonth() && cur.getDay() === 0) { break; }
    }

    wrap.appendChild(grid);
    host.innerHTML = "";
    host.appendChild(wrap);
  }

  // ── Mobile: mini month + agenda for the selected day ──────────────────
  //
  // Not a narrower grid — see the header comment. opts adds:
  //   selectedDate (YYYY-MM-DD), onSelectDate: fn(dateStr)
  function renderMobileMonth(host, opts) {
    var anchor = opts.anchor;
    var map = buildDateMap(opts.events);
    var days = dayNames(opts.en);
    var months = monthNames(opts.en);
    var todayStr = dateKey(new Date());

    var last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    var range = [];
    for (var i = 1; i <= last; i++) {
      range.push(anchor.getFullYear() + "-" + padZ(anchor.getMonth() + 1) + "-" + padZ(i));
    }

    // Keep the selection while it is still in range; otherwise today if this
    // is today's month, else the 1st. Without this, paging months leaves the
    // agenda pointing at a day that is no longer on screen.
    var sel = opts.selectedDate;
    if (range.indexOf(sel) === -1) {
      sel = (range.indexOf(todayStr) !== -1) ? todayStr : range[0];
    }

    host.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "cgrid-mini-wrap";

    var dowRow = document.createElement("div");
    dowRow.className = "cgrid-mini-dow-row";
    for (var d = 0; d < 7; d++) {
      var dow = document.createElement("div");
      dow.className = "cgrid-mini-dow";
      dow.textContent = days[d];
      dowRow.appendChild(dow);
    }
    wrap.appendChild(dowRow);

    var row = document.createElement("div");
    row.className = "cgrid-mini-row";
    // Pad so day 1 lands under its own weekday, same as the desktop grid.
    var firstDow = new Date(anchor.getFullYear(), anchor.getMonth(), 1).getDay();
    for (var p = 0; p < firstDow; p++) { row.appendChild(document.createElement("div")); }

    range.forEach(function (dstr) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cgrid-mini-cell" +
        (dstr === todayStr ? " is-today" : "") +
        (dstr === sel ? " is-selected" : "");

      var num = document.createElement("span");
      num.className = "cgrid-mini-num";
      num.textContent = parseInt(dstr.slice(8), 10);
      cell.appendChild(num);

      // A dot, not a count: the agenda below carries the detail, and a number
      // in a 30px circle is unreadable on a phone.
      var dot = document.createElement("span");
      dot.className = "cgrid-mini-dot" + ((map[dstr] && map[dstr].length) ? " has-events" : "");
      cell.appendChild(dot);

      cell.onclick = function () { if (opts.onSelectDate) { opts.onSelectDate(dstr); } };
      row.appendChild(cell);
    });
    wrap.appendChild(row);
    host.appendChild(wrap);

    // Agenda for the selected day.
    var selD = parseDateStr(sel);
    var head = document.createElement("div");
    head.className = "cgrid-agenda-head";
    head.textContent = days[selD.getDay()] + ", " + padZ(selD.getDate()) + " " +
                       months[selD.getMonth()] + " " + selD.getFullYear();
    host.appendChild(head);

    var list = document.createElement("div");
    list.className = "cgrid-agenda-list";
    var evs = sortDayEvents(map[sel]);
    if (!evs.length) {
      var empty = document.createElement("div");
      empty.className = "cgrid-empty";
      empty.textContent = opts.emptyText || (opts.en ? "Nothing scheduled." : "Nada agendado.");
      list.appendChild(empty);
    } else {
      evs.forEach(function (ev) {
        var chip = opts.renderChip(ev, true);   // true = agenda (roomier) form
        if (chip) { list.appendChild(chip); }
      });
    }
    host.appendChild(list);
  }

  // ── Week / Day: hour grid + timed-block overlay ────────────────────────
  //
  // Ported from calendar.html's renderWeek/renderDay (the Apex-tier session
  // calendar), which has been in daily production use — this keeps the same
  // geometry (HOUR_PX, the dynamic hour window, the greedy column packer for
  // overlapping timed events) rather than reinventing it. Generalized to the
  // same renderChip contract as the month grid: a timed event (any `start_time`
  // present) goes through the absolutely-positioned overlay; an all-day event
  // (no `start_time`) goes in the "no time" row above the hour grid, through
  // the SAME renderChip callback the month grid already uses (so job-band,
  // derived, lead, club and apex chips keep their existing look).
  //
  // No multi-day spanning: a job band is already one chip per day server-side
  // (gmDerivedJobEvents), so each day's "no time" row simply gets that day's
  // chip, exactly as the month grid already does.

  var HOUR_PX = 52;
  var DEFAULT_HOUR_START = 7;
  var DEFAULT_HOUR_END   = 21;

  function hhmmToMinutes(hhmm) {
    if (!hhmm) { return null; }
    var parts = String(hhmm).split(":");
    var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) { return null; }
    return h * 60 + m;
  }

  function endTimeHHMM(ev) {
    var v = ev.end_time;
    if (!v) { return null; }
    if (String(v).indexOf("T") !== -1) { return String(v).slice(11, 16); }
    return String(v).slice(0, 5);
  }

  function eventMinuteSpan(ev) {
    var startMin = hhmmToMinutes(ev.start_time);
    if (startMin === null) { return null; }
    var endMin = hhmmToMinutes(endTimeHHMM(ev));
    if (endMin === null) { endMin = startMin + 60; }
    if (endMin <= startMin) { endMin = 24 * 60; }
    return { start: startMin, end: endMin };
  }

  // The hour window stretches to cover every timed event being drawn, so an
  // early or late outlier always has a row rather than being clipped away.
  function hoursFor(events) {
    var startH = DEFAULT_HOUR_START, endH = DEFAULT_HOUR_END;
    (events || []).forEach(function (ev) {
      var span = eventMinuteSpan(ev);
      if (!span) { return; }
      var sh = Math.floor(span.start / 60);
      var eh = Math.ceil(span.end / 60) - 1;
      if (sh < startH) { startH = Math.max(0, sh); }
      if (eh > endH) { endH = Math.min(23, eh); }
    });
    var out = [];
    for (var h = startH; h <= endH; h++) { out.push(h); }
    return out;
  }

  // Greedy interval-graph column packer: two overlapping timed events sit
  // side by side instead of one hiding the other.
  function layoutTimedEvents(events) {
    var items = [];
    (events || []).forEach(function (ev) {
      var span = eventMinuteSpan(ev);
      if (!span) { return; }
      items.push({ ev: ev, start: span.start, end: span.end, col: 0, cols: 1 });
    });
    items.sort(function (a, b) {
      if (a.start !== b.start) { return a.start - b.start; }
      return b.end - a.end;
    });

    var cluster = [], clusterEnd = -1, colEnds = [];
    function closeCluster() {
      for (var c = 0; c < cluster.length; c++) { cluster[c].cols = colEnds.length || 1; }
      cluster = []; colEnds = []; clusterEnd = -1;
    }
    items.forEach(function (it) {
      if (cluster.length && it.start >= clusterEnd) { closeCluster(); }
      var placed = false;
      for (var k = 0; k < colEnds.length; k++) {
        if (it.start >= colEnds[k]) { it.col = k; colEnds[k] = it.end; placed = true; break; }
      }
      if (!placed) { it.col = colEnds.length; colEnds.push(it.end); }
      cluster.push(it);
      if (it.end > clusterEnd) { clusterEnd = it.end; }
    });
    closeCluster();
    return items;
  }

  // Builds one day column's absolutely-positioned overlay of timed blocks.
  // opts.renderTimedChip(ev, cols) -> Node, sized/positioned by the caller
  // (the caller only supplies the chip's CONTENT; position/size are set here
  // so every runtime's chip stays visually consistent).
  function buildTimedOverlay(events, hours, renderTimedChip) {
    var gridStartMin = hours[0] * 60;
    var gridEndMin = (hours[hours.length - 1] + 1) * 60;
    var overlay = document.createElement("div");
    overlay.className = "cgrid-day-col-overlay";
    layoutTimedEvents(events).forEach(function (it) {
      if (it.end <= gridStartMin || it.start >= gridEndMin) { return; }
      var top = Math.max(it.start, gridStartMin);
      var bottom = Math.min(it.end, gridEndMin);
      var topPx = ((top - gridStartMin) / 60) * HOUR_PX;
      var heightPx = Math.max(((bottom - top) / 60) * HOUR_PX, 18);
      var widthPct = 100 / it.cols;
      var block = renderTimedChip(it.ev, it.cols);
      if (!block) { return; }
      block.style.position = "absolute";
      block.style.top = topPx + "px";
      block.style.height = (heightPx - 2) + "px";
      block.style.left = (it.col * widthPct) + "%";
      block.style.width = "calc(" + widthPct + "% - 3px)";
      overlay.appendChild(block);
    });
    return overlay;
  }

  // Measures the real header height so overlay row 0 lines up with the first
  // hour row — the header/no-time rows are content-sized (bilingual labels
  // wrap differently), so this cannot be a hardcoded offset.
  function alignOverlayHost(overlayHost, firstHourLabel) {
    if (!overlayHost || !firstHourLabel) { return; }
    overlayHost.style.top = firstHourLabel.offsetTop + "px";
  }

  // opts: { anchor: Date (any day in the week), events: [], en: bool,
  //         renderChip: fn(ev) -> Node, renderTimedChip: fn(ev, cols) -> Node,
  //         noTimeLabel: {pt, en}, emptyText, onDayClick: fn(dateStr) }
  function renderWeekGrid(host, opts) {
    var days = dayNames(opts.en);
    var weekStart = new Date(opts.anchor);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    var weekDates = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(weekStart); d.setDate(d.getDate() + i);
      weekDates.push(dateKey(d));
    }
    var map = buildDateMap(opts.events);
    var todayStr = dateKey(new Date());

    var weekTimed = [];
    weekDates.forEach(function (k) { (map[k] || []).forEach(function (ev) { if (ev.start_time) { weekTimed.push(ev); } }); });
    var hours = hoursFor(weekTimed);

    var wrap = document.createElement("div");
    wrap.className = "cgrid-week-wrap";
    var grid = document.createElement("div");
    grid.className = "cgrid-week-grid";

    grid.appendChild(document.createElement("div")).className = "cgrid-week-time-gutter";
    weekDates.forEach(function (k, i) {
      var dayNum = parseInt(k.slice(8), 10);
      var head = document.createElement("div");
      head.className = "cgrid-week-day-head" + (k === todayStr ? " today" : "");
      head.textContent = days[i] + " " + padZ(dayNum);
      grid.appendChild(head);
    });

    var noTimeLabel = opts.noTimeLabel || { pt: "Sem horário", en: "No time" };
    var untimedGutter = document.createElement("div");
    untimedGutter.className = "cgrid-week-time-gutter";
    untimedGutter.textContent = opts.en ? noTimeLabel.en : noTimeLabel.pt;
    grid.appendChild(untimedGutter);
    weekDates.forEach(function (k) {
      var untimedSlot = document.createElement("div");
      untimedSlot.className = "cgrid-week-slot";
      sortDayEvents((map[k] || []).filter(function (ev) { return !ev.start_time; })).forEach(function (ev) {
        var chip = opts.renderChip(ev);
        if (chip) { untimedSlot.appendChild(chip); }
      });
      if (opts.onDayClick) { (function (dk) { untimedSlot.onclick = function () { opts.onDayClick(dk); }; })(k); }
      grid.appendChild(untimedSlot);
    });

    var firstHourLabel = null;
    hours.forEach(function (h, hi) {
      var timeLabel = document.createElement("div");
      timeLabel.className = "cgrid-week-time-label";
      timeLabel.textContent = padZ(h) + ":00";
      grid.appendChild(timeLabel);
      if (hi === 0) { firstHourLabel = timeLabel; }
      weekDates.forEach(function (k) {
        var slot = document.createElement("div");
        slot.className = "cgrid-week-slot";
        if (opts.onDayClick) { (function (dk) { slot.onclick = function () { opts.onDayClick(dk); }; })(k); }
        grid.appendChild(slot);
      });
    });

    wrap.appendChild(grid);

    var overlayHost = document.createElement("div");
    overlayHost.className = "cgrid-week-overlay-host";
    overlayHost.style.height = (hours.length * HOUR_PX) + "px";
    overlayHost.appendChild(document.createElement("div"));
    weekDates.forEach(function (k) {
      var timed = (map[k] || []).filter(function (ev) { return !!ev.start_time; });
      var col = document.createElement("div");
      col.className = "cgrid-week-overlay-col";
      col.appendChild(buildTimedOverlay(timed, hours, opts.renderTimedChip || opts.renderChip));
      overlayHost.appendChild(col);
    });
    wrap.appendChild(overlayHost);

    host.innerHTML = "";
    host.appendChild(wrap);
    alignOverlayHost(overlayHost, firstHourLabel);

    var total = 0;
    weekDates.forEach(function (k) { total += (map[k] || []).length; });
    if (!total) {
      var empty = document.createElement("div");
      empty.className = "cgrid-empty";
      empty.textContent = opts.emptyText || (opts.en ? "Nothing scheduled." : "Nada agendado.");
      grid.appendChild(empty);
    }
  }

  // opts: same shape as renderWeekGrid, anchor is the single day to show.
  function renderDayGrid(host, opts) {
    var days = dayNames(opts.en);
    var months = monthNames(opts.en);
    var key = dateKey(opts.anchor);
    var todayStr = dateKey(new Date());
    var map = buildDateMap(opts.events);
    var dayEvents = map[key] || [];
    var hours = hoursFor(dayEvents.filter(function (ev) { return !!ev.start_time; }));

    var wrap = document.createElement("div");
    wrap.className = "cgrid-day-wrap";
    var grid = document.createElement("div");
    grid.className = "cgrid-day-grid";

    grid.appendChild(document.createElement("div")).className = "cgrid-week-time-gutter";
    var headLabel = document.createElement("div");
    headLabel.className = "cgrid-day-head-label" + (key === todayStr ? " today" : "");
    headLabel.textContent = days[opts.anchor.getDay()] + ", " + padZ(opts.anchor.getDate()) + " " + months[opts.anchor.getMonth()];
    grid.appendChild(headLabel);

    var noTimeLabel = opts.noTimeLabel || { pt: "Sem horário", en: "No time" };
    var untimedGutter = document.createElement("div");
    untimedGutter.className = "cgrid-week-time-gutter";
    untimedGutter.textContent = opts.en ? noTimeLabel.en : noTimeLabel.pt;
    grid.appendChild(untimedGutter);
    var untimedSlot = document.createElement("div");
    untimedSlot.className = "cgrid-day-slot";
    sortDayEvents(dayEvents.filter(function (ev) { return !ev.start_time; })).forEach(function (ev) {
      var chip = opts.renderChip(ev);
      if (chip) { untimedSlot.appendChild(chip); }
    });
    grid.appendChild(untimedSlot);

    var firstHourLabel = null;
    hours.forEach(function (h, hi) {
      var timeLabel = document.createElement("div");
      timeLabel.className = "cgrid-day-time-label";
      timeLabel.textContent = padZ(h) + ":00";
      grid.appendChild(timeLabel);
      if (hi === 0) { firstHourLabel = timeLabel; }
      var slot = document.createElement("div");
      slot.className = "cgrid-day-slot";
      grid.appendChild(slot);
    });

    wrap.appendChild(grid);

    var overlayHost = document.createElement("div");
    overlayHost.className = "cgrid-day-overlay-host";
    overlayHost.style.height = (hours.length * HOUR_PX) + "px";
    overlayHost.appendChild(document.createElement("div"));
    var col = document.createElement("div");
    col.className = "cgrid-day-overlay-col";
    col.appendChild(buildTimedOverlay(dayEvents.filter(function (ev) { return !!ev.start_time; }), hours, opts.renderTimedChip || opts.renderChip));
    overlayHost.appendChild(col);
    wrap.appendChild(overlayHost);

    host.innerHTML = "";
    host.appendChild(wrap);
    alignOverlayHost(overlayHost, firstHourLabel);

    if (!dayEvents.length) {
      var empty = document.createElement("div");
      empty.className = "cgrid-empty";
      empty.textContent = opts.emptyText || (opts.en ? "Nothing scheduled." : "Nada agendado.");
      grid.appendChild(empty);
    }
  }

  // Picks the right renderer for the current width. Callers use this rather
  // than choosing themselves, so the breakpoint lives in exactly one place.
  function renderCalendar(host, opts) {
    if (isMobileWidth()) { renderMobileMonth(host, opts); }
    else { renderMonthGrid(host, opts); }
  }

  // Re-render when a resize CROSSES the breakpoint, so a rotated phone or a
  // resized window always shows the right pattern. Only on a crossing: firing
  // on every resize event would rebuild the grid continuously during a drag.
  function onBreakpointCross(fn) {
    var was = isMobileWidth();
    global.addEventListener("resize", function () {
      var now = isMobileWidth();
      if (now === was) { return; }
      was = now;
      fn(now);
    });
  }

  global.CalendarGrid = {
    dateKey: dateKey,
    parseDateStr: parseDateStr,
    padZ: padZ,
    isMobileWidth: isMobileWidth,
    dayNames: dayNames,
    monthNames: monthNames,
    buildDateMap: buildDateMap,
    sortDayEvents: sortDayEvents,
    renderMonthGrid: renderMonthGrid,
    renderMobileMonth: renderMobileMonth,
    renderWeekGrid: renderWeekGrid,
    renderDayGrid: renderDayGrid,
    renderCalendar: renderCalendar,
    onBreakpointCross: onBreakpointCross
  };
})(window);

// hook check: an edit to this file must change its ?v= key.
