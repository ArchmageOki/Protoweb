import { authFetch, apiBase } from "/src/auth.js";

// =============================
// Bloque: Configuración Título Automático
// =============================
(function autoTitleConfig() {
  const SETTINGS_ENDPOINT = apiBase + "/data/settings";
  try {
    const container = document.createElement("section");
    container.className =
      "rounded-xl border border-slate-200 bg-white/90 backdrop-blur-sm p-6 shadow-sm";
    container.innerHTML = `
          <header class="mb-4 flex items-center justify-between gap-2 flex-wrap">
            <h2 class="text-sm font-semibold tracking-wide text-slate-700 uppercase">Título automático</h2>
            <button type="button" id="auto-title-reset" class="text-[11px] px-2 py-1 rounded border border-slate-300 hover:bg-slate-100">Restablecer</button>
          </header>
          <p class="text-[11px] text-slate-500 mb-4 leading-snug max-w-prose">Define el orden de los fragmentos que compondrán un título cuando marques "Título automático" en un evento. Sólo se incluirán los fragmentos con datos disponibles. En el caso de <strong>Instagram &gt; móvil</strong> se toma Instagram si existe; en caso contrario el móvil.</p>
          <div>
            <h3 class="text-xs font-semibold mb-2 text-slate-600">Fragmentos disponibles</h3>
            <ul id="auto-title-fragments" class="flex flex-wrap gap-2 text-xs"></ul>
          </div>
          <div class="mt-6">
            <h3 class="text-xs font-semibold mb-2 text-slate-600">Orden actual</h3>
            <div id="auto-title-order" class="min-h-[3rem] p-2 rounded border border-dashed border-slate-300 flex flex-wrap gap-2 text-xs select-none"></div>
            <div class="mt-3 flex gap-2">
              <button type="button" id="auto-title-save" class="px-3 py-1.5 rounded bg-slate-900 text-white text-xs hover:bg-slate-800">Guardar</button>
              <button type="button" id="auto-title-clear" class="px-3 py-1.5 rounded border border-slate-300 text-xs hover:bg-slate-100">Vaciar</button>
            </div>
            <p class="text-[11px] text-slate-500 mt-2">Arrastra para reordenar (drag suave). Click para añadir / quitar.</p>
            <p class="text-[11px] text-slate-500 mt-1">Vista previa: <span id="auto-title-preview" class="font-medium text-slate-700"></span></p>
          </div>
        `;
    const rootMain = document.querySelector("main");
    rootMain?.appendChild(container);
    const FRAGMENTS = [
      { key: "nombre", label: "Nombre" },
      { key: "nombre_completo", label: "Nombre completo" },
      { key: "instagram", label: "Instagram" },
      { key: "movil", label: "Móvil" },
      { key: "ig_or_movil", label: "Instagram > móvil" },
      { key: "hora_inicio", label: "Hora de inicio" },
      { key: "hora_fin", label: "Hora de fin" },
      { key: "precio_total", label: "Precio total" },
      { key: "precio_pendiente", label: "Precio pendiente" },
      { key: "precio_pagado", label: "Precio pagado" },
      { key: "notas", label: "Notas" },
    ];
    async function load() {
      try {
        const r = await authFetch(SETTINGS_ENDPOINT);
        if (r.ok) {
          const j = await r.json();
          return j.settings?.auto_title_config?.order || [];
        }
      } catch {}
      return [];
    }
    const orderBox = container.querySelector("#auto-title-order");
    const listBox = container.querySelector("#auto-title-fragments");
    const previewSpan = container.querySelector("#auto-title-preview");
    const resetBtn = container.querySelector("#auto-title-reset");
    const saveBtn = container.querySelector("#auto-title-save");
    const clearBtn = container.querySelector("#auto-title-clear");
    let current = [];
    (async () => {
      current = await load();
      renderAvailable();
      renderOrder();
    })();
    function renderAvailable() {
      listBox.innerHTML = "";
      FRAGMENTS.forEach((f) => {
        const li = document.createElement("li");
        const used = current.includes(f.key);
        li.innerHTML = `<button type="button" data-frag="${
          f.key
        }" class="px-2 py-1 rounded border ${
          used
            ? "border-slate-200 text-slate-400 line-through"
            : "border-slate-300 hover:bg-slate-100"
        } text-left whitespace-nowrap">${f.label}</button>`;
        listBox.appendChild(li);
      });
    }
    function renderOrder() {
      orderBox.innerHTML = "";
      current.forEach((k) => {
        const f = FRAGMENTS.find((x) => x.key === k);
        if (!f) return;
        const chip = document.createElement("div");
        chip.className =
          "group flex items-center gap-1 px-2 py-1 rounded bg-slate-100 border border-slate-300 cursor-move whitespace-nowrap";
        chip.setAttribute("data-frag", k);
        chip.innerHTML = `<span class="">${f.label}</span><button type="button" class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-600" title="Quitar" data-remove="${k}">×</button>`;
        orderBox.appendChild(chip);
      });
      updatePreview();
    }
    function updatePreview() {
      const sample = {
        nombre: "Ana",
        instagram: "ana.dev",
        movil: "+34123456789",
        hora_inicio: "10:00",
        hora_fin: "11:00",
        precio_total: "120 €",
        precio_pendiente: "40 €",
        precio_pagado: "80 €",
        notas: "Retoque color",
      };
      const parts = current
        .map((k) => {
          if (k === "ig_or_movil") return sample.instagram || sample.movil;
          return sample[k] || "";
        })
        .filter(Boolean);
      previewSpan.textContent = parts.join(" - ");
    }
    listBox.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-frag]");
      if (!btn) return;
      const frag = btn.getAttribute("data-frag");
      if (current.includes(frag)) return;
      current.push(frag);
      renderAvailable();
      renderOrder();
    });
    orderBox.addEventListener("click", (e) => {
      const rm = e.target.closest("button[data-remove]");
      if (!rm) return;
      const frag = rm.getAttribute("data-remove");
      current = current.filter((k) => k !== frag);
      renderAvailable();
      renderOrder();
    });
    let dragState = null;
    orderBox.addEventListener("mousedown", (e) => {
      const target = e.target.closest("[data-frag]");
      if (!target) return;
      e.preventDefault();
      const key = target.getAttribute("data-frag");
      const rect = target.getBoundingClientRect();
      dragState = {
        key,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        ghost: null,
      };
      const ghost = target.cloneNode(true);
      const span = ghost.querySelector("span");
      if (span) {
        span.style.maxWidth = "none";
        span.classList.remove("truncate");
        span.textContent = span.textContent + " ";
      }
      ghost.style.whiteSpace = "nowrap";
      ghost.style.width = "auto";
      ghost.style.minWidth = rect.width + "px";
      ghost.style.paddingRight = "12px";
      ghost.style.position = "fixed";
      ghost.style.left = rect.left + "px";
      ghost.style.top = rect.top + "px";
      ghost.style.width = rect.width + "px";
      ghost.style.pointerEvents = "none";
      ghost.style.opacity = "0.85";
      ghost.style.zIndex = "9999";
      ghost.classList.add("ring", "ring-slate-300");
      document.body.appendChild(ghost);
      dragState.ghost = ghost;
      target.classList.add("opacity-40");
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragState) return;
      e.preventDefault();
      const { ghost, offsetX, offsetY } = dragState;
      if (ghost) {
        ghost.style.left = e.clientX - offsetX + "px";
        ghost.style.top = e.clientY - offsetY + "px";
      }
      const chips = Array.from(orderBox.querySelectorAll("[data-frag]"));
      for (const chip of chips) {
        const r = chip.getBoundingClientRect();
        if (
          e.clientX > r.left &&
          e.clientX < r.right &&
          e.clientY > r.top &&
          e.clientY < r.bottom
        ) {
          const keyOver = chip.getAttribute("data-frag");
          if (keyOver && keyOver !== dragState.key) {
            const srcIdx = current.indexOf(dragState.key);
            const tgtIdx = current.indexOf(keyOver);
            if (srcIdx > -1 && tgtIdx > -1) {
              current.splice(tgtIdx, 0, current.splice(srcIdx, 1)[0]);
              renderAvailable();
              renderOrder();
              const newEl = orderBox.querySelector(
                `[data-frag="${dragState.key}"]`
              );
              newEl?.classList.add("opacity-40");
            }
          }
          break;
        }
      }
    });
    window.addEventListener("mouseup", () => {
      if (!dragState) return;
      dragState.ghost?.remove();
      const el = orderBox.querySelector(`[data-frag="${dragState.key}"]`);
      el?.classList.remove("opacity-40");
      dragState = null;
    });
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      const orig = saveBtn.textContent;
      saveBtn.textContent = "Guardando...";
      try {
        const payload = { auto_title_config: { order: current } };
        const r = await authFetch(SETTINGS_ENDPOINT, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error("save_failed");
        saveBtn.textContent = "Guardado";
        window.dispatchEvent(
          new CustomEvent("autoTitle:orderSaved", {
            detail: { order: current },
          })
        );
      } catch (e) {
        console.error("[auto-title][save] error", e);
        saveBtn.textContent = "Error";
        setTimeout(() => {
          saveBtn.textContent = orig;
        }, 1800);
      } finally {
        setTimeout(() => {
          saveBtn.disabled = false;
          if (saveBtn.textContent === "Guardado") saveBtn.textContent = orig;
        }, 1200);
      }
    });
    clearBtn.addEventListener("click", () => {
      current = [];
      renderAvailable();
      renderOrder();
    });
    resetBtn.addEventListener("click", () => {
      current = ["nombre"];
      renderAvailable();
      renderOrder();
    });
  } catch (err) {
    console.error("[auto-title] init error", err);
  }
})();

