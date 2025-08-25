# Protoweb Monorepo

Estructura del proyecto:

```
apps/
  web/            # Frontend Vite + Tailwind
services/
  api/            # Backend principal (DB + lógica)
packages/
  shared/         # Librerías compartidas (tipos/utilidades)
infra/
  docker-compose.yml (futuro)
  reverse-proxy/      (futuro)
docs/
```

Comandos útiles:

- Iniciar frontend: `npm run dev:web`
- Construir frontend: `npm run build:web`
- Preview frontend: `npm run preview:web`

Workspaces: se gestionan desde el `package.json` raíz.

## Módulo de Mensajes (en construcción)

El antiguo servicio de integración WhatsApp ha sido retirado. El nuevo enfoque se centra en:

- Plantillas reutilizables de texto (con variables).
- Programación de campañas / recordatorios (one-shot y recurrentes).
- Historial de envíos y métricas básicas (estado, entregado, errores).
- Futuro: soportar múltiples canales (email/SMS) según prioridad.

Estructura actual: sólo la página `mensajes.html` con layout base. Próximos pasos (propuestos):

1. Definir esquema de plantilla (id, nombre, body, variables, updatedAt).
2. Endpoint CRUD plantillas (`/api/templates`).
3. Modelo de campaña (id, templateId, segmento, schedule, estado).
4. Worker / scheduler simple en `services/api` para ejecutar campañas pendientes.
5. UI inicial: lista de plantillas y creación de campaña.
