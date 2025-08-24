# Protoweb Monorepo

Estructura del proyecto:

```
apps/
  web/            # Frontend Vite + Tailwind
services/
  api/            # Backend principal (DB + lógica)
  whatsapp/       # Servicio WhatsApp (whatsapp-web.js)
packages/
  shared/         # Librerías compartidas (tipos/utilidades)
infra/
  docker-compose.yml (futuro)
  reverse-proxy/      (futuro)
docs/
```

Comandos útiles:

- Iniciar frontend: `npm run dev:web`
- Iniciar servicio WhatsApp: `npm run dev:whatsapp`
- Construir frontend: `npm run build:web`
- Preview frontend: `npm run preview:web`

Workspaces: se gestionan desde el `package.json` raíz.

## Servicio WhatsApp

Se basa en `whatsapp-web.js` con `LocalAuth` para persistir la sesión bajo `services/whatsapp/.wwebjs_auth`.

Arranque:

```
npm run dev:whatsapp
```

Primer inicio mostrará un QR en consola. Escanéalo con la app móvil. Envía "ping" desde un chat para recibir "pong" como prueba.

Integración futura (ideas):

- Exponer REST/websocket para que `apps/web` consuma estado de conversaciones.
- Persistir mensajes en el servicio `api` (cuando exista DB) en lugar de memoria.
- Gestión de plantillas y envío masivo desde Ajustes/Mensajes en el frontend.
