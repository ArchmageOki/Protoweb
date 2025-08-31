// Utilidades de autenticación frontend
// Mantiene access token en memoria y renueva vía /auth/refresh cuando expira

// Construir base API dinámicamente según host actual (útil si accedes vía IP LAN)
const API_HOST = window.location.hostname || 'localhost'
const API_PORT = 4002
const API_BASE = `http://${API_HOST}:${API_PORT}`
export const apiBase = API_BASE
let accessToken = null
let accessExp = 0
let refreshPromise = null

export function setAccess(token, exp){
  accessToken = token
  accessExp = exp * 1000 // almacenar en ms
}

export function getAccess(){ return accessToken }

// Devuelve un access token fresco (refresca si es necesario)
export async function ensureAccessToken(){
  await refreshIfNeeded().catch(()=>{})
  return accessToken
}

export async function ensureRefreshed(){
  await refreshIfNeeded().catch(()=>{})
  return !!accessToken
}

// Rehidratación: intentar un refresh inmediato al cargar si no hay token (para nuevas páginas)
if(typeof window !== 'undefined'){
  // Ejecutar después del event loop para no bloquear
  setTimeout(()=>{ if(!accessToken){ refreshIfNeeded().catch(()=>{}) } }, 0)
}

async function refreshIfNeeded(){
  const now = Date.now()
  if(accessToken && now <= accessExp - 5000) return
  if(refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const r = await fetch(API_BASE + '/auth/refresh', { method:'POST', credentials:'include' })
      if(!r.ok) throw new Error('refresh_failed')
      const data = await r.json()
      if(data.accessToken){ setAccess(data.accessToken, data.accessExp) }
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

export async function authFetch(input, init={}){
  await refreshIfNeeded().catch(()=>{ /* ignore; redirigirá guard */ })
  const headers = new Headers(init.headers||{})
  if(accessToken) headers.set('Authorization', 'Bearer ' + accessToken)
  return fetch(input, { ...init, headers, credentials:'include' })
}
