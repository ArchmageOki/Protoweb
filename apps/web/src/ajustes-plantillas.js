import { authFetch } from "./auth.js";
import { initEmojiPicker } from "./emoji-picker.js";

// Definición de plantillas soportadas
const TEMPLATE_DEFS = [
  {
    key: "event_created", // nueva clave en tabla user_message_templates
    legacySetting: "whatsapp_event_created_template", // para migración si existe
    title: "Creación de evento",
    desc: "Mensaje automático al crear un evento con cliente asignado.",
    def: "Hola {{nombre}}, tu evento '{{titulo}}' está programado para el {{fecha}} de {{hora_inicio}} a {{hora_fin}}.\nUbicación: {{ubicacion}}\nNotas: {{notas}}",
  },
  {
    key: "client_data_request",
    title: "Solicitud de completar datos de cliente",
    desc: "Mensaje para pedir al cliente que complete o confirme datos faltantes.",
    def: "Hola {{nombre}}! Para poder avanzar necesitamos completar tus datos.\nPor favor responde con:\n- Nombre completo (si falta)\n- Instagram (si usas)\n- Móvil de contacto\n- Ubicación preferente\nGracias!",
  },
  // Más plantillas aquí...
];

const VARIABLES = [
  ["{{nombre}}", "Nombre del cliente", "nombre"],
  ["{{apellidos}}", "Apellidos del cliente", "apellidos"],
  ["{{movil}}", "Móvil", "movil"],
  ["{{instagram}}", "Instagram", "instagram"],
  ["{{titulo}}", "Título del evento", "titulo"],
  ["{{fecha}}", "Fecha (DD/MM/YYYY)", "fecha"],
  ["{{hora_inicio}}", "Hora inicio (HH:mm)", "hora_inicio"],
  ["{{hora_fin}}", "Hora fin (HH:mm)", "hora_fin"],
  ["{{duracion}}", "Duración (minutos u horas formateado)", "duracion"],
  ["{{precio_total}}", "Precio total", "precio_total"],
  ["{{precio_pagado}}", "Precio pagado", "precio_pagado"],
  ["{{precio_pendiente}}", "Precio pendiente", "precio_pendiente"],
  ["{{ubicacion}}", "Ubicación", "ubicacion"],
  ["{{notas}}", "Notas", "notas"],
];

// Variables adicionales avanzadas (sección separada UI)
const EXTRA_VARIABLES = [
  [
    "{{enlace_completar_datos}}",
    "Enlace único para completar datos (expira al finalizar o en 7 días)",
    "enlace_completar_datos",
  ],
];

const state = {
  settings: {},
  current: null, // key de la plantilla seleccionada
  dirty: false,
  autoTimer: null,
  cacheLoaded: false,
  templates: [],
};

// Utilidades de fecha/hora para preview
const pad = (n) => String(n).padStart(2, "0");
function sampleContext() {
  const now = new Date("2025-08-05T12:00:00");
  const end = new Date("2025-08-05T15:00:00");
  const durMin = (end - now) / 60000;
  return {
    nombre: "Juan Manuel",
    apellidos: "Garrido Aguilera",
    movil: "628836603",
    instagram: "@archimago.fat",
    titulo: "@archimago.fat - Mariposas en el brazo",
    fecha: "05/08/2025",
    hora_inicio: "12:00",
    hora_fin: "15:00",
    duracion: "3 horas",
    precio_total: "100",
    precio_pagado: "20",
    precio_pendiente: String(100 - 20),
    ubicacion: "Estudio",
    notas: "Traer referencia",
    enlace_completar_datos: "https://example.com/completar-datos/TOKEN",
  };
}

function applyTemplate(tpl, data) {
  let out = VARIABLES.reduce(
    (acc, [tag, _d, key]) => acc.replace(new RegExp(tag, "g"), data[key] || ""),
    tpl
  );
  EXTRA_VARIABLES.forEach(([tag, _d, key]) => {
    out = out.replace(
      new RegExp(tag, "g"),
      data[key] || "https://example.com/completar-datos/TOKEN"
    );
  });
  return out;
}

// DOM refs
const el = (id) => document.getElementById(id);

