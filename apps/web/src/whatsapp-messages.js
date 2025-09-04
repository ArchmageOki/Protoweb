// WhatsApp Messages functionality
import { apiBase, authFetch } from "./auth.js";
import { initEmojiPicker } from "./emoji-picker.js";

// Estado de WhatsApp
let waStatusInterval = null;
let currentWaStatus = null;
let currentPollingInterval = 5000;
let errorCount = 0;
let lastStatusCheck = 0;

// Cache de clientes para búsqueda
let clientCache = [];
let clientFetchTs = 0;

// Elementos del DOM
const waStatusBadge = document.getElementById("waStatusBadge");
const resetSessionBtn = document.getElementById("resetSessionBtn");

// Elementos del formulario de envío
const waSendForm = document.getElementById("waSendForm");
const waSendClientSearch = document.getElementById("waSendClientSearch");
const waSendClientResults = document.getElementById("waSendClientResults");
const waSendClientId = document.getElementById("waSendClientId");
const waSendClientClear = document.getElementById("waSendClientClear");
const waSendSelectedClient = document.getElementById("waSendSelectedClient");
const waSendMessageText = document.getElementById("waSendMessageText");
const waSendBtn = document.getElementById("waSendBtn");
const waSendStatus = document.getElementById("waSendStatus");
const waSendCharCount = document.getElementById("waSendCharCount");

// Botones de interfaz WhatsApp
const emojiBtn = document.getElementById("emojiBtn");
const photoBtn = document.getElementById("photoBtn");
const fileBtn = document.getElementById("fileBtn");

// Outbox elementos
const outboxTbody = document.getElementById("outboxTbody");
const outboxCount = document.getElementById("outboxCount");
const outboxRefresh = document.getElementById("outboxRefresh");

// Selección de programación
let scheduleOffsetMinutes = 0;
let scheduledDateTime = null;
const waScheduleDateTime = document.getElementById("waScheduleDateTime");
const waSchedulePickerBtn = document.getElementById("waSchedulePickerBtn");
if (waScheduleDateTime) {
  // Configurar fecha mínima (ahora)
  const now = new Date();
  const nowString = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  waScheduleDateTime.min = nowString;

  waScheduleDateTime.addEventListener("change", () => {
    const selectedDate = new Date(waScheduleDateTime.value);
    const currentDate = new Date();

    if (selectedDate > currentDate) {
      scheduledDateTime = selectedDate;
      scheduleOffsetMinutes = Math.round(
        (selectedDate - currentDate) / (1000 * 60)
      );
    } else {
      scheduledDateTime = null;
      scheduleOffsetMinutes = 0;
      waScheduleDateTime.value = "";
    }
  });
}
// Botón para abrir el selector nativo
waSchedulePickerBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  // En algunos navegadores showPicker abre el diálogo; fallback: focus
  if (typeof waScheduleDateTime.showPicker === "function") {
    try {
      waScheduleDateTime.showPicker();
    } catch {
      waScheduleDateTime.focus();
    }
  } else {
    waScheduleDateTime.focus();
  }
});

// Historial de mensajes
const messageHistoryCount = document.getElementById("messageHistoryCount");
const messageHistoryTbody = document.getElementById("messageHistoryTbody");

// Variables de control
let clientSearchDebounce = null;
let selectedClient = null;

// ===== FUNCIONES PRINCIPALES =====

// Determinar intervalo de polling según estado
function getPollingInterval(status, errorCount = 0) {
  // Si hay errores consecutivos, aplicar backoff exponencial
  if (errorCount > 0) {
    const backoffMs = Math.min(1000 * Math.pow(2, errorCount), 30000); // Max 30s para recovery más rápido
    return backoffMs;
  }

  switch (status) {
    case "QR":
    case "INITIALIZING":
      return 2000; // Cada 2s durante QR/inicialización (crítico)

    case "AUTHENTICATED":
      return 3000; // Cada 3s durante autenticación (transición)

    case "READY":
      return 30000; // Cada 30s cuando está conectado (mantenimiento)

    case "DISCONNECTED":
      return 2000; // Cada 2s para detectar reconexión (más agresivo)

    case "ERROR":
    case "AUTH_FAILURE":
      return 5000; // Cada 5s en error (recovery más rápido)

    case "NO_SESSION":
    default:
      return 10000; // Cada 10s por defecto (más rápido)
  }
}

// Reiniciar polling con nuevo intervalo
function restartPolling(newInterval = null) {
  if (waStatusInterval) {
    clearInterval(waStatusInterval);
    waStatusInterval = null;
  }

  const interval =
    newInterval || getPollingInterval(currentWaStatus, errorCount);

  // Solo cambiar si es diferente al actual (evitar reiniciar innecesariamente)
  if (interval !== currentPollingInterval) {
    currentPollingInterval = interval;
    console.log(
      `📊 Polling adaptativo: ${
        interval / 1000
      }s (estado: ${currentWaStatus}, errores: ${errorCount})`
    );
  }

  waStatusInterval = setInterval(updateWhatsAppStatus, interval);
}

