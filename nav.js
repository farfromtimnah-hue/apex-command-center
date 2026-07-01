(function () {

  // ── Nav item definitions ────────────────────────────────────────────────
  var NAV_ITEMS_ALICE = [
    { key: "dashboard", href: "dashboard.html", icon: "home",
      labelPt: "Dashboard",                    labelEn: "Dashboard",
      tipPt: "Dashboard",                      tipEn: "Dashboard" },
    { key: "clients",   href: "clients.html",   icon: "users",
      labelPt: "Clientes",                     labelEn: "Clients",
      tipPt: "Clientes",                       tipEn: "Clients" },
    { key: "sessions",  href: "sessions.html",  icon: "calendar",
      labelPt: "Sess&otilde;es",               labelEn: "Sessions",
      tipPt: "Sessoes",                        tipEn: "Sessions" },
    { key: "documents", href: "documents.html", icon: "file",
      labelPt: "Documentos",                   labelEn: "Documents",
      tipPt: "Documentos",                     tipEn: "Documents" },
    { key: "tasks",     href: "tasks.html",     icon: "check-square",
      labelPt: "Tarefas",                      labelEn: "Tasks",
      tipPt: "Tarefas",                        tipEn: "Tasks" },
    { key: "settings",  href: "settings.html",  icon: "settings",
      labelPt: "Configura&ccedil;&otilde;es",  labelEn: "Settings",
      tipPt: "Configuracoes",                  tipEn: "Settings" }
  ];

  var NAV_ITEMS_RAFA = [
    { key: "dashboard", href: "dashboard.html", icon: "home",
      labelPt: "Vis&atilde;o Geral",           labelEn: "Overview",
      tipPt: "Visao Geral",                    tipEn: "Overview" },
    { key: "clients",   href: "clients.html",   icon: "users",
      labelPt: "Meus Clientes",                labelEn: "My Clients",
      tipPt: "Meus Clientes",                  tipEn: "My Clients" },
    { key: "sessions",  href: "sessions.html",  icon: "calendar",
      labelPt: "Sess&otilde;es",               labelEn: "Sessions",
      tipPt: "Sessoes",                        tipEn: "Sessions" },
    { key: "tasks",     href: "tasks.html",     icon: "check-square",
      labelPt: "Tarefas",                      labelEn: "Tasks",
      tipPt: "Tarefas",                        tipEn: "Tasks" }
  ];

  // ── SVG icon builder ────────────────────────────────────────────────────
  function navSvg(type) {
    var open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    var body = "";
    if (type === "home") {
      body = '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>';
    } else if (type === "users") {
      body = '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>';
    } else if (type === "calendar") {
      body = '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>';
    } else if (type === "file") {
      body = '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>';
    } else if (type === "check-square") {
      body = '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>';
    } else if (type === "settings") {
      body = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>';
    } else if (type === "chevron-left") {
      body = '<polyline points="15 18 9 12 15 6"/>';
    } else if (type === "chevron-right") {
      body = '<polyline points="9 18 15 12 9 6"/>';
    }
    return open + body + '</svg>';
  }

  // ── CSS injection ────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("apex-nav-styles")) { return; }
    var el = document.createElement("style");
    el.id = "apex-nav-styles";
    el.textContent =
      /* Layout wrappers (nav + content) */
      "#pageWrapper { flex: 1; display: flex; overflow: hidden; }" +
      "#contentArea { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }" +

      /* Nav sidebar shell */
      "#navSidebar { width: 240px; background: #1a1a1d; display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; transition: width 0.2s ease; border-right: 1px solid #2a2a2e; }" +
      "#navSidebar.apex-nav-collapsed { width: 72px; }" +

      /* Logo row */
      ".apex-nav-logo { height: 64px; display: flex; align-items: center; padding: 0 20px; border-bottom: 1px solid #2a2a2e; flex-shrink: 0; overflow: hidden; }" +
      ".apex-nav-logo-img { height: 28px; width: auto; display: block; }" +

      /* Items list */
      ".apex-nav-items { flex: 1; padding: 8px 0; overflow-y: auto; overflow-x: hidden; }" +
      "a.apex-nav-item { display: flex; align-items: center; gap: 12px; padding: 10px 20px; color: rgba(255,255,255,0.55); font-size: 13px; font-weight: 500; text-decoration: none; position: relative; transition: color 0.15s, background 0.15s; white-space: nowrap; font-family: 'Inter', sans-serif; }" +
      "a.apex-nav-item:hover { color: rgba(255,255,255,0.9); background: rgba(255,255,255,0.06); }" +
      "a.apex-nav-item.apex-nav-active { color: #C9A43A; }" +
      "a.apex-nav-item.apex-nav-active::before { content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 3px; background: #C9A43A; border-radius: 0 2px 2px 0; }" +
      ".apex-nav-icon { width: 20px; height: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }" +
      ".apex-nav-label { overflow: hidden; }" +

      /* Collapsed icon rail */
      "#navSidebar.apex-nav-collapsed a.apex-nav-item { padding: 12px; justify-content: center; gap: 0; }" +
      "#navSidebar.apex-nav-collapsed .apex-nav-label { display: none; }" +

      /* Tooltips on collapsed */
      "#navSidebar.apex-nav-collapsed a.apex-nav-item::after { content: attr(data-tip-pt); display: none; position: absolute; left: calc(100% + 8px); top: 50%; transform: translateY(-50%); background: #2a2a2e; color: rgba(255,255,255,0.9); font-size: 12px; font-weight: 500; padding: 5px 10px; border-radius: 6px; white-space: nowrap; z-index: 1000; pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,0.35); font-family: 'Inter', sans-serif; }" +
      "body.lang-en #navSidebar.apex-nav-collapsed a.apex-nav-item::after { content: attr(data-tip-en); }" +
      "#navSidebar.apex-nav-collapsed a.apex-nav-item:hover::after { display: block; }" +

      /* Dev view switcher */
      ".apex-nav-switcher { padding: 10px 12px; border-top: 1px solid #2a2a2e; flex-shrink: 0; }" +
      "#navSidebar.apex-nav-collapsed .apex-nav-switcher { display: none; }" +
      ".apex-nav-switcher-label { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; color: rgba(255,255,255,0.3); text-transform: uppercase; margin-bottom: 6px; padding: 0 4px; }" +
      ".apex-nav-switcher-btns { display: flex; gap: 4px; }" +
      ".apex-nav-view-btn { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.5); font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 500; padding: 4px 6px; border-radius: 12px; cursor: pointer; transition: all 0.15s; flex: 1; }" +
      ".apex-nav-view-btn:hover { border-color: #C9A43A; color: #C9A43A; }" +
      ".apex-nav-view-btn.apex-nav-view-active { background: rgba(201,164,58,0.14); border-color: #C9A43A; color: #C9A43A; font-weight: 600; }" +

      /* Footer collapse toggle */
      ".apex-nav-footer { border-top: 1px solid #2a2a2e; flex-shrink: 0; }" +
      ".apex-nav-toggle { width: 100%; background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer; padding: 10px 20px; display: flex; align-items: center; justify-content: flex-end; font-family: 'Inter', sans-serif; transition: color 0.15s; }" +
      ".apex-nav-toggle:hover { color: rgba(255,255,255,0.7); }" +
      "#navSidebar.apex-nav-collapsed .apex-nav-toggle { justify-content: center; padding: 10px; }" +

      /* Bilingual (safety net for placeholder pages) */
      "body.lang-pt .show-en { display: none; }" +
      "body.lang-en .show-pt { display: none; }" +

      /* Mobile: hide the nav rail entirely */
      "@media (max-width: 720px) { #navSidebar { display: none; } }";

    document.head.appendChild(el);
  }

  // ── Active page detection ────────────────────────────────────────────────
  function getActivePage() {
    var parts = window.location.pathname.split("/");
    return parts[parts.length - 1] || "dashboard.html";
  }

  // ── HTML builder ─────────────────────────────────────────────────────────
  function buildNavHTML(role, items, devView) {
    var activePage = getActivePage();
    var html = "";

    // Logo
    html += '<div class="apex-nav-logo">';
    html += '<img src="https://apexbusiness.pro/wp-content/uploads/2025/12/LogoApex.png" alt="Apex" class="apex-nav-logo-img">';
    html += '</div>';

    // Nav items
    html += '<nav class="apex-nav-items">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var activeClass = (activePage === item.href) ? " apex-nav-active" : "";
      html +=
        '<a class="apex-nav-item' + activeClass + '" href="' + item.href + '"' +
        ' data-tip-pt="' + item.tipPt + '" data-tip-en="' + item.tipEn + '">';
      html += '<span class="apex-nav-icon">' + navSvg(item.icon) + '</span>';
      html += '<span class="apex-nav-label">';
      html += '<span class="show-pt">' + item.labelPt + '</span>';
      html += '<span class="show-en">' + item.labelEn + '</span>';
      html += '</span>';
      html += '</a>';
    }
    html += '</nav>';

    // Dev view switcher (developer role only)
    if (role === "developer") {
      html += '<div class="apex-nav-switcher">';
      html += '<div class="apex-nav-switcher-label">DEV</div>';
      html += '<div class="apex-nav-switcher-btns">';
      var buttons = [
        { id: "navBtnAlice", v: "alice", label: "Alice" },
        { id: "navBtnRafa",  v: "rafa",  label: "Rafa"  },
        { id: "navBtnDev",   v: "dev",   label: "Dev"   }
      ];
      for (var j = 0; j < buttons.length; j++) {
        var b = buttons[j];
        var ac = (devView === b.v) ? " apex-nav-view-active" : "";
        html += '<button id="' + b.id + '" class="apex-nav-view-btn' + ac + '" onclick="apexNavSetView(\'' + b.v + '\')">' + b.label + '</button>';
      }
      html += '</div></div>';
    }

    // Collapse toggle
    html += '<div class="apex-nav-footer">';
    html += '<button class="apex-nav-toggle" id="apexNavToggle" onclick="apexNavToggle()"></button>';
    html += '</div>';

    return html;
  }

  // ── Refresh the collapse arrow icon ──────────────────────────────────────
  function refreshToggleIcon() {
    var btn = document.getElementById("apexNavToggle");
    var sidebar = document.getElementById("navSidebar");
    if (!btn || !sidebar) { return; }
    var collapsed = sidebar.classList.contains("apex-nav-collapsed");
    btn.innerHTML = navSvg(collapsed ? "chevron-right" : "chevron-left");
  }

  // ── Public: toggle collapse ───────────────────────────────────────────────
  window.apexNavToggle = function () {
    var sidebar = document.getElementById("navSidebar");
    if (!sidebar) { return; }
    if (sidebar.classList.contains("apex-nav-collapsed")) {
      sidebar.classList.remove("apex-nav-collapsed");
      sessionStorage.removeItem("apex_nav_collapsed");
    } else {
      sidebar.classList.add("apex-nav-collapsed");
      sessionStorage.setItem("apex_nav_collapsed", "1");
    }
    refreshToggleIcon();
  };

  // ── Public: dev view switcher ─────────────────────────────────────────────
  window.apexNavSetView = function (v) {
    sessionStorage.setItem("apex_dev_view", v);

    // Update switcher button active states
    var mapping = { "navBtnAlice": "alice", "navBtnRafa": "rafa", "navBtnDev": "dev" };
    var ids = ["navBtnAlice", "navBtnRafa", "navBtnDev"];
    for (var i = 0; i < ids.length; i++) {
      var btn = document.getElementById(ids[i]);
      if (btn) {
        btn.className = "apex-nav-view-btn" + (mapping[ids[i]] === v ? " apex-nav-view-active" : "");
      }
    }

    // Tell the page to switch views (only works on dashboard.html)
    if (typeof window.setView === "function") {
      window.setView(v === "dev" ? "alice" : v);
    }
  };

  // ── Public: init ─────────────────────────────────────────────────────────
  // Called by each page after auth + role are confirmed.
  window.initNav = function () {
    var sidebar = document.getElementById("navSidebar");
    if (!sidebar) { return; }

    injectStyles();

    var role = sessionStorage.getItem("apex_role") || "alice";
    var items = (role === "rafa") ? NAV_ITEMS_RAFA : NAV_ITEMS_ALICE;
    var devView = (role === "developer") ? (sessionStorage.getItem("apex_dev_view") || "alice") : "";

    sidebar.innerHTML = buildNavHTML(role, items, devView);

    if (sessionStorage.getItem("apex_nav_collapsed") === "1") {
      sidebar.classList.add("apex-nav-collapsed");
    }

    refreshToggleIcon();
  };

})();