function renderVarChips() {
  const varsWrap = document.getElementById("tpl-vars");
  const basic = VARIABLES.map(
    ([tag, _d, key]) =>
      `<span class="px-2 py-0.5 bg-slate-200 hover:bg-amber-200 transition-colors rounded text-[10px] font-mono cursor-pointer" data-insert="${tag}" data-eg-key="${key}">${tag}</span>`
  ).join("");
  const extraHeader = `<span class="basis-full text-[9px] uppercase tracking-wide text-slate-500 mt-1">Avanzadas</span>`;
  const extras = EXTRA_VARIABLES.map(
    ([tag, _d, key]) =>
      `<span class="px-2 py-0.5 bg-indigo-200/70 hover:bg-indigo-300 transition-colors rounded text-[10px] font-mono cursor-pointer" data-insert="${tag}" data-eg-key="${key}">${tag}</span>`
  ).join("");
  varsWrap.innerHTML = basic + extraHeader + extras;
  const handler = (e) => {
    const node = e.target.closest("[data-insert]");
    if (!node) return;
    const ta = document.getElementById("tpl-text");
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const ins = node.dataset.insert;
    ta.value = ta.value.slice(0, start) + ins + ta.value.slice(end);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + ins.length;
    markDirty();
  };
  varsWrap.addEventListener("click", handler);
  // Highlight en example
  varsWrap.addEventListener("mouseover", (e) => {
    const span = e.target.closest("[data-eg-key]");
    if (!span) return;
    const key = span.getAttribute("data-eg-key");
    document
      .querySelectorAll("#tpl-event-example [data-eg-var]")
      .forEach((el) => {
        if (el.getAttribute("data-eg-var") === key) {
          el.classList.add(
            "bg-amber-200",
            "outline",
            "outline-1",
            "outline-amber-500"
          );
        }
      });
  });
  varsWrap.addEventListener("mouseout", (e) => {
    document
      .querySelectorAll("#tpl-event-example [data-eg-var]")
      .forEach((el) => {
        el.classList.remove(
          "bg-amber-200",
          "outline",
          "outline-1",
          "outline-amber-500"
        );
      });
  });
}

async function loadTemplates() {
  try {
    const r = await authFetch("/data/templates");
    if (!r.ok) throw new Error("tpl_list");
    const js = await r.json();
    state.templates = js.items || [];
  } catch (e) {
    state.templates = [];
  }
}
function getTemplateRecord(key) {
  return state.templates.find((t) => t.template_key === key);
}

async function loadSettings() {
  try {
    const r = await authFetch("/data/settings");
    if (!r.ok) throw new Error("settings");
    state.settings = await r.json();
  } catch (err) {
    console.warn("No se pudieron cargar settings", err);
    state.settings = {};
  }
}

function renderList() {
  const list = el("tpl-list");
  list.innerHTML = "";
  TEMPLATE_DEFS.forEach((def) => {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" data-tpl="${def.key}" class="w-full text-left px-2 py-1 rounded hover:bg-slate-100 flex items-center gap-2 text-xs">${def.title}<span class="ml-auto hidden text-[10px] text-amber-600 font-medium" data-dirty-ind="${def.key}">●</span></button>`;
    list.appendChild(li);
  });
  list.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tpl]");
    if (!btn) return;
    selectTemplate(btn.dataset.tpl);
  });
}

function selectTemplate(key) {
  if (state.current === key) return;
  state.current = key;
  state.dirty = false;
  // Marcar activo
  el("tpl-list")
    .querySelectorAll("button[data-tpl]")
    .forEach((b) => {
      if (b.dataset.tpl === key)
        b.classList.add("bg-slate-900", "text-white", "hover:bg-slate-800");
      else
        b.classList.remove("bg-slate-900", "text-white", "hover:bg-slate-800");
    });
  const def = TEMPLATE_DEFS.find((d) => d.key === key);
  el("tpl-editor-title").textContent = def.title;
  el("tpl-editor-desc").textContent = def.desc;
  const rec = getTemplateRecord(def.key);
  const value = rec ? rec.content : def.def;
  const ta = el("tpl-text");
  ta.value = value;
  enableEditor();
  updatePreview();
  el("tpl-status").textContent = "";
  el("tpl-save").classList.remove("hidden");
  el("tpl-reset").classList.remove("hidden");
  syncDirtyIndicator();
}

function enableEditor() {
  const body = el("tpl-editor-body");
  body.classList.remove("opacity-60", "pointer-events-none");
  el("tpl-editor").dataset.empty = "false";
}