// Actualizar estado de WhatsApp
async function updateWhatsAppStatus() {
  try {
    lastStatusCheck = Date.now();
    const response = await authFetch(apiBase + "/data/whatsapp/status");
    if (!response.ok) {
      throw new Error("No se pudo obtener el estado de WhatsApp");
    }

    const data = await response.json();
    const previousStatus = currentWaStatus;
    currentWaStatus = data.status;

    // Reset contador de errores en petición exitosa
    if (errorCount > 0) {
      errorCount = 0;
      console.log("✅ Conexión restaurada, reiniciando polling normal");
    }

    // Detectar desconexión y necesidad de mostrar QR
    if (data.status === "QR" && previousStatus !== "QR") {
      console.log(
        "🔄 QR detectado, redirigiendo a página de inicio de sesión..."
      );
      // Redireccionar a whatsapp-login.html donde se cargará el QR
      setTimeout(() => {
        window.location.href = "whatsapp-login.html";
      }, 500); // Pequeño delay para que se vea el mensaje de estado
      return; // Salir temprano para evitar procesar más
    }

    // Detectar errores críticos que requieren reinicio automático
    if (data.status === "ERROR" && data.lastError) {
      console.warn(`⚠️ Error detectado: ${data.lastError}`);

      // Si es un error de sesión cerrada, reiniciar automáticamente después de un delay
      if (
        data.lastError.includes("navegador") ||
        data.lastError.includes("Session") ||
        data.lastError.includes("cerrada")
      ) {
        console.log(
          "🔄 Programando reinicio automático por error de sesión..."
        );
        setTimeout(() => {
          console.log("🚀 Reiniciando sesión automáticamente...");
          resetWhatsAppSession(true); // true = silencioso, sin confirmación
        }, 3000); // 3 segundos de delay
      }
    }

    // Detectar estado DISCONNECTED y acelerar polling
    if (data.status === "DISCONNECTED" && previousStatus === "READY") {
      console.log(
        "📱 Desconexión detectada, acelerando polling para detectar recovery..."
      );
      restartPolling(2000); // Polling cada 2s durante desconexión
    }

    // Intentar obtener número de la respuesta del microservicio o de la sesión persistida
    let phoneNumber =
      data.phone_number || data.phoneNumber || data.number || null;
    if (
      !phoneNumber &&
      (currentWaStatus === "READY" || currentWaStatus === "AUTHENTICATED")
    ) {
      try {
        const sessResp = await authFetch(apiBase + "/data/whatsapp/session");
        if (sessResp.ok) {
          const sess = await sessResp.json();
          phoneNumber = sess.session?.phone_number || phoneNumber;
          if (!phoneNumber) {
            // Intentar derivar del session_json (heurísticas típicas de wwebjs)
            try {
              const sj = sess.session?.session_json;
              let raw =
                sj?.me?.id || sj?.me?.wid || sj?.wid || sj?.user?.id || null;
              if (raw && typeof raw === "string") {
                const at = raw.indexOf("@");
                if (at > 0) raw = raw.slice(0, at);
                let digits = raw.replace(/[^0-9]/g, "");
                if (digits.length >= 9) {
                  // Formateo básico
                  if (!digits.startsWith("34") && digits.length === 9) {
                    digits = "34" + digits;
                  }
                  phoneNumber = "+" + digits;
                }
              }
            } catch (_e) {}
          }
        }
      } catch (_e) {}
    }

    // Actualizar badge visual
    updateStatusBadge(data.status, {
      isFullyReady: data.isFullyReady,
      internalState: data.internalState,
      phone: phoneNumber,
      lastError: data.lastError,
    });

    // Ya no mostramos QR inline aquí, se redirige a whatsapp-login.html
    // Si no es QR, ocultar cualquier overlay que pudiera quedar
    if (data.status !== "QR") {
      hideQRInline();
    }

    // Habilitar/deshabilitar formulario según el estado
    updateFormAvailability(data.status, data.isFullyReady);

    // Si el estado cambió, ajustar intervalo de polling
    if (previousStatus !== currentWaStatus) {
      console.log(`🔄 Estado WhatsApp: ${previousStatus} → ${currentWaStatus}`);
      restartPolling();
    }
  } catch (error) {
    console.error("Error obteniendo estado WhatsApp:", error);

    // Incrementar contador de errores para backoff
    errorCount++;
    console.log(`❌ Error de conexión ${errorCount}, aplicando backoff`);

    // Actualizar UI de error
    waStatusBadge.textContent = "Error de conexión";
    waStatusBadge.className =
      "text-xs px-2 py-1 rounded bg-red-200 text-red-600";
    updateFormAvailability("ERROR");

    // Reiniciar con backoff si hay errores consecutivos
    if (errorCount > 1) {
      restartPolling();
    }
  }
}

