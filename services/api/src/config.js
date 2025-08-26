// Configuración centralizada (en futuro: leer de process.env)
export const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change'
export const ACCESS_TOKEN_TTL_SEC = 15 * 60 // 15 min
export const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60 // 7 días
export const PASSWORD_HASH_MEMORY = 19 * 1024 // ~19MB
export const PASSWORD_HASH_TIME = 2
export const PASSWORD_HASH_PARALLELISM = 1
export const DB_BACKEND = 'pg'