// Extra Checks
(function () {
  const KEY = "app.settings";
  const root = document.getElementById("extra-checks-root");
  if (!root) return;
  console.log("[extra-checks] init");
  const DEFAULTS = {
    extraChecks: {
      1: {
        visible: true,
        style: "border",
        color: "#16a34a",
        icon: "✔",
        label: "Check 1",
      },
      2: {
        visible: false,
        style: "shadow",
        color: "#0ea5e9",
        icon: "★",
        label: "Check 2",
      },
      3: {
        visible: false,
        style: "icon",
        color: "#f59e0b",
        icon: "⚑",
        label: "Check 3",
      },
    },
  };
  async function fetchServer() {
    try {
      const r = await authFetch(apiBase + "/data/settings");
      if (!r.ok) throw new Error("fetch_failed");
      const j = await r.json();
      return j.settings?.extra_checks || {};
    } catch {
      return {};
    }
  }
  function mergeLocal(base) {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "{}");
      return { ...base, ...(s.extraChecks || {}) };
    } catch {
      return base;
    }
  }
  function persistLocal(extraChecks) {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "{}");
      const next = { ...s, extraChecks };
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  }
  let _cache = null;
  async function load() {
    if (_cache) return _cache;
    const server = await fetchServer();
    const merged = mergeLocal(server);
    const final = {
      ...DEFAULTS,
      extraChecks: { ...DEFAULTS.extraChecks, ...merged },
    };
    _cache = final;
    return final;
  }
  async function save(cfg) {
    persistLocal(cfg.extraChecks);
    try {
      await authFetch(apiBase + "/data/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extra_checks: cfg.extraChecks }),
      });
    } catch (e) {
      /* silencioso: fallback ya guardado local */
    }
    window.dispatchEvent(new CustomEvent("extraChecks:updated"));
  }
  const COLOR_VIVID = [
    "#16a34a",
    "#0ea5e9",
    "#f59e0b",
    "#dc2626",
    "#7c3aed",
    "#0d9488",
    "#334155",
  ];
  const COLOR_PASTEL = [
    "#bbf7d0",
    "#bae6fd",
    "#fde68a",
    "#fecaca",
    "#ddd6fe",
    "#99f6e4",
    "#cbd5e1",
  ];
  const STYLE_OPTIONS = [
    { value: "border", label: "Borde" },
    { value: "shadow", label: "Sombra" },
    { value: "icon", label: "Icono" },
  ];
  const ICON_PRESETS = ["✔", "★", "⚑", "✚", "✱", "●", "◆"];
  function buildColorButtons(style, selectedColor, k) {
    const palette = style === "border" ? COLOR_VIVID : COLOR_PASTEL;
    const btns = palette
      .map(
        (col) =>
          `<button type="button" data-role="color" data-k="${k}" data-color="${col}" class="w-5 h-5 rounded border ${
            col === selectedColor ? "ring-2 ring-offset-1 ring-slate-500" : ""
          }" style="background:${col}"></button>`
      )
      .join("");
    return (
      btns +
      `<button type="button" data-role="color-custom" data-k="${k}" class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center text-[10px] font-bold hover:bg-slate-100 relative" title="Color personalizado">+</button>`
    );
  }
  function escapeHtml(str) {
    return String(str || "").replace(
      /[&<>"']/g,
      (s) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[s])
    );
  }
  function buildPreview(cfg) {
    const exampleText = "10:00 Juan Pérez - 100 €";
    if (cfg.style === "icon") {
      // Icono sin borde: centrado y heredando color
      return `<span class="inline-flex items-center gap-1 text-[11px] font-medium"><span class="inline-flex items-center justify-center w-5 h-5 text-xs">${
        cfg.icon || "★"
      }</span>${exampleText}</span>`;
    }
    if (cfg.style === "shadow") {
      const col = cfg.color;
      const rgb =
        col.startsWith("#") && col.length === 7
          ? [
              parseInt(col.slice(1, 3), 16),
              parseInt(col.slice(3, 5), 16),
              parseInt(col.slice(5, 7), 16),
            ]
          : [0, 0, 0];
      const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      const textColor = lum > 0.55 ? "#1e293b" : "#ffffff";
      return `<span class="inline-block text-[11px] px-2 py-0.5 rounded font-medium shadow-sm" style="background:${col};color:${textColor}">${exampleText}</span>`;
    }
    // border: sólo borde coloreado, texto mantiene color por defecto
    return `<span class="inline-block text-[11px] px-2 py-0.5 rounded border font-medium" style="border-color:${cfg.color}">${exampleText}</span>`;
  }
  async function render() {
    const state = await load();
    root.innerHTML = "";
    Object.entries(state.extraChecks).forEach(([k, cfg]) => {
      const card = document.createElement("div");
      card.className =
        "rounded-lg border border-slate-200 p-4 bg-white/70 flex flex-col gap-3";
      card.setAttribute("data-card", k);
      const hasColor = cfg.style === "border" || cfg.style === "shadow";
      const showIcons = cfg.style === "icon";
      card.innerHTML = `
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <h3 class="text-xs font-semibold text-slate-600 m-0 leading-none"><span data-label-display>${
                    cfg.label || "Check " + k
                  }</span></h3>
                  <button type="button" data-action="edit-label" data-k="${k}" class="text-slate-500 hover:text-slate-700 p-1 rounded border border-transparent hover:border-slate-300 text-[11px]" title="Editar nombre">✎</button>
                </div>
                <label class="flex items-center gap-1 text-[11px] cursor-pointer select-none">
                  <span>Activar</span>
                  <input data-role="visible" data-k="${k}" type="checkbox" class="rounded border-slate-300 h-3 w-3" ${
        cfg.visible ? "checked" : ""
      } />
                </label>
              </div>
              <div class="flex flex-wrap items-start gap-6 text-[11px]" data-layout-row>
                <div class="flex flex-col gap-1">
                  <span class="font-medium text-slate-600">Estilo</span>
                  <select id="style-${k}" data-role="style" data-k="${k}" class="h-8 w-28 rounded border-slate-300 px-2 py-1">${STYLE_OPTIONS.map(
        (o) =>
          `<option value="${o.value}" ${
            o.value === cfg.style ? "selected" : ""
          }>${o.label}</option>`
      ).join("")}</select>
                </div>
                <div class="flex flex-col gap-1 ${
                  hasColor ? "" : "hidden"
                }" data-color-wrapper>
                  <span class="font-medium text-slate-600">Color</span>
                  <div class="flex flex-wrap gap-1" data-color-buttons>${
                    hasColor ? buildColorButtons(cfg.style, cfg.color, k) : ""
                  }</div>
                </div>
                <div class="flex flex-col gap-1 ${
                  showIcons ? "" : "hidden"
                }" data-icon-wrapper>
                  <span class="font-medium text-slate-600">Icono</span>
                  <div class="flex flex-wrap gap-1">${
                    showIcons
                      ? ICON_PRESETS.map(
                          (ic) =>
                            `<button type=\"button\" data-role=\"icon\" data-k=\"${k}\" data-icon=\"${ic}\" class=\"px-1.5 py-0.5 rounded border text-[11px] ${
                              ic === cfg.icon
                                ? "bg-slate-900 text-white border-slate-900"
                                : "border-slate-300 hover:bg-slate-100"
                            }\">${ic}</button>`
                        ).join("")
                      : ""
                  }</div>
                </div>
                <div class="flex flex-col gap-1 ml-auto min-w-[200px]" data-preview-wrapper>
                  <span class="font-medium text-slate-600">Ejemplo</span>
                  <div class="min-h-[28px] flex items-center" data-preview>${buildPreview(
                    cfg
                  )}</div>
                </div>
              </div>`;

      root.appendChild(card);
      if (!cfg.visible) {
        card.classList.add("opacity-50");
        [
          ...card.querySelectorAll('[data-role]:not([data-role="visible"])'),
        ].forEach((el) => {
          if (el.tagName === "SELECT" || el.tagName === "INPUT")
            el.disabled = true;
          if (
            el.tagName === "BUTTON" &&
            el.getAttribute("data-role") !== "color-custom"
          )
            el.disabled = true;
          el.classList.add("pointer-events-none");
        });
        const visBox = card.querySelector('input[data-role="visible"]');
        if (visBox) {
          visBox.disabled = false;
          visBox.classList.remove("pointer-events-none");
        }
        const editBtn = card.querySelector('[data-action="edit-label"]');
        if (editBtn) {
          editBtn.disabled = false;
          editBtn.classList.remove("pointer-events-none");
        }
      }
    });
  }
  async function mutate(fn) {
    const cfg = await load();
    fn(cfg);
    await save(cfg);
    _cache = null;
    await render();
  }
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-role]");
    if (btn) {
      const role = btn.getAttribute("data-role");
      const k = btn.getAttribute("data-k");
      // Ignorar clicks iniciales en selects/checkbox (se gestionan en 'change') para no forzar re-render que cierra el desplegable
      if (role === "style" || role === "visible") return;
      if (role === "color-custom") {
        const existing = document.querySelector(".custom-color-popup");
        if (existing) existing.remove();
        const rect = btn.getBoundingClientRect();
        const popup = document.createElement("div");
        popup.className =
          "custom-color-popup fixed z-50 bg-white border border-slate-300 rounded shadow-sm p-2 flex items-center gap-2";
        popup.style.top = rect.top + window.scrollY - 2 + "px";
        popup.style.left = rect.right + 8 + window.scrollX + "px";
        // Usar _cache existente (sin await) para no invocar load() async dentro del template
        const currentColor = _cache?.extraChecks?.[k]?.color || "#ffffff";
        popup.innerHTML = `<input type="color" class="h-8 w-8 cursor-pointer" value="${currentColor}" data-popup-color /><button type="button" data-popup-save="${k}" class="px-2 py-1 rounded bg-slate-900 text-white text-[11px] hover:bg-slate-800">Guardar</button>`;
        document.body.appendChild(popup);
        const closeAll = (ev) => {
          if (ev && popup.contains(ev.target)) return;
          popup.remove();
          document.removeEventListener("mousedown", closeAll);
        };
        setTimeout(() => document.addEventListener("mousedown", closeAll), 0);
        return;
      }
      mutate((cfg) => {
        const entry = cfg.extraChecks[k];
        if (role === "color") entry.color = btn.getAttribute("data-color");
        if (role === "icon") entry.icon = btn.getAttribute("data-icon");
      });
      return;
    }
    const actionBtn = e.target.closest("[data-action]");
    if (!actionBtn) return;
    const action = actionBtn.getAttribute("data-action");
    const k = actionBtn.getAttribute("data-k");
    if (action === "edit-label") {
      const card = actionBtn.closest("[data-card]");
      const labelSpan = card?.querySelector("[data-label-display]");
      if (!card || !labelSpan) return;
      const current = labelSpan.textContent.trim();
      const wrapper = document.createElement("div");
      wrapper.className = "flex items-center gap-2";
      wrapper.innerHTML = `<input type="text" data-temp-label-input class="text-xs px-2 py-1 border border-slate-300 rounded w-32" value="${current}" /><button type="button" data-action="save-label" data-k="${k}" class="text-slate-500 hover:text-slate-700 p-1 rounded border border-transparent hover:border-slate-300 text-[11px]" title="Guardar">💾</button>`;
      labelSpan.replaceWith(wrapper);
      actionBtn.remove();
      wrapper.querySelector("[data-temp-label-input]")?.focus();
      return;
    }
    if (action === "save-label") {
      const card = actionBtn.closest("[data-card]");
      const input = card?.querySelector("[data-temp-label-input]");
      if (!input) return;
      const val = input.value.trim() || "Check " + k;
      mutate((cfg) => {
        cfg.extraChecks[k].label = val;
      });
      return;
    }
  });
  document.addEventListener("click", (e) => {
    const saveBtn = e.target.closest("[data-popup-save]");
    if (!saveBtn) return;
    const k = saveBtn.getAttribute("data-popup-save");
    const popup = saveBtn.closest(".custom-color-popup");
    const colorInp = popup?.querySelector("[data-popup-color]");
    if (colorInp) {
      mutate((cfg) => {
        cfg.extraChecks[k].color = colorInp.value;
      });
    }
    popup?.remove();
  });
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (!el.matches("[data-role]")) return;
    const role = el.getAttribute("data-role");
    const k = el.getAttribute("data-k");
    mutate((cfg) => {
      const entry = cfg.extraChecks[k];
      if (role === "visible") entry.visible = el.checked;
      if (role === "style") entry.style = el.value;
    });
  });
  render();
})();

// Comunidades autónomas
(function () {
  const KEY = "app.settings";
  const form = document.getElementById("calendar-ccaa-form");
  const select = document.getElementById("ccaa");
  const DEFAULT = "ES-NC";
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    const val = saved?.ccaa || DEFAULT;
    if (select) select.value = val;
  } catch {}
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      const next = { ...saved, ccaa: select.value };
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    window.location.href = "/dashboard.html";
  });
})();
