// Learn (Aprenda): the switch and the address.
// enabled is OFF. While it is false the "?" button is not added, long press and
// right click do nothing, and the widget makes no network call. Turn it on by
// changing false to true here (and in ios/App/App/public/help-config.js).
// Guides and pictures are fetched from the live site, never from the app
// bundle, so a new guide never needs an iPhone build. The address matches CNAME.
(function () {
  var HELP_BASE = "https://apex.resonateai.online/";
  // Preview switch: only the browser that holds aprenda-preview = on sees the feature.
  // Used to test it on the real site before it is turned on for everyone.
  var preview = false;
  try { preview = window.localStorage.getItem("aprenda-preview") === "on"; } catch (e) { preview = false; }
  window.APEX_HELP = { enabled: preview, base: HELP_BASE };
}());
