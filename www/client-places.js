/* Shared client owners editor + State/City type-ahead
   (job 2026-10-14_client_owners_state_city).

   ONE copy used by every page that lets staff type a client's owners or
   location: client.html (overview card, inline edit) and calendar.html
   (Quick Add Client). Needs data/us-br-states.js loaded first (same
   ?v= cache-buster rule as every other shared script).

   var, not const/let; regular functions; ASCII only (\u escapes for accents),
   matching the rest of the codebase.

   Public API:
     ClientPlaces.ownersEditor(mountEl, initialOwners, opts)
       initialOwners: array of {first,last} (owners_json, parsed) or [].
       opts.legacyText: the old free-text owners string, shown read-only
         above the editor ONLY when initialOwners is empty and this is set.
       opts.onChange(rowsState) fires on every keystroke/add/remove; the
       caller reads ClientPlaces.ownersRead(mountEl) when it wants to save.
     ClientPlaces.ownersRead(mountEl)
       Returns { ownersJson: [...] | null, legacyOwners: string | null,
                 error: {pt,en} | null }. Mirrors the validation rules in B2:
       a half-filled row blocks the whole save with its own inline message
       (not returned as error -- the caller should not proceed, the message
       is already shown beside the row); a save with no valid row at all
       returns error = "Informe pelo menos um sócio" / "Enter at least
       one owner". When valid, ownersJson is the array and legacyOwners is
       the derived legacy string (B3 join rule).

     ClientPlaces.stateCityControl(mountEl, initialStateCode, initialCity, opts)
       Builds the State box then the City box (C2/C3). opts.lang() should
       return true for English, false for Portuguese (matches the page's
       own isEn()/lang test). opts.onStateChange(code) optional.
     ClientPlaces.stateCityRead(mountEl)
       Returns { stateCode: "US-WA"|null, city: string, error: {pt,en}|null }.
       error is set only when text was typed in the state box that does not
       match a listed state (C2); an unmatched city is NOT an error (C3).
*/
(function(global) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function stripAccents(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function norm(s) {
    return stripAccents(String(s || "")).toLowerCase();
  }

  // ── Owners editor ──────────────────────────────────────────────────────
  var MAX_OWNERS = 6;
  var NAME_MAX = 60;

  function ownersEditor(mount, initialOwners, opts) {
    opts = opts || {};
    var lang = opts.lang || function() { return false; };
    var rows = (initialOwners && initialOwners.length) ? initialOwners.map(function(o) {
      return { first: o.first || "", last: o.last || "" };
    }) : [{ first: "", last: "" }];

    mount._cpOwnersRows = rows;
    mount._cpOwnersLegacy = opts.legacyText || "";
    mount._cpOwnersLegacyShown = !!((!initialOwners || !initialOwners.length) && opts.legacyText);
    mount._cpOnChange = opts.onChange || null;

    renderOwnersEditor(mount);
  }

  function renderOwnersEditor(mount) {
    var en = mount._cpLangFn ? mount._cpLangFn() : (document.body.classList.contains("lang-en"));
    var rows = mount._cpOwnersRows;
    var h = "";

    if (mount._cpOwnersLegacyShown) {
      h += '<div class="cp-owners-legacy">' +
        '<div class="cp-owners-legacy-label">' + (en ? "Owner(s) (old)" : "Sócios (antigo)") + '</div>' +
        '<div class="cp-owners-legacy-text">' + esc(mount._cpOwnersLegacy) + '</div></div>';
    }

    rows.forEach(function(r, i) {
      var err = r._err;
      h += '<div class="cp-owner-row" data-idx="' + i + '">' +
        '<input type="text" class="cp-owner-first" data-idx="' + i + '" placeholder="' + (en ? "First name" : "Primeiro nome") + '" value="' + esc(r.first) + '" maxlength="' + NAME_MAX + '">' +
        '<input type="text" class="cp-owner-last" data-idx="' + i + '" placeholder="' + (en ? "Last name" : "Sobrenome") + '" value="' + esc(r.last) + '" maxlength="' + NAME_MAX + '">' +
        (rows.length > 1 ? '<button type="button" class="cp-owner-remove" data-idx="' + i + '" aria-label="' + (en ? "Remove" : "Remover") + '">✕</button>' : '') +
        (err ? '<div class="cp-owner-err">' + esc(en ? err.en : err.pt) + '</div>' : '') +
        '</div>';
    });

    h += '<button type="button" class="cp-owner-add"' + (rows.length >= MAX_OWNERS ? ' disabled' : '') + '>' +
      (en ? "+ Add owner" : "+ Adicionar sócio") + '</button>';
    if (mount._cpOwnersError) {
      h += '<div class="cp-owners-top-err">' + esc(en ? mount._cpOwnersError.en : mount._cpOwnersError.pt) + '</div>';
    }

    mount.innerHTML = h;

    var firsts = mount.querySelectorAll(".cp-owner-first");
    var lasts = mount.querySelectorAll(".cp-owner-last");
    for (var i = 0; i < firsts.length; i++) {
      firsts[i].addEventListener("input", makeFieldHandler(mount, "first"));
      lasts[i].addEventListener("input", makeFieldHandler(mount, "last"));
    }
    var removes = mount.querySelectorAll(".cp-owner-remove");
    for (var j = 0; j < removes.length; j++) {
      removes[j].addEventListener("click", function(e) {
        var idx = parseInt(e.currentTarget.getAttribute("data-idx"), 10);
        mount._cpOwnersRows.splice(idx, 1);
        renderOwnersEditor(mount);
        fireChange(mount);
      });
    }
    var addBtn = mount.querySelector(".cp-owner-add");
    if (addBtn) {
      addBtn.addEventListener("click", function() {
        if (mount._cpOwnersRows.length >= MAX_OWNERS) { return; }
        mount._cpOwnersRows.push({ first: "", last: "" });
        renderOwnersEditor(mount);
        fireChange(mount);
      });
    }
  }

  function makeFieldHandler(mount, which) {
    return function(e) {
      var idx = parseInt(e.target.getAttribute("data-idx"), 10);
      var row = mount._cpOwnersRows[idx];
      if (!row) { return; }
      row[which] = e.target.value;
      delete row._err;
      mount._cpOwnersError = null;
      fireChange(mount);
    };
  }

  function fireChange(mount) {
    if (mount._cpOnChange) { mount._cpOnChange(mount._cpOwnersRows); }
  }

  // B3: legacy string join rule.
  function joinOwnerNames(names) {
    if (names.length === 1) { return names[0]; }
    if (names.length === 2) { return names[0] + " e " + names[1]; }
    return names.slice(0, -1).join(", ") + " e " + names[names.length - 1];
  }

  // Validates and returns the save payload, per B2/B3. Mutates row._err for
  // half-filled rows and re-renders so the inline message shows; does NOT
  // re-render for the "no valid rows" case (caller shows error at the top).
  function ownersRead(mount) {
    var rows = mount._cpOwnersRows || [];
    var anyHalf = false;
    var valid = [];
    rows.forEach(function(r) {
      var first = (r.first || "").trim().slice(0, NAME_MAX);
      var last = (r.last || "").trim().slice(0, NAME_MAX);
      delete r._err;
      if (!first && !last) { return; } // blank row: dropped silently
      if (!first || !last) {
        r._err = { pt: "Informe nome e sobrenome", en: "Enter first and last name" };
        anyHalf = true;
        return;
      }
      valid.push({ first: first, last: last });
    });

    if (anyHalf) {
      renderOwnersEditor(mount);
      return { ownersJson: null, legacyOwners: null, error: null, blocked: true };
    }
    if (!valid.length) {
      mount._cpOwnersError = { pt: "Informe pelo menos um sócio", en: "Enter at least one owner" };
      renderOwnersEditor(mount);
      return { ownersJson: null, legacyOwners: null, error: mount._cpOwnersError, blocked: true };
    }
    mount._cpOwnersError = null;
    var legacy = joinOwnerNames(valid.map(function(o) { return (o.first + " " + o.last).trim(); }));
    return { ownersJson: valid, legacyOwners: legacy, error: null, blocked: false };
  }

  // Render "First Last, First Last" for a display-only context (B1 display
  // mode, and anywhere a list/card shows owners_json).
  function ownersDisplay(ownersJson) {
    if (!ownersJson || !ownersJson.length) { return ""; }
    return ownersJson.map(function(o) { return (o.first + " " + o.last).trim(); }).join(", ");
  }

  // ── State + City controls ──────────────────────────────────────────────

  function statesList() {
    return (global.APEX_PLACES_STATES || []);
  }
  function stateByCode(code) {
    var list = statesList();
    for (var i = 0; i < list.length; i++) { if (list[i].code === code) { return list[i]; } }
    return null;
  }
  function stateName(code, en) {
    var s = stateByCode(code);
    if (!s) { return ""; }
    return en ? s.nameEn : s.namePt;
  }
  // Matches the start of any WORD of the PT or EN name, ignoring accents.
  function stateMatches(s, query) {
    var q = norm(query);
    if (!q) { return true; }
    var hay = norm(s.namePt) + " " + norm(s.nameEn);
    var words = hay.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (words[i].indexOf(q) === 0) { return true; }
    }
    return false;
  }

  function stateCityControl(mount, initialStateCode, initialCity, opts) {
    opts = opts || {};
    mount._cpLangFn = opts.lang || function() { return document.body.classList.contains("lang-en"); };
    mount._cpOnStateChange = opts.onStateChange || null;
    mount._cpStateCode = initialStateCode || null;
    mount._cpStateQuery = initialStateCode ? stateName(initialStateCode, mount._cpLangFn()) : "";
    mount._cpCity = initialCity || "";
    mount._cpStateError = null;
    mount._cpCityList = null; // loaded lazily once a state is chosen
    mount._cpNoCity = !!opts.noCity; // D2: the Apex contract builder has no City box, State only
    mount._cpCountryFilter = opts.countryFilter || null; // D2: "US" restricts suggestions to US states

    renderStateCity(mount);
    if (!mount._cpNoCity && mount._cpStateCode) { loadCityList(mount, mount._cpStateCode); }
  }

  function renderStateCity(mount) {
    var en = mount._cpLangFn();
    var h = '<div class="cp-state-wrap">' +
      '<input type="text" class="cp-state-input" autocomplete="off" placeholder="' + (en ? "Type a state..." : "Digite um estado...") + '" value="' + esc(mount._cpStateQuery) + '">' +
      '<div class="cp-state-suggestions" hidden></div>' +
      (mount._cpStateError ? '<div class="cp-owner-err">' + esc(en ? mount._cpStateError.en : mount._cpStateError.pt) + '</div>' : '') +
      '</div>';
    if (!mount._cpNoCity) {
      h += '<div class="cp-city-wrap">' +
        '<input type="text" class="cp-city-input" autocomplete="off"' + (mount._cpStateCode ? '' : ' disabled') +
        ' placeholder="' + (mount._cpStateCode ? (en ? "Type a city..." : "Digite uma cidade...") : (en ? "Choose the state first" : "Escolha o estado primeiro")) + '"' +
        ' value="' + esc(mount._cpCity) + '">' +
        '<div class="cp-city-suggestions" hidden></div>' +
        '</div>';
    }
    mount.innerHTML = h;

    var stateInput = mount.querySelector(".cp-state-input");
    var stateSugg = mount.querySelector(".cp-state-suggestions");
    var cityInput = mount.querySelector(".cp-city-input");
    var citySugg = mount.querySelector(".cp-city-suggestions");

    function renderStateSuggestions(filterOpenOnFocus) {
      var q = stateInput.value;
      var list = statesList().filter(function(s) { return stateMatches(s, q); });
      if (mount._cpCountryFilter) { list = list.filter(function(s) { return s.country === mount._cpCountryFilter; }); }
      if (!list.length) { stateSugg.hidden = true; return; }
      var en2 = mount._cpLangFn();
      var us = list.filter(function(s) { return s.country === "US"; });
      var br = list.filter(function(s) { return s.country === "BR"; });
      var html = "";
      if (us.length) {
        html += '<div class="cp-suggest-group">' + (en2 ? "United States" : "Estados Unidos") + '</div>';
        us.forEach(function(s) { html += '<div class="cp-suggest-item" data-code="' + s.code + '">' + esc(en2 ? s.nameEn : s.namePt) + '</div>'; });
      }
      if (br.length) {
        html += '<div class="cp-suggest-group">' + (en2 ? "Brazil" : "Brasil") + '</div>';
        br.forEach(function(s) { html += '<div class="cp-suggest-item" data-code="' + s.code + '">' + esc(en2 ? s.nameEn : s.namePt) + '</div>'; });
      }
      stateSugg.innerHTML = html;
      stateSugg.hidden = false;
    }

    stateInput.addEventListener("input", function() {
      mount._cpStateQuery = stateInput.value;
      mount._cpStateError = null;
      // Typing again un-commits any previously chosen state until a
      // suggestion is clicked/chosen again, per C2 ("text that does not
      // match a state is not saved").
      if (!stateByCode(mount._cpStateCode) || stateName(mount._cpStateCode, mount._cpLangFn()) !== stateInput.value) {
        mount._cpStateCode = null;
      }
      renderStateSuggestions();
    });
    stateInput.addEventListener("focus", function() { renderStateSuggestions(); });
    stateInput.addEventListener("blur", function() {
      setTimeout(function() { stateSugg.hidden = true; }, 150);
    });
    stateInput.addEventListener("keydown", function(e) {
      var items = stateSugg.querySelectorAll(".cp-suggest-item");
      var active = stateSugg.querySelector(".cp-suggest-item.active");
      var idx = active ? Array.prototype.indexOf.call(items, active) : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (active) { active.classList.remove("active"); }
        idx = Math.min(items.length - 1, idx + 1);
        if (items[idx]) { items[idx].classList.add("active"); items[idx].scrollIntoView({ block: "nearest" }); }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (active) { active.classList.remove("active"); }
        idx = Math.max(0, idx - 1);
        if (items[idx]) { items[idx].classList.add("active"); items[idx].scrollIntoView({ block: "nearest" }); }
      } else if (e.key === "Enter") {
        if (active) {
          e.preventDefault();
          chooseState(mount, active.getAttribute("data-code"), stateInput, stateSugg, cityInput);
        }
      } else if (e.key === "Escape") {
        stateSugg.hidden = true;
      }
    });
    stateSugg.addEventListener("mousedown", function(e) {
      var item = e.target.closest ? e.target.closest(".cp-suggest-item") : null;
      if (!item) { return; }
      e.preventDefault();
      chooseState(mount, item.getAttribute("data-code"), stateInput, stateSugg, cityInput);
    });

    function renderCitySuggestions() {
      if (!cityInput || !citySugg) { return; }
      if (!mount._cpStateCode) { citySugg.hidden = true; return; }
      var q = norm(cityInput.value);
      var list = mount._cpCityList || [];
      if (!q) {
        citySugg.innerHTML = "";
        citySugg.hidden = true;
        return;
      }
      var starts = [], contains = [];
      for (var i = 0; i < list.length && (starts.length + contains.length) < 200; i++) {
        var n = norm(list[i]);
        if (n.indexOf(q) === 0) { starts.push(list[i]); }
        else if (n.indexOf(q) !== -1) { contains.push(list[i]); }
      }
      var shown = starts.concat(contains).slice(0, 8);
      if (!shown.length) { citySugg.hidden = true; return; }
      citySugg.innerHTML = shown.map(function(c) { return '<div class="cp-suggest-item" data-city="' + esc(c) + '">' + esc(c) + '</div>'; }).join("");
      citySugg.hidden = false;
    }
    if (cityInput) {
      cityInput.addEventListener("input", function() {
        mount._cpCity = cityInput.value;
        renderCitySuggestions();
      });
      cityInput.addEventListener("focus", function() { renderCitySuggestions(); });
      cityInput.addEventListener("blur", function() { setTimeout(function() { citySugg.hidden = true; }, 150); });
    }
    if (citySugg) {
      citySugg.addEventListener("mousedown", function(e) {
        var item = e.target.closest ? e.target.closest(".cp-suggest-item") : null;
        if (!item) { return; }
        e.preventDefault();
        cityInput.value = item.getAttribute("data-city");
        mount._cpCity = cityInput.value;
        citySugg.hidden = true;
      });
    }
  }

  function chooseState(mount, code, stateInput, stateSugg, cityInput) {
    var s = stateByCode(code);
    if (!s) { return; }
    mount._cpStateCode = code;
    mount._cpStateQuery = mount._cpLangFn() ? s.nameEn : s.namePt;
    stateInput.value = mount._cpStateQuery;
    stateSugg.hidden = true;
    mount._cpStateError = null;
    if (cityInput) {
      cityInput.disabled = false;
      cityInput.placeholder = mount._cpLangFn() ? "Type a city..." : "Digite uma cidade...";
    }
    if (!mount._cpNoCity) { loadCityList(mount, code); }
    if (mount._cpOnStateChange) { mount._cpOnStateChange(code); }
  }

  function loadCityList(mount, code) {
    mount._cpCityList = null;
    if (!global.ClientPlacesCityLoader) { return; }
    global.ClientPlacesCityLoader(code).then(function(list) {
      mount._cpCityList = list || [];
    }).catch(function() {
      mount._cpCityList = [];
    });
  }

  function stateCityRead(mount) {
    var en = mount._cpLangFn ? mount._cpLangFn() : document.body.classList.contains("lang-en");
    var stateInput = mount.querySelector(".cp-state-input");
    var typed = stateInput ? stateInput.value : "";
    // Empty box: no state chosen, no error (an unset state is simply empty).
    if (!typed.trim()) {
      return { stateCode: null, city: (mount._cpCity || "").trim().slice(0, 100), error: null };
    }
    if (!mount._cpStateCode || stateName(mount._cpStateCode, en) !== typed) {
      mount._cpStateError = { pt: "Escolha um estado da lista", en: "Choose a state from the list" };
      renderStateCity(mount);
      return { stateCode: null, city: null, error: mount._cpStateError };
    }
    return { stateCode: mount._cpStateCode, city: (mount._cpCity || "").trim().slice(0, 100), error: null };
  }

  // D2: the Apex contract builder's State field — same type-ahead as C2,
  // but US states only and no City box (Cidade is its own separate field
  // there, prefilled from the lead).
  function stateOnlyControl(mount, initialStateCode, opts) {
    opts = opts || {};
    opts.noCity = true;
    opts.countryFilter = "US";
    stateCityControl(mount, initialStateCode, "", opts);
  }
  function stateOnlyRead(mount) {
    var res = stateCityRead(mount);
    return { stateCode: res.stateCode, error: res.error };
  }

  global.ClientPlaces = {
    ownersEditor: ownersEditor,
    ownersRead: ownersRead,
    ownersDisplay: ownersDisplay,
    joinOwnerNames: joinOwnerNames,
    stateCityControl: stateCityControl,
    stateCityRead: stateCityRead,
    stateOnlyControl: stateOnlyControl,
    stateOnlyRead: stateOnlyRead,
    stateName: stateName,
    stateByCode: stateByCode,
    statesList: statesList
  };
})(window);
