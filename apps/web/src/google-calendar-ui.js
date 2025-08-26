import { authFetch, apiBase } from './auth.js'

// Este módulo inicializa los elementos de integración Google Calendar si existen en el DOM (calendario o ajustes)
(function(){
  async function refreshGoogleStatus(){
    const st = document.getElementById('google-cal-status')
    if(!st) return // nada que hacer en esta página
    try {
      const res = await authFetch(apiBase + '/data/integrations/google/status')
      if(!res.ok) throw new Error()
      const data = await res.json()
      const connectBtn = document.getElementById('google-cal-connect')
      const reauthInline = document.getElementById('google-cal-reauth-inline')
      const picker = document.getElementById('google-cal-picker')
      const currentSpan = document.getElementById('google-cal-current')
      const syncBtn = document.getElementById('google-cal-sync') // sólo existe en calendario.html
      const disconnectBtn = document.getElementById('google-cal-disconnect')
      if(data.connected){
        const pending = data.account?.pending
        st.classList.remove('hidden'); st.textContent = pending ? 'Conectado (selecciona calendario)' : 'Conectado con Google'; st.className='text-xs font-normal px-2 py-1 rounded ' + (pending? 'bg-amber-100 text-amber-700':'bg-green-100 text-green-700')
        connectBtn?.classList.add('hidden')
        if(!pending){
          picker?.classList.remove('hidden')
          if(syncBtn) syncBtn.classList.remove('hidden')
          disconnectBtn?.classList.remove('hidden')
        } else {
          // Mostrar botón para abrir selector si hay sección ajustes
          picker?.classList.remove('hidden')
          disconnectBtn?.classList.remove('hidden')
        }
        if(data.account?.calendar_id && currentSpan) currentSpan.textContent = data.account.calendar_id || '—'
        const scope = data.account?.scope || ''
        if(scope && !scope.includes('calendar.readonly')) reauthInline?.classList.remove('hidden')
        else reauthInline?.classList.add('hidden')
      } else {
        st.classList.remove('hidden'); st.textContent='No conectado'; st.className='text-xs font-normal px-2 py-1 rounded bg-amber-100 text-amber-700'
        connectBtn?.classList.remove('hidden')
        if(syncBtn) syncBtn.classList.add('hidden')
        reauthInline?.classList.add('hidden')
        picker?.classList.add('hidden')
        disconnectBtn?.classList.add('hidden')
      }
    } catch(e){ console.error('[google] status_failed', e) }
  }

  async function startOAuth(challenge){
    const r = await authFetch(apiBase + '/data/integrations/google/authurl?pkce_challenge='+encodeURIComponent(challenge))
    if(!r.ok) throw new Error('authurl_failed')
    const j = await r.json(); return j.url
  }

  async function pkce(){
    const rnd = crypto.getRandomValues(new Uint8Array(32))
    const base64url = (arr)=> btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
    const verifier = base64url(rnd)
    const enc = new TextEncoder().encode(verifier)
    const hash = await crypto.subtle.digest('SHA-256', enc)
    const challenge = base64url(new Uint8Array(hash))
    sessionStorage.setItem('google_pkce_verifier', verifier)
    return challenge
  }

  document.getElementById('google-cal-connect')?.addEventListener('click', async ()=>{
    try {
      const challenge = await pkce()
      const url = await startOAuth(challenge)
      window.location.href = url
    } catch(e){ console.error(e); alert('Error iniciando OAuth') }
  })

  document.getElementById('google-cal-sync')?.addEventListener('click', async ()=>{
    const btn = document.getElementById('google-cal-sync')
    if(btn) { btn.disabled=true; btn.textContent='Sync…' }
    try { await authFetch(apiBase + '/data/integrations/google/sync', { method:'POST' }) } catch(e){ alert('Error sync') }
    if(btn){ btn.disabled=false; btn.textContent='Sync' }
  })

  document.getElementById('google-cal-reauth-inline')?.addEventListener('click', async ()=>{
    try {
      const r = await authFetch(apiBase + '/data/integrations/google/authurl?scope=events')
      if(!r.ok) throw new Error()
      const j = await r.json(); window.location.href = j.url
    } catch { alert('Error generando nueva autorización') }
  })

  document.getElementById('google-cal-disconnect')?.addEventListener('click', async ()=>{
    // Abrir modal personalizado
    const modal = document.getElementById('google-disconnect-modal')
    const input = document.getElementById('google-disconnect-confirm')
    const confirmBtn = document.getElementById('google-disconnect-confirm-btn')
    const cancelBtn = document.getElementById('google-disconnect-cancel')
    if(!modal || !input || !confirmBtn) return
    modal.classList.remove('hidden')
    input.value=''
    confirmBtn.disabled = true
    input.focus()
    function close(){ modal.classList.add('hidden'); input.value=''; confirmBtn.disabled=true }
    input.addEventListener('input', ()=>{ confirmBtn.disabled = input.value.trim() !== 'DESCONECTAR' })
    cancelBtn?.addEventListener('click', ()=> close(), { once:true })
    confirmBtn.addEventListener('click', async ()=>{
      if(confirmBtn.disabled) return
      confirmBtn.disabled=true; confirmBtn.textContent='Eliminando...'
      try {
        const r = await authFetch(apiBase + '/data/integrations/google/account', { method:'DELETE' })
        if(!r.ok) throw new Error()
        close()
        // Refrescar estado e intentar limpiar eventos visibles en calendario si estamos en esa página
        refreshGoogleStatus()
        // Si existe FullCalendar en ventana, quitar eventos
        try {
          const calRoot = document.getElementById('month-calendar')
          if(calRoot){
            // Borrar nodos de eventos (simplificado: recarga)
            window.location.pathname.endsWith('/calendario.html') && window.location.reload()
          }
        } catch {}
      } catch { alert('Error desconectando') }
      finally { confirmBtn.disabled=false; confirmBtn.textContent='Desconectar definitivamente' }
    }, { once:true })
  })

  const pickerBtn = document.getElementById('google-cal-picker-btn')
  const dropdown = document.getElementById('google-cal-dropdown')
  pickerBtn?.addEventListener('click', async ()=>{
    if(!dropdown) return
    if(dropdown.classList.contains('hidden')){
      dropdown.innerHTML = '<div class="p-2 text-slate-500">Cargando…</div>'
      dropdown.classList.remove('hidden')
      try {
        const r = await authFetch(apiBase + '/data/integrations/google/calendars')
        if(!r.ok){
          let j=null; try { j = await r.json() } catch{}
          if(j?.error==='insufficient_scope'){
            dropdown.innerHTML = `<div class='p-2 text-red-600 space-y-2'>Permisos insuficientes.<br><button id='google-cal-reauth' class='px-2 py-1 border rounded text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50'>Reautorizar</button></div>`
            dropdown.querySelector('#google-cal-reauth')?.addEventListener('click', async ()=>{
              try {
                const r2 = await authFetch(apiBase + '/data/integrations/google/authurl?scope=events')
                if(!r2.ok) throw new Error()
                const j2 = await r2.json(); window.location.href = j2.url
              } catch { alert('Error generando nueva autorización') }
            })
            return
          }
          throw new Error()
        }
        const j = await r.json()
        dropdown.innerHTML = ''
        j.items.forEach(cal => {
          const item = document.createElement('button')
          item.type = 'button'
          item.className='w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-2'
          item.innerHTML = `<span class="flex-1 truncate">${cal.summary||cal.id}</span>${cal.primary?'<span class="text-[10px] px-1 rounded bg-indigo-100 text-indigo-700">primario</span>':''}`
          item.addEventListener('click', async ()=>{
            dropdown.innerHTML = '<div class="p-2 text-slate-500">Guardando…</div>'
            try {
              const r2 = await authFetch(apiBase + '/data/integrations/google/calendar', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ calendar_id: cal.id }) })
              if(!r2.ok) throw new Error()
              dropdown.classList.add('hidden')
              refreshGoogleStatus()
            } catch { dropdown.innerHTML = '<div class="p-2 text-red-600">Error</div>' }
          })
          dropdown.appendChild(item)
        })
      } catch { if(!dropdown.innerHTML.includes('Permisos insuficientes')) dropdown.innerHTML = '<div class="p-2 text-red-600">Error cargando</div>' }
    } else {
      dropdown.classList.add('hidden')
    }
  })
  document.addEventListener('click', (e)=>{ if(dropdown && !dropdown.contains(e.target) && e.target!==pickerBtn) dropdown.classList.add('hidden') })

  refreshGoogleStatus()
})()
