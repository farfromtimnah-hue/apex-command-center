// Measured material rules (2026-11-07). ONE file for the Worker and the browser:
// the unit lists, extra material, pieces needed and length by width. The Worker
// imports it (worker/index.js), the pages load it with a script tag, and the
// tests require it. Nothing here guesses: an unknown unit stays "unknown", an
// empty extra percent adds nothing, a missing input gives null.
var GM_MEASURE = (function() {
  // Units are compared after lower casing, removing accents, dots and extra
  // spaces ("Sq. Ft." and "sq ft" are the same word; "m²" is "m2").
  var MEASURED_UNITS = [
    "sq ft", "sqft", "sf", "ft2", "square feet", "square foot", "sq yd", "sy", "yd2", "sq m", "m2", "square meters", "square metres", "sq", "square",
    "linear feet", "linear foot", "lin ft", "ln ft", "lf", "ft", "feet", "foot", "yd", "yard", "yards", "m", "meter", "meters", "metre", "metres",
    "cubic yards", "cubic yard", "cu yd", "cy", "yd3", "cu ft", "cubic feet", "ft3", "m3", "cubic meters",
    "pes quadrados", "pe quadrado", "pes2", "jardas quadradas", "jarda quadrada", "metro quadrado", "metros quadrados",
    "pes lineares", "pe linear", "metro linear", "metros lineares", "pe", "pes", "jarda", "jardas", "metro", "metros", "ml",
    "jardas cubicas", "jarda cubica", "metro cubico", "metros cubicos", "pes cubicos", "pe cubico"
  ];
  var COUNTED_UNITS = [
    "each", "ea", "unit", "units", "un", "pc", "pcs", "piece", "pieces", "set", "sets", "door", "doors", "window", "windows",
    "hour", "hours", "hr", "hrs", "hora", "horas", "project", "projects", "lot", "ls", "lump sum",
    "unidade", "unidades", "peca", "pecas", "porta", "portas", "janela", "janelas", "projeto", "projetos", "lote", "lotes", "conjunto", "conjuntos"
  ];
  var CALC_UNITS = {
    sqft: { kind: "area", label: "sq ft", name_en: "Square feet", name_pt: "Pés quadrados" },
    sqyd: { kind: "area", label: "sq yd", name_en: "Square yards", name_pt: "Jardas quadradas" },
    sqm: { kind: "area", label: "sq m", name_en: "Square meters", name_pt: "Metros quadrados" },
    lnft: { kind: "length", label: "ln ft", name_en: "Linear feet", name_pt: "Pés lineares" },
    cuyd: { kind: "volume", label: "cu yd", name_en: "Cubic yards", name_pt: "Jardas cúbicas" },
    cuft: { kind: "volume", label: "cu ft", name_en: "Cubic feet", name_pt: "Pés cúbicos" }
  };
  var MEASURE_KINDS = ["area", "length", "volume", "count"];
  var CALC_MAX = 100000;

  function normUnit(u) {
    if (u === null || u === undefined) { return ""; }
    return String(u).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/²/g, "2").replace(/³/g, "3").replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  }
  function round6(n) { return Math.round(n * 1000000) / 1000000; }
  function posNum(n, max) { return typeof n === "number" && isFinite(n) && n > 0 && n <= (max || CALC_MAX); }

  // "measured", "counted" or "unknown". Never a guess.
  function unitKind(u) {
    var n = normUnit(u);
    if (!n) { return "unknown"; }
    if (MEASURED_UNITS.indexOf(n) !== -1) { return "measured"; }
    if (COUNTED_UNITS.indexOf(n) !== -1) { return "counted"; }
    return "unknown";
  }
  // A choice made by hand (measure_kind) wins over the unit text.
  function effectiveKind(row) {
    var k = row && row.measure_kind;
    if (k === "area" || k === "length" || k === "volume") { return "measured"; }
    if (k === "count") { return "counted"; }
    return unitKind(row && row.unit);
  }
  function showsExtraBox(row) { return effectiveKind(row) !== "counted"; }

  // undefined = refused. null = empty (no extra material). Otherwise 0 to 100, one decimal.
  function parseExtraPercent(v) {
    if (v === null || v === undefined) { return null; }
    if (typeof v === "string") {
      var t = v.trim();
      if (t === "") { return null; }
      if (!/^\d{1,3}(\.\d)?$/.test(t)) { return undefined; }
      v = Number(t);
    }
    if (typeof v !== "number" || !isFinite(v) || v < 0 || v > 100) { return undefined; }
    if (Math.abs(v * 10 - Math.round(v * 10)) > 1e-9) { return undefined; }
    return v;
  }
  // The question "Make this your standard?" is asked only when there is no standard and a number was typed.
  function shouldAskStandard(standard, entered) {
    return (standard === null || standard === undefined) && entered !== null && entered !== undefined;
  }

  // Coverage of ONE piece in the item's own unit (sq ft for area, ft for length).
  function coveragePerPiece(kind, a, b, dimUnit) {
    if (dimUnit !== "in" && dimUnit !== "ft") { return null; }
    var div = dimUnit === "in" ? 12 : 1;
    if (kind === "area") {
      if (!posNum(a) || !posNum(b)) { return null; }
      return round6((a / div) * (b / div));
    }
    if (kind === "length") {
      if (!posNum(a)) { return null; }
      return round6(a / div);
    }
    return null;
  }
  function withExtra(qty, pct) {
    var p = typeof pct === "number" && isFinite(pct) && pct > 0 ? pct : 0;
    return round6(qty * (1 + p / 100));
  }
  // Whole sold units needed (rounded UP). A counted item never gets extra.
  function piecesNeeded(qty, pct, coveragePerSoldUnit, kind) {
    if (!posNum(qty, 100000000) || !posNum(coveragePerSoldUnit, 100000000)) { return null; }
    var q = kind === "counted" ? qty : withExtra(qty, pct);
    return Math.ceil(round6(q / coveragePerSoldUnit));
  }
  // The stored conversion (abc_units_per_apex_unit) is, in the existing code and data,
  // how many units of the ITEM one ABC unit covers (a pallet of 100 sq ft is 100): the
  // cost is the ABC price divided by it. So the wizard stores the coverage itself.
  function abcFactorFromCoverage(coverageOfOneAbcUnit) {
    return posNum(coverageOfOneAbcUnit, 100000000) ? coverageOfOneAbcUnit : null;
  }
  // The quantity on an order line: estimate quantity, plus the item's own extra,
  // divided by what one ABC unit covers, rounded UP. null = set the quantity.
  function orderQuantity(o) {
    if (!o || !posNum(o.qty, 100000000) || !posNum(o.perAbcUnit, 100000000)) { return null; }
    var q = o.kind === "counted" ? o.qty : withExtra(o.qty, o.extra);
    return Math.ceil(round6(q / o.perAbcUnit));
  }

  // Length by width. Length and width in feet, depth in inches.
  function calcQuantity(unit, len, wid, depth) {
    var u = CALC_UNITS[unit];
    if (!u || !posNum(len)) { return null; }
    var r = null;
    if (u.kind === "length") { r = len; }
    else {
      if (!posNum(wid)) { return null; }
      var area = len * wid;
      if (u.kind === "area") { r = unit === "sqft" ? area : unit === "sqyd" ? area / 9 : area * 0.09290304; }
      else {
        if (!posNum(depth, 10000)) { return null; }
        var cuft = area * (depth / 12);
        r = unit === "cuft" ? cuft : cuft / 27;
      }
    }
    return Math.round(r * 100) / 100;
  }
  function num(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function calcLabel(unit, len, wid, depth, lang) {
    var u = CALC_UNITS[unit];
    var q = calcQuantity(unit, len, wid, depth);
    if (!u || q === null) { return ""; }
    var by = lang === "pt" ? " por " : " by ";
    var eq = lang === "pt" ? " igual a " : " equals ";
    var s = num(len) + " ft";
    if (u.kind !== "length") { s += by + num(wid) + " ft"; }
    if (u.kind === "volume") { s += by + num(depth) + " in"; }
    return s + eq + num(q) + " " + u.label;
  }
  // The stored inputs of an estimate line. undefined = refused. { none: true } = no calculator on this line.
  function parseCalc(o, qty) {
    o = o || {};
    var keys = ["calc_kind", "calc_length", "calc_width", "calc_depth", "calc_unit"];
    var any = keys.some(function(k) { return o[k] !== null && o[k] !== undefined && o[k] !== ""; });
    if (!any) { return { none: true }; }
    var u = CALC_UNITS[o.calc_unit];
    if (!u) { return undefined; }
    if (o.calc_kind !== null && o.calc_kind !== undefined && o.calc_kind !== "" && o.calc_kind !== u.kind) { return undefined; }
    function opt(v) { return v === null || v === undefined || v === "" ? null : v; }
    var len = opt(o.calc_length), wid = opt(o.calc_width), dep = opt(o.calc_depth);
    if (!posNum(len)) { return undefined; }
    if (u.kind === "length" && (wid !== null || dep !== null)) { return undefined; }
    if (u.kind === "area" && dep !== null) { return undefined; }
    var q = calcQuantity(o.calc_unit, len, wid, dep);
    if (q === null) { return undefined; }
    if (typeof qty !== "number" || !isFinite(qty) || Math.abs(qty - q) > 0.011) { return undefined; }
    return { calc_kind: u.kind, calc_unit: o.calc_unit, calc_length: len, calc_width: wid, calc_depth: dep };
  }

  return {
    MEASURED_UNITS: MEASURED_UNITS, COUNTED_UNITS: COUNTED_UNITS, CALC_UNITS: CALC_UNITS, MEASURE_KINDS: MEASURE_KINDS,
    normUnit: normUnit, unitKind: unitKind, effectiveKind: effectiveKind, showsExtraBox: showsExtraBox,
    parseExtraPercent: parseExtraPercent, shouldAskStandard: shouldAskStandard,
    coveragePerPiece: coveragePerPiece, withExtra: withExtra, piecesNeeded: piecesNeeded, abcFactorFromCoverage: abcFactorFromCoverage, orderQuantity: orderQuantity,
    calcQuantity: calcQuantity, calcLabel: calcLabel, parseCalc: parseCalc
  };
})();
if (typeof module !== "undefined" && module.exports) { module.exports = GM_MEASURE; }
else if (typeof window !== "undefined") { window.GM_MEASURE = GM_MEASURE; }
