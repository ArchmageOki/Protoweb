// Script para consentimiento-whatsapp.html
// Usar proxy de Vite en desarrollo, API directa en producción
const API_BASE =
  location.hostname === "localhost" ? "" : `http://${location.hostname}:4002`;

const consent = document.getElementById("wa-consent");
const back = document.getElementById("btn-back");
const finish = document.getElementById("btn-finish");
const msg = document.getElementById("consent-msg");
const params = new URLSearchParams(location.search);
const token = params.get("token");

// VALIDACIÓN INMEDIATA: Sin token -> redirect
if (!token) {
  window.location.replace("/404.html?reason=missing-token");
  throw new Error("No token provided");
}

// Bloquear interfaz hasta validar token
finish.disabled = true;
back.disabled = true;
finish.textContent = "Validando token...";

// Validar que el token sigue siendo válido
async function initializePage() {
  try {
    console.log("Validando token en consentimiento:", token);
    const response = await fetch(
      API_BASE + `/public/client-completion/${encodeURIComponent(token)}`
    );
    console.log("Response status:", response.status);

    if (!response.ok) {
      console.error(
        "Token inválido en consentimiento, status:",
        response.status
      );
      window.location.replace("/404.html?reason=token");
      return;
    }

    const result = await response.json();
    if (!result?.client) {
      console.error("No se encontraron datos del cliente en consentimiento");
      window.location.replace("/404.html?reason=token");
      return;
    }

    // Token válido - habilitar interfaz
    finish.disabled = false;
    back.disabled = false;
    finish.textContent = "Finalizar";

    console.log("Página de consentimiento inicializada correctamente");
  } catch (error) {
    console.error("Error validando token en consentimiento:", error);
    window.location.replace("/404.html?reason=token");
    return;
  }
}

// Evento click del botón atrás
back.addEventListener("click", () => {
  console.log("Volviendo a completar datos");
  // Agregar parámetro para indicar que viene desde consentimiento
  window.location.href = `/completar-datos.html?token=${encodeURIComponent(
    token
  )}&from=consent`;
});

// Evento click del botón finalizar
finish.addEventListener("click", async () => {
  if (!token) {
    window.location.replace("/404.html?reason=missing-token");
    return;
  }

  console.log("Iniciando proceso de finalización");

  // Recuperar datos del formulario guardados en sessionStorage
  const clientFormData = sessionStorage.getItem("clientFormData");
  if (!clientFormData) {
    alert(
      "Error: No se encontraron los datos del formulario. Vuelve al paso anterior."
    );
    window.location.href = `/completar-datos.html?token=${encodeURIComponent(
      token
    )}`;
    return;
  }

  let parsedClientData;
  try {
    parsedClientData = JSON.parse(clientFormData);
    console.log("Datos del cliente recuperados:", parsedClientData);
  } catch (e) {
    alert("Error: Datos del formulario corrompidos. Vuelve al paso anterior.");
    window.location.href = `/completar-datos.html?token=${encodeURIComponent(
      token
    )}`;
    return;
  }

  finish.disabled = true;
  back.disabled = true;
  finish.textContent = "Guardando datos...";

  try {
    console.log("Enviando datos finales - consentimiento:", consent.checked);

    // Finalizar el proceso: guardar datos + consentimiento + caducar token
    const res = await fetch(
      API_BASE +
        `/public/client-completion/${encodeURIComponent(token)}/consent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whatsapp_consent: consent.checked,
          client_data: parsedClientData,
        }),
      }
    );

    console.log("Response status finalización:", res.status);

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("Error en finalización:", errorData);

      if (errorData.error === "invalid_token") {
        window.location.replace("/404.html?reason=token");
        return;
      }

      finish.disabled = false;
      back.disabled = false;
      finish.textContent = "Finalizar";
      msg.textContent = `Error: ${
        errorData.error || "No se pudieron guardar los datos"
      }`;
      return;
    }

    // Limpiar datos temporales
    sessionStorage.removeItem("clientFormData");
    console.log("Datos guardados exitosamente, token caducado");

    finish.textContent = "Completado ✓";
    msg.textContent = consent.checked
      ? "Datos guardados. Has aceptado recibir comunicaciones vía WhatsApp."
      : "Datos guardados. Has optado por no recibir comunicaciones vía WhatsApp.";

    // Redirect a página final (sin token ya que está caducado)
    setTimeout(() => {
      console.log("Navegando a página final");
      window.location.href = "/finalizado.html";
    }, 1500);
  } catch (e) {
    console.error("Error finalizando proceso:", e);
    finish.disabled = false;
    back.disabled = false;
    finish.textContent = "Finalizar";
    msg.textContent = "Error de conexión. Inténtalo de nuevo.";
  }
});

// Inicializar página cuando el DOM esté listo
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializePage);
} else {
  initializePage();
}
