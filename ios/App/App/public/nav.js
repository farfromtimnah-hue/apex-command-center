(function () {

  // ── DEV view switcher: ONE list, used by BOTH the desktop sidebar and the
  // mobile "Mais" menu ─────────────────────────────────────────────────────
  // These were previously two hand-maintained arrays. They drifted: "Seller"
  // was added to the sidebar and never to the mobile menu, so on a phone the
  // Seller preview was unreachable in portrait and only appeared in landscape
  // (landscape crosses mobile.css's 769px breakpoint, which swaps the "Mais"
  // menu for the desktop sidebar). Derive both from here so it cannot recur.
  //
  // Client and Seller open a picker rather than switching the nav directly —
  // Seller takes two steps, because a salesperson only means something inside
  // one client.
  var DEV_VIEWS = [
    { v: "alice",  label: "Alice"  },
    { v: "rafa",   label: "Rafa"   },
    { v: "dev",    label: "Dev"    },
    { v: "client", label: "Client" },
    { v: "seller", label: "Seller" }
  ];

  // ── Nav item definitions ────────────────────────────────────────────────
  var NAV_ITEMS_ALICE = [
    { key: "dashboard", href: "dashboard.html", icon: "home",
      labelPt: "Dashboard",                    labelEn: "Dashboard",
      tipPt: "Dashboard",                      tipEn: "Dashboard" },
    { key: "clients",   href: "clients.html",   icon: "users",
      labelPt: "Clientes",                     labelEn: "Clients",
      tipPt: "Clientes",                       tipEn: "Clients" },
    { key: "clientanalytics", href: "client-analytics.html", icon: "target",
      labelPt: "An&aacute;lise de Clientes",   labelEn: "Client Analytics",
      tipPt: "Analise de Clientes",            tipEn: "Client Analytics" },
    { key: "sessions",  href: "sessions.html",  icon: "calendar",
      labelPt: "Sess&otilde;es",               labelEn: "Sessions",
      tipPt: "Sessoes",                        tipEn: "Sessions" },
    { key: "calendar",  href: "calendar.html",  icon: "cal-grid",
      labelPt: "Calend&aacute;rio",            labelEn: "Calendar",
      tipPt: "Calendario",                     tipEn: "Calendar" },
    { key: "documents", href: "documents.html", icon: "file",
      labelPt: "Documentos",                   labelEn: "Documents",
      tipPt: "Documentos",                     tipEn: "Documents" },
    { key: "tasks",     href: "tasks.html",     icon: "check-square",
      labelPt: "Tarefas",                      labelEn: "Tasks",
      tipPt: "Tarefas",                        tipEn: "Tasks" },
    // The old finance.html link was removed 2026-08-26: Alice has been sending
    // real invoices from finance-new.html and the new system is what she uses.
    // The page still exists and is still reachable by URL -- only the nav entry
    // is gone -- so nothing breaks for a stale bookmark or an old deep link.
    // Label drops "(Novo)" because there is no longer an old one to tell it
    // apart from.
    { key: "financenew", href: "finance-new.html", icon: "finance",
      labelPt: "Financeiro",                   labelEn: "Financial",
      tipPt: "Financeiro",                     tipEn: "Financial" },
    { key: "sales",     href: "sales.html",     icon: "trend",
      labelPt: "Vendas",                       labelEn: "Sales",
      tipPt: "Vendas",                         tipEn: "Sales" },
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
    { key: "clientanalytics", href: "client-analytics.html", icon: "target",
      labelPt: "An&aacute;lise de Clientes",   labelEn: "Client Analytics",
      tipPt: "Analise de Clientes",            tipEn: "Client Analytics" },
    { key: "sales",     href: "sales.html",     icon: "trend",
      labelPt: "Vendas",                       labelEn: "Sales",
      tipPt: "Vendas",                         tipEn: "Sales" },
    { key: "sessions",  href: "sessions.html",  icon: "calendar",
      labelPt: "Sess&otilde;es",               labelEn: "Sessions",
      tipPt: "Sessoes",                        tipEn: "Sessions" },
    { key: "calendar",  href: "calendar.html",  icon: "cal-grid",
      labelPt: "Calend&aacute;rio",            labelEn: "Calendar",
      tipPt: "Calendario",                     tipEn: "Calendar" },
    { key: "documents", href: "documents.html", icon: "file",
      labelPt: "Documentos",                   labelEn: "Documents",
      tipPt: "Documentos",                     tipEn: "Documents" },
    { key: "tasks",     href: "tasks.html",     icon: "check-square",
      labelPt: "Tarefas",                      labelEn: "Tasks",
      tipPt: "Tarefas",                        tipEn: "Tasks" },
    // The old finance.html link was removed 2026-08-26: Alice has been sending
    // real invoices from finance-new.html and the new system is what she uses.
    // The page still exists and is still reachable by URL -- only the nav entry
    // is gone -- so nothing breaks for a stale bookmark or an old deep link.
    // Label drops "(Novo)" because there is no longer an old one to tell it
    // apart from.
    { key: "financenew", href: "finance-new.html", icon: "finance",
      labelPt: "Financeiro",                   labelEn: "Financial",
      tipPt: "Financeiro",                     tipEn: "Financial" },
    { key: "settings",  href: "settings.html",  icon: "settings",
      labelPt: "Configura&ccedil;&otilde;es",  labelEn: "Settings",
      tipPt: "Configuracoes",                  tipEn: "Settings" }
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
    } else if (type === "cal-grid") {
      body = '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8" y2="14" stroke-width="3"/><line x1="12" y1="14" x2="12" y2="14" stroke-width="3"/><line x1="16" y1="14" x2="16" y2="14" stroke-width="3"/><line x1="8" y1="18" x2="8" y2="18" stroke-width="3"/><line x1="12" y1="18" x2="12" y2="18" stroke-width="3"/>';
    } else if (type === "finance") {
      body = '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>';
    } else if (type === "trend") {
      body = '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>';
    } else if (type === "chevron-left") {
      body = '<polyline points="15 18 9 12 15 6"/>';
    } else if (type === "chevron-right") {
      body = '<polyline points="9 18 15 12 9 6"/>';
    } else if (type === "user-plus") {
      body = '<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/>';
    } else if (type === "more") {
      body = '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>';
    } else if (type === "briefcase") {
      body = '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>';
    } else if (type === "list") {
      body = '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>';
    } else if (type === "star") {
      body = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>';
    } else if (type === "target") {
      body = '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>';
    } else if (type === "view") {
      body = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
    return open + body + '</svg>';
  }

  // ── Public: same icon set used by the admin nav rail/dock, for pages that
  // build their own dock markup instead of calling initNav() (e.g. the
  // client-role portal, which has no #navSidebar and navigates in-page
  // instead of across pages) ────────────────────────────────────────────
  window.apexNavSvg = navSvg;

  // ── Public: icon badge for mobile card action buttons ───────────────────
  // Pages embed these inside row action buttons; mobile.css hides the text
  // label and shows this icon at 768px and below. Hidden on desktop.
  window.apexMcIcon = function (type) {
    var open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    var body = "";
    if (type === "view") {
      body = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    } else if (type === "edit") {
      body = '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>';
    } else if (type === "check") {
      body = '<polyline points="20 6 9 17 4 12"/>';
    } else if (type === "send") {
      body = '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>';
    } else if (type === "link") {
      body = '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>';
    } else if (type === "x") {
      body = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
    } else if (type === "restore") {
      body = '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>';
    } else if (type === "download") {
      body = '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
    }
    return '<span class="mc-ico" aria-hidden="true">' + open + body + '</svg></span>';
  };

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
      var buttons = DEV_VIEWS.map(function (dv) {
        return { id: "navBtn" + dv.label, v: dv.v, label: dv.label };
      });
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

  // ── Public: current language ─────────────────────────────────────────────
  // One definition for every page. Pages historically each declared their own
  // isEn(); those still work, but new code should call this.
  window.apexIsEn = function () {
    return document.body.classList.contains("lang-en");
  };

  // ── Public: bilingual <title> ────────────────────────────────────────────
  // A <title> cannot hold .show-pt/.show-en spans, so every page was stuck in
  // Portuguese. Pages declare both strings once:
  //     <title data-title-pt="Apex — Clientes" data-title-en="Apex — Clients">
  // and the toggle swaps them. Pages without the attributes are left alone.
  function applyTitle() {
    var el = document.querySelector("title");
    if (!el) { return; }
    var pt = el.getAttribute("data-title-pt");
    var en = el.getAttribute("data-title-en");
    if (!pt || !en) { return; }
    el.textContent = window.apexIsEn() ? en : pt;
  }
  window.apexApplyTitle = applyTitle;

  // ── Public: language toggle (shared across all pages) ────────────────────
  // Swapping the class is only half the job. Anything already baked into
  // innerHTML/textContent by a ternary can never change on its own, so we
  // announce the change and let each page re-render from ITS CACHED DATA.
  // Listeners must not refetch — a language toggle is not a reload.
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
    applyTitle();
    var lang = window.apexIsEn() ? "en" : "pt";
    try {
      document.dispatchEvent(new CustomEvent("apex:langchange", { detail: { lang: lang } }));
    } catch (e) {
      // Never let one page's listener throwing leave the toggle half-applied.
      if (window.console && console.error) { console.error("apex:langchange listener failed", e); }
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
    // "Client" opens the portal preview picker instead of a cosmetic nav
    // switch — it does NOT touch apex_dev_view (the admin pages keep their
    // current view; the preview happens on portal.html?previewAs=<id>).
    if (v === "client") {
      openClientPreviewPicker();
      return;
    }
    // Same contract as "client": a preview, not a nav state. Picks a client
    // first, then one of that client's salespeople.
    if (v === "seller") {
      openClientPreviewPicker({ seller: true });
      return;
    }
    sessionStorage.setItem("apex_dev_view", v);

    if (typeof window.setView === "function") {
      window.setView(v === "dev" ? "alice" : v);
    }

    window.initNav && window.initNav();
  };

  // ── Developer client-preview picker (modeled on LTC's preview-as flow) ────
  // Searchable modal listing every client; picking one opens
  // portal.html?previewAs=<client_id> (read-only, enforced by the Worker).
  var pickerClients = null;
  // When true the client pick is step 1 of the seller flow and hands off to the
  // seller picker instead of navigating straight into the portal.
  var pickerSellerMode = false;

  function openClientPreviewPicker(opts) {
    pickerSellerMode = !!(opts && opts.seller);
    // Step 1 always starts from the client list, even if a previous run left a
    // seller list loaded — otherwise the filter box would still be filtering
    // the old client's salespeople.
    pickerSellers = null;
    pickerSellerClientId = null;
    var overlay = document.getElementById("apexClientPickerOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "apexClientPickerOverlay";
      overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(20,18,16,0.55);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;";
      overlay.innerHTML =
        '<div style="background:#fff;border-radius:14px;padding:20px;width:100%;max-width:420px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.3);font-family:\'Inter\',sans-serif;">' +
        '<div style="font-size:15px;font-weight:700;margin-bottom:10px;color:#1a1a1d;" id="apexClientPickerTitle"></div>' +
        '<input type="text" id="apexClientPickerFilter" placeholder="Filtrar / Filter…" ' +
        'style="border:1px solid #e8e2d9;border-radius:8px;padding:10px 12px;font-family:\'Inter\',sans-serif;font-size:14px;margin-bottom:10px;outline:none;" ' +
        'oninput="window.apexClientPickerRender()">' +
        '<div id="apexClientPickerList" style="overflow-y:auto;flex:1;min-height:120px;"></div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:12px;">' +
        '<button type="button" onclick="apexClientPickerClose()" ' +
        'style="background:transparent;border:1px solid #e8e2d9;border-radius:8px;padding:9px 16px;font-family:\'Inter\',sans-serif;font-size:13px;font-weight:600;cursor:pointer;color:#1a1a1d;">' +
        '<span class="show-pt">Cancelar</span><span class="show-en">Cancel</span></button>' +
        '</div></div>';
      overlay.addEventListener("click", function (ev) {
        if (ev.target === overlay) { window.apexClientPickerClose(); }
      });
      document.body.appendChild(overlay);
    }
    overlay.style.display = "flex";
    var titleEl = document.getElementById("apexClientPickerTitle");
    if (titleEl) {
      titleEl.innerHTML = pickerSellerMode
        ? '<span class="show-pt">Ver como vendedor — escolha o cliente</span>' +
          '<span class="show-en">Preview as salesperson — pick the client</span>'
        : '<span class="show-pt">Ver portal como cliente</span>' +
          '<span class="show-en">Preview portal as client</span>';
    }
    document.getElementById("apexClientPickerFilter").value = "";
    var listEl = document.getElementById("apexClientPickerList");
    listEl.innerHTML = '<div style="color:#6b6660;font-size:13px;padding:10px;">Carregando… / Loading…</div>';

    if (pickerClients) { window.apexClientPickerRender(); return; }
    var workerUrl = window.WORKER_URL || "https://apex-api.farfromtimnah.workers.dev";
    var fb = window.firebase;
    if (!fb || !fb.auth || !fb.auth().currentUser) {
      listEl.innerHTML = '<div style="color:#b44040;font-size:13px;padding:10px;">Sessão não encontrada / No session</div>';
      return;
    }
    fb.auth().currentUser.getIdToken().then(function (token) {
      return fetch(workerUrl + "/api/clients", { headers: { "Authorization": "Bearer " + token } });
    }).then(function (res) { return res.json(); }).then(function (data) {
      pickerClients = data.clients || [];
      window.apexClientPickerRender();
    }).catch(function (e) {
      listEl.innerHTML = '<div style="color:#b44040;font-size:13px;padding:10px;">Erro: ' + (e && e.message ? e.message : "?") + '</div>';
    });
  }

  window.apexClientPickerRender = function () {
    // The one filter box serves both steps of the seller flow, so once the
    // seller list is up, typing filters that instead of the client list.
    if (pickerSellers) { window.apexSellerPickerRender(); return; }
    var listEl = document.getElementById("apexClientPickerList");
    if (!listEl || !pickerClients) { return; }
    var q = (document.getElementById("apexClientPickerFilter").value || "").toLowerCase();
    var html = "";
    for (var i = 0; i < pickerClients.length; i++) {
      var c = pickerClients[i];
      var name = c.name || c.id;
      if (q && name.toLowerCase().indexOf(q) === -1) { continue; }
      html += '<button type="button" onclick="apexClientPickerGo(\'' + String(c.id).replace(/'/g, "") + '\')" ' +
        'style="display:block;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid #e8e2d9;' +
        'padding:11px 6px;font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;color:#1a1a1d;cursor:pointer;">' +
        name.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
        (c.status && c.status !== "active" ? ' <span style="font-size:11px;color:#6b6660;font-weight:500;">(' + c.status + ')</span>' : '') +
        '</button>';
    }
    listEl.innerHTML = html || '<div style="color:#6b6660;font-size:13px;padding:10px;">Nenhum cliente / No clients</div>';
  };

  window.apexClientPickerGo = function (id) {
    if (pickerSellerMode) { openSellerPreviewPicker(id); return; }
    window.location.href = "portal.html?previewAs=" + encodeURIComponent(id);
  };

  // ── Developer salesperson-preview picker (step 2 of the Seller flow) ──────
  // Lists the client's salespeople and opens the portal scoped to one of them.
  //
  // THE LIST COMES FROM gm_seller_login_requests, NOT client_logins. A seat
  // request is the client saying "this person sells for me"; the seat itself is
  // paperwork Rafa and Alice work through by hand. JM has four requested and
  // zero approved, so an approved-only picker would be empty and there would be
  // nothing to test against. Pending names are listed and visibly marked.
  //
  // This is a PREVIEW, exactly like the client preview: it appends
  // ?previewAs=<client>&previewSeller=<name> and nothing more. No session is
  // created, no token is minted, no client_logins row is touched, and the
  // Worker's read-only preview gate still rejects every write. Nobody is logged
  // in as the salesperson -- the developer's own Google session is what
  // authenticates, and the extra param only narrows what is displayed.
  var pickerSellers = null;
  var pickerSellerClientId = null;

  function openSellerPreviewPicker(clientId) {
    pickerSellerClientId = clientId;
    pickerSellers = null;
    var titleEl = document.getElementById("apexClientPickerTitle");
    if (titleEl) {
      titleEl.innerHTML =
        '<span class="show-pt">Ver como vendedor — escolha a pessoa</span>' +
        '<span class="show-en">Preview as salesperson — pick the person</span>';
    }
    document.getElementById("apexClientPickerFilter").value = "";
    var listEl = document.getElementById("apexClientPickerList");
    listEl.innerHTML = '<div style="color:#6b6660;font-size:13px;padding:10px;">Carregando… / Loading…</div>';

    var workerUrl = window.WORKER_URL || "https://apex-api.farfromtimnah.workers.dev";
    var fb = window.firebase;
    if (!fb || !fb.auth || !fb.auth().currentUser) {
      listEl.innerHTML = '<div style="color:#b44040;font-size:13px;padding:10px;">Sessão não encontrada / No session</div>';
      return;
    }
    fb.auth().currentUser.getIdToken().then(function (token) {
      return fetch(workerUrl + "/api/clients/" + encodeURIComponent(clientId) + "/gm/seller-login-requests",
        { headers: { "Authorization": "Bearer " + token } });
    }).then(function (res) { return res.json(); }).then(function (data) {
      pickerSellers = data.requests || [];
      window.apexSellerPickerRender();
    }).catch(function (e) {
      listEl.innerHTML = '<div style="color:#b44040;font-size:13px;padding:10px;">Erro: ' + (e && e.message ? e.message : "?") + '</div>';
    });
  }

  window.apexSellerPickerRender = function () {
    var listEl = document.getElementById("apexClientPickerList");
    if (!listEl || !pickerSellers) { return; }
    var q = (document.getElementById("apexClientPickerFilter").value || "").toLowerCase();
    var html = "";
    for (var i = 0; i < pickerSellers.length; i++) {
      var s = pickerSellers[i];
      var name = s.seller_name || "";
      if (!name) { continue; }
      if (q && name.toLowerCase().indexOf(q) === -1) { continue; }
      // A pending request is the normal case today, so it is labelled rather
      // than hidden or disabled — the whole point is being able to preview a
      // salesperson before their seat exists.
      var tag = s.status && s.status !== "approved"
        ? ' <span style="font-size:11px;color:#7a5f18;background:rgba(201,164,58,0.18);' +
          'border-radius:9px;padding:1px 7px;font-weight:700;">' + s.status + '</span>'
        : '';
      html += '<button type="button" onclick="apexSellerPickerGo(' +
        JSON.stringify(name).replace(/"/g, "&quot;") + ')" ' +
        'style="display:block;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid #e8e2d9;' +
        'padding:11px 6px;font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;color:#1a1a1d;cursor:pointer;">' +
        name.replace(/&/g, "&amp;").replace(/</g, "&lt;") + tag +
        '</button>';
    }
    listEl.innerHTML = html ||
      '<div style="color:#6b6660;font-size:13px;padding:10px;">' +
      'Nenhum vendedor solicitado / No salespeople requested</div>';
  };

  window.apexSellerPickerGo = function (name) {
    window.location.href = "portal.html?previewAs=" + encodeURIComponent(pickerSellerClientId) +
      "&previewSeller=" + encodeURIComponent(name);
  };

  window.apexClientPickerClose = function () {
    var overlay = document.getElementById("apexClientPickerOverlay");
    if (overlay) { overlay.style.display = "none"; }
  };

  // ── Mobile bottom tab bar + "Mais" overflow menu ─────────────────────────
  // The #mobile-tab-bar and #mobile-more-menu containers are STATIC HTML in
  // every page (never created here); this code only fills them in. All of
  // their positioning and visibility lives in mobile.css behind a max-width
  // media query.

  function mobileTabDef(key, href, icon, labelPt, labelEn) {
    return { key: key, href: href, icon: icon, labelPt: labelPt, labelEn: labelEn };
  }

  var MTAB_INICIO     = mobileTabDef("dashboard", "dashboard.html", "home",         "In&iacute;cio",                "Home");
  var MTAB_CLIENTES   = mobileTabDef("clients",   "clients.html",   "users",        "Clientes",                     "Clients");
  var MTAB_SESSOES    = mobileTabDef("sessions",  "sessions.html",  "calendar",     "Sess&otilde;es",               "Sessions");
  var MTAB_VENDAS     = mobileTabDef("sales",     "sales.html",     "trend",        "Vendas",                       "Sales");
  var MTAB_TAREFAS    = mobileTabDef("tasks",     "tasks.html",     "check-square", "Tarefas",                      "Tasks");
  var MTAB_FINANCENOVO = mobileTabDef("financenew", "finance-new.html", "finance",   "Financeiro",                   "Financial");
  var MTAB_CALENDARIO = mobileTabDef("calendar",  "calendar.html",  "cal-grid",     "Calend&aacute;rio",            "Calendar");
  var MTAB_DOCUMENTOS = mobileTabDef("documents", "documents.html", "file",         "Documentos",                   "Documents");
  var MTAB_CONFIG     = mobileTabDef("settings",  "settings.html",  "settings",     "Configura&ccedil;&otilde;es",  "Settings");
  var MTAB_ADDUSER    = mobileTabDef("adduser",   "add-user.html",  "user-plus",    "Adicionar Usu&aacute;rio",     "Add User");
  var MTAB_CLIENTANALYTICS = mobileTabDef("clientanalytics", "client-analytics.html", "target", "An&aacute;lise de Clientes", "Client Analytics");

  function getMobileNavConfig(navRole) {
    if (navRole === "rafa") {
      return {
        tabs: [MTAB_INICIO, MTAB_CLIENTES, MTAB_SESSOES, MTAB_VENDAS, MTAB_TAREFAS],
        more: [MTAB_CLIENTANALYTICS, MTAB_FINANCENOVO, MTAB_CALENDARIO, MTAB_DOCUMENTOS, MTAB_CONFIG]
      };
    }
    if (navRole === "developer") {
      return {
        tabs: [MTAB_INICIO, MTAB_CLIENTES, MTAB_SESSOES],
        more: [MTAB_CLIENTANALYTICS, MTAB_VENDAS, MTAB_TAREFAS, MTAB_FINANCENOVO, MTAB_CALENDARIO, MTAB_DOCUMENTOS, MTAB_CONFIG, MTAB_ADDUSER]
      };
    }
    // alice (default)
    return {
      tabs: [MTAB_INICIO, MTAB_CLIENTES, MTAB_SESSOES, MTAB_FINANCENOVO, MTAB_CALENDARIO],
      more: [MTAB_CLIENTANALYTICS, MTAB_VENDAS, MTAB_TAREFAS, MTAB_DOCUMENTOS, MTAB_CONFIG]
    };
  }

  function buildMobileLabelSpan(item) {
    return '<span class="show-pt">' + item.labelPt + '</span>' +
           '<span class="show-en">' + item.labelEn + '</span>';
  }

  function populateMobileNav(navRole) {
    var bar  = document.getElementById("mobile-tab-bar");
    var menu = document.getElementById("mobile-more-menu");
    if (!bar || !menu) { return; }

    var cfg = getMobileNavConfig(navRole);
    var activePage = getActivePage();
    var moreIsActive = false;
    var i;

    for (i = 0; i < cfg.more.length; i++) {
      if (cfg.more[i].href === activePage) { moreIsActive = true; }
    }

    var barHtml = "";
    for (i = 0; i < cfg.tabs.length; i++) {
      var t = cfg.tabs[i];
      var activeCls = (activePage === t.href) ? " m-tab-active" : "";
      barHtml += '<a class="m-tab' + activeCls + '" href="' + t.href + '">';
      barHtml += '<span class="m-tab-ico">' + navSvg(t.icon) + '</span>';
      barHtml += '<span class="m-tab-label">' + buildMobileLabelSpan(t) + '</span>';
      barHtml += '</a>';
    }
    barHtml += '<button type="button" class="m-tab' + (moreIsActive ? " m-tab-active" : "") + '" id="mTabMais" onclick="apexMoreToggle()">';
    barHtml += '<span class="m-tab-ico">' + navSvg("more") + '</span>';
    barHtml += '<span class="m-tab-label"><span class="show-pt">Mais</span><span class="show-en">More</span></span>';
    barHtml += '</button>';
    bar.innerHTML = barHtml;

    var menuHtml = '<div class="mm-head">';
    menuHtml += '<span class="mm-title"><span class="show-pt">Mais</span><span class="show-en">More</span></span>';
    menuHtml += '<button type="button" class="mm-close" onclick="apexMoreToggle()" aria-label="Fechar">&times;</button>';
    menuHtml += '</div>';
    menuHtml += '<nav class="mm-list">';
    for (i = 0; i < cfg.more.length; i++) {
      var m = cfg.more[i];
      var itemActive = (activePage === m.href) ? " mm-item-active" : "";
      menuHtml += '<a class="mm-item' + itemActive + '" href="' + m.href + '">';
      menuHtml += '<span class="mm-item-ico">' + navSvg(m.icon) + '</span>';
      menuHtml += buildMobileLabelSpan(m);
      menuHtml += '<span class="mm-item-chevron">' + navSvg("chevron-right") + '</span>';
      menuHtml += '</a>';
    }
    menuHtml += '</nav>';

    // Dev view switcher (developer role only) — the SAME DEV_VIEWS list and
    // the same apexNavSetView calls as the desktop sidebar switcher, derived
    // rather than duplicated (see DEV_VIEWS). Checks the
    // REAL role, not navRole: a developer previewing Alice/Rafa still needs
    // the switcher visible to get back to the Dev view.
    var realRole = sessionStorage.getItem("apex_role") || "alice";
    if (realRole === "developer") {
      var mmDevView = sessionStorage.getItem("apex_dev_view") || "dev";
      var mmButtons = DEV_VIEWS.map(function (dv) {
        return { id: "mmBtn" + dv.label, v: dv.v, label: dv.label };
      });
      menuHtml += '<div class="mm-switcher">';
      menuHtml += '<div class="mm-switcher-label">DEV</div>';
      menuHtml += '<div class="mm-switcher-btns">';
      for (var k = 0; k < mmButtons.length; k++) {
        var mb = mmButtons[k];
        var mac = (mmDevView === mb.v) ? " mm-view-active" : "";
        menuHtml += '<button type="button" id="' + mb.id + '" class="mm-view-btn' + mac + '" onclick="apexNavSetView(\'' + mb.v + '\')">' + mb.label + '</button>';
      }
      menuHtml += '</div></div>';
    }

    menu.innerHTML = menuHtml;
  }

  // ── Scrollable view-switch tab strips (.m-scroll-tabs) ──────────────────
  // mobile.css makes these one-row horizontal scrollers at 768px and below;
  // this only maintains the mst-fade-left/right hint classes and brings the
  // active tab into view. Inert on desktop: the classes have no CSS effect
  // outside the mobile media query.
  function setupTabStrips() {
    var strips = document.querySelectorAll(".m-scroll-tabs");
    var i;
    for (i = 0; i < strips.length; i++) {
      (function (el) {
        if (el.getAttribute("data-mst-wired") === "1") { return; }
        el.setAttribute("data-mst-wired", "1");
        function updateFade() {
          var maxScroll = el.scrollWidth - el.clientWidth;
          if (maxScroll <= 1) {
            el.classList.remove("mst-fade-left");
            el.classList.remove("mst-fade-right");
            return;
          }
          if (el.scrollLeft > 1) { el.classList.add("mst-fade-left"); }
          else { el.classList.remove("mst-fade-left"); }
          if (el.scrollLeft < maxScroll - 1) { el.classList.add("mst-fade-right"); }
          else { el.classList.remove("mst-fade-right"); }
        }
        el.addEventListener("scroll", updateFade);
        window.addEventListener("resize", updateFade);
        // Web fonts change pill widths after first layout
        if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
          document.fonts.ready.then(updateFade);
        }
        setTimeout(updateFade, 600);
        var active = el.querySelector(".active");
        if (active && el.scrollWidth > el.clientWidth) {
          el.scrollLeft = Math.max(0, active.offsetLeft - el.offsetLeft - 16);
        }
        updateFade();
      })(strips[i]);
    }
  }
  window.apexSetupTabStrips = setupTabStrips;

  // ── Public: toggle the full-screen "Mais" menu ───────────────────────────
  window.apexMoreToggle = function () {
    var menu = document.getElementById("mobile-more-menu");
    if (!menu) { return; }
    if (menu.classList.contains("mm-open")) {
      menu.classList.remove("mm-open");
      document.body.classList.remove("mm-menu-lock");
    } else {
      menu.classList.add("mm-open");
      document.body.classList.add("mm-menu-lock");
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
    // Landing on a page while EN is active must give an English tab too.
    applyTitle();

    var role = sessionStorage.getItem("apex_role") || "alice";
    var devView = (role === "developer") ? (sessionStorage.getItem("apex_dev_view") || "dev") : "";

    var navRole = (role === "developer" && (devView === "alice" || devView === "rafa")) ? devView : role;

    var items = (navRole === "rafa") ? NAV_ITEMS_RAFA : NAV_ITEMS_ALICE;
    if (navRole === "developer") {
      items = items.slice();
      items.push({
        key: "adduser", href: "add-user.html", icon: "user-plus",
        labelPt: "Adicionar Usu&aacute;rio", labelEn: "Add User",
        tipPt: "Adicionar Usuario",           tipEn: "Add User"
      });
    }

    sidebar.innerHTML = buildNavHTML(role, items, devView);

    if (sessionStorage.getItem("apex_nav_collapsed") === "1") {
      sidebar.classList.add("apex-nav-collapsed");
    }

    refreshToggleIcon();

    populateMobileNav(navRole);

    setupTabStrips();
  };

})();
