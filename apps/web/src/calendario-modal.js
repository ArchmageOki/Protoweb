import { authFetch, apiBase } from '/src/auth.js'

(function(){
  // Ahora el modal se muestra si no hay calendar_id todavía (estado pending) detectado vía status inicial
  // Se invoca sólo en calendario.html (este script cargado allí) cuando aún no hay calendario asignado
  // Para evitar parpadeo, primero comprobamos estado
  let mounted=false
  async function init(){
    try {
      const r = await authFetch(apiBase + '/data/integrations/google/status')
      if(!r.ok) return
      const j = await r.json()
      if(!j.connected || j.account?.calendar_id) return // nada que hacer
      showModal()
    } catch{}
  }
  function showModal(){
    if(mounted) return; mounted=true
    // Mostrar modal de selección de calendario sólo si el usuario aún no tiene calendar_id escogido
  const modal = document.createElement('div')
  modal.id='calendar-pick-once-modal'
  modal.className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'
  modal.innerHTML = `
    <div class="bg-white rounded-md shadow-lg max-w-md w-full p-5 space-y-4">
      <h3 class="text-sm font-semibold">Selecciona un calendario</h3>
      <p class="text-xs text-slate-600 leading-relaxed">Elige en qué calendario de tu cuenta de Google se crearán los eventos. Puedes cambiarlo más tarde en Ajustes.</p>
      <div id="first-cal-list" class="border border-slate-200 rounded max-h-60 overflow-auto divide-y divide-slate-100"></div>
      <div class="flex justify-end gap-2 pt-2 text-[11px] text-slate-500">
        Debes seleccionar un calendario para comenzar.
      </div>
    </div>`
  document.body.appendChild(modal)
  const listBox = modal.querySelector('#first-cal-list')
  const skipBtn = null
  async function load(){
    listBox.innerHTML = '<div class="p-3 text-xs text-slate-500">Cargando calendarios…</div>'
    try {
      const r = await authFetch(apiBase + '/data/integrations/google/calendars')
      if(!r.ok) throw new Error()
      const j = await r.json()
      listBox.innerHTML = ''
      j.items.forEach(cal => {
        const btn = document.createElement('button')
        btn.type='button'
        btn.className='w-full text-left px-3 py-2 text-xs hover:bg-slate-100 flex items-center gap-2'
        btn.innerHTML = `<span class="flex-1 truncate">${cal.summary||cal.id}</span>${cal.primary?'<span class="text-[10px] px-1 rounded bg-indigo-100 text-indigo-700">primario</span>':''}`
        btn.addEventListener('click', async ()=>{
          btn.disabled=true
          btn.textContent='Guardando…'
          try {
            const r2 = await authFetch(apiBase + '/data/integrations/google/calendar', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ calendar_id: cal.id }) })
            if(!r2.ok) throw new Error()
            close(); location.reload()
          } catch { btn.textContent='Error'; setTimeout(()=> load(), 1200) }
        })
        listBox.appendChild(btn)
      })
      if(j.items.length === 0){
        listBox.innerHTML = '<div class="p-3 text-xs text-slate-500">Sin calendarios disponibles</div>'
      }
    } catch { listBox.innerHTML = '<div class="p-3 text-xs text-red-500">Error cargando</div>' }
  }
  function close(){ modal?.remove() }
  load()
  }
  init()
})()
