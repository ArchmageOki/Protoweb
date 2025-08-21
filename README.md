# Protoweb Monorepo

Estructura del proyecto:

```
apps/
  web/            # Frontend Vite + Tailwind
services/
  api/            # Backend principal (DB + lógica)
  whatsapp/       # Servicio WhatsApp (futuro, p.ej. whatsapp-web.js)
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