// Actualizar badge visual de estado
function updateStatusBadge(status, extraInfo = {}) {
  let text, className;

  switch (status) {
    case "READY":
      if (extraInfo.phone) {
        // Formatear número: quitar prefijo internacional +34 y corchetes
        let digits = String(extraInfo.phone).replace(/[^0-9]/g, "");
        // Quitar 0034 o 34 inicial si la longitud resultante sería 9
        if (digits.startsWith("0034") && digits.length > 11)
          digits = digits.slice(4);
        if (digits.startsWith("34") && digits.length > 9)
          digits = digits.slice(2);
        text = `Conectado con el número ${digits} ✓`;
      } else if (extraInfo.isFullyReady) {
        text = "Conectado ✓";
      } else {
        text = "Conectado (Limitado)";
      }
      className = extraInfo.isFullyReady
        ? "text-xs px-2 py-1 rounded bg-green-200 text-green-600"
        : "text-xs px-2 py-1 rounded bg-yellow-200 text-yellow-600";
      break;
    case "AUTHENTICATED":
      text = "Autenticado";
      className = "text-xs px-2 py-1 rounded bg-blue-200 text-blue-600";
      break;
    case "QR":
      text = "Esperando QR";
      className = "text-xs px-2 py-1 rounded bg-yellow-200 text-yellow-600";
      break;
    case "INITIALIZING":
      text = "Inicializando";
      className = "text-xs px-2 py-1 rounded bg-blue-200 text-blue-600";
      break;
    case "NO_SESSION":
      text = "Sin sesión";
      className = "text-xs px-2 py-1 rounded bg-slate-200 text-slate-600";
      break;
    case "ERROR":
    case "AUTH_FAILURE":
      if (extraInfo.lastError && extraInfo.lastError.includes("cerrada")) {
        text = "Reiniciando automáticamente...";
        className = "text-xs px-2 py-1 rounded bg-orange-200 text-orange-600";
      } else {
        text = "Error";
        className = "text-xs px-2 py-1 rounded bg-red-200 text-red-600";
      }
      break;
    case "DISCONNECTED":
      text = "Desconectado";
      className = "text-xs px-2 py-1 rounded bg-orange-200 text-orange-600";
      break;
    default:
      text = "Desconocido";
      className = "text-xs px-2 py-1 rounded bg-slate-200 text-slate-600";
  }

  waStatusBadge.textContent = text;
  waStatusBadge.className = className;
}

// Habilitar/deshabilitar formulario
function updateFormAvailability(status, isFullyReady = false) {
  const isReady = status === "READY" || status === "AUTHENTICATED";

  waSendClientSearch.disabled = !isReady;
  waSendMessageText.disabled = !isReady;
  waSendBtn.disabled = !isReady;

  if (!isReady) {
    if (status === "ERROR" || status === "AUTH_FAILURE") {
      // Solo mostrar toast para errores críticos, no para estados normales
      // showSendStatus('Error en WhatsApp. Reinicia la sesión.', 'error')
    } else if (status === "DISCONNECTED") {
      // showSendStatus('WhatsApp desconectado', 'warning')
    } else {
      // showSendStatus('WhatsApp no está conectado', 'warning')
    }
  } else {
    if (status === "READY" && !isFullyReady) {
      // showSendStatus('Conectado (funcionalidad limitada)', 'warning')
    } else {
      // Estado conectado correctamente - no mostrar nada
    }
  }
}

// Cargar clientes del servidor
async function ensureClients() {
  const now = Date.now();
  if (clientCache.length && now - clientFetchTs < 60000) return;

  try {
    const response = await authFetch(apiBase + "/data/clients");
    if (!response.ok) throw new Error("Error cargando clientes");

    const data = await response.json();
    clientCache = Array.isArray(data.items) ? data.items : [];
    clientFetchTs = now;
  } catch (error) {
    console.error("Error cargando clientes:", error);
  }
}

// Formatear fila de cliente para mostrar en resultados
function formatClientRow(client) {
  const name = client.full_name || client.first_name || "(Sin nombre)";
  const vip = client.is_vip
    ? '<span class="text-[10px] px-1 rounded bg-yellow-100 text-yellow-700 ml-1">VIP</span>'
    : "";
  const ig = client.instagram
    ? `<span class="text-slate-500">@${client.instagram}</span>`
    : "";
  const mobile = client.mobile
    ? `<span class="text-slate-500">${client.mobile}</span>`
    : "";

  return `<div class="flex flex-col">
    <span class="font-medium truncate">${name}${vip}</span>
    <span class="text-[10px] text-slate-500 flex gap-2">${mobile}${
    ig ? " · " + ig : ""
  }</span>
  </div>`;
}

// Seleccionar cliente
function selectClient(client) {
  selectedClient = client;
  waSendClientId.value = client.id;

  const name = client.full_name || client.first_name || "(Sin nombre)";
  const parts = [name];
  if (client.mobile) parts.push(client.mobile);
  if (client.instagram) parts.push("@" + client.instagram);

  waSendClientSearch.value = parts.join(" · ");
  waSendClientSearch.disabled = true;
  waSendClientSearch.className =
    waSendClientSearch.className.replace(
      " focus:ring-2 focus:ring-green-500 focus:border-green-500",
      ""
    ) + " bg-slate-50 cursor-not-allowed";

  // Ocultar resultados inmediatamente al seleccionar
  waSendClientResults.classList.add("hidden");
  waSendClientClear.classList.remove("hidden");
}

