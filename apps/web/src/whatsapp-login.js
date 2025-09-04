import "./style.css";
import { ensureAccessToken } from "./auth.js";

// Elementos DOM
const statusText = document.getElementById("statusText");
const qrWrap = document.getElementById("qrWrap");
const resetBtn = document.getElementById("resetBtn");
const deleteSessionBtn = document.getElementById("deleteSessionBtn");
const regenerateQrBtn = document.getElementById("regenerateQrBtn");
const qrTimer = document.getElementById("qrTimer");
const qrCountdown = document.getElementById("qrCountdown");

// Estado del polling y QR
let pollingInterval = null;
let qrTimeoutId = null;
let qrCountdownInterval = null;
let qrSecondsLeft = 60;
let currentQRData = null; // Almacenar QR actual
let qrActive = false; // Estado si QR está activo y siendo mostrado

// Función para hacer requests autenticados
async function apiRequest(url, options = {}) {
  const token = await ensureAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

// Actualizar el texto de estado
function updateStatus(message) {
  if (statusText) {
    statusText.textContent = message;
    console.log("[WhatsApp Login]", message);
  }
}

// Mostrar el código QR con temporizador
function showQR(qrData) {
  if (!qrWrap) return;

  if (qrData) {
    // Si ya hay un QR activo, no resetear el temporizador, solo actualizar la imagen si es diferente
    if (qrActive && currentQRData === qrData) {
      return; // No hacer nada, mantener el QR y temporizador actual
    }

    // Si es un QR nuevo o no hay QR activo, inicializar/resetear
    if (!qrActive || currentQRData !== qrData) {
      // Limpiar timers anteriores solo si no hay QR activo
      clearQRTimers();

      currentQRData = qrData;
      qrActive = true;

      qrWrap.innerHTML = `<img src="${qrData}" alt="QR Code" class="w-full h-full object-contain rounded" />`;

      // Mostrar temporizador y ocultar botón regenerar
      if (qrTimer) {
        qrTimer.classList.remove("hidden");
      }
      if (regenerateQrBtn) {
        regenerateQrBtn.classList.add("hidden");
      }

      // Iniciar cuenta regresiva
      qrSecondsLeft = 60;
      updateQRCountdown();
      qrCountdownInterval = setInterval(updateQRCountdown, 1000);

      // Ocultar QR después de 60 segundos
      qrTimeoutId = setTimeout(() => {
        hideQR(); // hideQR() ya incluye el botón integrado
        qrActive = false;
        currentQRData = null;
      }, 60000);
    }
  } else {
    // Sin QR data, limpiar todo
    clearQRTimers();
    qrActive = false;
    currentQRData = null;
    qrWrap.innerHTML =
      '<span class="text-slate-400 text-xs">Esperando QR...</span>';
    hideQRTimer();
  }
}

// Actualizar cuenta regresiva
function updateQRCountdown() {
  if (qrCountdown) {
    qrCountdown.textContent = qrSecondsLeft;
  }
  qrSecondsLeft--;
}

// Ocultar QR y mostrar mensaje con botón integrado
function hideQR() {
  if (qrWrap) {
    qrWrap.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full py-8">
        <button id="regenerateQrBtnIntegrated" class="text-blue-600 hover:text-blue-800 text-sm font-medium mb-3 transition-colors" type="button">
          Generar QR de nuevo
        </button>
        <svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
      </div>
    `;

    // Conectar el evento al nuevo botón integrado
    const integratedBtn = document.getElementById("regenerateQrBtnIntegrated");
    if (integratedBtn) {
      integratedBtn.addEventListener("click", handleRegenerateQR);
    }
  }
  hideQRTimer();
}

// Mostrar botón de regenerar QR (ahora integrado en hideQR)
function showRegenerateButton() {
  // El botón ahora está integrado en el cuadro QR
  // Mantener oculto el botón externo
  if (regenerateQrBtn) {
    regenerateQrBtn.classList.add("hidden");
  }
}

// Ocultar temporizador
function hideQRTimer() {
  if (qrTimer) {
    qrTimer.classList.add("hidden");
  }
}

// Limpiar todos los timers del QR
function clearQRTimers() {
  if (qrTimeoutId) {
    clearTimeout(qrTimeoutId);
    qrTimeoutId = null;
  }
  if (qrCountdownInterval) {
    clearInterval(qrCountdownInterval);
    qrCountdownInterval = null;
  }
  hideQRTimer();
}

// Verificar el estado de WhatsApp
async function checkStatus() {
  try {
    const data = await apiRequest("/data/whatsapp/status");
    const { status, qr } = data;

    console.log("[WhatsApp] Status:", status);

    switch (status) {
      case "NO_SESSION":
        updateStatus("Iniciando sesión de WhatsApp...");
        showQR(null);
        await apiRequest("/data/whatsapp/start", { method: "POST" });
        break;

      case "INITIALIZING":
        updateStatus("Inicializando WhatsApp...");
        showQR(null);
        break;

      case "QR":
        updateStatus("Escanea el código QR con tu WhatsApp");
        showQR(qr);
        break;

      case "AUTHENTICATED":
        updateStatus("Autenticado. Ya puedes usar WhatsApp!");
        clearQRTimers();
        qrActive = false;
        currentQRData = null;
        showQR(null);
        stopPolling();
        setTimeout(() => {
          window.location.href = "/mensajes.html";
        }, 1500);
        break;

      case "LOADING":
        updateStatus("Cargando WhatsApp Web...");
        clearQRTimers();
        qrActive = false;
        currentQRData = null;
        showQR(null);
        break;

      case "READY":
        updateStatus("¡Conectado exitosamente! Redirigiendo...");
        clearQRTimers();
        qrActive = false;
        currentQRData = null;
        showQR(null);
        stopPolling();
        setTimeout(() => {
          window.location.href = "/mensajes.html";
        }, 1500);
        break;

      case "QR_EXPIRED":
        updateStatus("Código QR expirado");
        hideQR(); // hideQR() ya incluye el botón integrado
        qrActive = false;
        currentQRData = null;
        break;

      case "DISCONNECTED":
        updateStatus("Desconectado. Reiniciando...");
        showQR(null);
        await apiRequest("/data/whatsapp/start", { method: "POST" });
        break;
      case "UNAVAILABLE":
        updateStatus("Servicio de WhatsApp no disponible. Arrancando...");
        showQR(null);
        // Intentar iniciar (puede disparar autospawn en backend)
        try {
          await apiRequest("/data/whatsapp/start", { method: "POST" });
        } catch {}
        break;

      default:
        updateStatus(`Estado: ${status}`);
        showQR(null);
    }
  } catch (error) {
    console.error("[WhatsApp] Error:", error);
    updateStatus("Error de conexión");
    showQR(null);
  }
}

// Iniciar el polling
function startPolling() {
  if (pollingInterval) return;

  updateStatus("Conectando con WhatsApp...");
  checkStatus(); // Primera verificación inmediata

  pollingInterval = setInterval(checkStatus, 3000); // Verificar cada 3 segundos
}

// Detener el polling
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Reiniciar sesión
async function resetSession() {
  try {
    updateStatus("Reiniciando sesión...");
    showQR(null);

    stopPolling();
    clearQRTimers();
    qrActive = false;
    currentQRData = null;

    await apiRequest("/data/whatsapp/reset", { method: "POST" });

    updateStatus("Sesión reiniciada. Reconectando...");

    setTimeout(startPolling, 2000);
  } catch (error) {
    console.error("[WhatsApp] Reset error:", error);
    updateStatus("Error al reiniciar sesión");
  }
}

// Eliminar sesión completa y generar nuevo QR
async function deleteSession() {
  try {
    updateStatus("Eliminando sesión y generando nuevo QR...");
    showQR(null);

    stopPolling();
    clearQRTimers();
    qrActive = false;
    currentQRData = null;

    await apiRequest("/data/whatsapp/delete-session", { method: "POST" });

    updateStatus("Sesión eliminada. Generando nuevo QR...");

    setTimeout(startPolling, 2000);
  } catch (error) {
    console.error("[WhatsApp] Delete session error:", error);
    updateStatus("Error al eliminar sesión");
  }
}

// Regenerar QR (cuando ha expirado)
// Función para regenerar QR (reutilizable)
async function handleRegenerateQR() {
  try {
    updateStatus("Generando nuevo QR...");

    // Ocultar botón regenerar externo si existe
    if (regenerateQrBtn) {
      regenerateQrBtn.classList.add("hidden");
    }

    // Resetear estado QR
    clearQRTimers();
    qrActive = false;
    currentQRData = null;

    await apiRequest("/data/whatsapp/force-qr", { method: "POST" });

    updateStatus("Nuevo QR generado");

    // Verificar estado para obtener el nuevo QR
    setTimeout(checkStatus, 1000);
  } catch (error) {
    console.error("[WhatsApp] Error regenerando QR:", error);
    updateStatus("Error generando nuevo QR");
    showRegenerateButton();
  }
}

// Función original para compatibilidad con botón externo
async function regenerateQR() {
  return handleRegenerateQR();
}

// Event listeners
if (resetBtn) {
  resetBtn.addEventListener("click", resetSession);
}

if (deleteSessionBtn) {
  deleteSessionBtn.addEventListener("click", deleteSession);
}

if (regenerateQrBtn) {
  regenerateQrBtn.addEventListener("click", regenerateQR);
}

// Limpiar al salir
window.addEventListener("beforeunload", () => {
  stopPolling();
  clearQRTimers();
});

// Iniciar
startPolling();
