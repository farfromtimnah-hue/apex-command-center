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

// "2026-07-26 14:00:00" / "2026-07-26T14:00:00" -> "07/26/2026 2:00 PM".
// Date-only input renders the date alone. Empty -> "—".
function formatDateTime(str) {
  if (!str) { return "—"; }
  var normalized = String(str).replace("T", " ").split(".")[0];
  var parts    = normalized.split(" ");
  var datePart = parts[0] || "";
  var timePart = parts[1] ? formatTime(parts[1]) : "";
  var date = formatDate(datePart);
  return timePart ? date + " " + timePart : date;
}