// Limpiar selección de cliente
function clearClientSelection() {
  selectedClient = null;
  waSendClientId.value = "";
  waSendClientSearch.value = "";
  waSendClientSearch.disabled = false;
  waSendClientSearch.className =
    "w-full border border-slate-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500";
  waSendClientResults.classList.add("hidden");
  waSendClientClear.classList.add("hidden");

  // Enfocar el campo de búsqueda tras limpiar
  waSendClientSearch.focus();
}

// Normalizar número de teléfono para España
function normalizePhoneNumber(phone) {
  if (!phone) return null;

  // Eliminar todos los caracteres no numéricos
  let cleaned = phone.replace(/\D/g, "");

  // Si tiene 9 dígitos, agregar prefijo de España (+34)
  if (cleaned.length === 9) {
    cleaned = "34" + cleaned;
  }

  // Agregar '+' al inicio si no lo tiene
  if (!cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }

  return cleaned;
}

// Enviar mensaje de WhatsApp
async function sendWhatsAppMessage() {
  if (!selectedClient) {
    showSendStatus("Selecciona un cliente primero", "error");
    return;
  }

  const messageText = waSendMessageText.value.trim();
  if (!messageText) {
    showSendStatus("Escribe un mensaje", "error");
    return;
  }

  if (!selectedClient.mobile) {
    showSendStatus("El cliente no tiene número de teléfono", "error");
    return;
  }

  const phoneNumber = normalizePhoneNumber(selectedClient.mobile);
  if (!phoneNumber) {
    showSendStatus("Número de teléfono inválido", "error");
    return;
  }

  try {
    // Estado de envío
    waSendBtn.disabled = true;
    waSendBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 animate-spin">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    `;

    showSendStatus("Enviando mensaje...", "loading");

    const requestData = {
      phone: phoneNumber,
      message: messageText,
      clientId: selectedClient.id,
      clientName:
        selectedClient.full_name || selectedClient.first_name || "(Sin nombre)",
      clientInstagram: selectedClient.instagram,
    };

    // Si hay programación, incluirla
    if (scheduledDateTime) {
      requestData.scheduledFor = scheduledDateTime.toISOString();
    }

    const response = await authFetch(apiBase + "/data/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error || "Error enviando mensaje");
      error.needsRestart = errorData.needsRestart;
      error.details = errorData.details;
      error.currentStatus = errorData.currentStatus;
      throw error;
    }

    const result = await response.json();

    // Confirmación visual exitosa
    if (scheduledDateTime) {
      showSendStatus(
        `Mensaje programado para ${scheduledDateTime.toLocaleString("es-ES")}`,
        "success"
      );
    } else {
      showSendStatus("Mensaje enviado correctamente", "success");
    }

    // Efecto visual de confirmación en el botón
    waSendBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5 text-white">
        <path fill-rule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd" />
      </svg>
    `;
    waSendBtn.className = waSendBtn.className.replace(
      "bg-green-600 hover:bg-green-700",
      "bg-green-500"
    );

    // Limpiar formulario después de 1.5 segundos
    setTimeout(() => {
      waSendMessageText.value = "";
      clearClientSelection();

      // Reset programación
      if (waScheduleDateTime) {
        waScheduleDateTime.value = "";
        scheduledDateTime = null;
        scheduleOffsetMinutes = 0;
      }

      updateCharCounter();

      // Recargar historial y outbox
      loadMessageHistory();
      loadOutbox();

      showSendStatus("", "clear");
    }, 1500);
  } catch (error) {
    console.error("Error enviando mensaje:", error);

    let errorMessage = "Error enviando mensaje";

    if (error.needsRestart) {
      errorMessage =
        "⚠️ Error de WhatsApp. Reinicia la sesión e inténtalo de nuevo.";

      // Actualizar estado para mostrar que necesita reinicio
      waStatusBadge.textContent = "Necesita reinicio";
      waStatusBadge.className =
        "text-xs px-2 py-1 rounded bg-red-200 text-red-600";
      updateFormAvailability("ERROR");
    } else if (error.message) {
      errorMessage = error.message;
    }

    showSendStatus(errorMessage, "error");
    resetSendButton();
  }
}

// Función para mostrar estados del envío con toast
function showSendStatus(message, type) {
  const toast = document.getElementById("waSendToast");
  const toastMessage = toast.querySelector(".toast-message");
  const toastIcon = toast.querySelector(".toast-icon");

  if (!toast || !message || type === "clear") {
    hideToast();
    return;
  }

  // Configurar el mensaje
  toastMessage.textContent = message;

  // Configurar el icono según el tipo
  const icons = {
    success: "✓",
    error: "⚠",
    loading: "⟳",
    warning: "!",
  };

  toastIcon.textContent = icons[type] || "";

  // Limpiar clases previas y agregar la nueva
  // Reset base classes (posicionado dentro del contenedor)
  toast.className =
    "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white z-30 transition-all duration-300 opacity-0 scale-95 pointer-events-none";
  toast.classList.add(type, "show");

  // Auto-ocultar después de cierto tiempo (excepto loading)
  if (type !== "loading") {
    const hideTimeout = type === "success" ? 2000 : 4000;
    setTimeout(hideToast, hideTimeout);
  }
}

// Función para ocultar el toast
function hideToast() {
  const toast = document.getElementById("waSendToast");
  if (toast) {
    toast.classList.remove("show", "success", "error", "loading", "warning");
    // Mantener base classes para siguiente aparición
  }
}

// Función para resetear el botón de envío
function resetSendButton() {
  if (!waSendBtn) return;

  const currentStatus = currentWaStatus || "NO_SESSION";
  const hasText = waSendMessageText.value.trim().length > 0;
  const hasClient = selectedClient !== null;
  const isReady =
    currentStatus === "READY" || currentStatus === "AUTHENTICATED";

  waSendBtn.disabled = !hasText || !hasClient || !isReady;
  waSendBtn.className =
    "w-11 h-11 rounded-full bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors flex-shrink-0";
  waSendBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z"/>
    </svg>
  `;
}

// Actualizar contador de caracteres
function updateCharCounter() {
  const count = waSendMessageText?.value.length || 0;

  // Habilitar/deshabilitar botón según contenido
  if (waSendBtn) {
    const hasText = count > 0;
    const hasClient = selectedClient !== null;
    const currentStatus = currentWaStatus || "NO_SESSION";
    const isReady =
      currentStatus === "READY" || currentStatus === "AUTHENTICATED";

    waSendBtn.disabled = !hasText || !hasClient || !isReady;

    // Cambiar opacidad visual del botón
    if (hasText && hasClient && isReady) {
      waSendBtn.style.opacity = "1";
    } else {
      waSendBtn.style.opacity = "0.5";
    }
  }
}

// Cargar historial de mensajes
async function loadMessageHistory() {
  try {
    const response = await authFetch(apiBase + "/data/whatsapp/history");
    if (!response.ok) throw new Error("Error cargando historial");

    const data = await response.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];

    messageHistoryCount.textContent = `${messages.length} registros`;

    if (messages.length === 0) {
      messageHistoryTbody.innerHTML =
        '<tr class="empty-row"><td colspan="6" class="py-6 text-center text-slate-400">Sin mensajes todavía</td></tr>';
    } else {
      messageHistoryTbody.innerHTML = messages
        .map(
          (msg) => `
        <tr>
          <td class="py-2 pr-4 text-slate-900">${msg.phone || "-"}</td>
          <td class="py-2 pr-4 text-slate-900">${msg.client_name || "-"}</td>
          <td class="py-2 pr-4 text-slate-500">${
            msg.instagram ? "@" + msg.instagram : "-"
          }</td>
          <td class="py-2 pr-4 text-slate-500">-</td>
          <td class="py-2 pr-4 text-slate-500">${
            msg.sent_at ? new Date(msg.sent_at).toLocaleString("es-ES") : "-"
          }</td>
          <td class="py-2 pr-4 text-slate-700 max-w-xs truncate" title="${
            msg.message_text || ""
          }">${msg.message_text || "-"}</td>
        </tr>
      `
        )
        .join("");
    }
  } catch (error) {
    console.error("Error cargando historial:", error);
  }
}

