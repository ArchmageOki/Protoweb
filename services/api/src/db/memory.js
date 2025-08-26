// Simulación de almacenamiento en memoria (sustituir por DB real luego)
export const db = {
  users: new Map(), // email -> user
  refresh: new Map(), // tokenId -> { userId, exp, revoked }
}
