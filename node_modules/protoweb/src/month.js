import "./style.css";
import { Calendar } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import esLocale from "@fullcalendar/core/locales/es";
import {
  ensureHolidayYears,
  isHoliday,
  ymd,
  loadEventsRange,
} from "./calendar-utils";
import { authFetch, apiBase } from "./auth.js";

// Sidebar móvil + colapso escritorio reutilizado
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const openBtn = document.getElementById("sidebarOpen");
const closeBtn = document.getElementById("sidebarClose");
const collapseBtn = document.getElementById("sidebarCollapse");
const BODY = document.body;
const STORAGE_KEY_UI = "app.ui";

// Restaurar estado colapsado
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_UI) || "{}");
  if (saved.sidebarCollapsed) BODY.classList.add("sidebar-collapsed");
} catch {}

function openSidebar() {
  sidebar?.classList.remove("-translate-x-full");
  overlay?.classList.remove("hidden");
}
function closeSidebar() {
  sidebar?.classList.add("-translate-x-full");
  overlay?.classList.add("hidden");
}
openBtn?.addEventListener("click", openSidebar);
closeBtn?.addEventListener("click", closeSidebar);
overlay?.addEventListener("click", closeSidebar);
collapseBtn?.addEventListener("click", () => {
  BODY.classList.toggle("sidebar-collapsed");
  try {
    const prev = JSON.parse(localStorage.getItem(STORAGE_KEY_UI) || "{}");
    const next = {
      ...prev,
      sidebarCollapsed: BODY.classList.contains("sidebar-collapsed"),
    };
    localStorage.setItem(STORAGE_KEY_UI, JSON.stringify(next));
  } catch {}
});