function markDirty() {
  if (!state.current) return;
  state.dirty = true;
  el("tpl-status").textContent = "Cambios sin guardar";
  syncDirtyIndicator();
  updatePreview();
  if (state.autoTimer) clearTimeout(state.autoTimer);
  state.autoTimer = setTimeout(() => save(false), 1700);
}

function syncDirtyIndicator() {
  TEMPLATE_DEFS.forEach((def) => {
    const ind = document.querySelector(`[data-dirty-ind="${def.key}"]`);
    if (!ind) return;
    ind.classList.toggle("hidden", !(state.dirty && state.current === def.key));
  });
}

function updatePreview() {
  const ta = el("tpl-text");
  const sample = sampleContext();
  const msg = applyTemplate(ta.value, sample);
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const bubble = el("tpl-preview");
  // Preservar el span del sender y el de la hora
  const senderSpan = bubble.querySelector(".chat-preview-sender");
  let timeSpan = bubble.querySelector(".chat-preview-time");
  if (!timeSpan) {
    timeSpan = document.createElement("span");
    timeSpan.className = "chat-preview-time";
    bubble.appendChild(timeSpan);
  }
  // Limpiar sólo nodos de texto existentes (excepto sender/time)
  [...bubble.childNodes].forEach((n) => {
    if (n === senderSpan || n === timeSpan) return;
    if (
      n.nodeType === Node.TEXT_NODE ||
      (n.nodeType === 1 && !n.classList.contains("chat-preview-sender"))
    )
      n.remove();
  });
  const textNode = document.createTextNode(msg + " ");
  bubble.insertBefore(textNode, timeSpan);
  timeSpan.textContent = `${hh}:${mm}`;
}

async function save(manual) {
  if (!state.current) return;
  const def = TEMPLATE_DEFS.find((d) => d.key === state.current);
  const value = document.getElementById("tpl-text").value.trim() || def.def;
  try {
    document.getElementById("tpl-status").textContent = manual
      ? "Guardando..."
      : "Autoguardando...";
    const r = await authFetch(
      "/data/templates/" + encodeURIComponent(def.key),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: def.title, content: value }),
      }
    );
    if (!r.ok) throw new Error("fail");
    await loadTemplates();
    state.dirty = false;
    syncDirtyIndicator();
    document.getElementById("tpl-status").textContent = manual
      ? "Guardado"
      : "Auto-guardado";
    setTimeout(() => {
      const st = document.getElementById("tpl-status");
      if (st && st.textContent.includes("guardado")) st.textContent = "";
    }, 1600);
  } catch (e) {
    document.getElementById("tpl-status").textContent = "Error al guardar";
  }
}

function resetCurrent() {
  if (!state.current) return;
  const def = TEMPLATE_DEFS.find((d) => d.key === state.current);
  if (!confirm("Restablecer a la plantilla por defecto?")) return;
  el("tpl-text").value = def.def;
  markDirty();
}

function initEvents() {
  el("tpl-text").addEventListener("input", markDirty);
  el("tpl-save").addEventListener("click", () => save(true));
  el("tpl-reset").addEventListener("click", resetCurrent);
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  const emojiBtn = document.getElementById("tpl-emoji-btn");
  if (emojiBtn) {
    initEmojiPicker(emojiBtn, el("tpl-text"), updatePreview);
  }
}

async function migrateLegacyIfNeeded() {
  // Si no existe la plantilla en nueva tabla, intentar leer value antiguo de settings
  const missing = TEMPLATE_DEFS.filter((def) => !getTemplateRecord(def.key));
  if (!missing.length) return;
  try {
    const r = await authFetch("/data/settings");
    if (!r.ok) return;
    const js = await r.json();
    for (const def of missing) {
      if (def.legacySetting && js?.settings && js.settings[def.legacySetting]) {
        await authFetch("/data/templates/" + encodeURIComponent(def.key), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: def.title,
            content: js.settings[def.legacySetting],
          }),
        });
      }
    }
    await loadTemplates();
  } catch (_e) {}
}

async function init() {
  renderVarChips();
  renderList();
  initEvents();
  await loadTemplates();
  await migrateLegacyIfNeeded();
  renderList();
  if (TEMPLATE_DEFS.length) {
    selectTemplate(TEMPLATE_DEFS[0].key);
  }
}

init();
