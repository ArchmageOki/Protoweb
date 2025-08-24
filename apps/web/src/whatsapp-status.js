// Detectar estado del backend de WhatsApp y, si falta sesión, pedir número.
// Estrategia simple: consulta a un endpoint (futuro) /whatsapp/status.
// Como aún no hay API HTTP real, usaremos localStorage como señal de arranque y
// pedir el número de forma perezosa al entrar en mensajes.html.

(function(){
  const isMensajes = /mensajes\.html$/i.test(window.location.pathname)
  if(!isMensajes) return

  const KEY = 'whatsapp.sessionPhone'
  const API = (path) => `http://localhost:4001${path}`

  async function fetchJSON(url, opts){
    const res = await fetch(url, { headers: { 'Content-Type':'application/json' }, ...opts })
    if(!res.ok) throw new Error('HTTP '+res.status)
    return res.json()
  }

  async function ensureSession(){
    const phone = localStorage.getItem(KEY)
    if(phone){
      try {
        const st = await fetchJSON(API(`/whatsapp/status?phone=${phone}`))
        if(st.state === 'ready') { renderStatus(st); return true }
        // Si está en pairing/qr redirigimos al login para mostrar código completo
        window.location.replace('/whatsapp-login.html')
        return false
      } catch {}
    }
    // Sin teléfono guardado: redirigir al login dedicado
    window.location.replace('/whatsapp-login.html')
    return false
  }

  function notify(msg, isError){
    const banner = document.createElement('div')
    banner.className = 'fixed bottom-4 right-4 max-w-sm text-sm px-4 py-3 rounded shadow border ' + (isError? 'bg-red-600 text-white border-red-700':'bg-slate-900 text-white border-slate-700')
    banner.textContent = msg
    document.body.appendChild(banner)
    setTimeout(()=>banner.remove(), 6000)
  }

  function renderStatus(st){
    let el = document.getElementById('wa-status-badge')
    if(!el){
      el = document.createElement('div')
      el.id = 'wa-status-badge'
      el.className = 'fixed top-4 right-4 z-50'
      document.body.appendChild(el)
    }
    const clsBase = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium shadow border'
    const map = {
      ready: 'bg-green-100 text-green-800 border-green-300',
      pairing: 'bg-amber-100 text-amber-800 border-amber-300',
      qr: 'bg-blue-100 text-blue-800 border-blue-300',
      disconnected: 'bg-red-100 text-red-700 border-red-300',
      auth_failure: 'bg-red-100 text-red-700 border-red-300',
      idle: 'bg-slate-100 text-slate-700 border-slate-300',
      absent: 'bg-slate-100 text-slate-700 border-slate-300'
    }
    const state = st.state || 'idle'
    el.innerHTML = ''
    const badge = document.createElement('span')
    badge.className = clsBase + ' ' + (map[state]||map.idle)
    badge.textContent = 'WA: '+state
  if(st.pairingCode){
      const code = document.createElement('code')
      code.className = 'ml-2 font-mono text-xs'
      code.textContent = st.pairingCode
      badge.appendChild(code)
    }
    el.appendChild(badge)
  }

  // Polling de estado mientras no esté ready
  async function poll(){
    const phone = localStorage.getItem(KEY)
    if(!phone) return
    try {
      const st = await fetchJSON(API(`/whatsapp/status?phone=${phone}`))
      renderStatus(st)
      if(st.state !== 'ready'){ setTimeout(poll, 4000) }
    } catch { setTimeout(poll, 6000) }
  }

  ensureSession().then(ok => { if(ok) poll() })
})();
