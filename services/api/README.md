# API Service (Auth)

Archivos clave:
- `package.json`: dependencias y scripts del servicio API.
- `src/config.js`: constantes de configuración (TTL tokens, parámetros Argon2). En producción leer de variables de entorno.
- `src/db/memory.js`: almacenamiento en memoria (Map) simulando tablas: usuarios y refresh tokens.
- `src/models/userStore.js`: lógica de usuarios (crear, verificar password, bloqueo incremental, etc.).
- `src/auth/token.js`: emisión/verificación de access JWT y gestión de refresh tokens opacos.
- `src/auth/routes.js`: rutas /auth/* (register, login, refresh, logout).
- `src/middleware/auth.js`: middleware para proteger rutas usando el access token (Bearer).
- `src/index.js`: arranque Express, montaje de middlewares y rutas.

Flujo:
1. POST /auth/register -> crea usuario.
2. POST /auth/login -> set cookie rt (refresh), retorna accessToken.
3. Cliente usa Authorization: Bearer <accessToken> para rutas protegidas.
4. Cuando expira, POST /auth/refresh (envía cookie) -> nuevo access + refresh rotado.
5. POST /auth/logout -> revoca refresh y limpia cookie.

Próximos pasos recomendados: persistencia real, rate limiting, MFA, rotación de claves JWT, pruebas unitarias.
