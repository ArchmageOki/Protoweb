// Lógica para la página 404.html
console.log("Inicializando página 404");

function initialize404Page() {
  const urlParams = new URLSearchParams(location.search);
  const reason = urlParams.get("reason");

  const titleElement = document.getElementById("title");
  const descElement = document.getElementById("desc");
  const extraElement = document.getElementById("extra");
  const homeLink = document.getElementById("home-link");

  console.log("Razón de error 404:", reason);

  if (reason === "token") {
    titleElement.textContent = "Enlace no válido o caducado";
    descElement.textContent =
      "El enlace que has utilizado ya no es válido. Puede haber expirado o ya fue usado.";
    extraElement.textContent =
      "Si necesitas un nuevo enlace, contacta con el establecimiento para que te lo reenvíen.";
    homeLink?.remove();
    console.log("Página 404 configurada para token inválido");
  } else if (reason === "missing-token") {
    titleElement.textContent = "Token ausente";
    descElement.textContent =
      "Esta página requiere un parámetro de acceso que no se ha proporcionado.";
    homeLink?.remove();
    console.log("Página 404 configurada para token ausente");
  } else {
    console.log("Página 404 configurada para error genérico");
  }
}

// Inicializar cuando el DOM esté listo
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize404Page);
} else {
  initialize404Page();
}