const calEl = document.getElementById("month-calendar");
if (calEl) {
  calEl.classList.add("no-text-select");
  let currentRange = { start: null, end: null };
  let loadingOverlay = null;
  let loadingTimer = null;
  function showLoading() {
    if (!calEl) return;
    // Mostrar sólo si tarda >150ms para evitar parpadeo
    if (loadingTimer) clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => {
      if (!loadingOverlay) {
        loadingOverlay = document.createElement("div");
        loadingOverlay.className = "calendar-loading-overlay";
        const spin = document.createElement("div");
        spin.className = "calendar-loading-spinner";
        loadingOverlay.appendChild(spin);
        calEl.appendChild(loadingOverlay);
      }
      loadingOverlay.style.display = "flex";
    }, 150);
  }
  function hideLoading() {
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      loadingTimer = null;
    }
    if (loadingOverlay) loadingOverlay.style.display = "none";
  }
  async function refetch(range) {
    showLoading();
    try {
      const evs = await loadEventsRange(range.start, range.end);
      // Reemplazo en batch para minimizar reflow y parpadeo
      calendar.batchRendering(() => {
        calendar.removeAllEvents();
        evs.forEach((e) =>
          calendar.addEvent({
            ...e,
            extendedProps: { ...(e.extendedProps || {}), __persisted: true },
          })
        );
      });
    } catch (e) {
      console.error("refetch_error", e);
    } finally {
      hideLoading();
    }
  }

  const calendar = new Calendar(calEl, {
    plugins: [dayGridPlugin],
    initialView: "dayGridMonth",
    firstDay: 1,
    // Altura automática: elimina el aspectRatio por defecto que generaba
    // hueco en pantallas grandes y necesidad de scroll en iPad.
    height: "auto",
    contentHeight: "auto",
    handleWindowResize: true,
    locale: "es",
    locales: [esLocale],
    headerToolbar: { left: "prev today", center: "title", right: "next" },
    dayCellClassNames(info) {
      return isHoliday(info.date) ? ["is-holiday"] : [];
    },
    dayHeaderClassNames(info) {
      return isHoliday(info.date) ? ["is-holiday"] : [];
    },
    dayCellDidMount(info) {
      // Ajustes mínimos; la altura de eventos la gestionamos en eventDidMount
      const frame = info.el.querySelector(".fc-daygrid-day-frame");
      if (frame) frame.style.display = "flex";
      const eventsBox = info.el.querySelector(".fc-daygrid-day-events");
      if (eventsBox) {
        eventsBox.style.marginBottom = "0";
        eventsBox.style.paddingBottom = "0";
      }
    },
    async datesSet(info) {
      await ensureHolidayYears(info.start, info.end);
      // Refrescar clases de festivos manualmente (la versión actual no expone rerenderDates)
      try {
        const dayNodes = calEl.querySelectorAll(".fc-daygrid-day");
        dayNodes.forEach((day) => {
          const ds = day.getAttribute("data-date");
          if (!ds) return;
          const dObj = new Date(ds + "T00:00:00");
          if (isHoliday(dObj)) day.classList.add("is-holiday");
          else day.classList.remove("is-holiday");
        });
      } catch (e) {
        /* noop */
      }
      currentRange = { start: info.start, end: info.end };
      refetch(currentRange);
      queueMicrotask(markEmptyDays);
    },
    eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
    eventContent(arg) {
      // Una sola línea: HH:MM Título
      const start = arg.event.start;
      const title = arg.event.title || "";
      const isAll = arg.event.allDay;
      const fmt = (d) =>
        d
          ? d.toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : "";
      const timePart = isAll ? "" : fmt(start);
      const text = `${timePart} ${title}`.trim();
      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center"; // Centrado vertical
      wrapper.style.justifyContent = "flex-start";
      // Sin gap para acercar icono al texto
      wrapper.style.gap = "0";
      wrapper.style.width = "100%";
      wrapper.style.height = "100%"; // Ocupar toda la altura del evento
      wrapper.style.fontSize = "0.65rem";
      wrapper.style.lineHeight = "1rem";
      const textSpan = document.createElement("span");
      textSpan.textContent = text;
      textSpan.style.display = "block";
      textSpan.style.flex = "1 1 auto";
      textSpan.style.whiteSpace = "nowrap";
      textSpan.style.overflow = "hidden";
      textSpan.style.textOverflow = "ellipsis";
      // (Eliminado indicador visual de completado para liberar espacio)
      // Extra check icon único al inicio (solo si NO está completado)
      let iconInserted = false;
      try {
        const settings = JSON.parse(
          localStorage.getItem("app.settings") || "{}"
        );
        const ec = settings.extraChecks || {};
        const isCompleted = !!(
          arg.event.extendedProps && arg.event.extendedProps.is_completed
        );
        if (!isCompleted) {
          for (const k of ["1", "2", "3"]) {
            const prop = "extra_check_" + k;
            if (arg.event.extendedProps && arg.event.extendedProps[prop]) {
              const cfg = ec[k];
              if (cfg && cfg.visible && cfg.style === "icon") {
                const iconBox = document.createElement("span");
                iconBox.className = "extra-check-icon";
                iconBox.textContent = cfg.icon || "✔";
                wrapper.appendChild(iconBox);
                iconInserted = true;
                break;
              }
            }
          }
        }
      } catch (e) {
        /* silencio */
      }
      wrapper.appendChild(textSpan);
      return { domNodes: [wrapper] };
    },
    // Orden: primero eventos con hora, luego all-day; entre temporales, por hora de inicio.
    eventOrder(a, b) {
      const aAll = a.allDay ? 1 : 0;
      const bAll = b.allDay ? 1 : 0;
      if (aAll !== bAll) return aAll - bAll; // 0 (timed) antes que 1 (all-day)
      if (!a.allDay && !b.allDay) {
        const toMs = (ev) => {
          if (ev.start instanceof Date) return ev.start.getTime();
          if (typeof ev.start === "string") {
            const d = new Date(ev.start);
            if (!isNaN(d)) return d.getTime();
          }
          if (ev.start && typeof ev.start.getTime === "function") {
            try {
              return ev.start.getTime();
            } catch {}
          }
          return 0;
        };
        const at = toMs(a);
        const bt = toMs(b);
        return at - bt;
      }
      // Ambos all-day: mantener orden original (por título como fallback)
      return (a.title || "").localeCompare(b.title || "");
    },
    eventClick(info) {
      info.jsEvent?.preventDefault();
      const ev = info.event;
      const start = ev.start;
      const end = ev.end || start;
      const pad = (n) => String(n).padStart(2, "0");
      const dateStr = `${start.getFullYear()}-${pad(
        start.getMonth() + 1
      )}-${pad(start.getDate())}`;
      const tStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const startStr = tStr(start);
      const endStr = tStr(end);
      const panel = document.getElementById("event-form-panel");
      if (panel) {
        panel.classList.remove("creating-event", "flash-new");
      }
      // Campos del formulario
      const nombre = document.getElementById("evt-nombre");
      const fecha = document.getElementById("evt-fecha");
      const iniHidden = document.getElementById("evt-inicio");
      const finHidden = document.getElementById("evt-fin");
      const chkDesign = document.getElementById("evt-diseno-terminado");
      const chkExtra2 = document.getElementById("evt-extra-check-2");
      const chkExtra3 = document.getElementById("evt-extra-check-3");
      if (nombre) nombre.value = ev.title || "";
      if (fecha) fecha.value = dateStr;
      if (iniHidden) iniHidden.value = startStr;
      if (finHidden) finHidden.value = endStr;
      const iniLabel = document.querySelector(
        '[data-time-display="evt-inicio"] .time-value'
      );
      const finLabel = document.querySelector(
        '[data-time-display="evt-fin"] .time-value'
      );
      if (iniLabel) iniLabel.textContent = startStr;
      if (finLabel) finLabel.textContent = endStr;
      // Guardar referencia a evento seleccionado y estado del checkbox
      selectedEventId =
        ev.id || ev._def?.publicId || ev._instance?.instanceId || ev;
      // Sync checkbox desde extendedProps
      // Pre-cargar estado de los extra checks desde extendedProps (cargados al fetch inicial de rango)
      if (chkDesign) chkDesign.checked = !!ev.extendedProps.extra_check_1;
      if (chkExtra2) chkExtra2.checked = !!ev.extendedProps.extra_check_2;
      if (chkExtra3)
        chkExtra3.checked = !!ev.extendedProps.extra_check_3;
        // Parsear descripción para rellenar precios y notas
      (async () => {
        try {
          const totalInput = document.getElementById("evt-precio-total");
          const pagadoInput = document.getElementById("evt-precio-pagado");
          const notasInput = document.getElementById("evt-notas");
          const fmtMoney = (val) => {
            const n = Number(val || 0);
            if (!isFinite(n)) return "0 €";
            const intPart = Math.trunc(n);
            if (Math.abs(n - intPart) < 0.000001) return intPart + " €";
            return n.toFixed(2) + " €";
          };
          // Si ya tenemos extendedProps con total_amount, usarlos directamente
          const ep = ev.extendedProps || {};
          let needFetch =
            ep.total_amount == null &&
            ep.paid_amount == null &&
            ep.notes == null;
          if (!needFetch) {
            if (totalInput) {
              const v = ep.total_amount != null ? ep.total_amount : 0;
              totalInput.value = fmtMoney(v);
            }
            if (pagadoInput) {
              const v2 = ep.paid_amount != null ? ep.paid_amount : 0;
              pagadoInput.value = fmtMoney(v2);
            }
            if (notasInput && typeof ep.notes === "string") {
              notasInput.value = ep.notes;
            }
            return;
          }
          const resp = await authFetch(
            apiBase + "/data/events/" + encodeURIComponent(ev.id)
          );
          if (!resp.ok) return;
          const data = await resp.json();
          const item = data.item || {};
          if (totalInput) {
            const v = item.total_amount != null ? item.total_amount : 0;
            totalInput.value = fmtMoney(v);
          }
          if (pagadoInput) {
            const v2 = item.paid_amount != null ? item.paid_amount : 0;
            pagadoInput.value = fmtMoney(v2);
          }
          if (notasInput && typeof item.notes === "string") {
            notasInput.value = item.notes;
          }
          // Guardar en extendedProps para evitar futuro fetch
          try {
            ev.setExtendedProp?.("total_amount", item.total_amount);
            ev.setExtendedProp?.("paid_amount", item.paid_amount);
            ev.setExtendedProp?.("notes", item.notes);
            ev.setExtendedProp?.("extra_check_1", item.extra_check_1);
            ev.setExtendedProp?.("extra_check_2", item.extra_check_2);
            ev.setExtendedProp?.("extra_check_3", item.extra_check_3);
            // Sincronizar checkboxes si están en DOM
            const designChk = document.getElementById("evt-diseno-terminado");
            if (designChk) designChk.checked = !!item.extra_check_1;
            const extra2 = document.getElementById("evt-extra-check-2");
            if (extra2) extra2.checked = !!item.extra_check_2;
            const extra3 = document.getElementById("evt-extra-check-3");
            if (extra3) extra3.checked = !!item.extra_check_3;
          } catch {}
        } catch {}
      })();
      applySelectionStyles();
      const formTitle = document.getElementById("event-form-title");
      if (formTitle) formTitle.textContent = "Editar evento";
      updateActionButtons();
      // Eliminar placeholder de nuevo evento si existía (se sale del modo creación)
      document
        .querySelectorAll(".fc-placeholder-creating")
        .forEach((el) => el.remove());
      // No forzamos foco para evitar abrir teclado en iPad.
      // Si se quisiera, se podría añadir un botón 'Editar' que haga focus manual.
    },
    eventDidMount(info) {
      const el = info.el;
      const harness = el.parentElement;
      const BOX_HEIGHT = 20;
      el.style.boxSizing = "border-box";
      el.style.height = BOX_HEIGHT + "px";
      el.style.minHeight = BOX_HEIGHT + "px";
      el.style.marginTop = "0";
      el.style.marginBottom = "0";
      // Ajuste de padding para permitir mejor centrado vertical (quitamos padding vertical)
      el.style.padding = "0 4px";
      // Convertir el elemento del evento en contenedor flex centrado
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.overflow = "hidden";
      if (harness) {
        harness.style.marginTop = "0";
        harness.style.marginBottom = "0";
        harness.style.height = BOX_HEIGHT + "px";
        harness.style.minHeight = BOX_HEIGHT + "px";
      }
      const hasPrev = !!(harness && harness.previousElementSibling);
      el.style.borderTop = "none";
      el.style.boxShadow = hasPrev ? "inset 0 1px 0 #e2e8f0" : "none";
      const dayEl = el.closest(".fc-daygrid-day");
      const eventsContainer = dayEl?.querySelector(".fc-daygrid-day-events");
      if (eventsContainer) {
        eventsContainer.style.marginBottom = "0";
        eventsContainer.style.paddingBottom = "0";
        // (Animación de altura semanal se gestiona globalmente)
      }
      // Aplicar estilos condicionales para eventos ya marcados como diseño terminado
      // Aplicar estilos para extra checks (border/shadow)
      try {
        const settings = JSON.parse(
          localStorage.getItem("app.settings") || "{}"
        );
        const ec = settings.extraChecks || {};
        // NUEVO: clase para completados
        if (info.event.extendedProps && info.event.extendedProps.is_completed) {
          info.el.classList.add("event-completed");
        }
        // Acumulamos estilos para combinar adecuadamente borde + relleno.
        let fillCfg = null;
        let borderCfg = null;
        ["1", "2", "3"].forEach((k) => {
          const prop = "extra_check_" + k;
          if (!(info.event.extendedProps && info.event.extendedProps[prop]))
            return;
          const cfg = ec[k];
          if (!cfg || !cfg.visible) return;
          if (cfg.style === "shadow") {
            if (!fillCfg) fillCfg = cfg;
          } else if (cfg.style === "border") {
            if (!borderCfg) borderCfg = cfg;
          }
        });
        // Aplicar relleno primero (si existe)
        if (fillCfg) {
          const col = fillCfg.color || "#2563eb";
          const rgb =
            col.startsWith("#") && col.length === 7
              ? [
                  parseInt(col.slice(1, 3), 16),
                  parseInt(col.slice(3, 5), 16),
                  parseInt(col.slice(5, 7), 16),
                ]
              : [37, 99, 235];
          const lum =
            (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
          const textColor = lum > 0.55 ? "#1e293b" : "#ffffff";
          el.style.background = col;
          el.style.color = textColor;
          el.style.borderRadius = "4px";
          el.style.boxShadow = "0 1px 2px rgba(0,0,0,0.15)";
          // Borde temporal igual al fondo; si luego hay bordeCfg se sobrescribirá.
          el.style.border = "1px solid " + col;
        }
        // Aplicar borde (si existe) asegurando contraste con el relleno si coincide.
        if (borderCfg) {
          let bCol = borderCfg.color || "#2563eb";
          if (fillCfg) {
            // Si el borde y el relleno son el mismo color, ajustar tono para contraste
            if (
              (fillCfg.color || "").toLowerCase() ===
              (borderCfg.color || "").toLowerCase()
            ) {
              const hex =
                bCol.startsWith("#") && bCol.length === 7
                  ? bCol.slice(1)
                  : null;
              if (hex) {
                const r = parseInt(hex.slice(0, 2), 16),
                  g = parseInt(hex.slice(2, 4), 16),
                  b = parseInt(hex.slice(4, 6), 16);
                const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
                function clamp(x) {
                  return Math.max(0, Math.min(255, Math.round(x)));
                }
                let nr, ng, nb;
                if (lum > 0.5) {
                  // color claro -> oscurecer
                  nr = r * 0.75;
                  ng = g * 0.75;
                  nb = b * 0.75;
                } else {
                  // color oscuro -> aclarar
                  nr = r + (255 - r) * 0.4;
                  ng = g + (255 - g) * 0.4;
                  nb = b + (255 - b) * 0.4;
                }
                bCol =
                  "#" +
                  [nr, ng, nb]
                    .map((v) => clamp(v).toString(16).padStart(2, "0"))
                    .join("");
              } else {
                // fallback: si no es hex simple, usar negro/blanco según luminancia
                bCol = "#000000";
              }
            }
          } else {
            // Sólo borde: fondo transparente
            el.style.background = "transparent";
          }
          el.style.border = (fillCfg ? "2px" : "1px") + " solid " + bCol;
          el.style.borderRadius = "4px";
        }
      } catch {}
    },
    events: [],
    eventsSet() {
      markEmptyDays();
    },
  });
  function markEmptyDays() {
    const evs = calendar.getEvents();
    const datesWithEvents = new Set(evs.map((e) => ymd(e.start)));
    calEl.querySelectorAll(".fc-daygrid-day").forEach((day) => {
      const date = day.getAttribute("data-date");
      if (date && !datesWithEvents.has(date)) {
        day.classList.add("has-no-events");
      } else {
        // Si el día ahora tiene eventos, eliminar la marca de vacío
        day.classList.remove("has-no-events");
      }
      // Ajuste de altura diferido a adjustWeekHeights()
    });
    adjustWeekHeights();
  }
  function adjustWeekHeights() {
    const THRESHOLD = 4;
    const BOX_HEIGHT = 20;
    const rows = calEl.querySelectorAll(".fc-daygrid-body tr");
    rows.forEach((row) => {
      let maxEvents = 0;
      row.querySelectorAll(".fc-daygrid-day").forEach((day) => {
        const cnt = day.querySelectorAll(".fc-daygrid-event").length;
        if (cnt > maxEvents) maxEvents = cnt;
      });
      const expand = maxEvents > THRESHOLD;
      if (row._expanded === expand) {
        return;
      }
      const targetMin = expand ? maxEvents * BOX_HEIGHT : 0;
      const dayEvents = Array.from(
        row.querySelectorAll(".fc-daygrid-day-events")
      );
      dayEvents.forEach((ec) => {
        if (expand) {
          ec.style.minHeight = targetMin + "px";
        } else {
          ec.style.minHeight = "";
        }
      });
      const before = row.getBoundingClientRect().height;
      void row.offsetHeight; // reflow
      if (row._anim) {
        row.style.transition = "none";
        void row.offsetHeight;
      }
      row.style.height = before + "px";
      row.style.transition = "height 300ms ease";
      requestAnimationFrame(() => {
        row.style.height = "auto";
        const afterAuto = row.getBoundingClientRect().height;
        row.style.height = before + "px";
        void row.offsetHeight;
        if (Math.abs(afterAuto - before) < 2) {
          row.style.height = "";
          row._expanded = expand;
          return;
        }
        row.style.height = afterAuto + "px";
        row._anim = true;
        row.addEventListener("transitionend", function te(e) {
          if (e.propertyName === "height") {
            row.style.height = "";
            row._anim = false;
            row.removeEventListener("transitionend", te);
          }
        });
      });
      row._expanded = expand;
    });
  }
  // ====== Gestión de selección y diseño terminado ======
  let selectedEventId = null;
  const saveBtn = document.getElementById("evt-save");
  const deleteBtn = document.getElementById("evt-delete");
  const completeBtn = document.getElementById("evt-complete");
  // resetBtn eliminado

  function updateActionButtons() {
    const panel = document.getElementById("event-form-panel");
    const finishedBadge = document.getElementById("event-finished-badge");
    if (deleteBtn) {
      if (selectedEventId) {
        deleteBtn.classList.remove("hidden");
        panel?.classList.remove("creating-event");
      } else {
        deleteBtn.classList.add("hidden");
      }
    }
    // NUEVO: mostrar/ocultar botón finalizar
    if (completeBtn) {
      if (!selectedEventId) {
        completeBtn.classList.add("hidden");
      } else {
        const ev = calendar
          .getEvents()
          .find(
            (ev) =>
              (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) ===
              selectedEventId
          );
        if (ev) {
          if (ev.extendedProps?.is_completed) {
            // Mostrar como deshabilitado (estado informativo)
            completeBtn.classList.remove("hidden");
            completeBtn.disabled = true;
            completeBtn.classList.add("opacity-50", "cursor-not-allowed");
            completeBtn.title = "Evento ya finalizado";
          } else {
            completeBtn.classList.remove("hidden");
            completeBtn.disabled = false;
            completeBtn.classList.remove("opacity-50", "cursor-not-allowed");
            completeBtn.title = "Marcar evento como finalizado";
          }
        } else {
          completeBtn.classList.add("hidden");
        }
      }
    }
    // Ocultar botón guardar si evento completado
    if (saveBtn) {
      try {
        const ev =
          selectedEventId &&
          calendar
            .getEvents()
            .find(
              (e) =>
                (e.id || e._def?.publicId || e._instance?.instanceId || e) ===
                selectedEventId
            );
        const completed = !!ev?.extendedProps?.is_completed;
        // Mostrar siempre; deshabilitar cuando completado
        saveBtn.classList.remove("hidden");
        if (completed) {
          saveBtn.disabled = true;
          saveBtn.classList.add("opacity-50", "cursor-not-allowed");
          saveBtn.title = "No editable: evento finalizado";
        } else {
          saveBtn.disabled = false;
          saveBtn.classList.remove("opacity-50", "cursor-not-allowed");
          saveBtn.title = "Guardar cambios";
        }
        if (finishedBadge) {
          finishedBadge.classList.toggle("hidden", !completed);
        }
      } catch {}
    }
  }
  function applySelectionStyles() {
    const all = calEl.querySelectorAll(".fc-daygrid-event");
    all.forEach((a) => a.classList.remove("is-selected"));
    // Helper para aplicar estado habilitado/deshabilitado según completado
    function setCompletedUI(completed) {
      const finishedBadge = document.getElementById("event-finished-badge");
      if (finishedBadge) {
        finishedBadge.classList.toggle("hidden", !completed);
      }
      const chk1 = document.getElementById("evt-diseno-terminado");
      const chk2 = document.getElementById("evt-extra-check-2");
      const chk3 = document.getElementById("evt-extra-check-3");
      [chk1, chk2, chk3].forEach((ch) => {
        if (ch) {
          ch.disabled = completed;
          if (completed) {
            ch.classList.add("opacity-40", "cursor-not-allowed");
          } else {
            ch.classList.remove("opacity-40", "cursor-not-allowed");
          }
        }
      });
      const lockIds = [
        "evt-nombre",
        "evt-fecha",
        "evt-inicio",
        "evt-fin",
        "evt-precio-total",
        "evt-precio-pagado",
        "evt-notas",
        "evt-titulo-auto",
      ];
      lockIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.disabled = completed;
          if (completed) {
            el.classList.add("opacity-60", "cursor-not-allowed");
          } else {
            el.classList.remove("opacity-60", "cursor-not-allowed");
          }
        }
      });
      document
        .querySelectorAll(
          '[data-time-display="evt-inicio"],[data-time-display="evt-fin"]'
        )
        .forEach((btn) => {
          if (completed) {
            btn.classList.add("pointer-events-none", "opacity-60");
          } else {
            btn.classList.remove("pointer-events-none", "opacity-60");
          }
        });
      const clientSearch = document.getElementById("evt-client-search");
      const clientClear = document.getElementById("evt-client-clear");
      if (clientSearch) {
        clientSearch.disabled = completed;
        if (completed) {
          clientSearch.classList.add("opacity-60", "cursor-not-allowed");
        } else {
          clientSearch.classList.remove("opacity-60", "cursor-not-allowed");
        }
      }
      if (clientClear) {
        if (completed) {
          clientClear.classList.add("hidden");
        }
      }
      if (saveBtn) {
        saveBtn.classList.remove("hidden");
        saveBtn.disabled = completed;
        if (completed) {
          saveBtn.classList.add("opacity-50", "cursor-not-allowed");
          saveBtn.title = "No editable: evento finalizado";
        } else {
          saveBtn.classList.remove("opacity-50", "cursor-not-allowed");
          saveBtn.title = "Guardar cambios";
        }
      }
      if (completeBtn) {
        if (!selectedEventId) {
          completeBtn.classList.add("hidden");
        } else {
          completeBtn.classList.remove("hidden");
          completeBtn.disabled = completed;
          if (completed) {
            completeBtn.classList.add("opacity-50", "cursor-not-allowed");
            completeBtn.title = "Evento ya finalizado";
          } else {
            completeBtn.classList.remove("opacity-50", "cursor-not-allowed");
            completeBtn.title = "Marcar evento como finalizado";
          }
        }
      }
    }
    if (!selectedEventId) {
      // Sin selección: asegurar que todo queda habilitado (nuevo evento o formulario vacío)
      setCompletedUI(false);
      return;
    }
    try {
      const ev = calendar
        .getEvents()
        .find(
          (ev) =>
            (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) ===
            selectedEventId
        );
      const completed = !!ev?.extendedProps?.is_completed;
      setCompletedUI(completed);
    } catch {}
    // Encontrar todos los elementos DOM del evento seleccionado (por si está en varias celdas)
    calendar.getEvents().forEach((ev) => {
      const match =
        (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) ===
        selectedEventId;
      if (match) {
        const els = calEl.querySelectorAll(
          `[data-event-id="${ev._instance?.instanceId}"] .fc-daygrid-event, .fc-daygrid-event`
        ); // fallback simple
        // Más fiable: comparar título y horas si no hay id
        els.forEach((el) => {
          if (el.textContent?.includes(ev.title))
            el.classList.add("is-selected");
        });
      }
    });
    // Si seleccionamos un evento existente, cortar animación de creación si estaba activa.
    const panel = document.getElementById("event-form-panel");
    if (panel && !panel.classList.contains("creating-event")) {
      panel.classList.remove("flash-new");
    }
    if (panel && panel.classList.contains("creating-event")) {
      // Pasar a modo edición: quitar clases de creación inmediatamente
      panel.classList.remove("creating-event", "flash-new");
    }
  }
  // (Opcional futuro) función para resetear el formulario y volver a 'Nuevo evento'
  function resetFormTitleIfNeeded() {
    if (!selectedEventId) {
      const formTitle = document.getElementById("event-form-title");
      if (formTitle) formTitle.textContent = "Nuevo evento";
    }
  }
  // Escuchar cambios del checkbox de diseño terminado
  const designChk = document.getElementById("evt-diseno-terminado");
  const extraCheck2 = document.getElementById("evt-extra-check-2");
  const extraCheck3 = document.getElementById("evt-extra-check-3");
  function bindExtraCheck(el, prop) {
    if (!el) return;
    el.addEventListener("change", () => {
      if (!selectedEventId) return;
      const ev = calendar
        .getEvents()
        .find(
          (ev) =>
            (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) ===
            selectedEventId
        );
      if (!ev) return;
      if (typeof ev.setExtendedProp === "function")
        ev.setExtendedProp(prop, el.checked);
      else
        ev.setProp("extendedProps", {
          ...(ev.extendedProps || {}),
          [prop]: el.checked,
        });
      // Forzar rerender para que se apliquen icono/estilo inmediatamente
      try {
        if (typeof calendar.rerenderEvents === "function") {
          calendar.rerenderEvents();
        } else {
          // Fallback: tocar una prop para provocar re-render parcial
          ev.setProp("title", ev.title);
        }
      } catch {}
    });
  }
  bindExtraCheck(designChk, "extra_check_1");
  bindExtraCheck(extraCheck2, "extra_check_2");
  bindExtraCheck(extraCheck3, "extra_check_3");
  // Inicial: asegurar estado disabled si se reabre página con seleccionado (caso poco probable)
  applySelectionStyles();
  // === Nombres y visibilidad dinámicos de extra checks ===
  function applyExtraChecksMeta() {
    try {
      const settings = JSON.parse(localStorage.getItem("app.settings") || "{}");
      const ec = settings.extraChecks || {};
      ["1", "2", "3"].forEach((k) => {
        const cont = document.querySelector(`[data-extra-check="${k}"]`);
        if (!cont) return;
        const cfg = ec[k] || {};
        const input = cont.querySelector('input[type="checkbox"]');
        const label = cont.querySelector("label");
        if (!cfg.visible) {
          cont.classList.add("hidden");
          if (input) input.checked = false;
        } else {
          cont.classList.remove("hidden");
          if (label) {
            label.textContent = cfg.name || cfg.label || "Extra " + k;
          }
        }
      });
    } catch {}
  }
  applyExtraChecksMeta();
  window.addEventListener("extraChecks:updated", () => {
    applyExtraChecksMeta();
    try {
      calendar.rerenderEvents();
    } catch {}
  });
  // resetBtn eliminado
  function clearForm() {
    const nombre = document.getElementById("evt-nombre");
    if (nombre) nombre.value = "";
    const fecha = document.getElementById("evt-fecha");
    if (fecha) fecha.value = "";
    const ini = document.getElementById("evt-inicio");
    if (ini) ini.value = "10:00";
    const fin = document.getElementById("evt-fin");
    if (fin) fin.value = "11:00";
    const iniLabel = document.querySelector(
      '[data-time-display="evt-inicio"] .time-value'
    );
    if (iniLabel) iniLabel.textContent = "10:00";
    const finLabel = document.querySelector(
      '[data-time-display="evt-fin"] .time-value'
    );
    if (finLabel) finLabel.textContent = "11:00";
    // NUEVO: limpiar estado completado
    const chkCompleto = document.getElementById("evt-completo");
    if (chkCompleto) chkCompleto.checked = false;
    const precioT = document.getElementById("evt-precio-total");
    if (precioT) precioT.value = "0 €";
    const precioP = document.getElementById("evt-precio-pagado");
    if (precioP) precioP.value = "0 €";
    const notas = document.getElementById("evt-notas");
    if (notas) notas.value = "";
    if (designChk) designChk.checked = false;
    if (extraCheck2) extraCheck2.checked = false;
    if (extraCheck3) extraCheck3.checked = false;
    const formTitle = document.getElementById("event-form-title");
    if (formTitle) formTitle.textContent = "Nuevo evento";
    const panel = document.getElementById("event-form-panel");
    if (panel) {
      // Salir de modo creación: quitar estilos azules
      panel.classList.remove("creating-event", "flash-new");
    }
  }
  if (deleteBtn) {
    // Modal confirmación
    const delModal = document.getElementById("event-delete-confirm");
    const delTitleSpan = document.getElementById("event-delete-title");
    const delCancel = document.getElementById("event-delete-cancel");
    const delConfirm = document.getElementById("event-delete-confirm-btn");
    let pendingDeleteEvent = null;
    function openDeleteModal(ev) {
      pendingDeleteEvent = ev;
      if (delTitleSpan)
        delTitleSpan.textContent = `"${ev.title || "este evento"}"`;
      if (delModal) delModal.classList.remove("hidden");
      delConfirm?.focus();
    }
    function closeDeleteModal() {
      if (delModal) delModal.classList.add("hidden");
      pendingDeleteEvent = null;
    }
    delCancel?.addEventListener("click", closeDeleteModal);
    delModal?.addEventListener("click", (e) => {
      if (e.target === delModal) closeDeleteModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !delModal?.classList.contains("hidden"))
        closeDeleteModal();
    });
    delConfirm?.addEventListener("click", () => {
      if (!pendingDeleteEvent) return;
      const ev = pendingDeleteEvent;
      delConfirm.disabled = true;
      delConfirm.textContent = "Borrando…";
      const panelDel = document.getElementById("event-form-panel");
      if (panelDel) {
        panelDel.classList.remove("creating-event", "flash-new");
      }
      authFetch(apiBase + "/data/events/" + encodeURIComponent(ev.id), {
        method: "DELETE",
      })
        .then((r) => {
          if (!r.ok) throw new Error("delete_failed");
          return r.json();
        })
        .then(() => {
          try {
            ev.remove();
          } catch {}
          if (currentRange?.start && currentRange?.end) {
            refetch(currentRange).catch(() => {});
          }
        })
        .catch((err) => {
          console.error("delete_failed", err);
          alert("Error eliminando");
        })
        .finally(() => {
          delConfirm.disabled = false;
          delConfirm.textContent = "Borrar";
          closeDeleteModal();
          selectedEventId = null;
          applySelectionStyles();
          clearForm();
          updateActionButtons();
          markEmptyDays();
          const panelAfterDel = document.getElementById("event-form-panel");
          if (panelAfterDel) {
            panelAfterDel.classList.remove("creating-event", "flash-new");
          }
        });
    });
    deleteBtn.addEventListener("click", () => {
      // Caso: nuevo evento (sin id seleccionado) => cancelar creación sin confirmación
      if (!selectedEventId) {
        const panel = document.getElementById("event-form-panel");
        if (panel) {
          panel.classList.remove("creating-event", "flash-new");
        }
        document
          .querySelectorAll(".fc-new-event-indicator, .fc-placeholder-creating")
          .forEach((el) => el.remove());
        clearForm();
        applySelectionStyles();
        updateActionButtons();
        return;
      }
      const ev = calendar
        .getEvents()
        .find(
          (ev) =>
            (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) ===
            selectedEventId
        );
      if (!ev) {
        return;
      }
      const isPersisted = !!ev.extendedProps.__persisted;
      if (!isPersisted) {
        // Evento aún no persistido: eliminar sin confirmar
        try {
          ev.remove();
        } catch {}
        selectedEventId = null;
        const panel = document.getElementById("event-form-panel");
        if (panel) {
          panel.classList.remove("creating-event", "flash-new");
        }
        clearForm();
        applySelectionStyles();
        updateActionButtons();
        markEmptyDays();
        return;
      }
      openDeleteModal(ev);
    });
  }
  if (completeBtn) {
    const compModal = document.getElementById("event-complete-confirm");
    const compTitleSpan = document.getElementById("event-complete-title");
    const compCancel = document.getElementById("event-complete-cancel");
    const compConfirm = document.getElementById("event-complete-confirm-btn");
    function openCompleteModal(ev) {
      if (compTitleSpan)
        compTitleSpan.textContent = `"${ev.title || "este evento"}"`;
      compModal?.classList.remove("hidden");
      compConfirm?.focus();
      try {
        console.debug("[finalizar] modal abierto para evento", ev.id);
      } catch {}
    }
    function closeCompleteModal() {
      compModal?.classList.add("hidden");
    }
    compCancel?.addEventListener("click", closeCompleteModal);
    compModal?.addEventListener("click", (e) => {
      if (e.target === compModal) closeCompleteModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !compModal?.classList.contains("hidden"))
        closeCompleteModal();
    });
    compConfirm?.addEventListener("click", () => {
      if (!selectedEventId) return;
      compConfirm.disabled = true;
      const origTxt = compConfirm.textContent;
      compConfirm.textContent = "Finalizando…";
      const ev = calendar
        .getEvents()
        .find(
          (e) =>
            (e.id || e._def?.publicId || e._instance?.instanceId || e) ===
            selectedEventId
        );
      if (!ev) {
        compConfirm.disabled = false;
        compConfirm.textContent = origTxt;
        closeCompleteModal();
        return;
      }
      authFetch(
        apiBase + "/data/events/" + encodeURIComponent(ev.id) + "/complete",
        { method: "POST" }
      )
        .then((r) => {
          if (!r.ok) throw new Error("complete_failed");
          return r.json();
        })
        .then(() => {
          // Marcar en memoria inmediatamente para feedback instantáneo
          ev.setExtendedProp("is_completed", true);
          try {
            calendar.rerenderEvents();
          } catch {}
          applySelectionStyles();
          updateActionButtons();
          // Forzar recarga completa para garantizar que formulario y estado de botones
          // se sincronicen con cualquier otro dato (visits_count, etc.) y evitar casos
          // en los que el panel conserve botones visibles.
          setTimeout(() => {
            try {
              window.location.reload();
            } catch {}
          }, 120);
        })
        .catch((err) => {
          console.error(err);
          alert("Error finalizando evento");
        })
        .finally(() => {
          compConfirm.disabled = false;
          compConfirm.textContent = origTxt;
          closeCompleteModal();
        });
    });
    completeBtn.addEventListener("click", () => {
      if (!selectedEventId) return;
      const ev = calendar
        .getEvents()
        .find(
          (e) =>
            (e.id || e._def?.publicId || e._instance?.instanceId || e) ===
            selectedEventId
        );
      if (!ev) {
        console.debug("[finalizar] no se encontró evento seleccionado");
        return;
      }
      if (ev.extendedProps?.is_completed) {
        console.debug("[finalizar] ya completado, no se abre modal");
        return;
      }
      console.debug("[finalizar] clic en finalizar para evento", ev.id);
      openCompleteModal(ev);
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const nombre = document.getElementById("evt-nombre");
      const autoChk = document.getElementById("evt-titulo-auto");
      const autoPrev = document.getElementById("evt-titulo-auto-prev");
      const fecha = document.getElementById("evt-fecha");
      const iniHidden = document.getElementById("evt-inicio");
      const finHidden = document.getElementById("evt-fin");
      const precioT = document.getElementById("evt-precio-total");
      const precioP = document.getElementById("evt-precio-pagado");
      const notas = document.getElementById("evt-notas");
      const designChk = document.getElementById("evt-diseno-terminado");
      const extraCheck2 = document.getElementById("evt-extra-check-2");
      const extraCheck3 = document.getElementById("evt-extra-check-3");
      const clientIdInput = document.getElementById("evt-client-id");
      // Errores DOM
      const errClient = document.getElementById("evt-client-error");
      const errFecha = document.getElementById("evt-fecha-error");
      const errPrecios = document.getElementById("evt-precios-error");
      const errTiempo = document.getElementById("time-error");
      // Reset estado visual previo
      function clearError(el, msgEl) {
        if (el) {
          el.classList.remove("border-red-500", "focus:ring-red-400");
          el.classList.add("border-slate-300");
        }
        if (msgEl) {
          msgEl.classList.add("hidden");
          msgEl.textContent = "";
        }
      }
      function setError(el, msgEl, msg) {
        if (el) {
          el.classList.remove("border-slate-300");
          el.classList.add("border-red-500", "focus:ring-red-400");
        }
        if (msgEl) {
          msgEl.textContent = msg;
          msgEl.classList.remove("hidden");
        }
      }
      clearError(document.getElementById("evt-client-search"), errClient);
      clearError(fecha, errFecha);
      clearError(precioT, errPrecios);
      clearError(precioP, errPrecios);
      if (errTiempo) {
        errTiempo.classList.add("hidden");
      }
      let title = nombre?.value?.trim() || "";
      // Ya no reconstruimos manualmente aquí: el input ya se rellena por el sistema de Título automático.
      if (autoChk && autoChk.checked) {
        title = nombre?.value?.trim() || title;
      }
      const date = fecha?.value;
      const startTime = iniHidden?.value || "09:00";
      const endTime = finHidden?.value || startTime;
      if (!title) {
        alert("El nombre es obligatorio");
        return;
      }
      let hasError = false;
      if (!date) {
        setError(fecha, errFecha, "La fecha es obligatoria");
        hasError = true;
      }
      // Validar cliente obligatorio
      const clientId = clientIdInput?.value?.trim();
      if (!clientId) {
        setError(
          document.getElementById("evt-client-search"),
          errClient,
          "El cliente es obligatorio"
        );
        hasError = true;
      }
      // Validar horas
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        if (errTiempo) {
          errTiempo.textContent = "Formato de hora inválido";
          errTiempo.classList.remove("hidden");
        }
        hasError = true;
      }
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      const startMinutes = sh * 60 + sm;
      const endMinutes = eh * 60 + em;
      if (endMinutes <= startMinutes) {
        if (errTiempo) {
          errTiempo.textContent =
            "La hora de fin debe ser posterior a la de inicio";
          errTiempo.classList.remove("hidden");
        }
        // Resaltar botones
        document
          .querySelector('[data-time-display="evt-inicio"]')
          .classList.add("border-red-500", "focus:ring-red-400");
        document
          .querySelector('[data-time-display="evt-fin"]')
          .classList.add("border-red-500", "focus:ring-red-400");
        hasError = true;
      } else {
        document
          .querySelector('[data-time-display="evt-inicio"]')
          .classList.remove("border-red-500", "focus:ring-red-400");
        document
          .querySelector('[data-time-display="evt-fin"]')
          .classList.remove("border-red-500", "focus:ring-red-400");
      }
      // Construir descripción estructurada para sincronizar con Google
      const parseAmount = (v) => {
        if (v == null) return null;
        let s = String(v).trim();
        if (!s) return null;
        s = s.replace(/€/g, "").replace(/\s+/g, ""); // quitar símbolo y espacios
        if (!s) return null;
        const n = Number(s.replace(",", "."));
        return isNaN(n) ? null : n;
      };
      const fmtAmount = (n) => {
        if (n == null) return "";
        const hasDecimals = Math.abs(n - Math.trunc(n)) > 0.000001;
        return hasDecimals ? n.toFixed(2) : String(Math.trunc(n)); // sin símbolo € para BBDD
      };
      const totalRaw = precioT?.value || "";
      const pagadoRaw = precioP?.value || "";
      const totalParsed = parseAmount(totalRaw);
      const pagadoParsed = parseAmount(pagadoRaw);
      if (
        totalParsed != null &&
        pagadoParsed != null &&
        pagadoParsed > totalParsed
      ) {
        setError(
          precioT,
          errPrecios,
          "El precio pagado no puede ser superior al total"
        );
        setError(
          precioP,
          errPrecios,
          "El precio pagado no puede ser superior al total"
        );
        hasError = true;
      }
      if (hasError) return;
      let pendienteParsed = null;
      if (totalParsed != null && pagadoParsed != null) {
        pendienteParsed = totalParsed - pagadoParsed;
      }
      const totalStr = fmtAmount(totalParsed);
      const pagadoStr = fmtAmount(pagadoParsed);
      const pendienteStr = fmtAmount(pendienteParsed);
      const notasVal = (notas?.value || "").trim();
      // La descripción se mantiene para Google, pero valores monetarios van a columnas separadas
      const description = [
        `Nombre: ${title}`,
        `Pendiente: ${pendienteStr}`,
        notasVal ? `Notas: ${notasVal}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      // Construir Date objetos
      const toDate = (d, t) => {
        const [Y, M, D] = d.split("-").map(Number);
        const [h, m] = t.split(":").map(Number);
        return new Date(Y, M - 1, D, h, m, 0, 0);
      };
      let start = toDate(date, startTime);
      let end = toDate(date, endTime);
      if (end <= start) {
        // Ajuste automático a +1 hora en lugar de +30min
        end = new Date(start.getTime() + 60 * 60000);
      }
      const client_id = clientIdInput?.value || null;
      const completed_design = !!designChk?.checked;
      const extra_check_1 = !!designChk?.checked;
      const extra_check_2 = !!extraCheck2?.checked;
      const extra_check_3 = !!extraCheck3?.checked;
      if (selectedEventId) {
        // Editar
        const ev = calendar
          .getEvents()
          .find(
            (ev) =>
              (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) ===
              selectedEventId
          );
        if (!ev) {
          selectedEventId = null;
          updateActionButtons();
          return;
        }
        authFetch(apiBase + "/data/events/" + encodeURIComponent(ev.id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            all_day: false,
            client_id,
            completed_design,
            extra_check_1,
            extra_check_2,
            extra_check_3,
            total_amount: totalParsed,
            paid_amount: pagadoParsed,
            notes: notasVal,
          }),
        })
          .then(async (r) => {
            if (!r.ok) throw new Error("update_failed");
            const data = await r.json();
            ev.setProp("title", data.item.title);
            ev.setStart(data.item.start_at);
            ev.setEnd(data.item.end_at);
            ev.setExtendedProp("__persisted", true);
            ev.setExtendedProp("client_id", data.item.client_id || null);
            ev.setExtendedProp("extra_check_1", !!extra_check_1);
            ev.setExtendedProp("extra_check_2", !!extra_check_2);
            ev.setExtendedProp("extra_check_3", !!extra_check_3);
            // Recargar la página para forzar refresco completo del HTML tras guardar
            setTimeout(() => {
              try {
                window.location.reload();
              } catch {}
            }, 50);
          })
          .catch((err) => alert("Error actualizando evento"));
      } else {
        // Crear
        authFetch(apiBase + "/data/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            all_day: false,
            client_id,
            completed_design,
            extra_check_1,
            extra_check_2,
            extra_check_3,
            total_amount: totalParsed,
            paid_amount: pagadoParsed,
            notes: notasVal,
          }),
        })
          .then(async (r) => {
            if (!r.ok) throw new Error("create_failed");
            const data = await r.json();
            calendar.addEvent({
              id: data.item.id,
              title: data.item.title,
              start: data.item.start_at,
              end: data.item.end_at,
              extendedProps: {
                __persisted: true,
                client_id: data.item.client_id || null,
                extra_check_1: !!extra_check_1,
                extra_check_2: !!extra_check_2,
                extra_check_3: !!extra_check_3,
              },
            });
            // Intento asíncrono de envío WhatsApp (no bloqueante)
            console.log("[EVENT-CREATE] Resultado del evento:", data);
            console.log(
              "[EVENT-CREATE] client_completion:",
              data.client_completion
            );
            try {
              console.log("[WHATSAPP] Iniciando maybeSendWhatsAppOnCreate...");
              // Pasamos el objeto completo data que incluye client_completion
              await maybeSendWhatsAppOnCreate(data, {
                title,
                start,
                end,
                client_id,
                notes: notasVal,
                total_amount: totalParsed,
              });
              console.log("[WHATSAPP] maybeSendWhatsAppOnCreate completado");
            } catch (err) {
              console.error(
                "[WHATSAPP] Error en maybeSendWhatsAppOnCreate:",
                err
              );
            }
            clearForm();
            // Refetch completo para asegurar etags/google_event_id y coherencia
            if (currentRange?.start && currentRange?.end) {
              try {
                await refetch(currentRange);
              } catch {}
            }
            // Recargar tras crear
            setTimeout(() => {
              try {
                window.location.reload();
              } catch {}
            }, 50);
          })
          .catch((err) => alert("Error creando evento"));
      }
      try {
        if (typeof calendar.rerenderEvents === "function")
          calendar.rerenderEvents();
        else calendar.refetchEvents?.();
      } catch {}
      markEmptyDays();
      applySelectionStyles();
      // Mostrar indicador visual de guardado
      const ind = document.getElementById("save-indicator");
      if (ind) {
        // Mantener el SVG interno; solo togglear visibilidad
        ind.classList.remove("opacity-0");
        ind.classList.add("opacity-100");
        clearTimeout(ind._tHide);
        ind._tHide = setTimeout(() => {
          ind.classList.add("opacity-0");
          ind.classList.remove("opacity-100");
        }, 1800);
      }
    });
  }
  updateActionButtons();

  // ====== Título automático ======
  (function initAutoTitle() {
    const chk = document.getElementById("evt-titulo-auto");
    const input = document.getElementById("evt-nombre");
    const hint = document.getElementById("evt-auto-hint");
    const msg = document.getElementById("evt-titulo-auto-msg");
    const prev = document.getElementById("evt-titulo-auto-prev");
    if (!chk || !input) return;
    const SETTINGS_KEY = "app.settings";
    async function loadOrder() {
      try {
        const r = await authFetch(apiBase + "/data/settings");
        if (r.ok) {
          const j = await r.json();
          return j.settings?.auto_title_config?.order || [];
        }
      } catch {}
      return [];
    }
    function saveCheckboxState() {} // ya no usamos localStorage
    function loadCheckboxState() {
      return false;
    }
    // Cargar estado persistente desde backend (prioridad) y fallback a localStorage
    (async function syncInitialAutoTitle() {
      try {
        const r = await authFetch(apiBase + "/data/settings");
        if (r.ok) {
          const data = await r.json();
          const enabled = !!data.settings?.auto_title_enabled;
          chk.checked = enabled;
        } else {
          chk.checked = loadCheckboxState();
        }
      } catch {
        chk.checked = loadCheckboxState();
      }
      compute();
    })();
    function compute() {
      if (!chk.checked) {
        input.disabled = false;
        hint?.classList.add("hidden");
        // Eliminado mensaje "Generado automáticamente"
        if (msg) msg.classList.add("hidden");
        return;
      }
      input.disabled = true;
      hint?.classList.add("hidden"); // ocultamos hint ahora que no queremos texto "Generado..."
      let order = [];
      try {
        loadOrder()
          .then((o) => {
            order = o;
            recomputeWith(order);
          })
          .catch(() => {});
      } catch {}
      const iniHidden = document.getElementById("evt-inicio");
      const finHidden = document.getElementById("evt-fin");
      const clientSearch = document.getElementById("evt-client-search");
      const clientSearchEl = clientSearch;
      // Datos fiables desde dataset (establecidos al seleccionar cliente)
      let firstName = clientSearchEl?.dataset?.clientFirstName || "";
      let fullName = clientSearchEl?.dataset?.clientFullName || "";
      const mobile = clientSearchEl?.dataset?.clientMobile || "";
      const instagramHandle = clientSearchEl?.dataset?.clientInstagram || "";
      const isVip = clientSearchEl?.dataset?.clientVip === "1";
      // Compatibilidad retro (cliente ya seleccionado antes de actualización)
      if (
        !firstName &&
        clientSearch &&
        clientSearch.disabled &&
        clientSearch.value
      ) {
        const raw = clientSearch.value.trim();
        firstName = raw.split(/[·|-]/)[0].trim().split(/\s+/)[0] || "";
      }
      if (!fullName) {
        const apellido = clientSearchEl?.dataset?.clientApellidos || "";
        fullName = [firstName, apellido].filter(Boolean).join(" ").trim();
      }
      const iniVal = iniHidden?.value || "";
      const finVal = finHidden?.value || "";
      // Recoger datos actuales del formulario
      const precioTotal =
        document.getElementById("evt-precio-total")?.value || "";
      const precioPagado =
        document.getElementById("evt-precio-pagado")?.value || "";
      let precioPendiente = "";
      try {
        const pt = parseFloat((precioTotal || "").replace(",", "."));
        const pp = parseFloat((precioPagado || "").replace(",", "."));
        if (!isNaN(pt) && !isNaN(pp)) {
          const diff = pt - pp;
          if (!isNaN(diff))
            precioPendiente = diff.toFixed(
              Math.abs(diff - Math.trunc(diff)) > 0.0001 ? 2 : 0
            );
        }
      } catch {}
      const notas = document.getElementById("evt-notas")?.value.trim() || "";
      const instagram = instagramHandle
        ? "@" + instagramHandle.replace(/^@/, "")
        : "";
      // Construir piezas (con placeholders vacíos, sin filtrar) para mantener separadores visibles
      function recomputeWith(currentOrder) {
        const pieces = currentOrder.map((k) => {
          const norm = (val) => {
            if (val == null) return "";
            const s = String(val).replace(/€/g, "").trim();
            if (!s) return "";
            return s + " €";
          };
          switch (k) {
            case "nombre":
              return firstName;
            case "nombre_completo":
              return fullName;
            case "instagram":
              return instagram;
            case "movil":
              return mobile;
            case "ig_or_movil":
              return instagram || mobile;
            case "hora_inicio":
              return iniVal;
            case "hora_fin":
              return finVal;
            case "precio_total":
              return norm(precioTotal);
            case "precio_pendiente":
              return norm(precioPendiente);
            case "precio_pagado":
              return norm(precioPagado);
            case "notas":
              return notas;
            default:
              return "";
          }
        });
        // Si no hay ningún fragmento configurado, usar fallback
        if (!currentOrder.length) {
          pieces.push(firstName || "Evento");
        }
        // Ya no añadimos hora automáticamente; sólo mediante fragmentos seleccionados
        let title = pieces.join(" - ");
        // Normalizar espacios múltiples (por piezas vacías)
        title = title.replace(/\s{2,}/g, " ").trimEnd();
        // Eliminado prefijo de estrella para VIP en el título automático
        input.value = title;
        if (prev) {
          prev.textContent = title;
        }
        if (msg) {
          msg.classList.add("hidden");
        } // oculto permanentemente
      }
    }
    chk.addEventListener("change", async () => {
      compute();
      saveCheckboxState();
      // Persistir inmediatamente elección del usuario
      try {
        await authFetch(apiBase + "/data/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auto_title_enabled: chk.checked }),
        });
      } catch (e) {
        /* silencioso */
      }
    });
    // Reaplicar orden tras guardarse desde ajustes
    window.addEventListener("autoTitle:orderSaved", (e) => {
      if (!chk.checked) return;
      try {
        const newOrder = e.detail?.order || [];
        // Sobrescribir compute temporalmente con nuevo order
        window.__autoTitleCompute && window.__autoTitleCompute();
      } catch {}
    });
    // Recalcular al cambiar hora inicio o cliente seleccionado
    document
      .getElementById("evt-inicio")
      ?.addEventListener("change", () => chk.checked && compute());
    document
      .getElementById("evt-client-clear")
      ?.addEventListener("click", () => chk.checked && compute());
    const clientSearchInput = document.getElementById("evt-client-search");
    clientSearchInput?.addEventListener(
      "change",
      () => chk.checked && compute()
    );
    // Recalcular también inmediatamente tras seleccionar cliente (mediante dataset cambio)
    const observer = new MutationObserver(() => {
      if (chk.checked) compute();
    });
    if (clientSearchInput) {
      observer.observe(clientSearchInput, {
        attributes: true,
        attributeFilter: [
          "data-clientfirstname",
          "data-clientfullname",
          "data-clientmobile",
          "data-clientinstagram",
        ],
      });
    }
    // Exponer compute global para uso explícito tras selectClient()
    window.__autoTitleCompute = compute;
    // Recalcular en tiempo real mientras se escribe precios y notas
    ["evt-precio-total", "evt-precio-pagado", "evt-notas"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("keyup", () => chk.checked && compute());
      el.addEventListener("change", () => chk.checked && compute());
    });
    // No autocompletar tras carga (F5). Mantener vacío hasta que haya interacción/datos.
    if (chk.checked) {
      input.value = "";
      if (prev) prev.textContent = "";
      input.disabled = true;
    }
  })();

  // ====== Gestión de horarios y validaciones ======
  function addTimeToTime(timeStr, minutesToAdd) {
    const [h, m] = timeStr.split(":").map(Number);
    const totalMinutes = h * 60 + m + minutesToAdd;
    const newH = Math.floor(totalMinutes / 60) % 24;
    const newM = totalMinutes % 60;
    return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
  }

  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
  }

  function validateTimes(showAutoFix = false) {
    const ini = document.getElementById("evt-inicio");
    const fin = document.getElementById("evt-fin");
    const finBtn = document.querySelector('[data-time-display="evt-fin"]');
    const err = document.getElementById("time-error");
    if (!ini || !fin || !finBtn) return;
    const startMin = timeToMinutes(ini.value);
    const endMin = timeToMinutes(fin.value);
    if (endMin <= startMin) {
      finBtn.classList.add("border-red-500", "focus:ring-red-400");
      finBtn.classList.remove("border-slate-300");
      if (err) err.classList.remove("hidden");
      if (showAutoFix) {
        const corrected = addTimeToTime(ini.value, 60);
        fin.value = corrected;
        const finLabel = document.querySelector(
          '[data-time-display="evt-fin"] .time-value'
        );
        if (finLabel) finLabel.textContent = corrected;
        finBtn.classList.remove("border-red-500", "focus:ring-red-400");
        finBtn.classList.add("border-slate-300");
        if (err) err.classList.add("hidden");
      }
      return false;
    }
    finBtn.classList.remove("border-red-500", "focus:ring-red-400");
    finBtn.classList.add("border-slate-300");
    if (err) err.classList.add("hidden");
    return true;
  }

  function rebuildEndHourOptions() {
    // Filtrar horas disponibles en el popover de fin según inicio seleccionado
    const ini = document.getElementById("evt-inicio");
    const pop = document.querySelector('[data-time-popover="evt-fin"]');
    if (!ini || !pop) return;
    const startHour = parseInt(ini.value.split(":")[0], 10);
    const hourList = pop.querySelector(".time-hours");
    if (!hourList) return;
    hourList.querySelectorAll("[data-hour]").forEach((li) => {
      const h = parseInt(li.dataset.hour, 10);
      if (h < startHour) {
        li.classList.add("opacity-30", "pointer-events-none");
      } else {
        li.classList.remove("opacity-30", "pointer-events-none");
      }
    });
  }

  // Listener para hora de inicio: actualizar fin automáticamente
  const iniHidden = document.getElementById("evt-inicio");
  if (iniHidden) {
    iniHidden.addEventListener("change", () => {
      const finHidden = document.getElementById("evt-fin");
      const finLabel = document.querySelector(
        '[data-time-display="evt-fin"] .time-value'
      );
      if (finHidden && !finHidden.dataset.userModified) {
        // Solo auto-actualizar si el usuario no ha tocado la hora de fin manualmente
        const newEnd = addTimeToTime(iniHidden.value, 60); // +1 hora
        finHidden.value = newEnd;
        if (finLabel) finLabel.textContent = newEnd;
      }
      rebuildEndHourOptions();
      validateTimes(false);
    });
  }

  // Listener para hora de fin: validar que no sea <= inicio y marcar como modificado por usuario
  const finHidden = document.getElementById("evt-fin");
  if (finHidden) {
    finHidden.addEventListener("change", () => {
      finHidden.dataset.userModified = "true";
      const iniHidden = document.getElementById("evt-inicio");
      if (iniHidden) {
        const startMin = timeToMinutes(iniHidden.value);
        const endMin = timeToMinutes(finHidden.value);
        if (endMin <= startMin) validateTimes(false);
        else validateTimes(false);
      }
    });
  }

  // Resetear flag de modificación cuando se limpia el formulario
  const originalClearForm = clearForm;
  clearForm = function () {
    originalClearForm();
    if (finHidden) delete finHidden.dataset.userModified;
    rebuildEndHourOptions();
    validateTimes(false);
  };

  updateActionButtons();
  // ====== Pulsación larga en un día para preseleccionar fecha (iPad / touch) ======
  (function () {
    const LONG_PRESS_MS = 600;
    let lpTimer = null;
    let lpDate = null;
    let placeholderEl = null;
    function removePlaceholder() {
      if (placeholderEl && placeholderEl.parentElement) {
        placeholderEl.parentElement.removeChild(placeholderEl);
      }
      placeholderEl = null;
    }
    function cancel() {
      if (lpTimer) {
        clearTimeout(lpTimer);
        lpTimer = null;
        lpDate = null;
      }
    }
    calEl.addEventListener(
      "touchstart",
      (e) => {
        const day = e.target.closest(".fc-daygrid-day");
        if (!day) return;
        // No activar si se pulsa sobre un evento existente
        if (e.target.closest(".fc-daygrid-event")) return;
        lpDate = day.getAttribute("data-date");
        if (!lpDate) return;
        cancel();
        lpTimer = setTimeout(() => {
          // Rellenar fecha
          const fecha = document.getElementById("evt-fecha");
          if (fecha) {
            fecha.value = lpDate;
          }
          // Reset selección y limpiar formulario
          clearForm();
          // Limpiar cliente explícitamente (por si override futuro cambia orden)
          try {
            if (typeof clearClientSelection === "function")
              clearClientSelection();
          } catch {}
          if (fecha) {
            fecha.value = lpDate;
          } // Restaurar fecha después del clear
          selectedEventId = null;
          applySelectionStyles();
          const formTitle = document.getElementById("event-form-title");
          if (formTitle) formTitle.textContent = "Nuevo evento";
          const panel = document.getElementById("event-form-panel");
          if (panel) {
            panel.classList.add("creating-event");
            panel.classList.remove("flash-new");
            void panel.offsetWidth;
            panel.classList.add("flash-new");
          }
          updateActionButtons();
          // Crear placeholder visual persistente
          removePlaceholder();
          const eventsBox = day.querySelector(".fc-daygrid-day-events") || day;
          placeholderEl = document.createElement("div");
          placeholderEl.className =
            "fc-daygrid-event fc-event fc-placeholder-creating";
          placeholderEl.textContent = "Nuevo evento…";
          eventsBox.appendChild(placeholderEl);
        }, LONG_PRESS_MS);
      },
      { passive: true }
    );
    ["touchend", "touchcancel", "touchmove", "scroll"].forEach((ev) => {
      calEl.addEventListener(ev, cancel, { passive: true });
    });
    // Limpiar placeholder al guardar o limpiar
    if (saveBtn) {
      saveBtn.addEventListener("click", removePlaceholder);
    }
    if (deleteBtn) {
      deleteBtn.addEventListener("click", removePlaceholder);
    }
  })();

  // ====== Doble click en día vacío para nuevo evento ======
  calEl.addEventListener("dblclick", (e) => {
    const day = e.target.closest(".fc-daygrid-day");
    if (!day) return;
    // No activar si se hace doble click sobre un evento existente
    if (e.target.closest(".fc-daygrid-event")) return;

    const dayDate = day.getAttribute("data-date");
    if (!dayDate) return;

    // Limpiar formulario completamente
    clearForm();
    try {
      if (typeof clearClientSelection === "function") clearClientSelection();
    } catch {}

    // Establecer la fecha del día clickeado
    const fecha = document.getElementById("evt-fecha");
    if (fecha) fecha.value = dayDate;

    // Reset selección
    selectedEventId = null;
    applySelectionStyles();
    updateActionButtons();

    // Actualizar título y panel
    const formTitle = document.getElementById("event-form-title");
    if (formTitle) formTitle.textContent = "Nuevo evento";
    const panel = document.getElementById("event-form-panel");
    if (panel) {
      panel.classList.add("creating-event");
      panel.classList.remove("flash-new");
      void panel.offsetWidth;
      panel.classList.add("flash-new");
    }

    // Insertar indicador visual similar a selección (placeholder persistente bajo eventos existentes)
    try {
      day
        .querySelectorAll(".fc-new-event-indicator")
        .forEach((x) => x.remove());
      const box = day.querySelector(".fc-daygrid-day-events") || day;
      const indicator = document.createElement("div");
      indicator.className =
        "fc-daygrid-event fc-event fc-new-event-indicator is-selected";
      indicator.textContent = "Nuevo evento…";
      // Que visualmente coincida con selección (clase is-selected ya aplica fondo/azul vía CSS)
      indicator.style.fontStyle = "italic";
      box.appendChild(indicator);
      // Ajustar altura si hay demasiados eventos (>=4) para evitar overflow oculto
      const eventsContainer = day.querySelector(".fc-daygrid-day-events");
      if (eventsContainer) {
        const evCount =
          eventsContainer.querySelectorAll(".fc-daygrid-event").length;
        if (evCount >= 4) {
          eventsContainer.style.maxHeight = "none";
          eventsContainer.style.minHeight = evCount * 20 + "px";
        }
        indicator.dataset.dynamicHeight = "1";
      }
      // Limpiar indicador al salir sin guardar: al cambiar selección o limpiar formulario
      const removeIndicator = () => {
        indicator.remove();
        // Restaurar altura si se había modificado y ya no hay tantos eventos
        if (eventsContainer) {
          const afterCount =
            eventsContainer.querySelectorAll(".fc-daygrid-event").length;
          if (afterCount < 4) {
            eventsContainer.style.minHeight = "";
            eventsContainer.style.maxHeight = "";
          }
        }
        document.removeEventListener("click", outsideListener);
      };
      const outsideListener = (ev) => {
        // Ignorar clics fuera del calendario (formularios, etc.)
        if (!calEl.contains(ev.target)) return;
        // Si se hace clic en otro día distinto => quitar
        const otherDay = ev.target.closest(".fc-daygrid-day");
        if (otherDay && otherDay !== day) {
          removeIndicator();
          return;
        }
        // Si se hace clic sobre un evento existente distinto del indicador => quitar
        const evEl = ev.target.closest(".fc-daygrid-event");
        if (evEl && !evEl.classList.contains("fc-new-event-indicator")) {
          removeIndicator();
          return;
        }
      };
      document.addEventListener("click", outsideListener);
      // Hook en clearForm y save/delete para limpiar
      const origClear = clearForm;
      clearForm = function () {
        try {
          origClear();
        } catch {}
        removeIndicator();
      };
      saveBtn?.addEventListener("click", removeIndicator, { once: true });
      deleteBtn?.addEventListener("click", removeIndicator, { once: true });
    } catch {}
    // Enfocar el campo nombre (si no está en modo auto)
    const nombre = document.getElementById("evt-nombre");
    if (nombre && !document.getElementById("evt-titulo-auto")?.checked) {
      nombre.focus();
    }
  });
  // Escape para cancelar la creación de un nuevo evento
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const panel = document.getElementById("event-form-panel");
    if (!panel) return;
    if (panel.classList.contains("creating-event")) {
      e.preventDefault();
      panel.classList.remove("creating-event", "flash-new");
      // Eliminar indicadores visuales de nuevo evento
      document
        .querySelectorAll(".fc-new-event-indicator, .fc-placeholder-creating")
        .forEach((el) => el.remove());
      // Reset selección y formulario
      selectedEventId = null;
      applySelectionStyles();
      clearForm();
      // Restaurar placeholder fecha dd/mm/aaaa si existe
      const fecha = document.getElementById("evt-fecha");
      if (fecha) {
        fecha.value = "";
      }
    }
  });
  calendar.render();
  // Rerender eventos cuando cambian estilos/visibilidad de extra checks
  window.addEventListener("extraChecks:updated", () => {
    try {
      calendar.rerenderEvents();
    } catch {}
  });
  // Inicial
  rebuildEndHourOptions();
  validateTimes(false);
  const refreshSize = () => {
    try {
      calendar.updateSize();
    } catch {}
  };
  // Forzar un par de recalculos tras el render por layout dinámico del sidebar
  requestAnimationFrame(() => {
    refreshSize();
    requestAnimationFrame(refreshSize);
  });
  let rafId = null;
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(refreshSize);
    });
    if (sidebar) ro.observe(sidebar);
    const mainWrapper = document.querySelector(".main-wrapper");
    if (mainWrapper) ro.observe(mainWrapper);
  } else {
    sidebar?.addEventListener("transitionrun", refreshSize);
    sidebar?.addEventListener("transitionend", refreshSize);
  }
  collapseBtn?.addEventListener("click", () => {
    requestAnimationFrame(refreshSize);
    setTimeout(refreshSize, 120);
    setTimeout(refreshSize, 260);
  });
  setTimeout(markEmptyDays, 0);

  // ====== BÚSQUEDA Y SELECCIÓN DE CLIENTE ======
  const clientSearch = document.getElementById("evt-client-search");
  const clientIdHidden = document.getElementById("evt-client-id");
  const clientResults = document.getElementById("evt-client-results");
  const clientSelectedBox = document.getElementById("evt-client-selected"); // obsoleto
  const clientSelectedText = document.querySelector(
    "[data-client-selected-text]"
  ); // obsoleto
  const clientClearBtn = document.getElementById("evt-client-clear");
  const clientVipIcon = document.getElementById("evt-client-vip-icon");
  const clientCreateBox = document.getElementById("evt-client-create-inline");
  const newClientName = document.getElementById("new-client-name");
  const newClientLastName = document.getElementById("new-client-last-name");
  const newClientMobile = document.getElementById("new-client-mobile");
  const newClientInstagram = document.getElementById("new-client-instagram");
  const newClientSave = document.getElementById("new-client-save");
  const newClientCancel = document.getElementById("new-client-cancel");
  const newClientError = document.getElementById("new-client-error");
  let clientCache = [];
  let clientFetchTs = 0;
  async function ensureClients() {
    const now = Date.now();
    if (clientCache.length && now - clientFetchTs < 60000) return;
    try {
      const r = await authFetch(apiBase + "/data/clients");
      if (!r.ok) throw new Error("fetch_clients_failed");
      const j = await r.json();
      clientCache = Array.isArray(j.items) ? j.items : [];
      clientFetchTs = now;
    } catch (e) {
      console.error("clientes_error", e);
    }
  }
  function formatClientRow(c) {
    const name = c.full_name || c.first_name || "(Sin nombre)";
    const vip = c.is_vip
      ? '<span class="text-[10px] px-1 rounded bg-yellow-100 text-yellow-700 ml-1">VIP</span>'
      : "";
    const ig = c.instagram
      ? `<span class="text-slate-500">@${c.instagram}</span>`
      : "";
    return `<div class="flex flex-col">
      <span class="font-medium truncate">${name}${vip}</span>
      <span class="text-[10px] text-slate-500 flex gap-2"><span>${
        c.mobile || ""
      }</span>${ig}</span>
    </div>`;
  }
  function clearClientSelection() {
    if (clientIdHidden) clientIdHidden.value = "";
    if (clientSelectedBox) clientSelectedBox.classList.add("hidden"); // ya no se usa visualmente
    if (clientSelectedText) clientSelectedText.textContent = "";
    if (clientSearch) {
      clientSearch.disabled = false;
      clientSearch.classList.remove(
        "cursor-not-allowed",
        "bg-slate-100",
        "opacity-70"
      );
      clientSearch.value = "";
      clientSearch.style.paddingLeft = "0.75rem";
      delete clientSearch.dataset.clientApellidos;
      delete clientSearch.dataset.clientVip;
      delete clientSearch.dataset.clientFirstName;
      delete clientSearch.dataset.clientFullName;
      delete clientSearch.dataset.clientMobile;
      delete clientSearch.dataset.clientInstagram;
    }
    if (clientVipIcon) clientVipIcon.classList.add("hidden");
    if (clientClearBtn) clientClearBtn.classList.add("hidden");
  }
  function selectClient(c) {
    if (clientIdHidden) clientIdHidden.value = c.id;
    const name = c.full_name || c.first_name || "(Sin nombre)";
    const parts = [name];
    if (c.mobile) parts.push(c.mobile);
    if (c.instagram) parts.push("@" + c.instagram);
    const summary = parts.join(" · ");
    if (clientSearch) {
      clientSearch.value = summary; // sin emoji estrella
      clientSearch.disabled = true;
      clientSearch.classList.add(
        "cursor-not-allowed",
        "bg-slate-100",
        "opacity-70"
      );
      clientSearch.dataset.clientApellidos = c.last_name || "";
      clientSearch.dataset.clientVip = c.is_vip ? "1" : "0";
      clientSearch.dataset.clientFirstName = c.first_name || "";
      clientSearch.dataset.clientFullName = c.full_name || "";
      clientSearch.dataset.clientMobile = c.mobile || "";
      clientSearch.dataset.clientInstagram = c.instagram || "";
      // Ajustar padding para icono VIP si aplica
      if (c.is_vip) {
        clientSearch.style.paddingLeft = "2rem";
        if (clientVipIcon) clientVipIcon.classList.remove("hidden");
      } else {
        clientSearch.style.paddingLeft = "0.75rem";
        if (clientVipIcon) clientVipIcon.classList.add("hidden");
      }
    }
    // Ocultar chip separado (redundante ahora)
    if (clientSelectedBox) clientSelectedBox.classList.add("hidden");
    if (clientResults) clientResults.classList.add("hidden");
    clientCreateBox?.classList.add("hidden");
    if (clientClearBtn) clientClearBtn.classList.remove("hidden");
    if (!c.is_vip && clientVipIcon) clientVipIcon.classList.add("hidden");
    // Recalcular título automático si procede
    try {
      if (window.__autoTitleCompute) window.__autoTitleCompute();
    } catch {}
  }
  function showCreateInline(prefill) {
    // Cancelar búsqueda pendiente y ocultar inmediatamente la lista de resultados
    if (typeof clientSearchDebounce !== "undefined" && clientSearchDebounce) {
      clearTimeout(clientSearchDebounce);
      clientSearchDebounce = null;
    }
    if (clientResults) clientResults.classList.add("hidden");
    clearClientSelection();
    if (clientCreateBox) clientCreateBox.classList.remove("hidden");
    if (newClientName) newClientName.value = "";
    if (newClientLastName) newClientLastName.value = "";
    if (newClientMobile) newClientMobile.value = "";
    if (prefill) {
      const hasDigit = /\d/.test(prefill);
      const onlyDigits = prefill.replace(/[^0-9]/g, "");
      // Considerar como móvil si contiene algún dígito y tras limpiar quedan al menos 5
      if (hasDigit && onlyDigits.length >= 5) {
        if (newClientMobile) newClientMobile.value = onlyDigits;
      } else {
        if (newClientName) newClientName.value = prefill;
      }
    }
    if (newClientInstagram) newClientInstagram.value = "";
    if (newClientError) newClientError.textContent = "";
  }
  clientClearBtn?.addEventListener("click", () => {
    clearClientSelection();
    clientSearch?.focus();
  });
  newClientCancel?.addEventListener("click", () => {
    clientCreateBox?.classList.add("hidden");
    if (clientSearch) clientSearch.focus();
  });
  newClientSave?.addEventListener("click", async () => {
    if (!newClientMobile || !newClientMobile.value.trim()) {
      if (newClientError)
        newClientError.textContent = "El móvil es obligatorio";
      return;
    }
    try {
      newClientSave.disabled = true;
      newClientSave.textContent = "Guardando…";
      const body = {
        mobile: newClientMobile.value.trim(),
        first_name: newClientName?.value?.trim() || null,
        last_name: newClientLastName?.value?.trim() || null,
        instagram: newClientInstagram?.value?.trim() || null,
        // is_vip se elimina del creador rápido
      };
      const r = await authFetch(apiBase + "/data/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "create_failed");
      }
      const j = await r.json();
      clientCache.unshift(j.item);
      selectClient(j.item);
      clientCreateBox?.classList.add("hidden");
    } catch (e) {
      if (newClientError) newClientError.textContent = "Error creando cliente";
      console.error(e);
    } finally {
      newClientSave.disabled = false;
      newClientSave.textContent = "Crear";
    }
  });
  let clientSearchDebounce = null;
  clientSearch?.addEventListener("input", () => {
    if (clientSearchDebounce) clearTimeout(clientSearchDebounce);
    clientSearchDebounce = setTimeout(async () => {
      const q = clientSearch.value.trim().toLowerCase();
      if (!q) {
        if (clientResults) clientResults.classList.add("hidden");
        return;
      }
      await ensureClients();
      const filtered = clientCache
        .filter((c) => {
          return [
            c.full_name,
            c.first_name,
            c.last_name,
            c.mobile,
            c.instagram,
          ].some((v) => v && String(v).toLowerCase().includes(q));
        })
        .slice(0, 30);
      if (!filtered.length) {
        if (clientResults) {
          clientResults.innerHTML = `<button type="button" data-action="create-inline" class="w-full text-left px-3 py-2 hover:bg-slate-50">Crear nuevo cliente "${q}"</button>`;
          clientResults.classList.remove("hidden");
        }
        return;
      }
      if (clientResults) {
        clientResults.innerHTML = "";
        filtered.forEach((c) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className =
            "w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2";
          btn.innerHTML = formatClientRow(c);
          btn.addEventListener("click", () => selectClient(c));
          clientResults.appendChild(btn);
        });
        // Opción crear explícita al final
        const createBtn = document.createElement("button");
        createBtn.type = "button";
        createBtn.dataset.action = "create-inline";
        createBtn.className =
          "w-full text-left px-3 py-2 hover:bg-slate-50 text-indigo-600";
        createBtn.textContent = "Crear nuevo cliente…";
        createBtn.addEventListener("click", () => showCreateInline(q));
        clientResults.appendChild(createBtn);
        clientResults.classList.remove("hidden");
      }
    }, 180);
  });
  document.addEventListener("click", (e) => {
    if (
      clientResults &&
      !e.target.closest("#evt-client-results") &&
      !e.target.closest("#evt-client-search")
    ) {
      clientResults.classList.add("hidden");
    }
    if (e.target.matches('[data-action="create-inline"]')) {
      const txt = clientSearch?.value?.trim() || "";
      showCreateInline(txt);
    }
  });
  // Seleccionar cliente cuando se hace click en un evento existente (si lo tiene)
  const originalEventClick = calendar.getOption("eventClick");
  calendar.setOption("eventClick", (info) => {
    originalEventClick?.(info);
    const cid = info.event.extendedProps?.client_id;
    if (cid) {
      ensureClients().then(() => {
        const c = clientCache.find((x) => x.id === cid);
        if (c) selectClient(c);
      });
    } else {
      clearClientSelection();
    }
  });
  // Asegurar que al limpiar formulario (nuevo evento) se limpia también el cliente
  const _prevClearForm = clearForm;
  clearForm = function () {
    try {
      _prevClearForm();
    } catch {}
    try {
      clearClientSelection();
    } catch {}
  };

  // Inputs de precio: símbolo € persistente, limpiar 0 al foco, restricción de caracteres
  (function priceInputs() {
    const ids = ["evt-precio-total", "evt-precio-pagado"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!/€/.test(el.value || ""))
        el.value = (el.value?.trim() || "0") + " €";
      el.addEventListener("focus", () => {
        const numeric = el.value.replace(/€/g, "").trim();
        if (numeric === "0") el.value = "";
      });
      el.addEventListener("keypress", (e) => {
        const ch = e.key;
        if (ch.length === 1 && !/[0-9.,]/.test(ch)) e.preventDefault();
        if ((ch === "." || ch === ",") && /[.,]/.test(el.value))
          e.preventDefault();
      });
      el.addEventListener("input", () => {
        let v = el.value.replace(/€/g, "").replace(/[^0-9.,]/g, "");
        el.value = v;
        if (document.getElementById("evt-titulo-auto")?.checked) {
          try {
            window.__autoTitleCompute?.();
          } catch {}
        }
      });
      el.addEventListener("blur", () => {
        let v = el.value.replace(/€/g, "").trim();
        if (!v) v = "0";
        v = v.replace(",", ".");
        const n = parseFloat(v);
        const norm = !isNaN(n)
          ? Math.abs(n - Math.trunc(n)) > 0.0001
            ? n.toFixed(2)
            : String(Math.trunc(n))
          : "0";
        el.value = norm.replace(".", ",") + " €";
        if (document.getElementById("evt-titulo-auto")?.checked) {
          try {
            window.__autoTitleCompute?.();
          } catch {}
        }
      });
    });
  })();
}

async function maybeSendWhatsAppOnCreate(createdData, ctx) {
  console.log("[WhatsApp] === INICIO DE FUNCIÓN ===");
  console.log("[WhatsApp] createdData:", createdData);
  console.log("[WhatsApp] ctx:", ctx);

  if (!ctx?.client_id) {
    console.log("[WhatsApp] ABORTADO: No hay client_id en ctx");
    return;
  }

  if (!createdData?.client_completion?.needed) {
    console.log("[WhatsApp] Cliente completo, no necesita solicitud de datos");
    console.log(
      "[WhatsApp] client_completion:",
      createdData?.client_completion
    );
    return;
  }

  console.log(
    "[WhatsApp] ✓ Cliente necesita completar datos, enviando mensaje..."
  );

  try {
    // Hacer petición directa al nuevo endpoint del backend
    const response = await authFetch(
      apiBase + "/data/whatsapp/send-completion-request",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: ctx.client_id,
          event_data: {
            title: ctx.title || createdData.item?.title || "",
            start: ctx.start || createdData.item?.start_at,
            end: ctx.end || createdData.item?.end_at,
          },
        }),
      }
    );

    if (response.ok) {
      const result = await response.json();
      console.log(
        "[WhatsApp] ✅ Mensaje de completar datos enviado exitosamente"
      );
    } else {
      const error = await response.text();
      console.error(
        "[WhatsApp] ❌ Error enviando mensaje:",
        response.status,
        error
      );
    }
  } catch (e) {
    console.error("[WhatsApp] ❌ Error en petición:", e);
  }
}
