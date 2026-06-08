/* ============================================================
 * Axon Chrome Extension — side-panel launcher controller
 * Owns config + the /v1/* request layer, current-tab tracking, and
 * the browse → run → result/doc flow from the design handoff
 * (Reference/ext/sidepanel.jsx). Wired to the real Axon server.
 * ============================================================ */

(function () {
  const { el, Icon, ActionBody, RetrieveDocFromRaw } = window.AxonRender;
  const { iconSvg, axonMark } = window.AxonIcons;
  const { OPS_BY_CATEGORY, OP_BY_ID, toneOf, tint, hostOf, detectIngestSource } = window.AxonData;

  const DEFAULT_AXON_URL = "http://100.88.16.79:8001";
  const COLOR_CODE = true; // color-code actions by family (design default on)

  const state = { view: "browse", tab: null, online: null, host: "", op: null, lastStatus: 200, bodyEl: null };

  /* ── config + request layer ── */
  async function loadConfig() {
    const stored = (chrome.storage && chrome.storage.local) ? await chrome.storage.local.get(["axonUrl", "axonToken"]) : {};
    return { axonUrl: stored.axonUrl || DEFAULT_AXON_URL, axonToken: stored.axonToken || "" };
  }
  function isLoopback(server) {
    try { const h = new URL(server).hostname; return h === "127.0.0.1" || h === "localhost" || h === "::1"; } catch { return false; }
  }
  async function requestAxon(method, path, body) {
    const cfg = await loadConfig();
    const server = cfg.axonUrl.trim().replace(/\/+$/, "");
    const token = cfg.axonToken.trim();
    if (!server) throw new Error("Axon server URL is required. Open Settings.");
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!token && path !== "/healthz" && !isLoopback(server)) throw new Error("Missing bearer token for this server. Open Settings.");
    const res = await fetch(`${server}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    state.lastStatus = res.status;
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try { const j = JSON.parse(text); message = j.message || j.error || text; } catch { /* keep text */ }
      const err = new Error(message || `HTTP ${res.status}`); err.status = res.status; err.statusText = res.statusText; throw err;
    }
    if (!text) return {};
    try { return JSON.parse(text); } catch { return text; }
  }
  function friendlyError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (lower.includes("missing bearer token") || lower.includes("401") || lower.includes("auth_failed")) return "Auth failed — Axon needs the bearer token for this server. Open Settings.";
    if (lower.includes("403") || lower.includes("forbidden")) return "Forbidden by the Axon server or proxy. Check the URL and token.";
    if (lower.includes("failed to fetch") || lower.includes("networkerror")) return "Axon is unreachable from Chrome. Check the server URL and that Axon is listening.";
    return message.replace(/<!--[\s\S]*?-->/g, "").trim() || "Request failed.";
  }

  /* ── current tab ── */
  function isWeb(t) { return /^https?:\/\//i.test((t && t.url) || ""); }
  async function getActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (isWeb(tab)) return tab;
      const all = await chrome.tabs.query({ currentWindow: true });
      const web = all.filter(isWeb).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      return web || tab || null;
    } catch { return null; }
  }

  /* ── arg model ── */
  function argMode(op) {
    if (["doctor", "status", "stats"].includes(op.id)) return "none";
    if (["suggest", "sources", "domains"].includes(op.id)) return "optional";
    if (["search", "research", "query", "ask", "evaluate"].includes(op.id)) return "query";
    return "url"; // scrape, map, retrieve, screenshot, diff, brand, endpoints, crawl, extract, embed, ingest, summarize
  }
  function splitUrls(arg) {
    return String(arg || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }

  /* ── API dispatch per action ── */
  function callApi(op, arg) {
    switch (op.id) {
      case "scrape": return requestAxon("POST", "/v1/scrape", { url: arg, embed: true });
      case "map": return requestAxon("POST", "/v1/map", { url: arg, limit: 100 });
      case "retrieve": return requestAxon("POST", "/v1/retrieve", { url: arg, max_points: 50, token_budget: 8000 });
      case "screenshot": return requestAxon("POST", "/v1/screenshot", { url: arg, full_page: true });
      case "brand": return requestAxon("POST", "/v1/brand", { url: arg });
      case "endpoints": return requestAxon("POST", "/v1/endpoints", { url: arg });
      case "diff": { const u = splitUrls(arg); if (u.length < 2) { const e = new Error("Diff needs two URLs — “URL A  URL B”."); e.status = 400; throw e; } return requestAxon("POST", "/v1/diff", { url_a: u[0], url_b: u[1] }); }
      case "crawl": return requestAxon("POST", "/v1/crawl", { urls: [arg] });
      case "extract": return requestAxon("POST", "/v1/extract", { urls: [arg] });
      case "embed": return requestAxon("POST", "/v1/embed", { input: arg });
      case "ingest": return requestAxon("POST", "/v1/ingest", { source_type: detectIngestSource(arg), target: arg });
      case "search": return requestAxon("POST", "/v1/search", { query: arg, limit: 10 });
      case "research": return requestAxon("POST", "/v1/research", { query: arg, limit: 10 });
      case "query": return requestAxon("POST", "/v1/query", { query: arg, limit: 10 });
      case "suggest": return requestAxon("POST", "/v1/suggest", arg ? { focus: arg } : {});
      case "sources": return requestAxon("GET", "/v1/sources");
      case "domains": return requestAxon("GET", "/v1/domains");
      case "ask": return requestAxon("POST", "/v1/ask", { query: arg });
      case "summarize": return requestAxon("POST", "/v1/summarize", { urls: [arg] });
      case "evaluate": return requestAxon("POST", "/v1/evaluate", { question: arg });
      case "doctor": return requestAxon("GET", "/v1/doctor");
      case "status": return requestAxon("GET", "/v1/status");
      case "stats": return requestAxon("GET", "/v1/stats");
      default: { const e = new Error(`Unsupported action: ${op.id}`); throw e; }
    }
  }

  /* ── root ── */
  let panel;
  function mount() {
    panel = el("div", { class: "ext-panel" });
    document.getElementById("root").appendChild(panel);
    render();
  }
  function render() {
    panel.textContent = "";
    if (state.view === "browse") renderBrowse();
    else if (state.view === "result") renderResult();
    else if (state.view === "doc") renderDoc();
  }

  /* ── header ── */
  function brandHeader() {
    const dot = el("span", { class: `ext-dot ${state.online === false ? "is-off" : state.online == null ? "is-wait" : ""}`, title: state.online === false ? "Axon offline" : state.online == null ? "Checking…" : "Axon online" });
    const gear = el("button", { class: "ext-icon", title: "Settings", "aria-label": "Settings", onclick: openOptions }, iconSvg("settings", { size: 16 }));
    return el("header", { class: "ext-head" }, [
      el("span", { class: "ext-brand" }, [axonMark(22), el("span", { class: "ext-word" }, "Axon"), dot]),
      el("span", { class: "ext-host", title: state.host }, state.host || "not configured"),
      gear,
    ]);
  }
  function resultHeader(title, back) {
    const ok = state.lastStatus >= 200 && state.lastStatus < 300;
    const badgeClass = state.view === "result" && state.op && state.lastStatus === 202 ? "is-accepted" : !ok ? "is-error" : "";
    const badge = el("span", { class: `ext-statusbadge ${badgeClass}` }, [Icon(ok ? "check" : "alert", 11), String(state.lastStatus)]);
    return el("header", { class: "ext-result-head" }, [
      el("button", { class: "ext-icon", title: "Back", "aria-label": "Back", onclick: back }, iconSvg("arrowLeft", { size: 17 })),
      el("span", { class: "ext-result-title" }, title),
      badge,
    ]);
  }
  function footer() {
    return el("div", { class: "ext-foot" }, [Icon("command", 12), el("span", null, "⌘⇧Space to open · right-click any page to Scrape / Ingest / Ask")]);
  }

  /* ── browse view ── */
  function renderBrowse() {
    panel.appendChild(brandHeader());
    const scroll = el("div", { class: "ext-scroll aurora-scrollbar" });

    const url = (state.tab && state.tab.url) || "";
    const dom = url ? hostOf(url).split("/")[0] : "";
    const rest = url ? hostOf(url).slice(dom.length) : "";
    const tabCard = el("div", { class: "ext-tabcard" }, [
      el("div", { class: "ext-tabcard-top" }, [iconSvg("globe", { size: 13, color: "var(--aurora-accent-strong)" }), el("span", { class: "ext-tablabel" }, "THIS PAGE")]),
      el("div", { class: "ext-taburl", title: url }, url ? [dom, el("span", { class: "dim" }, rest)] : [el("span", { class: "dim" }, "Open an http:// or https:// tab")]),
      el("div", { class: "ext-quick" }, [
        quickBtn("scrape", "Scrape", "scrape"),
        quickBtn("ingest", "Ingest", "box"),
        quickBtn("endpoints", "Endpoints", "plug"),
      ]),
    ]);
    scroll.appendChild(tabCard);

    OPS_BY_CATEGORY.forEach((cat) => {
      if (!cat.ops.length) return;
      scroll.appendChild(el("div", { class: "ext-seclabel" }, cat.label));
      cat.ops.forEach((op) => scroll.appendChild(actionRow(op)));
    });

    panel.appendChild(scroll);
    panel.appendChild(footer());
  }
  function quickBtn(opId, label, icon) {
    const url = (state.tab && state.tab.url) || "";
    return el("button", { class: "ext-quickbtn", disabled: url ? undefined : "", onclick: () => openAction(OP_BY_ID[opId], url || undefined) }, [iconSvg(icon, { size: 13 }), label]);
  }
  function actionRow(op) {
    const t = toneOf(op.tone, COLOR_CODE);
    const tile = el("span", { class: "ext-tile", style: { color: t.fg, background: tint(t.base, 14, "var(--axon-page)"), border: `1px solid ${tint(t.base, 28)}` } }, iconSvg(op.icon, { size: 15 }));
    const name = el("span", { class: "ext-row-name" }, [op.name, op.async ? el("span", { class: "ext-async" }, "ASYNC") : null]);
    return el("button", { class: "ext-row", onclick: () => openAction(op) }, [
      tile,
      el("span", { class: "ext-row-main" }, [name, el("span", { class: "ext-row-sub" }, op.short)]),
      iconSvg("chevronRight", { size: 15, color: "var(--aurora-text-muted)" }),
    ]);
  }

  /* ── result view ── */
  function renderResult() {
    const op = state.op;
    const mode = argMode(op);
    panel.appendChild(resultHeader(op.name, () => { state.view = "browse"; render(); }));

    let argInput = null;
    if (mode !== "none") {
      const placeholder = mode === "url" ? "URL…" : op.argLabel || "input…";
      argInput = el("input", { class: "ext-arginput", type: "text", spellcheck: "false", autocomplete: "off", placeholder, value: state.pendingArg || "" });
      const run = () => runWithArg(op, argInput.value.trim());
      argInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
      panel.appendChild(el("div", { class: "ext-argbar" }, [
        el("span", { class: "ext-arg-icon" }, iconSvg(mode === "url" ? "link" : "search", { size: 14 })),
        argInput,
        el("button", { class: "ext-argrun", title: "Run", onclick: run }, [iconSvg("enter", { size: 13 }), "Run"]),
      ]));
    }

    const body = el("div", { class: "ext-scroll aurora-scrollbar", style: { paddingTop: "12px" } });
    state.bodyEl = body;
    panel.appendChild(body);
    panel.appendChild(footer());

    // decide initial run
    state.pendingArg = null;
    if (mode === "url") { const initial = state.initialArg != null ? state.initialArg : ((state.tab && state.tab.url) || ""); if (argInput) argInput.value = initial; runWithArg(op, initial); }
    else if (mode === "optional" || mode === "none") { if (state.initialArg) { if (argInput) argInput.value = state.initialArg; runWithArg(op, state.initialArg); } else runWithArg(op, ""); }
    else if (mode === "query") { if (state.initialArg) { if (argInput) argInput.value = state.initialArg; runWithArg(op, state.initialArg); } else { body.appendChild(promptHint(op)); if (argInput) setTimeout(() => argInput.focus(), 40); } }
    state.initialArg = null;
  }
  function promptHint(op) {
    return el("div", { class: "ext-loading" }, [Icon("arrowUp", 14, "var(--aurora-text-muted)"), `Enter a ${op.argLabel || "query"} above to run ${op.name}.`]);
  }
  async function runWithArg(op, arg) {
    const body = state.bodyEl;
    if (!body) return;
    body.textContent = "";
    body.appendChild(el("div", { class: "ext-loading" }, [axonMark(18, true), `Running ${op.name}…`]));
    const tones = toneOf(op.tone, COLOR_CODE);
    try {
      const raw = await callApi(op, arg);
      // refresh header status badge
      refreshResultBadge();
      body.textContent = "";
      body.appendChild(ActionBody(op, raw, tones, {
        onOpenDoc: (u) => openDoc(u),
        onAct: (kind, u) => openAction(OP_BY_ID[kind], u),
      }));
    } catch (error) {
      state.lastStatus = (error && error.status) || 0; // 0 = transport/network error
      refreshResultBadge();
      body.textContent = "";
      body.appendChild(errorCard(op, error));
    }
  }
  function refreshResultBadge() {
    // rebuild only the header to reflect the latest HTTP status
    const head = panel.querySelector(".ext-result-head");
    if (!head) return;
    const code = state.lastStatus;
    const ok = code >= 200 && code < 300;
    const label = code >= 100 ? String(code) : "ERR";
    const badge = head.querySelector(".ext-statusbadge");
    if (!badge) return;
    badge.className = `ext-statusbadge ${code === 202 ? "is-accepted" : !ok ? "is-error" : ""}`;
    badge.textContent = "";
    badge.appendChild(Icon(ok ? "check" : "alert", 11));
    badge.appendChild(document.createTextNode(label));
  }
  function errorCard(op, error) {
    const status = error && error.status ? error.status : "ERR";
    return el("div", { class: "ext-errorcard" }, [
      el("div", { class: "err-title" }, [Icon("alert", 15), `${op.name} failed${typeof status === "number" ? ` · ${status}` : ""}`]),
      el("div", { class: "err-body" }, friendlyError(error)),
      el("div", { class: "err-hint" }, "Check Settings (server URL + token), or that Axon is running."),
    ]);
  }

  /* ── doc viewer (sources → retrieve) ── */
  async function openDoc(url) {
    state.view = "doc";
    state.docUrl = url;
    render();
  }
  function renderDoc() {
    panel.appendChild(resultHeader("Document", () => { state.view = "result"; render(); }));
    const body = el("div", { class: "ext-scroll aurora-scrollbar", style: { paddingTop: "12px" } });
    panel.appendChild(body);
    panel.appendChild(footer());
    body.appendChild(el("div", { class: "ext-loading" }, [axonMark(18, true), "Loading document…"]));
    requestAxon("POST", "/v1/retrieve", { url: state.docUrl, max_points: 50, token_budget: 8000 })
      .then((raw) => { refreshResultBadge(); body.textContent = ""; body.appendChild(RetrieveDocFromRaw(raw, toneOf("cyan", COLOR_CODE))); })
      .catch((error) => { refreshResultBadge(); body.textContent = ""; body.appendChild(errorCard({ name: "Retrieve" }, error)); });
  }

  /* ── open an action (from row / quick action / context-menu intent) ── */
  function openAction(op, argOverride) {
    if (!op) return;
    state.op = op;
    state.initialArg = argOverride != null ? argOverride : null;
    state.view = "result";
    render();
  }
  function openOptions() {
    if (chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL("options.html"));
  }

  /* ── server status dot ── */
  async function checkHealth() {
    const cfg = await loadConfig();
    try { state.host = new URL(cfg.axonUrl).host; } catch { state.host = cfg.axonUrl; }
    state.online = null;
    if (state.view === "browse") render();
    try {
      await requestAxon("GET", "/healthz");
      state.online = true;
    } catch { state.online = false; }
    if (state.view === "browse") render();
  }

  /* ── context-menu intents ── */
  const INTENT_OPS = { scrape: "scrape", ingest: "ingest", ask: "ask" };
  function applyIntent(intent) {
    if (!intent || !intent.op) return;
    const opId = INTENT_OPS[intent.op];
    if (!opId) return;
    openAction(OP_BY_ID[opId], intent.arg || undefined);
  }
  async function consumePendingIntent() {
    if (!(chrome.storage && chrome.storage.local)) return;
    const { axonPendingIntent } = await chrome.storage.local.get(["axonPendingIntent"]);
    if (axonPendingIntent && Date.now() - (axonPendingIntent.ts || 0) < 60000) {
      await chrome.storage.local.remove(["axonPendingIntent"]);
      applyIntent(axonPendingIntent);
    }
  }

  /* ── boot ── */
  async function init() {
    state.tab = await getActiveTab();
    mount();
    checkHealth();
    consumePendingIntent();

    chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "axon-intent") applyIntent(msg);
    });
    chrome.tabs && chrome.tabs.onActivated && chrome.tabs.onActivated.addListener(async () => { state.tab = await getActiveTab(); if (state.view === "browse") render(); });
    chrome.tabs && chrome.tabs.onUpdated && chrome.tabs.onUpdated.addListener(async (_id, info) => { if (info.status === "complete" || info.url) { state.tab = await getActiveTab(); if (state.view === "browse") render(); } });
    chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.axonUrl || changes.axonToken)) checkHealth(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
