"use strict";

(() => {
  const API = "https://api.tcgdex.net/v2";
  const PRICE_TTL = 24 * 60 * 60 * 1000; // Preise 24 h zwischenspeichern
  // Cardmarket-Filter: language=3 → Deutsch, minCondition=3 → Excellent oder besser (1 Mint, 2 Near Mint, 3 Excellent)
  const CM_FILTER = "language=3&minCondition=3";
  const KEYS = {
    owned: "pkc.owned.v1",
    ownPrices: "pkc.ownPrices.v1",
    prices: "pkc.prices.v1",
    filter: "pkc.filter.v1",
    lastExport: "pkc.lastExport.v1",
  };
  const FILTERS = ["all", "missing", "owned"];
  const BACKUP_DAYS = 30; // danach erinnert die Seite ans Exportieren
  const RARITY = {
    "Illustration rare": "Illustration Rare",
    "Special illustration rare": "Special Illustration Rare",
    "Ultra Rare": "Ultra Rare · Full Art",
  };
  const ICONS = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.2 15.2L20 20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ---------- Speicher (localStorage, robust gegen Privatmodus) ----------
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* Speicher voll oder gesperrt – App läuft trotzdem weiter */
      }
    },
  };

  const savedOwned = store.get(KEYS.owned, []);
  const savedOwn = store.get(KEYS.ownPrices, {});
  const savedPrices = store.get(KEYS.prices, null);
  const savedFilter = store.get(KEYS.filter, "all");

  const state = {
    data: null,
    owned: new Set(Array.isArray(savedOwned) ? savedOwned : []),
    ownPrices: isPlainObject(savedOwn) ? savedOwn : {},
    prices: isPlainObject(savedPrices) && typeof savedPrices.fetchedAt === "number" && isPlainObject(savedPrices.cards) ? savedPrices : null,
    filter: FILTERS.includes(savedFilter) ? savedFilter : "all",
    query: [], // Suchbegriffe, normalisiert
    loadingPrices: false,
    views: new Map(), // Karten-ID → DOM-Referenzen
    lineViews: [],
    groupViews: [],
  };

  const $ = (sel) => document.querySelector(sel);
  const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const int = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  let filterTimer = null;
  let lightboxId = null;

  // ---------- Hilfsfunktionen ----------
  function isPlainObject(x) {
    return x != null && typeof x === "object" && !Array.isArray(x);
  }

  // klein, ohne Akzente: „Pokémon“ findet man auch mit „pokemon“
  function norm(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function num(x) {
    return typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null;
  }

  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of [].concat(children)) if (c != null) el.append(c);
    return el;
  }

  function fmtEur(x) {
    return x == null ? "–" : eur.format(x);
  }

  function fmtRange(lo, hi) {
    const a = Math.round(lo);
    const b = Math.round(hi);
    return a === b ? `${int.format(b)} €` : `${int.format(a)}–${int.format(b)} €`;
  }

  function parseEuro(text) {
    const cleaned = String(text).replace(/[€\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
  }

  function fmtAmount(x) {
    return Number.isInteger(x) ? int.format(x) : x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtMy([a, b]) {
    return a === b ? `${fmtAmount(a)} €` : `${fmtAmount(a)}–${fmtAmount(b)} €`;
  }

  // Eigene Preisspanne aus cards.json: "myPrice": [min, max] (oder eine einzelne Zahl)
  function myRange(card) {
    const m = card.myPrice;
    const arr = Array.isArray(m) ? m : m != null ? [m, m] : null;
    if (!arr) return null;
    const a = num(arr[0]);
    const b = num(arr.length > 1 ? arr[1] : arr[0]);
    if (a == null || b == null) return null;
    return [Math.min(a, b), Math.max(a, b)];
  }

  function cardNumber(card) {
    const set = state.data.sets[card.set];
    // Promos (z. B. MEP) haben keine offizielle Setgröße → nur die Nummer
    return set && set.official ? `${card.number}/${String(set.official).padStart(3, "0")}` : card.number;
  }

  function rarityLabel(card) {
    return RARITY[card.rarityEn] || card.rarityEn || card.rarity || "";
  }

  function livePrice(id) {
    return (state.prices && state.prices.cards[id]) || null;
  }

  function cardmarketUrl(card) {
    const p = livePrice(card.id);
    const id = (p && p.idProduct) || card.cardmarketId;
    if (id) return `https://www.cardmarket.com/de/Pokemon/Products?idProduct=${encodeURIComponent(id)}&${CM_FILTER}`;
    return `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(card.nameEn)}&${CM_FILTER}`;
  }

  // ---------- Fortschritt & Kosten ----------
  function slotDone(slot) {
    return slot.options.some((o) => state.owned.has(o.id));
  }

  // Reihenfolge: eingetragener Preis (gesehen/bezahlt) → meine Spanne aus cards.json → Cardmarket ab–Trend
  function cardEstimate(card) {
    const own = num(state.ownPrices[card.id]);
    if (own != null) return { lo: own, hi: own, own: true };
    const mine = myRange(card);
    if (mine) return { lo: mine[0], hi: mine[1], own: false, mine: true };
    const p = livePrice(card.id);
    if (!p) return null;
    const low = num(p.low);
    const trend = num(p.trend);
    if (low == null && trend == null) return null;
    const a = low ?? trend;
    const b = trend ?? low;
    return { lo: Math.min(a, b), hi: Math.max(a, b), own: false };
  }

  // Bei mehreren Optionen (Full Art oder SIR) zählt die günstigere.
  function slotEstimate(slot) {
    const ests = slot.options.map(cardEstimate).filter(Boolean);
    if (!ests.length) return null;
    return {
      lo: Math.min(...ests.map((e) => e.lo)),
      hi: Math.min(...ests.map((e) => e.hi)),
      own: ests.some((e) => e.own),
      mine: ests.some((e) => e.mine),
    };
  }

  function computeLine(line) {
    const r = { done: 0, total: line.slots.length, lo: 0, hi: 0, unknown: 0, own: false, mine: false };
    for (const slot of line.slots) {
      if (slotDone(slot)) {
        r.done++;
        continue;
      }
      const e = slotEstimate(slot);
      if (e) {
        r.lo += e.lo;
        r.hi += e.hi;
        r.own = r.own || e.own;
        r.mine = r.mine || e.mine;
      } else {
        r.unknown++;
      }
    }
    return r;
  }

  function costText(r) {
    const missing = r.total - r.done;
    if (missing === 0) return null;
    if (missing === r.unknown) return state.loadingPrices ? "…" : "Preis offen";
    return fmtRange(r.lo, r.hi) + (r.unknown ? " + ?" : "");
  }

  // ---------- Rendering ----------
  function renderLines() {
    const main = $("#lines");
    main.textContent = "";
    state.views.clear();
    state.lineViews = [];
    state.groupViews = [];

    const groups = Array.isArray(state.data.groups) ? state.data.groups : [];
    const known = new Set(groups.map((g) => g.id));
    for (const group of groups) {
      const lines = state.data.lines.filter((l) => l.group === group.id);
      if (!lines.length) continue;
      const count = h("span", { class: "group-count" });
      const head = h("header", { class: "group-head" }, [
        h("div", { class: "group-title" }, [h("h2", { id: `g-${group.id}` }, group.name), count]),
        group.subtitle ? h("p", { class: "group-sub" }, group.subtitle) : null,
      ]);
      main.append(head);
      const gv = { group, head, count, lines: [] };
      state.groupViews.push(gv);
      for (const line of lines) gv.lines.push(renderLine(main, line, `g-${group.id}`));
    }
    // Reihen ohne (bekannte) Gruppe trotzdem anzeigen
    for (const line of state.data.lines) if (!known.has(line.group)) renderLine(main, line, null);
  }

  function renderLine(main, line, groupHeadingId) {
    const count = h("span", { class: "line-count" });
    const barFill = h("i");
    const cost = h("span", { class: "line-cost" });
    const head = h("header", { class: "line-head" }, [
      line.name || line.typeLabel
        ? h("div", { class: "line-title" }, [
            line.name ? h("h3", { id: `h-${line.id}` }, line.name) : null,
            line.typeLabel ? h("span", { class: "type-chip" }, line.typeLabel) : null,
          ])
        : null,
      h("div", { class: "line-meta" }, [count, h("div", { class: "line-bar", "aria-hidden": "true" }, [barFill]), cost]),
    ]);
    const multi = line.slots.filter((s) => s.options.length > 1);
    if (multi.length) {
      head.append(
        h("p", { class: "line-hint" }, multi.map((s) => `${s.stage}: ${s.options.map((o) => o.variant).join(" oder ")}, eine reicht.`).join(" "))
      );
    }

    const cards = h("div", { class: "cards" });
    for (const slot of line.slots) {
      slot.options.forEach((card) => cards.append(renderCard(line, slot, card)));
    }

    const labelledBy = line.name ? `h-${line.id}` : groupHeadingId;
    const noStages = line.slots.every((s) => !s.stage && s.options.every((o) => !o.variant && !o.tag));
    const section = h("section", { class: noStages ? "line no-stages" : "line", "data-type": line.type, "aria-labelledby": labelledBy }, [head, cards]);
    main.append(section);
    const lv = { line, section, cards, count, barFill, cost };
    state.lineViews.push(lv);
    return lv;
  }

  function renderCard(line, slot, card) {
    const set = state.data.sets[card.set];
    const nr = cardNumber(card);

    const img = h("img", {
      crossorigin: "anonymous", // für den Offline-Speicher im Service Worker
      alt: `${card.name} ${nr}`,
      loading: "lazy",
      decoding: "async",
      width: 600,
      height: 825,
      sizes: "(min-width: 900px) 200px, 46vw",
    });
    const art = h("button", { type: "button", class: "art", "aria-pressed": "false" }, [
      img,
      h("span", { class: "art-fallback", "aria-hidden": "true" }, [h("span", { class: "ball" }), h("span", {}, [card.name, h("br"), nr])]),
      h("span", { class: "covered-note" }, slot.stage ? `${slot.stage} erledigt` : "erledigt"),
      h("span", { class: "check", html: ICONS.check }),
    ]);
    const zoom = h("button", { type: "button", class: "zoom", "aria-label": `${card.name} groß anzeigen` }, [h("span", { html: ICONS.zoom })]);

    // Eigene Spanne = Hauptpreis, Cardmarket-Richtwert als Vergleich. Ohne Spanne gilt der Richtwert als Schätzung.
    const mine = myRange(card);
    const priceVals = h("div", { class: "price-vals" });
    const price = h("div", { class: mine ? "price has-mine" : "price" }, [
      mine ? h("div", { class: "price-mine" }, [h("span", {}, "Meine Spanne"), h("b", {}, fmtMy(mine))]) : null,
      priceVals,
      // Die API-Werte mischen alle Sprachen und Zustände – nicht der Preis für deutsche Karten ab Excellent
      h("span", { class: "price-note" }, mine ? "Vergleich: Richtwert aller Sprachen & Zustände" : "Geschätzt: Richtwert aller Sprachen & Zustände"),
    ]);

    const input = h("input", {
      type: "text",
      inputmode: "decimal",
      autocomplete: "off",
      enterkeyhint: "done",
      placeholder: "z. B. 12,50 €",
      "aria-label": `Mein Preis für ${card.name} in Euro`,
    });
    const own = h("label", { class: "own" }, [h("span", {}, "Mein Preis (gesehen/bezahlt)"), input]);

    const link = h("a", { class: "btn cm-link", target: "_blank", rel: "noopener" }, [
      h("span", {}, "Auf Cardmarket ansehen"),
      h("span", { class: "cm-icon", html: ICONS.external }),
    ]);

    const el = h("article", { class: "card", "data-id": card.id }, [
      h("div", { class: "stage" }, [
        slot.stage,
        card.variant ? h("span", { class: "opt" }, card.variant) : null,
        card.tag ? h("span", { class: "opt opt-tag" }, card.tag) : null,
      ]),
      h("div", { class: "art-wrap" }, [art, zoom]),
      h("div", { class: "info" }, [
        h("h3", {}, card.name),
        h("p", { class: "meta" }, [h("span", { class: "num" }, nr), ` · ${card.set}`]),
        h("p", { class: "set" }, set.name),
        h("p", { class: "rarity" }, rarityLabel(card)),
        price,
        own,
        link,
        h("p", { class: "cm-hint" }, "Deutsch · ab Excellent"),
      ]),
    ]);

    // Suchtext: deutscher & englischer Name, Nummer (196) und Set-Kürzel (PAL) – ohne „/193“, sonst findet „1“ jede Karte
    const search = norm(`${card.name} ${card.nameEn || ""} ${card.number} ${card.set}`);
    const v = { el, card, slot, line, nr, search, art, img, price, priceVals, input, own, link, imgBase: null, imgStage: 0 };
    state.views.set(card.id, v);

    // Bild: deutsch → englisch → Platzhalter
    img.addEventListener("error", () => {
      if (v.imgStage === 0 && v.imgBase && v.imgBase.includes("/de/")) {
        v.imgStage = 1;
        setImgSrc(img, v.imgBase.replace("/de/", "/en/"));
      } else {
        art.classList.add("no-img");
      }
    });
    img.addEventListener("load", () => art.classList.remove("no-img"));

    art.addEventListener("click", () => toggleOwned(card.id));
    zoom.addEventListener("click", () => openLightbox(card.id));

    const stored = num(state.ownPrices[card.id]);
    if (stored != null) input.value = stored.toFixed(2).replace(".", ",");
    input.addEventListener("input", () => setOwnPrice(card.id, input.value));
    input.addEventListener("blur", () => {
      const n = num(state.ownPrices[card.id]);
      input.value = n == null ? "" : n.toFixed(2).replace(".", ",");
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });

    return el;
  }

  function setImgSrc(img, base) {
    img.srcset = `${base}/low.webp 245w, ${base}/high.webp 600w`;
    img.src = `${base}/low.webp`;
  }

  function updateImage(v) {
    const p = livePrice(v.card.id);
    const base = (p && p.image) || v.card.image;
    if (!base) {
      v.art.classList.add("no-img");
      return;
    }
    if (v.imgBase === base) return;
    v.imgBase = base;
    v.imgStage = 0;
    v.art.classList.remove("no-img");
    setImgSrc(v.img, base);
  }

  function updatePrices() {
    for (const v of state.views.values()) {
      const p = livePrice(v.card.id);
      const low = p ? num(p.low) : null;
      const trend = p ? num(p.trend) : null;
      v.priceVals.textContent = "";
      if (low == null && trend == null) {
        v.price.classList.add("is-empty");
        v.priceVals.append(state.loadingPrices ? "Preis lädt …" : "Kein Richtwert verfügbar");
      } else {
        v.price.classList.remove("is-empty");
        v.priceVals.append(h("span", {}, ["ab ", h("b", {}, fmtEur(low))]), h("span", {}, ["Trend ", h("b", {}, fmtEur(trend))]));
      }
      v.link.href = cardmarketUrl(v.card);
      updateImage(v);
    }
  }

  function updateStates() {
    for (const v of state.views.values()) {
      const owned = state.owned.has(v.card.id);
      const covered = !owned && slotDone(v.slot);
      v.el.classList.toggle("is-owned", owned);
      v.el.classList.toggle("is-covered", covered);
      v.art.setAttribute("aria-pressed", String(owned));
      v.art.setAttribute("aria-label", `${v.card.name} ${v.nr}: ${owned ? "vorhanden, antippen zum Entfernen" : "fehlt, antippen zum Abhaken"}`);
    }
  }

  function updateSummary() {
    let slots = 0;
    let done = 0;
    let linesDone = 0;
    let lo = 0;
    let hi = 0;
    let unknown = 0;
    let own = false;
    let mine = false;
    const results = new Map();

    for (const lv of state.lineViews) {
      const r = computeLine(lv.line);
      results.set(lv, r);
      slots += r.total;
      done += r.done;
      lo += r.lo;
      hi += r.hi;
      unknown += r.unknown;
      own = own || r.own;
      mine = mine || r.mine;
      const complete = r.done === r.total;
      if (complete) linesDone++;

      lv.count.textContent = `${r.done}/${r.total}`;
      lv.barFill.style.width = `${(r.done / r.total) * 100}%`;
      lv.section.classList.toggle("is-complete", complete);
      const c = costText(r);
      lv.cost.textContent = complete ? "Komplett ✓" : `noch ${c}`;
    }

    for (const gv of state.groupViews) {
      let gDone = 0;
      let gTotal = 0;
      for (const lv of gv.lines) {
        const r = results.get(lv);
        gDone += r.done;
        gTotal += r.total;
      }
      gv.count.textContent = `${gDone}/${gTotal}`;
      gv.head.classList.toggle("is-complete", gDone === gTotal);
    }

    $("#totalOwned").textContent = done;
    $("#totalSlots").textContent = slots;
    $("#totalBar").style.width = slots ? `${(done / slots) * 100}%` : "0";
    $("#linesDone").textContent = `${linesDone} von ${state.lineViews.length} Reihen & Gruppen komplett`;

    const missing = slots - done;
    const totalCost = $("#totalCost");
    const hint = $("#totalCostHint");
    if (missing === 0) {
      totalCost.textContent = "0 €";
      hint.textContent = "Alles gesammelt!";
    } else if (missing === unknown) {
      totalCost.textContent = state.loadingPrices ? "…" : "–";
      hint.textContent = state.loadingPrices ? "Preise laden" : "keine Preise verfügbar";
    } else {
      totalCost.textContent = fmtRange(lo, hi) + (unknown ? " + ?" : "");
      const parts = [mine ? "meine Spannen, sonst ab-Preis bis Trend" : "ab-Preis bis Trend"];
      if (own) parts.push("inkl. eigener Preise");
      if (unknown) parts.push(`${unknown} ohne Preis`);
      hint.textContent = parts.join(" · ");
    }
  }

  function applyFilter() {
    clearTimeout(filterTimer);
    const f = state.filter;
    let anyVisible = false;
    for (const lv of state.lineViews) {
      let lineVisible = false;
      for (const slot of lv.line.slots) {
        const done = slotDone(slot);
        for (const card of slot.options) {
          const owned = state.owned.has(card.id);
          const v = state.views.get(card.id);
          const show =
            (f === "all" || (f === "owned" && owned) || (f === "missing" && !owned && !done)) &&
            state.query.every((t) => v.search.includes(t));
          v.el.hidden = !show;
          lineVisible = lineVisible || show;
        }
      }
      lv.section.hidden = !lineVisible;
      anyVisible = anyVisible || lineVisible;
    }
    for (const gv of state.groupViews) gv.head.hidden = gv.lines.every((lv) => lv.section.hidden);
    const empty = $("#emptyState");
    empty.hidden = anyVisible;
    if (!anyVisible && state.query.length)
      empty.textContent = `Keine Karte gefunden für „${$("#search").value.trim()}“.` + (f === "all" ? "" : " Tipp: Filter auf „Alle“ stellen.");
    else if (!anyVisible) empty.textContent = f === "missing" ? "Alles gesammelt, keine Karte fehlt mehr! 🎉" : "Noch keine Karte abgehakt. Tippe auf ein Kartenbild, um es abzuhaken.";

    document.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.filter === f)));
  }

  // ---------- Aktionen ----------
  function toggleOwned(id, force) {
    const next = typeof force === "boolean" ? force : !state.owned.has(id);
    if (next) state.owned.add(id);
    else state.owned.delete(id);
    store.set(KEYS.owned, [...state.owned]);

    const v = state.views.get(id);
    if (next && v) {
      v.el.classList.add("just-owned");
      setTimeout(() => v.el.classList.remove("just-owned"), 400);
      if (navigator.vibrate) navigator.vibrate(12);
    }
    updateStates();
    updateSummary();
    if (state.filter !== "all") {
      // kurz warten, damit man den Haken noch sieht, bevor die Karte ausgeblendet wird
      clearTimeout(filterTimer);
      filterTimer = setTimeout(applyFilter, 700);
    }
    if (lightboxId === id) updateLightboxToggle();
  }

  function setOwnPrice(id, text) {
    const n = parseEuro(text);
    const v = state.views.get(id);
    if (n == null || n === 0) {
      delete state.ownPrices[id];
    } else if (Number.isNaN(n)) {
      return; // Tippfehler ignorieren, alter Wert bleibt
    } else {
      state.ownPrices[id] = n;
    }
    store.set(KEYS.ownPrices, state.ownPrices);
    if (v) v.own.classList.toggle("has-value", state.ownPrices[id] != null);
    updateSummary();
  }

  function setFilter(f) {
    if (!FILTERS.includes(f)) return;
    state.filter = f;
    store.set(KEYS.filter, f);
    applyFilter();
  }

  function setSearch(text) {
    // „#199“ und „199/165“ → „199“
    state.query = norm(text).replace(/#|\/\d*/g, " ").split(/\s+/).filter(Boolean);
    $("#searchClear").hidden = !text;
    if (!state.data) return; // Karten noch nicht geladen, init() filtert danach
    // Wischreihen auf dem Handy nach vorne, damit Treffer sichtbar sind
    for (const lv of state.lineViews) lv.cards.scrollLeft = 0;
    applyFilter();
    // Weit unten gescrollt? Treffer direkt unter die Suchleiste holen
    const top = $(".hero").offsetHeight;
    if (window.scrollY > top) window.scrollTo({ top });
  }

  function updateBackupReminder() {
    const last = store.get(KEYS.lastExport, null);
    const days = typeof last === "number" ? Math.floor((Date.now() - last) / 864e5) : null;
    const due = state.owned.size > 0 && (days == null || days >= BACKUP_DAYS);
    $("#backupReminder").hidden = !due;
    if (due) $("#backupReminderText").textContent = days == null ? "Dein Stand ist noch nicht gesichert." : `Letzte Sicherung vor ${days} Tagen.`;
  }

  function showNotice(text) {
    const n = $("#notice");
    n.textContent = text || "";
    n.hidden = !text;
  }

  // ---------- Preise von TCGdex ----------
  async function fetchJson(url, ms = 8000, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchCard(id) {
    try {
      return await fetchJson(`${API}/de/cards/${encodeURIComponent(id)}`);
    } catch {
      return await fetchJson(`${API}/en/cards/${encodeURIComponent(id)}`);
    }
  }

  function extractPrice(c) {
    const cm = c && c.pricing && c.pricing.cardmarket;
    const first = (...vals) => vals.map(num).find((x) => x != null) ?? null;
    return {
      low: cm ? first(cm.low, cm["low-holo"]) : null,
      trend: cm ? first(cm.trend, cm["trend-holo"], cm.avg30, cm.avg7, cm.avg) : null,
      idProduct: (cm && cm.idProduct) || null,
      updated: (cm && cm.updated) || null,
      image: (c && c.image) || null,
    };
  }

  function priceStamp() {
    if (!state.prices) return "Noch keine Preise geladen.";
    const d = new Date(state.prices.fetchedAt);
    return `Cardmarket-Richtwerte via TCGdex · Stand ${d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`;
  }

  function allCardIds() {
    return state.data.lines.flatMap((l) => l.slots.flatMap((s) => s.options.map((o) => o.id)));
  }

  async function loadPrices(force) {
    const status = $("#priceStatus");
    const btn = $("#refreshPrices");
    const fresh = state.prices && Date.now() - state.prices.fetchedAt < PRICE_TTL;
    // Neu hinzugekommene Karten auch bei frischem Cache sofort nachladen
    const uncached = allCardIds().filter((id) => !livePrice(id));
    if (fresh && !force && !uncached.length) {
      status.textContent = priceStamp();
      return;
    }
    if (state.loadingPrices) return;

    state.loadingPrices = true;
    btn.disabled = true;
    btn.classList.add("is-loading");
    updatePrices();
    updateSummary();

    const onlyMissing = fresh && !force;
    const ids = onlyMissing ? uncached : allCardIds();
    const result = { ...(state.prices ? state.prices.cards : {}) };
    let done = 0;
    let ok = 0;
    let failed = 0;
    let next = 0;

    const worker = async () => {
      while (next < ids.length) {
        // Wenn die ersten Anfragen alle scheitern, ist die API wohl down – nicht ewig weiterprobieren.
        if (ok === 0 && failed >= 6) return;
        const id = ids[next++];
        try {
          result[id] = extractPrice(await fetchCard(id));
          ok++;
        } catch {
          failed++;
        }
        done++;
        status.textContent = `Preise werden geladen … ${done}/${ids.length}`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));

    if (ok > 0) {
      // Beim reinen Nachladen bleibt der Zeitstempel (und damit die 24-h-Frist) der übrigen Preise erhalten
      state.prices = { fetchedAt: onlyMissing ? state.prices.fetchedAt : Date.now(), cards: result };
      store.set(KEYS.prices, state.prices);
    }
    state.loadingPrices = false;
    btn.disabled = false;
    btn.classList.remove("is-loading");

    if (ok === 0) {
      showNotice(
        state.prices
          ? "TCGdex ist gerade nicht erreichbar. Angezeigt werden die zuletzt gespeicherten Preise. Abhaken funktioniert ganz normal."
          : "TCGdex ist gerade nicht erreichbar, daher gibt es keine Preise. Abhaken, Nummern und Cardmarket-Links funktionieren trotzdem."
      );
    } else if (ok < ids.length) {
      showNotice(`${ids.length - ok} Karten konnten nicht aktualisiert werden. Für sie gelten die zuletzt gespeicherten Werte.`);
    } else {
      showNotice("");
    }
    status.textContent = priceStamp();
    updatePrices();
    updateSummary();
  }

  // ---------- Lightbox ----------
  function openLightbox(id) {
    const v = state.views.get(id);
    const dlg = $("#lightbox");
    if (!v || typeof dlg.showModal !== "function") return;
    lightboxId = id;

    const img = $("#lightboxImg");
    const base = v.imgBase ? (v.imgStage === 1 ? v.imgBase.replace("/de/", "/en/") : v.imgBase) : null;
    img.onerror = null;
    if (base) {
      img.src = `${base}/high.webp`;
      img.onerror = () => {
        img.onerror = null;
        img.src = `${base}/low.webp`;
      };
    } else {
      img.removeAttribute("src");
    }
    img.alt = `${v.card.name} ${v.nr}`;
    $("#lightboxName").textContent = v.card.name;
    $("#lightboxMeta").textContent = `${state.data.sets[v.card.set].name} · ${v.nr} · ${rarityLabel(v.card)}`;
    updateLightboxToggle();

    document.documentElement.classList.add("lb-open");
    dlg.showModal();
  }

  function updateLightboxToggle() {
    const owned = state.owned.has(lightboxId);
    const btn = $("#lightboxToggle");
    btn.setAttribute("aria-pressed", String(owned));
    btn.textContent = owned ? "✓ Hab ich" : "Hab ich";
  }

  // ---------- Export / Import ----------
  async function exportData() {
    const payload = {
      app: "pokemon-karten-checkliste",
      version: 1,
      exportedAt: new Date().toISOString(),
      owned: [...state.owned].sort(),
      ownPrices: state.ownPrices,
    };
    const file = new File([JSON.stringify(payload, null, 2)], `karten-checkliste-${new Date().toISOString().slice(0, 10)}.json`, {
      type: "application/json",
    });
    // iPhone-App vom Home-Bildschirm: Downloads sind dort unzuverlässig → Teilen-Menü („In Dateien sichern“, AirDrop …)
    if (navigator.standalone && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch {
        return; // abgebrochen → nicht als gesichert zählen
      }
    } else {
      const url = URL.createObjectURL(file);
      const a = h("a", { href: url, download: file.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    store.set(KEYS.lastExport, Date.now());
    updateBackupReminder();
  }

  async function importData(file) {
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      alert("Die Datei ist kein gültiges JSON.");
      return;
    }
    if (!isPlainObject(payload) || !Array.isArray(payload.owned)) {
      alert("Die Datei sieht nicht nach einem Export dieser Checkliste aus.");
      return;
    }
    const known = new Set(state.views.keys());
    const owned = payload.owned.filter((id) => known.has(id));
    const ownPrices = {};
    if (isPlainObject(payload.ownPrices)) {
      for (const [id, val] of Object.entries(payload.ownPrices)) if (known.has(id) && num(val) != null) ownPrices[id] = val;
    }
    const ok = confirm(
      `Import: ${owned.length} abgehakte Karten und ${Object.keys(ownPrices).length} eigene Preise.\n\nDein aktueller Stand in diesem Browser wird ersetzt. Fortfahren?`
    );
    if (!ok) return;

    state.owned = new Set(owned);
    state.ownPrices = ownPrices;
    store.set(KEYS.owned, owned);
    store.set(KEYS.ownPrices, ownPrices);
    for (const v of state.views.values()) {
      const n = num(ownPrices[v.card.id]);
      v.input.value = n == null ? "" : n.toFixed(2).replace(".", ",");
      v.own.classList.toggle("has-value", n != null);
    }
    updateStates();
    updateSummary();
    applyFilter();
    store.set(KEYS.lastExport, Date.now()); // die importierte Datei ist ja eine Sicherung
    updateBackupReminder();
    showNotice(`Import erfolgreich: ${owned.length} Karten abgehakt.`);
  }

  // ---------- Start ----------
  function bindUi() {
    document.querySelectorAll(".segmented button").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.filter)));
    const search = $("#search");
    search.addEventListener("input", () => setSearch(search.value));
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") search.blur(); // Handy-Tastatur zuklappen
    });
    $("#searchClear").addEventListener("click", () => {
      search.value = "";
      setSearch("");
      search.focus();
    });
    $("#refreshPrices").addEventListener("click", () => loadPrices(true));
    $("#exportBtn").addEventListener("click", exportData);
    $("#backupReminderBtn").addEventListener("click", exportData);
    $("#importFile").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importData(file);
      e.target.value = "";
    });

    const dlg = $("#lightbox");
    $("#lightboxClose").addEventListener("click", () => dlg.close());
    $("#lightboxToggle").addEventListener("click", () => toggleOwned(lightboxId));
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || e.target.classList.contains("lightbox-inner")) dlg.close();
    });
    dlg.addEventListener("close", () => {
      document.documentElement.classList.remove("lb-open");
      lightboxId = null;
    });
  }

  // Abhak-Status und eigene Preise von Karten löschen, die nicht mehr in cards.json stehen
  function pruneRemovedCards() {
    const known = new Set(allCardIds());
    const owned = [...state.owned].filter((id) => known.has(id));
    if (owned.length !== state.owned.size) {
      state.owned = new Set(owned);
      store.set(KEYS.owned, owned);
    }
    const stale = Object.keys(state.ownPrices).filter((id) => !known.has(id));
    if (stale.length) {
      for (const id of stale) delete state.ownPrices[id];
      store.set(KEYS.ownPrices, state.ownPrices);
    }
    if (state.prices) {
      const cached = Object.keys(state.prices.cards).filter((id) => !known.has(id));
      if (cached.length) {
        for (const id of cached) delete state.prices.cards[id];
        store.set(KEYS.prices, state.prices);
      }
    }
  }

  async function init() {
    bindUi();
    try {
      state.data = await fetchJson("cards.json", 15000, { cache: "no-cache" });
    } catch {
      $("#lines").innerHTML =
        '<p class="loading">cards.json konnte nicht geladen werden. Öffne die Seite über GitHub Pages oder einen lokalen Webserver (nicht per Doppelklick als Datei).</p>';
      $("#priceStatus").textContent = "";
      return;
    }
    pruneRemovedCards();
    renderLines();
    for (const v of state.views.values()) v.own.classList.toggle("has-value", num(state.ownPrices[v.card.id]) != null);
    updateStates();
    updatePrices();
    updateSummary();
    applyFilter();
    updateBackupReminder();
    loadPrices(false);
    // iPhone-App vom Home-Bildschirm hat keinen Neu-laden-Knopf → nach 1 h im Hintergrund selbst neu laden (holt Updates)
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60 * 60 * 1000) location.reload();
    });
    // Offline-Betrieb und Bitte, den Speicher nicht automatisch zu löschen (Browser darf ablehnen)
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  init();
})();
