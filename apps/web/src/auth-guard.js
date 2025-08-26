// Redirige a login si no se obtiene /me
import { authFetch, apiBase } from './auth.js'

async function check(){
  const attempt = async () => {
    const r = await authFetch(apiBase + '/me')
    if(!r.ok) return null
    const data = await r.json().catch(()=>null)
    return data && data.ok ? data : null
  }
  let data = await attempt()
  if(!data){
    // Esperar un poco por si el refresh concurrente está en curso
    await new Promise(r=>setTimeout(r,150))
    data = await attempt()
  }
  if(!data){
    window.location.replace('/index.html')
  } else {
    console.info('Usuario autenticado', data.user)
  }
}

check()
