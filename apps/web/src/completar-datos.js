// Script para completar-datos.html
// Usar proxy de Vite en desarrollo, API directa en producción
const API_BASE =
  location.hostname === "localhost" ? "" : `http://${location.hostname}:4002`;

const form = document.getElementById("complete-client-form");
const nextBtn = document.getElementById("cli-next");
const params = new URLSearchParams(location.search);
const token = params.get("token");
const fromConsent = params.get("from") === "consent"; // Detectar si viene desde consentimiento
const mobileInput = document.getElementById("cli-movil");
const instaInput = document.getElementById("cli-instagram");
const requiredFields = [
  "cli-nombre",
  "cli-apellidos",
  "cli-movil",
  "cli-dni",
  "cli-direccion",
  "cli-cp",
  "cli-fecha-nacimiento",
];

console.log(
  "Detectado origen:",
  fromConsent ? "Desde consentimiento" : "Acceso directo"
);

// VALIDACIÓN INMEDIATA: Sin token -> redirect
if (!token) {
  window.location.replace("/404.html?reason=missing-token");
  throw new Error("No token provided");
}

// Marcar todos los campos como required excepto Instagram
requiredFields.forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.required = true;
});

let tokenValid = false;
let clientData = null;

// Bloquear interfaz hasta validar token
form.style.opacity = "0.5";
form.style.pointerEvents = "none";
nextBtn.disabled = true;
nextBtn.textContent = "Validando token...";

// Validar token y cargar datos
async function initializePage() {
  try {
    console.log("Validando token:", token);
    const response = await fetch(
      API_BASE + `/public/client-completion/${encodeURIComponent(token)}`
    );
    console.log("Response status:", response.status);

    if (!response.ok) {
      console.error("Token inválido, status:", response.status);
      window.location.replace("/404.html?reason=token");
      return;
    }

    const result = await response.json();
    console.log("Datos recibidos:", result);

    if (!result?.client) {
      console.error("No se encontraron datos del cliente");
      window.location.replace("/404.html?reason=token");
      return;
    }

    // Token válido - habilitar interfaz
    tokenValid = true;
    clientData = result.client;
    form.style.opacity = "1";
    form.style.pointerEvents = "auto";
    nextBtn.disabled = false;
    nextBtn.textContent = "Siguiente";

    // Verificar si hay datos guardados en sessionStorage (cuando vuelve atrás)
    const savedFormData = sessionStorage.getItem("clientFormData");
    let dataToLoad = clientData;

    if (savedFormData && fromConsent) {
      // Si viene desde consentimiento, usar datos guardados
      try {
        const parsedSavedData = JSON.parse(savedFormData);
        console.log(
          "Volviendo desde consentimiento - usando datos guardados:",
          parsedSavedData
        );

        // Usar datos guardados en lugar de los originales de la BD
        dataToLoad = {
          first_name: parsedSavedData.first_name,
          last_name: parsedSavedData.last_name,
          mobile: parsedSavedData.mobile,
          dni: parsedSavedData.dni,
          address: parsedSavedData.address,
          postal_code: parsedSavedData.postal_code,
          birth_date: parsedSavedData.birth_date,
          instagram: parsedSavedData.instagram,
        };
      } catch (e) {
        console.warn(
          "Error al parsear datos guardados, usando datos originales:",
          e
        );
        dataToLoad = clientData;
      }
    } else if (!fromConsent) {
      // Si es acceso directo, limpiar datos guardados anteriores
      console.log("Acceso directo - limpiando datos guardados anteriores");
      sessionStorage.removeItem("clientFormData");
    }

    // Cargar datos (originales de BD o guardados en sessionStorage)
    form.elements["nombre"].value = dataToLoad.first_name || "";
    form.elements["apellidos"].value = dataToLoad.last_name || "";
    form.elements["movil"].value = dataToLoad.mobile || "";
    form.elements["dni"].value = dataToLoad.dni || "";
    form.elements["direccion"].value = dataToLoad.address || "";
    form.elements["codigo_postal"].value = dataToLoad.postal_code || "";
    form.elements["fecha_nacimiento"].value = dataToLoad.birth_date || "";
    form.elements["instagram"].value = dataToLoad.instagram || "";

    // Campo móvil no editable (gris)
    mobileInput.readOnly = true;
    mobileInput.classList.add(
      "bg-gray-100",
      "text-gray-500",
      "cursor-not-allowed"
    );

    console.log("Página inicializada correctamente");

    // Agregar listeners para guardar cambios automáticamente
    const autoSaveFields = [
      "nombre",
      "apellidos",
      "dni",
      "direccion",
      "codigo_postal",
      "fecha_nacimiento",
      "instagram",
    ];
    let isInitialLoad = true;

    autoSaveFields.forEach((fieldName) => {
      const field = form.elements[fieldName];
      if (field) {
        // Marcar como no inicial después del primer evento focus o input
        field.addEventListener(
          "focus",
          () => {
            isInitialLoad = false;
          },
          { once: true }
        );

        field.addEventListener("input", () => {
          if (!isInitialLoad) {
            // Guardar cambios automáticamente en sessionStorage
            const currentData = {
              first_name: form.elements["nombre"].value.trim(),
              last_name: form.elements["apellidos"].value.trim(),
              mobile: form.elements["movil"].value.trim(),
              dni: form.elements["dni"].value.trim(),
              address: form.elements["direccion"].value.trim(),
              postal_code: form.elements["codigo_postal"].value.trim(),
              birth_date: form.elements["fecha_nacimiento"].value,
              instagram: form.elements["instagram"].value.trim(),
            };
            sessionStorage.setItem(
              "clientFormData",
              JSON.stringify(currentData)
            );
            console.log("Datos guardados automáticamente");
          }
        });
      }
    });
  } catch (error) {
    console.error("Error validando token:", error);
    window.location.replace("/404.html?reason=token");
    return;
  }
}

// Evento click del botón siguiente
nextBtn.addEventListener("click", async () => {
  if (!token || !tokenValid) {
    window.location.replace("/404.html?reason=token");
    return;
  }

  if (!form.reportValidity()) return;

  const data = Object.fromEntries(new FormData(form).entries());

  // Validar que todos los campos obligatorios están completos
  const requiredData = {
    nombre: data.nombre?.trim(),
    apellidos: data.apellidos?.trim(),
    movil: data.movil?.trim(),
    dni: data.dni?.trim(),
    direccion: data.direccion?.trim(),
    codigo_postal: data.codigo_postal?.trim(),
    fecha_nacimiento: data.fecha_nacimiento,
  };

  for (const [field, value] of Object.entries(requiredData)) {
    if (!value) {
      alert(`El campo ${field} es obligatorio`);
      return;
    }
  }

  // Guardar datos en sessionStorage para usar en la siguiente página
  sessionStorage.setItem(
    "clientFormData",
    JSON.stringify({
      first_name: requiredData.nombre,
      last_name: requiredData.apellidos,
      mobile: requiredData.movil,
      dni: requiredData.dni,
      address: requiredData.direccion,
      postal_code: requiredData.codigo_postal,
      birth_date: requiredData.fecha_nacimiento,
      instagram: data.instagram?.trim() || "",
    })
  );

  console.log("Datos guardados en sessionStorage, navegando a consentimiento");

  // Ir a página de consentimiento sin guardar aún
  window.location.href = `/consentimiento-whatsapp.html?token=${encodeURIComponent(
    token
  )}`;
});

// Inicializar página cuando el DOM esté listo
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializePage);
} else {
  initializePage();
}
