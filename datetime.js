// Shared date/time display formatting — American convention (MM/DD/YYYY,
// 12-hour AM/PM) in every language. The PT/EN toggle must never change how
// a date or time renders: two people reading the same screen see the same
// value. Display only — stored data and outbound API payloads (D1, Google
// Calendar, Zoho) stay ISO dates and 24-hour times.

// "2026-07-26" -> "07/26/2026". Also accepts a full ISO datetime and
// formats its date portion. Empty -> "—"; unparseable -> input unchanged.
function formatDate(str) {
  if (!str) { return "—"; }
  var s = String(str).replace("T", " ").split(" ")[0];
  var p = s.split("-");
  if (p.length !== 3 || !p[0] || !p[1] || !p[2]) { return str; }
  return p[1] + "/" + p[2] + "/" + p[0];
}

// "14:00" / "14:00:00" -> "2:00 PM". Also accepts a full ISO datetime and
// formats its time portion (the Google Calendar sync stores full datetimes
// in sessions.end_time while the app's own writes store plain "HH:MM").
// Empty -> ""; unparseable -> input unchanged.
function formatTime(t) {
  if (!t) { return ""; }
  var s = String(t);
  var ti = s.indexOf("T");
  if (ti !== -1) { s = s.slice(ti + 1); }
  var p = s.split(":");
  if (p.length < 2) { return t; }
  var h = parseInt(p[0], 10);
  var m = p[1].slice(0, 2);
  if (isNaN(h) || !/^\d\d$/.test(m)) { return t; }
  var suffix = h >= 12 ? " PM" : " AM";
  var h12 = h % 12;
  if (h12 === 0) { h12 = 12; }
  return h12 + ":" + m + suffix;
}

// D1 stores audit timestamps in UTC (every datetime('now') column: logged_at,
// created_at, stage_changed_at, next_step_set_at, ...). formatDateTime below
// does pure string surgery and applies NO timezone conversion, so feeding it a
// UTC value renders the UTC clock: a contact logged at 10:08 PM Eastern shows
// as "2:08 AM" the NEXT DAY. That four-hour error is not hypothetical — it has
// already caused a real timeline to be misread.
//
// Use this for any stored-UTC timestamp. formatDateTime stays as-is for values
// that are already local wall-clock time — session date/time, which are
// entered and displayed as the time of the meeting itself and must NOT shift.
//
// Eastern is hardcoded on purpose: Apex operates on one clock, and the display
// must not change depending on where the person reading it happens to be.
// Intl handles EDT/EST, so this is correct across the DST boundary.
function formatDateTimeUTC(str) {
  if (!str) { return "—"; }
  var s = String(str).replace(" ", "T").split(".")[0];
  // A bare D1 timestamp carries no zone designator; without the "Z" the
  // browser would parse it as LOCAL time and the conversion would be a no-op
  // for Eastern users and wrong by the offset for everyone else.
  if (!/[Zz]|[+-]\d\d:?\d\d$/.test(s)) { s += "Z"; }
  var d = new Date(s);
  if (isNaN(d.getTime())) { return formatDateTime(str); }
  try {
    var p = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "numeric", minute: "2-digit", hour12: true
    }).formatToParts(d).reduce(function (acc, part) {
      acc[part.type] = part.value; return acc;
    }, {});
    return p.month + "/" + p.day + "/" + p.year + " " +
           p.hour + ":" + p.minute + " " + (p.dayPeriod || "").toUpperCase();
  } catch (e) {
    return formatDateTime(str);   // Intl unavailable: better raw than blank
  }
}

// "2026-07-26 14:00:00" / "2026-07-26T14:00:00" -> "07/26/2026 2:00 PM".
// Date-only input renders the date alone. Empty -> "—".
//
// NO timezone conversion — see formatDateTimeUTC above for stored-UTC values.
function formatDateTime(str) {
  if (!str) { return "—"; }
  var normalized = String(str).replace("T", " ").split(".")[0];
  var parts    = normalized.split(" ");
  var datePart = parts[0] || "";
  var timePart = parts[1] ? formatTime(parts[1]) : "";
  var date = formatDate(datePart);
  return timePart ? date + " " + timePart : date;
}
