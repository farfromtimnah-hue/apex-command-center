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
  function sortDayEvents(list) {
    return (list || []).slice().sort(function (a, b) {
      var ta = a.start_time || "";
      var tb = b.start_time || "";
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

    var firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    // The grid starts on the Sunday of the week containing day 1, so the
    // month's first row is complete rather than ragged.
    var gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());

    var wrap = document.createElement("div");
    wrap.className = "cgrid-wrap";

    var headers = document.createElement("div");
    headers.className = "cgrid-day-headers";
    for (var d = 0; d < 7; d++) {
      var h = document.createElement("div");
      h.className = "cgrid-day-header";
      h.textContent = days[d];
      headers.appendChild(h);
    }
    wrap.appendChild(headers);

    var grid = document.createElement("div");
    grid.className = "cgrid";

    var cur = new Date(gridStart);
    for (var w = 0; w < 6; w++) {
      for (var dw = 0; dw < 7; dw++) {
        var inMonth = cur.getMonth() === anchor.getMonth();
        var key = dateKey(cur);

        var cell = document.createElement("div");
        cell.className = "cgrid-cell" + (inMonth ? "" : " other-month") +
                         (cur.getTime() === today.getTime() ? " today" : "");
        cell.setAttribute("data-date", key);

        var num = document.createElement("div");
        num.className = "cgrid-day-num";
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
    renderCalendar: renderCalendar,
    onBreakpointCross: onBreakpointCross
  };
})(window);

// hook check: an edit to this file must change its ?v= key.
