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

  // ── Dock config: top 3 primary destinations per role + "More" ──────────
  // DOCK_KEYS lists the nav item keys shown directly in the dock.
  // Everything else goes in the More sheet.
  var DOCK_KEYS_ALICE = ["dashboard", "clients", "sessions"];
  var DOCK_KEYS_RAFA  = ["dashboard", "clients", "sessions"];
  // Developer sees same primary set as Alice; More sheet adds Add User + dev controls
  var DOCK_KEYS_DEV   = ["dashboard", "clients", "sessions"];

  // ── Mobile state ─────────────────────────────────────────────────────────
  var _mobileRole    = "alice";
  var _mobileItems   = NAV_ITEMS_ALICE;
  var _mobileDevView = "";
  var _isMoreOpen    = false;

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
    } else if (type === "more-horizontal") {
      body = '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>';
    } else if (type === "x") {
      body = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
    } else if (type === "user-plus") {
      body = '<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>';
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
      "#appHeader { justify-content: flex-end; }" +
      "#navSidebar { width: 240px; height: calc(100vh - 64px); background: #1a1a1d; display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; transition: width 0.2s ease; border-right: 1px solid #2a2a2e; }" +
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

      /* ── Mobile: hide sidebar, show bottom dock ── */
      "@media (max-width: 768px) {" +
        "#navSidebar { display: none; }" +
        "#apexMobileDock { display: flex; }" +
        "#appMain, #contentArea { padding-bottom: 72px; }" +
      "}" +

      /* Mobile dock — hidden by default, shown via media query above */
      "#apexMobileDock { display: none; position: fixed; bottom: 0; left: 0; right: 0; height: 64px; background: #1a1a1d; border-top: 1px solid #2a2a2e; z-index: 900; align-items: stretch; justify-content: space-around; padding: 0; safe-area-inset-bottom: env(safe-area-inset-bottom); padding-bottom: env(safe-area-inset-bottom, 0px); }" +

      /* Dock tab buttons */
      ".apex-dock-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 500; text-decoration: none; padding: 8px 4px; position: relative; transition: color 0.15s; -webkit-tap-highlight-color: transparent; }" +
      ".apex-dock-tab:hover { color: rgba(255,255,255,0.85); }" +
      ".apex-dock-tab.apex-dock-active { color: #C9A43A; }" +
      ".apex-dock-tab svg { width: 22px; height: 22px; }" +
      ".apex-dock-label { font-size: 10px; line-height: 1; }" +

      /* More sheet overlay */
      "#apexMoreOverlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 910; }" +
      "#apexMoreOverlay.apex-more-open { display: block; }" +

      /* More sheet panel */
      "#apexMoreSheet { position: fixed; left: 0; right: 0; bottom: 0; background: #1a1a1d; border-top: 1px solid #2a2a2e; border-radius: 16px 16px 0 0; z-index: 920; transform: translateY(100%); transition: transform 0.25s ease; padding-bottom: env(safe-area-inset-bottom, 0px); }" +
      "#apexMoreSheet.apex-more-open { transform: translateY(0); }" +

      /* Sheet handle + header */
      ".apex-sheet-handle { width: 36px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; margin: 12px auto 0; }" +
      ".apex-sheet-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px 10px; border-bottom: 1px solid #2a2a2e; }" +
      ".apex-sheet-title { font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.5); letter-spacing: 0.8px; text-transform: uppercase; }" +
      ".apex-sheet-close { background: none; border: none; color: rgba(255,255,255,0.4); cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent; }" +
      ".apex-sheet-close:hover { color: rgba(255,255,255,0.8); }" +

      /* Sheet nav items */
      ".apex-sheet-items { padding: 8px 0 16px; }" +
      "a.apex-sheet-item { display: flex; align-items: center; gap: 14px; padding: 13px 20px; color: rgba(255,255,255,0.65); font-size: 14px; font-weight: 500; text-decoration: none; font-family: 'Inter', sans-serif; transition: color 0.15s, background 0.15s; }" +
      "a.apex-sheet-item:hover { color: rgba(255,255,255,0.95); background: rgba(255,255,255,0.06); }" +
      "a.apex-sheet-item.apex-sheet-active { color: #C9A43A; }" +
      ".apex-sheet-item-icon { width: 22px; height: 22px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }" +

      /* Dev section in More sheet */
      ".apex-sheet-dev-section { border-top: 1px solid #2a2a2e; padding: 12px 20px 16px; }" +
      ".apex-sheet-dev-label { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; color: rgba(255,255,255,0.3); text-transform: uppercase; margin-bottom: 10px; }" +
      ".apex-sheet-switcher-btns { display: flex; gap: 6px; margin-bottom: 10px; }" +
      ".apex-sheet-view-btn { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.5); font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500; padding: 6px 12px; border-radius: 12px; cursor: pointer; transition: all 0.15s; }" +
      ".apex-sheet-view-btn:hover { border-color: #C9A43A; color: #C9A43A; }" +
      ".apex-sheet-view-btn.apex-sheet-view-active { background: rgba(201,164,58,0.14); border-color: #C9A43A; color: #C9A43A; font-weight: 600; }";

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

  // ── Mobile dock + More sheet builders ────────────────────────────────────
  function getDockKeys(role) {
    if (role === "rafa") { return DOCK_KEYS_RAFA; }
    if (role === "developer") { return DOCK_KEYS_DEV; }
    return DOCK_KEYS_ALICE;
  }

  function buildMobileDock(role, items, devView) {
    var activePage = getActivePage();
    var dockKeys = getDockKeys(role);
    var html = '';

    // Render primary dock tabs
    for (var i = 0; i < dockKeys.length; i++) {
      var key = dockKeys[i];
      var item = null;
      for (var k = 0; k < items.length; k++) {
        if (items[k].key === key) { item = items[k]; break; }
      }
      if (!item) { continue; }
      var isActive = (activePage === item.href);
      var activeClass = isActive ? ' apex-dock-active' : '';
      html += '<a class="apex-dock-tab' + activeClass + '" href="' + item.href + '">';
      html += navSvg(item.icon);
      html += '<span class="apex-dock-label">';
      html += '<span class="show-pt">' + item.tipPt + '</span>';
      html += '<span class="show-en">' + item.tipEn + '</span>';
      html += '</span>';
      html += '</a>';
    }

    // More tab
    html += '<button class="apex-dock-tab" id="apexDockMoreBtn" onclick="apexNavOpenMore()">';
    html += navSvg("more-horizontal");
    html += '<span class="apex-dock-label">';
    html += '<span class="show-pt">Mais</span>';
    html += '<span class="show-en">More</span>';
    html += '</span>';
    html += '</button>';

    return html;
  }

  function buildMoreSheet(role, items, devView) {
    var activePage = getActivePage();
    var dockKeys = getDockKeys(role);
    var html = '';

    html += '<div class="apex-sheet-handle"></div>';
    html += '<div class="apex-sheet-header">';
    html += '<span class="apex-sheet-title">';
    html += '<span class="show-pt">Navegar</span>';
    html += '<span class="show-en">Navigate</span>';
    html += '</span>';
    html += '<button class="apex-sheet-close" onclick="apexNavCloseMore()">' + navSvg("x") + '</button>';
    html += '</div>';

    html += '<div class="apex-sheet-items">';

    // Items NOT in the dock
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var inDock = false;
      for (var d = 0; d < dockKeys.length; d++) {
        if (dockKeys[d] === item.key) { inDock = true; break; }
      }
      if (inDock) { continue; }
      var isActive = (activePage === item.href);
      var activeClass = isActive ? ' apex-sheet-active' : '';
      html += '<a class="apex-sheet-item' + activeClass + '" href="' + item.href + '">';
      html += '<span class="apex-sheet-item-icon">' + navSvg(item.icon) + '</span>';
      html += '<span>';
      html += '<span class="show-pt">' + item.labelPt + '</span>';
      html += '<span class="show-en">' + item.labelEn + '</span>';
      html += '</span>';
      html += '</a>';
    }

    // Developer-only: Add User page
    if (role === "developer") {
      html += '<a class="apex-sheet-item" href="add-user.html">';
      html += '<span class="apex-sheet-item-icon">' + navSvg("user-plus") + '</span>';
      html += '<span>';
      html += '<span class="show-pt">Adicionar Usuario</span>';
      html += '<span class="show-en">Add User</span>';
      html += '</span>';
      html += '</a>';
    }

    html += '</div>';

    // Developer-only: view switcher + nav collapse toggle in sheet
    if (role === "developer") {
      html += '<div class="apex-sheet-dev-section">';
      html += '<div class="apex-sheet-dev-label">DEV</div>';
      html += '<div class="apex-sheet-switcher-btns">';
      var btns = [
        { id: "mobileNavBtnAlice", v: "alice", label: "Alice" },
        { id: "mobileNavBtnRafa",  v: "rafa",  label: "Rafa"  },
        { id: "mobileNavBtnDev",   v: "dev",   label: "Dev"   }
      ];
      for (var j = 0; j < btns.length; j++) {
        var b = btns[j];
        var ac = (devView === b.v) ? ' apex-sheet-view-active' : '';
        html += '<button id="' + b.id + '" class="apex-sheet-view-btn' + ac + '" onclick="apexNavSetView(\'' + b.v + '\')">' + b.label + '</button>';
      }
      html += '</div>';
      html += '</div>';
    }

    return html;
  }

  // ── Inject mobile dock + sheet into DOM ───────────────────────────────────
  function injectMobileDock(role, items, devView) {
    // Remove any prior dock/sheet/overlay
    var old;
    old = document.getElementById("apexMobileDock");
    if (old) { old.parentNode.removeChild(old); }
    old = document.getElementById("apexMoreSheet");
    if (old) { old.parentNode.removeChild(old); }
    old = document.getElementById("apexMoreOverlay");
    if (old) { old.parentNode.removeChild(old); }

    // Dock
    var dock = document.createElement("div");
    dock.id = "apexMobileDock";
    dock.innerHTML = buildMobileDock(role, items, devView);
    document.body.appendChild(dock);

    // Overlay (tap-outside to close)
    var overlay = document.createElement("div");
    overlay.id = "apexMoreOverlay";
    overlay.onclick = function () { apexNavCloseMore(); };
    document.body.appendChild(overlay);

    // Sheet
    var sheet = document.createElement("div");
    sheet.id = "apexMoreSheet";
    sheet.innerHTML = buildMoreSheet(role, items, devView);
    document.body.appendChild(sheet);
  }

  // ── Refresh the collapse arrow icon ──────────────────────────────────────
  function refreshToggleIcon() {
    var btn = document.getElementById("apexNavToggle");
    var sidebar = document.getElementById("navSidebar");
    if (!btn || !sidebar) { return; }
    var collapsed = sidebar.classList.contains("apex-nav-collapsed");
    btn.innerHTML = navSvg(collapsed ? "chevron-right" : "chevron-left");
  }

  // ── Public: open/close More sheet ─────────────────────────────────────────
  window.apexNavOpenMore = function () {
    _isMoreOpen = true;
    var overlay = document.getElementById("apexMoreOverlay");
    var sheet = document.getElementById("apexMoreSheet");
    if (overlay) { overlay.className = "apex-more-open"; }
    if (sheet) { sheet.className = "apex-more-open"; }
  };

  window.apexNavCloseMore = function () {
    _isMoreOpen = false;
    var overlay = document.getElementById("apexMoreOverlay");
    var sheet = document.getElementById("apexMoreSheet");
    if (overlay) { overlay.className = ""; }
    if (sheet) { sheet.className = ""; }
  };

  // ── Public: language toggle (shared across all pages) ────────────────────
  window.apexNavToggleLang = function () {
    var b = document.body;
    if (b.classList.contains("lang-pt")) {
      b.classList.remove("lang-pt");
      b.classList.add("lang-en");
      sessionStorage.setItem("apex_lang", "en");
    } else {
      b.classList.remove("lang-en");
      b.classList.add("lang-pt");
      sessionStorage.setItem("apex_lang", "pt");
    }
  };

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
    _mobileDevView = v;

    // Update desktop sidebar buttons
    var mapping = { "navBtnAlice": "alice", "navBtnRafa": "rafa", "navBtnDev": "dev" };
    var ids = ["navBtnAlice", "navBtnRafa", "navBtnDev"];
    for (var i = 0; i < ids.length; i++) {
      var btn = document.getElementById(ids[i]);
      if (btn) {
        btn.className = "apex-nav-view-btn" + (mapping[ids[i]] === v ? " apex-nav-view-active" : "");
      }
    }

    // Update mobile sheet buttons
    var mobileMapping = { "mobileNavBtnAlice": "alice", "mobileNavBtnRafa": "rafa", "mobileNavBtnDev": "dev" };
    var mobileIds = ["mobileNavBtnAlice", "mobileNavBtnRafa", "mobileNavBtnDev"];
    for (var m = 0; m < mobileIds.length; m++) {
      var mbtn = document.getElementById(mobileIds[m]);
      if (mbtn) {
        mbtn.className = "apex-sheet-view-btn" + (mobileMapping[mobileIds[m]] === v ? " apex-sheet-view-active" : "");
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

    // Restore language preference across page navigation
    var savedLang = sessionStorage.getItem("apex_lang");
    if (savedLang === "en") {
      document.body.classList.remove("lang-pt");
      document.body.classList.add("lang-en");
    } else {
      document.body.classList.remove("lang-en");
      document.body.classList.add("lang-pt");
    }

    var role = sessionStorage.getItem("apex_role") || "alice";
    var items = (role === "rafa") ? NAV_ITEMS_RAFA : NAV_ITEMS_ALICE;
    var devView = (role === "developer") ? (sessionStorage.getItem("apex_dev_view") || "alice") : "";

    // Store mobile state
    _mobileRole    = role;
    _mobileItems   = items;
    _mobileDevView = devView;

    sidebar.innerHTML = buildNavHTML(role, items, devView);

    if (sessionStorage.getItem("apex_nav_collapsed") === "1") {
      sidebar.classList.add("apex-nav-collapsed");
    }

    refreshToggleIcon();

    // Inject mobile dock + More sheet
    injectMobileDock(role, items, devView);
  };

})();