// ===== OUTBOX =====
async function loadOutbox() {
  if (!outboxTbody) return;
  try {
    const resp = await authFetch(apiBase + "/data/whatsapp/outbox");
    if (!resp.ok) throw new Error("outbox fetch failed");
    const data = await resp.json();
    const items = data.items || [];
    outboxCount && (outboxCount.textContent = items.length + " pendientes");
    outboxTbody.innerHTML = "";
    if (!items.length) {
      outboxTbody.innerHTML =
        '<tr class="empty-row"><td colspan="7" class="py-6 text-center text-slate-400">Sin mensajes programados</td></tr>';
      return;
    }
    const now = Date.now();
    for (const it of items) {
      const sched = new Date(it.scheduled_at);
      const etaMs = sched - now;
      const eta = etaMs > 0 ? Math.round(etaMs / 60000) + "m" : "ahora";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="py-2 pr-4 whitespace-nowrap">${sched.toLocaleString()}<br><span class="text-[10px] text-slate-400">${eta}</span></td>
        <td class="py-2 pr-4">${it.phone}</td>
        <td class="py-2 pr-4">${it.client_name || ""}</td>
        <td class="py-2 pr-4">${it.instagram ? "@" + it.instagram : ""}</td>
        <td class="py-2 pr-4 max-w-xs truncate" title="${(
          it.message_text || ""
        ).replace(/"/g, "&quot;")}">${it.message_text || ""}</td>
        <td class="py-2 pr-4">${it.status}</td>
        <td class="py-2 pr-4 text-right">
          <button data-cancel="${
            it.id
          }" class="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-red-50 hover:border-red-400 hover:text-red-600">Cancelar</button>
        </td>`;
      outboxTbody.appendChild(tr);
    }
  } catch (e) {
    console.error("loadOutbox error", e);
  }
}
async function cancelOutbox(id) {
  try {
    const r = await authFetch(
      apiBase + "/data/whatsapp/outbox/" + id + "/cancel",
      { method: "POST" }
    );
    if (r.ok) loadOutbox();
  } catch (e) {
    console.error("cancelOutbox", e);
  }
}
outboxRefresh?.addEventListener("click", loadOutbox);
outboxTbody?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cancel]");
  if (btn) cancelOutbox(btn.getAttribute("data-cancel"));
});

// Mostrar QR inline en la página actual
function showQRInline(qrData) {
  if (!qrData) return;

  // Crear overlay para QR
  let qrOverlay = document.getElementById("waQROverlay");
  if (!qrOverlay) {
    qrOverlay = document.createElement("div");
    qrOverlay.id = "waQROverlay";
    qrOverlay.className =
      "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";
    qrOverlay.innerHTML = `
      <div class="bg-white rounded-lg p-6 max-w-sm mx-4 text-center">
        <h3 class="text-lg font-semibold mb-4">Escanea el QR con WhatsApp</h3>
        <div class="mb-4">
          <img id="waQRImage" src="" alt="QR Code" class="mx-auto max-w-full h-auto">
        </div>
        <p class="text-sm text-gray-600 mb-4">
          Abre WhatsApp en tu teléfono, ve a "Dispositivos vinculados" y escanea este código.
        </p>
        <button id="waQRClose" class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
          Cerrar
        </button>
      </div>
    `;
    document.body.appendChild(qrOverlay);

    // Cerrar QR overlay
    document.getElementById("waQRClose").addEventListener("click", () => {
      qrOverlay.remove();
    });
  }

  // Actualizar QR
  document.getElementById("waQRImage").src = qrData;
  qrOverlay.style.display = "flex";
}

// Ocultar QR overlay cuando ya no es necesario
function hideQRInline() {
  const qrOverlay = document.getElementById("waQROverlay");
  if (qrOverlay) {
    qrOverlay.remove();
  }
}

// Reiniciar sesión de WhatsApp
async function resetWhatsAppSession(silent = false) {
  // Confirmar solo si no es silencioso (reinicio automático)
  if (
    !silent &&
    !confirm("¿Estás seguro de que quieres cerrar la sesión de WhatsApp?")
  ) {
    return;
  }

  try {
    resetSessionBtn.disabled = true;
    resetSessionBtn.textContent = "Cerrando...";

    const response = await authFetch(apiBase + "/data/whatsapp/reset", {
      method: "POST",
    });

    if (response.ok) {
      waStatusBadge.textContent = silent ? "Reiniciando..." : "Sesión cerrada";
      waStatusBadge.className =
        "text-xs px-2 py-1 rounded bg-slate-200 text-slate-600";
      updateFormAvailability("NO_SESSION");

      if (silent) {
        console.log("🔄 Sesión reiniciada automáticamente");
      }
    }
  } catch (error) {
    console.error("Error cerrando sesión:", error);
  } finally {
    resetSessionBtn.disabled = false;
    resetSessionBtn.textContent = "Cerrar sesión";
  }
}

// ===== EVENT LISTENERS =====

// Inicializar polling de estado
function startStatusPolling() {
  // Hacer primera consulta inmediatamente
  updateWhatsAppStatus();

  // Iniciar polling adaptativo
  const initialInterval = getPollingInterval(
    currentWaStatus || "NO_SESSION",
    0
  );
  currentPollingInterval = initialInterval;
  console.log(`🚀 Iniciando polling adaptativo: ${initialInterval / 1000}s`);

  waStatusInterval = setInterval(updateWhatsAppStatus, initialInterval);
}

// Búsqueda de clientes con debounce
waSendClientSearch?.addEventListener("input", () => {
  if (clientSearchDebounce) clearTimeout(clientSearchDebounce);

  clientSearchDebounce = setTimeout(async () => {
    const query = waSendClientSearch.value.trim().toLowerCase();

    if (!query) {
      waSendClientResults.classList.add("hidden");
      return;
    }

    await ensureClients();

    const filtered = clientCache
      .filter((client) => {
        return [
          client.full_name,
          client.first_name,
          client.last_name,
          client.mobile,
          client.instagram,
        ].some((field) => field && String(field).toLowerCase().includes(query));
      })
      .slice(0, 20);

    if (filtered.length === 0) {
      waSendClientResults.innerHTML =
        '<div class="px-3 py-2 text-slate-500 text-xs">No se encontraron clientes</div>';
    } else {
      waSendClientResults.innerHTML = filtered
        .map((client) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className =
            "w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2";
          button.innerHTML = formatClientRow(client);
          button.addEventListener("click", () => selectClient(client));
          return button.outerHTML;
        })
        .join("");

      // Re-agregar event listeners después de actualizar innerHTML
      waSendClientResults.querySelectorAll("button").forEach((btn, index) => {
        btn.addEventListener("click", () => selectClient(filtered[index]));
      });
    }

    waSendClientResults.classList.remove("hidden");
  }, 200);
});

// Cerrar resultados al hacer clic fuera y cerrar popups
document.addEventListener("click", (e) => {
  // Cerrar desplegable de clientes
  if (!e.target.closest("#waClientPicker")) {
    waSendClientResults?.classList.add("hidden");
  }

  // Cerrar popup de emojis
  const popup = document.getElementById("emojiPopup");
  if (popup && !emojiBtn?.contains(e.target) && !popup.contains(e.target)) {
    popup.remove();
  }
});

// Contador de caracteres en tiempo real
waSendMessageText?.addEventListener("input", updateCharCounter);

// Navegación con teclado en el desplegable de clientes
waSendClientSearch?.addEventListener("keydown", (e) => {
  const results = waSendClientResults.querySelectorAll("button");
  const isVisible = !waSendClientResults.classList.contains("hidden");

  if (!isVisible || results.length === 0) return;

  let selectedIndex = Array.from(results).findIndex((btn) =>
    btn.classList.contains("bg-slate-100")
  );

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      if (selectedIndex < results.length - 1) {
        results[selectedIndex]?.classList.remove("bg-slate-100");
        selectedIndex++;
        results[selectedIndex].classList.add("bg-slate-100");
        results[selectedIndex].scrollIntoView({ block: "nearest" });
      }
      break;

    case "ArrowUp":
      e.preventDefault();
      if (selectedIndex > 0) {
        results[selectedIndex].classList.remove("bg-slate-100");
        selectedIndex--;
        results[selectedIndex].classList.add("bg-slate-100");
        results[selectedIndex].scrollIntoView({ block: "nearest" });
      }
      break;

    case "Enter":
      e.preventDefault();
      if (selectedIndex >= 0) {
        results[selectedIndex].click();
      }
      break;

    case "Escape":
      e.preventDefault();
      waSendClientResults.classList.add("hidden");
      break;
  }
});

// Envío rápido con Ctrl+Enter
waSendMessageText?.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (!waSendBtn.disabled) {
      waSendForm.dispatchEvent(new Event("submit"));
    }
  }
});

// Envío del formulario
waSendForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (scheduleOffsetMinutes > 0) {
    // Programar en outbox
    if (!selectedClient) {
      waSendStatus.textContent = "Selecciona un cliente primero";
      waSendStatus.className = "text-xs text-red-500";
      return;
    }
    const messageText = waSendMessageText.value.trim();
    if (!messageText) {
      waSendStatus.textContent = "Escribe un mensaje";
      waSendStatus.className = "text-xs text-red-500";
      return;
    }
    const phoneNumber = normalizePhoneNumber(selectedClient.mobile);
    if (!phoneNumber) {
      waSendStatus.textContent = "Número inválido";
      waSendStatus.className = "text-xs text-red-500";
      return;
    }
    waSendBtn.disabled = true;
    const scheduleText = scheduledDateTime
      ? `Programando para ${scheduledDateTime.toLocaleString("es-ES")}...`
      : "Programando...";
    waSendStatus.textContent = scheduleText;
    waSendStatus.className = "text-xs text-slate-500";
    const schedAt = scheduledDateTime
      ? scheduledDateTime.toISOString()
      : new Date(Date.now() + scheduleOffsetMinutes * 60000).toISOString();
    authFetch(apiBase + "/data/whatsapp/outbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: phoneNumber,
        client_id: selectedClient.id,
        client_name:
          selectedClient.full_name ||
          selectedClient.first_name ||
          "(Sin nombre)",
        instagram: selectedClient.instagram,
        message_text: messageText,
        scheduled_at: schedAt,
      }),
    })
      .then(async (resp) => {
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          waSendStatus.textContent = "Programado";
          waSendStatus.className = "text-xs text-green-600";
          waSendMessageText.value = "";
          waScheduleDateTime.value = "";
          scheduledDateTime = null;
          scheduleOffsetMinutes = 0;
          updateCharCounter();
          loadOutbox();
          setTimeout(() => {
            waSendStatus.textContent = "";
          }, 2500);
        } else {
          waSendStatus.textContent = data.error || "Error programando";
          waSendStatus.className = "text-xs text-red-500";
        }
      })
      .catch(() => {
        waSendStatus.textContent = "Error de red";
        waSendStatus.className = "text-xs text-red-500";
      })
      .finally(() => {
        waSendBtn.disabled = false;
      });
  } else {
    sendWhatsAppMessage();
  }
});

// Botón de reset de sesión
resetSessionBtn?.addEventListener("click", resetWhatsAppSession);

// Botón para limpiar selección de cliente
waSendClientClear?.addEventListener("click", () => {
  clearClientSelection();
  waSendClientSearch?.focus();
});

// ===== INTERFAZ WHATSAPP =====

// Auto-resize del textarea
waSendMessageText?.addEventListener("input", function () {
  this.style.height = "44px";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});

// Funcionalidad de botones WhatsApp
// Inicializar selector de emojis
initEmojiPicker(emojiBtn, waSendMessageText, updateCharCounter);

photoBtn?.addEventListener("click", () => {
  // Emojis oficiales de WhatsApp (los más usados en orden de popularidad)
  const emojis = [
    "😂",
    "❤️",
    "🤣",
    "👍",
    "😭",
    "🙏",
    "�",
    "🥰",
    "😍",
    "😊",
    "🎉",
    "�",
    "�",
    "🥺",
    "�",
    "�🔥",
    "☺️",
    "♥️",
    "�",
    "🤗",
    "💙",
    "😉",
    "🙂",
    "🤔",
    "😳",
    "🥶",
    "😱",
    "😡",
    "😢",
    "🎂",
    "🌹",
    "�💯",
    "�",
    "⭐",
    "🌟",
    "💫",
    "🚀",
    "⚡",
    "�",
    "💝",
    "�",
    "�🎊",
    "🎵",
    "🎶",
    "💃",
    "🕺",
    "👏",
    "🤝",
    "👋",
    "💪",
  ];

  // Crear popup de emojis estilo WhatsApp
  const existingPopup = document.getElementById("emojiPopup");
  if (existingPopup) {
    existingPopup.remove();
    return;
  }

  const popup = document.createElement("div");
  popup.id = "emojiPopup";
  popup.className =
    "fixed bg-white border border-slate-200 rounded-lg p-3 shadow-lg grid grid-cols-10 gap-1 text-lg z-50";
  popup.style.width = "360px";
  popup.style.maxHeight = "200px";
  popup.style.overflowY = "auto";

  // Posicionar el popup relativo al botón de emoji
  const rect = emojiBtn.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.bottom = `${window.innerHeight - rect.top + 10}px`;

  // Ajustar posición si se sale de la pantalla
  const popupWidth = 360;
  if (rect.left + popupWidth > window.innerWidth) {
    popup.style.left = `${window.innerWidth - popupWidth - 10}px`;
  }
  if (rect.left < 0) {
    popup.style.left = "10px";
  }

  // Título del popup
  const title = document.createElement("div");
  title.className =
    "col-span-10 text-xs font-medium text-slate-600 pb-2 border-b border-slate-100 mb-2";
  title.textContent = "Emojis frecuentes";
  popup.appendChild(title);

  emojis.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = emoji;
    btn.className =
      "hover:bg-slate-100 w-8 h-8 rounded flex items-center justify-center transition-colors";
    btn.addEventListener("click", () => {
      const textarea = waSendMessageText;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      textarea.value = text.slice(0, start) + emoji + text.slice(end);
      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
      textarea.focus();
      updateCharCounter();
      popup.remove();
    });
    popup.appendChild(btn);
  });

  emojiBtn.parentElement.style.position = "relative";
  document.body.appendChild(popup);
});

photoBtn?.addEventListener("click", () => {
  // Crear input file para fotos
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", (e) => {
    if (e.target.files[0]) {
      showSendStatus(
        `📷 Foto seleccionada: ${e.target.files[0].name}`,
        "success"
      );
    }
  });
  input.click();
});

fileBtn?.addEventListener("click", () => {
  // Crear input file para archivos
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,.doc,.docx,.xls,.xlsx,.txt";
  input.addEventListener("change", (e) => {
    if (e.target.files[0]) {
      showSendStatus(
        `📎 Archivo seleccionado: ${e.target.files[0].name}`,
        "success"
      );
    }
  });
  input.click();
});

// Cerrar popups al redimensionar o hacer scroll

window.addEventListener("resize", () => {
  const popup = document.getElementById("emojiPopup");
  if (popup) {
    popup.remove();
  }
});

window.addEventListener("scroll", () => {
  const popup = document.getElementById("emojiPopup");
  if (popup) {
    popup.remove();
  }
});

// ===== INICIALIZACIÓN =====

// Inicializar cuando se carga la página
document.addEventListener("DOMContentLoaded", () => {
  startStatusPolling();
  loadMessageHistory();
  updateCharCounter();
  loadOutbox();
  setInterval(loadOutbox, 15000);
});

// Limpiar interval al salir
window.addEventListener("beforeunload", () => {
  if (waStatusInterval) {
    clearInterval(waStatusInterval);
  }
});

// ===== UTILIDADES DE DEBUG =====

// Función para obtener estadísticas del polling (disponible en consola)
window.waPollingStats = function () {
  const now = Date.now();
  const timeSinceLastCheck = lastStatusCheck ? now - lastStatusCheck : 0;

  console.group("📊 WhatsApp Polling Stats");
  console.log(`Estado actual: ${currentWaStatus || "UNKNOWN"}`);
  console.log(`Intervalo actual: ${currentPollingInterval / 1000}s`);
  console.log(`Errores consecutivos: ${errorCount}`);
  console.log(`Última consulta: ${timeSinceLastCheck}ms ago`);
  console.log(
    `Próxima consulta: ~${Math.max(
      0,
      currentPollingInterval - timeSinceLastCheck
    )}ms`
  );

  // Mostrar configuración de intervalos
  console.log("\n🔧 Configuración de intervalos:");
  console.log("QR/INITIALIZING: 2s");
  console.log("AUTHENTICATED: 3s");
  console.log("READY: 30s");
  console.log("DISCONNECTED: 5s");
  console.log("ERROR/AUTH_FAILURE: 10s + backoff exponencial");
  console.log("NO_SESSION: 15s");
  console.groupEnd();
};

// Función para forzar reinicio del polling (útil para debug)
window.waRestartPolling = function (customInterval) {
  console.log("🔄 Reiniciando polling manualmente...");
  restartPolling(customInterval);
};
