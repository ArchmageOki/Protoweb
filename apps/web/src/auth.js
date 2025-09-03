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
let lastRefreshFailAt = 0
const REFRESH_FAIL_COOLDOWN = 3000
const REFRESH_LOCK_KEY = 'auth_refresh_lock_v1'
const REFRESH_BROADCAST_KEY = 'auth_refresh_broadcast_v1'

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
  window.addEventListener('storage', ev=>{
    if(ev.key === REFRESH_BROADCAST_KEY && ev.newValue){
      // Otro tab refrescó; podemos optar por no hacer nada hasta que caduque o forzar prefetch.
    }
  })
}

async function refreshIfNeeded(){
  const now = Date.now()
  if(accessToken && now <= accessExp - 5000) return
  if(refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      // Lock sencillo para evitar carreras entre pestañas
      let haveLock = false
      const candidate = Date.now()+':'+Math.random().toString(36).slice(2)
      try {
        if(localStorage && !localStorage.getItem(REFRESH_LOCK_KEY)){
          localStorage.setItem(REFRESH_LOCK_KEY, candidate)
          if(localStorage.getItem(REFRESH_LOCK_KEY) === candidate) haveLock = true
        }
      } catch(_e){}
      if(!haveLock){
        const waitStart = Date.now()
        while(Date.now() - waitStart < 4000){
          if(accessToken && Date.now() <= accessExp - 5000) return
          await new Promise(r=>setTimeout(r,150))
        }
      }
      const r = await fetch(API_BASE + '/auth/refresh', { method:'POST', credentials:'include' })
      if(!r.ok) throw new Error('refresh_failed')
      const data = await r.json()
      if(data.accessToken){ setAccess(data.accessToken, data.accessExp) }
      else throw new Error('no_token')
      try { localStorage.setItem(REFRESH_BROADCAST_KEY, JSON.stringify({ ts: Date.now(), exp: accessExp })) } catch(_e){}
    } finally {
      if(!accessToken){
        lastRefreshFailAt = Date.now()
      }
      try { if(localStorage.getItem(REFRESH_LOCK_KEY)) localStorage.removeItem(REFRESH_LOCK_KEY) } catch(_e){}
      refreshPromise = null
    }
  })()
  return refreshPromise
}

export async function authFetch(input, init={}){
  await refreshIfNeeded().catch(()=>{ /* ignore; redirigirá guard */ })
  const headers = new Headers(init.headers||{})
  if(accessToken) headers.set('Authorization', 'Bearer ' + accessToken)
  const resp = await fetch(input, { ...init, headers, credentials:'include' })
  if(resp.status === 401){
    // Intentar un único refresh forzado si no acabamos de fallar
    const now = Date.now()
    if(now - lastRefreshFailAt > REFRESH_FAIL_COOLDOWN){
      accessToken = null; accessExp = 0
      try { await refreshIfNeeded() } catch(_e){}
      if(accessToken){
        const headers2 = new Headers(init.headers||{})
        headers2.set('Authorization','Bearer '+accessToken)
        return fetch(input, { ...init, headers: headers2, credentials:'include' })
      }
    }
    // Redirigir a login si seguimos sin token
    if(!accessToken){
      // Evitar bucle en páginas de login/register
      const p = window.location.pathname
      if(!/login|register|forgot|reset/.test(p)){
        setTimeout(()=>{ window.location.href = '/index.html?sesion=expirada' }, 10)
      }
    }
  }
  return resp
}
