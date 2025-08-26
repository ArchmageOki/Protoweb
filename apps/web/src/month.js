import './style.css'
import { Calendar } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import esLocale from '@fullcalendar/core/locales/es'
import { ensureHolidayYears, isHoliday, ymd, loadEventsRange } from './calendar-utils'
import { authFetch, apiBase } from './auth.js'

// Sidebar móvil + colapso escritorio reutilizado
const sidebar = document.getElementById('sidebar')
const overlay = document.getElementById('overlay')
const openBtn = document.getElementById('sidebarOpen')
const closeBtn = document.getElementById('sidebarClose')
const collapseBtn = document.getElementById('sidebarCollapse')
const BODY = document.body
const STORAGE_KEY_UI = 'app.ui'

// Restaurar estado colapsado
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_UI) || '{}')
  if (saved.sidebarCollapsed) BODY.classList.add('sidebar-collapsed')
} catch {}

function openSidebar() {
  sidebar?.classList.remove('-translate-x-full')
  overlay?.classList.remove('hidden')
}
function closeSidebar() {
  sidebar?.classList.add('-translate-x-full')
  overlay?.classList.add('hidden')
}
openBtn?.addEventListener('click', openSidebar)
closeBtn?.addEventListener('click', closeSidebar)
overlay?.addEventListener('click', closeSidebar)
collapseBtn?.addEventListener('click', () => {
  BODY.classList.toggle('sidebar-collapsed')
  try {
    const prev = JSON.parse(localStorage.getItem(STORAGE_KEY_UI) || '{}')
    const next = { ...prev, sidebarCollapsed: BODY.classList.contains('sidebar-collapsed') }
    localStorage.setItem(STORAGE_KEY_UI, JSON.stringify(next))
  } catch {}
})

const calEl = document.getElementById('month-calendar')
if (calEl) {
  calEl.classList.add('no-text-select')
  let currentRange = { start: null, end: null }
  let loadingOverlay = null
  function showLoading(){
    if(!calEl) return
    if(!loadingOverlay){
      loadingOverlay = document.createElement('div')
      loadingOverlay.className='calendar-loading-overlay'
      const spin = document.createElement('div')
      spin.className='calendar-loading-spinner'
      loadingOverlay.appendChild(spin)
      calEl.appendChild(loadingOverlay)
    }
    loadingOverlay.style.display='flex'
  }
  function hideLoading(){ if(loadingOverlay) loadingOverlay.style.display='none' }
  async function refetch(range){
    showLoading()
    try {
  const evs = await loadEventsRange(range.start, range.end)
  calendar.removeAllEvents()
  evs.forEach(e=> calendar.addEvent({ ...e, extendedProps:{ ...(e.extendedProps||{}), __persisted:true } }))
    } catch(e){ console.error('refetch_error', e) }
    finally { hideLoading() }
  }

  const calendar = new Calendar(calEl, {
    plugins: [dayGridPlugin],
    initialView: 'dayGridMonth',
    firstDay: 1,
  // Altura automática: elimina el aspectRatio por defecto que generaba
  // hueco en pantallas grandes y necesidad de scroll en iPad.
  height: 'auto',
  contentHeight: 'auto',
  handleWindowResize: true,
    locale: 'es',
    locales: [esLocale],
    headerToolbar: { left: 'prev today', center: 'title', right: 'next' },
    dayCellClassNames(info){ return isHoliday(info.date) ? ['is-holiday'] : [] },
    dayHeaderClassNames(info){ return isHoliday(info.date) ? ['is-holiday'] : [] },
    dayCellDidMount(info){
      // Ajustes mínimos; la altura de eventos la gestionamos en eventDidMount
      const frame = info.el.querySelector('.fc-daygrid-day-frame')
      if (frame) frame.style.display = 'flex'
      const eventsBox = info.el.querySelector('.fc-daygrid-day-events')
      if (eventsBox) {
        eventsBox.style.marginBottom = '0'
        eventsBox.style.paddingBottom = '0'
      }
    },
    async datesSet(info){
      await ensureHolidayYears(info.start, info.end)
      // Refrescar clases de festivos manualmente (la versión actual no expone rerenderDates)
      try {
        const dayNodes = calEl.querySelectorAll('.fc-daygrid-day')
        dayNodes.forEach(day => {
          const ds = day.getAttribute('data-date')
          if(!ds) return
          const dObj = new Date(ds+'T00:00:00')
            if(isHoliday(dObj)) day.classList.add('is-holiday')
            else day.classList.remove('is-holiday')
        })
      } catch(e){ /* noop */ }
      currentRange = { start: info.start, end: info.end }
      refetch(currentRange)
      queueMicrotask(markEmptyDays)
    },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventContent(arg){
      // Una sola línea: HH:MM Título
      const start = arg.event.start
      const title = arg.event.title || ''
      const isAll = arg.event.allDay
      const fmt = (d) => d ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
      const timePart = isAll ? '' : fmt(start)
      const text = `${timePart} ${title}`.trim()
      const wrapper = document.createElement('div')
      wrapper.style.display = 'flex'
      wrapper.style.alignItems = 'center'
      wrapper.style.justifyContent = 'space-between'
      wrapper.style.width = '100%'
      wrapper.style.fontSize = '0.65rem'
      wrapper.style.lineHeight = '1rem'
      const textSpan = document.createElement('span')
      textSpan.textContent = text
      textSpan.style.display = 'block'
      textSpan.style.flex = '1 1 auto'
      textSpan.style.whiteSpace = 'nowrap'
      textSpan.style.overflow = 'hidden'
      textSpan.style.textOverflow = 'ellipsis'
      wrapper.appendChild(textSpan)
      if (arg.event.extendedProps?.designFinished) {
        const tick = document.createElement('span')
        tick.textContent = '✔'
        tick.className = 'design-finished-icon'
        wrapper.appendChild(tick)
      }
      return { domNodes: [wrapper] }
    },
    // Orden: primero eventos con hora, luego all-day; entre temporales, por hora de inicio.
    eventOrder(a, b){
      const aAll = a.allDay ? 1 : 0
      const bAll = b.allDay ? 1 : 0
      if(aAll !== bAll) return aAll - bAll // 0 (timed) antes que 1 (all-day)
      if(!a.allDay && !b.allDay){
        const toMs = (ev)=>{
          if(ev.start instanceof Date) return ev.start.getTime()
          if(typeof ev.start === 'string'){ const d = new Date(ev.start); if(!isNaN(d)) return d.getTime() }
          if(ev.start && typeof ev.start.getTime === 'function'){ try { return ev.start.getTime() } catch{} }
          return 0
        }
        const at = toMs(a)
        const bt = toMs(b)
        return at - bt
      }
      // Ambos all-day: mantener orden original (por título como fallback)
      return (a.title||'').localeCompare(b.title||'')
    },
  eventClick(info){
      info.jsEvent?.preventDefault()
      const ev = info.event
      const start = ev.start
      const end = ev.end || start
      const pad = (n)=> String(n).padStart(2,'0')
      const dateStr = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}`
      const tStr = (d)=> `${pad(d.getHours())}:${pad(d.getMinutes())}`
      const startStr = tStr(start)
      const endStr = tStr(end)
      // Campos del formulario
      const nombre = document.getElementById('evt-nombre')
      const fecha = document.getElementById('evt-fecha')
      const iniHidden = document.getElementById('evt-inicio')
      const finHidden = document.getElementById('evt-fin')
  const chkDesign = document.getElementById('evt-diseno-terminado')
      if (nombre) nombre.value = ev.title || ''
      if (fecha) fecha.value = dateStr
      if (iniHidden) iniHidden.value = startStr
      if (finHidden) finHidden.value = endStr
      const iniLabel = document.querySelector('[data-time-display="evt-inicio"] .time-value')
      const finLabel = document.querySelector('[data-time-display="evt-fin"] .time-value')
      if (iniLabel) iniLabel.textContent = startStr
      if (finLabel) finLabel.textContent = endStr
  // Guardar referencia a evento seleccionado y estado del checkbox
  selectedEventId = ev.id || ev._def?.publicId || ev._instance?.instanceId || ev
  // Sync checkbox desde extendedProps
  if (chkDesign) chkDesign.checked = !!ev.extendedProps.designFinished
  // Parsear descripción para rellenar precios y notas
  try {
    const desc = ev.extendedProps?.description || ev._def?.extendedProps?.description || ''
    if(desc){
      const lines = desc.split(/\n+/).map(l=>l.trim())
      const map = {}
      for(const line of lines){
        const idx = line.indexOf(':')
        if(idx>-1){
          const key = line.slice(0,idx).toLowerCase().trim()
          const val = line.slice(idx+1).trim()
          map[key]=val
        }
      }
      const stripEuro = v => v?.replace(/€/g,'').trim() || ''
      const totalInput = document.getElementById('evt-precio-total')
      const pagadoInput = document.getElementById('evt-precio-pagado')
      const notasInput = document.getElementById('evt-notas')
      if(totalInput && map['precio total']) totalInput.value = stripEuro(map['precio total'])
      if(pagadoInput && map['pagado']) pagadoInput.value = stripEuro(map['pagado'])
      if(notasInput && map['notas']) notasInput.value = map['notas']
    }
  } catch {}
  applySelectionStyles()
  const formTitle = document.getElementById('event-form-title')
  if (formTitle) formTitle.textContent = 'Editar evento'
  updateActionButtons()
  // Eliminar placeholder de nuevo evento si existía (se sale del modo creación)
  document.querySelectorAll('.fc-placeholder-creating').forEach(el=> el.remove())
  // No forzamos foco para evitar abrir teclado en iPad.
  // Si se quisiera, se podría añadir un botón 'Editar' que haga focus manual.
    },
    eventDidMount(info){
      const el = info.el
      const harness = el.parentElement
      const BOX_HEIGHT = 20
      el.style.boxSizing = 'border-box'
      el.style.height = BOX_HEIGHT + 'px'
      el.style.minHeight = BOX_HEIGHT + 'px'
      el.style.marginTop = '0'
      el.style.marginBottom = '0'
      el.style.padding = '2px 4px'
      el.style.overflow = 'hidden'
      if (harness) {
        harness.style.marginTop = '0'
        harness.style.marginBottom = '0'
        harness.style.height = BOX_HEIGHT + 'px'
        harness.style.minHeight = BOX_HEIGHT + 'px'
      }
      const hasPrev = !!(harness && harness.previousElementSibling)
      el.style.borderTop = 'none'
      el.style.boxShadow = hasPrev ? 'inset 0 1px 0 #e2e8f0' : 'none'
      const dayEl = el.closest('.fc-daygrid-day')
      const eventsContainer = dayEl?.querySelector('.fc-daygrid-day-events')
      if (eventsContainer) {
        eventsContainer.style.marginBottom = '0'
        eventsContainer.style.paddingBottom = '0'
      }
      // Aplicar estilos condicionales para eventos ya marcados como diseño terminado
      if (info.event.extendedProps.designFinished) {
        el.classList.add('is-design-finished')
      }
    },
  events: [],
    eventsSet(){
      markEmptyDays()
    }
  })
  function markEmptyDays(){
    const evs = calendar.getEvents()
    const datesWithEvents = new Set(evs.map(e => ymd(e.start)))
    calEl.querySelectorAll('.fc-daygrid-day').forEach(day => {
      const date = day.getAttribute('data-date')
      if (date && !datesWithEvents.has(date)) {
        day.classList.add('has-no-events')
      } else {
        day.classList.remove('has-no-events')
      }
    })
  }
  // ====== Gestión de selección y diseño terminado ======
  let selectedEventId = null
  const saveBtn = document.getElementById('evt-save')
  const deleteBtn = document.getElementById('evt-delete')
  // resetBtn eliminado

  function updateActionButtons(){
    const panel = document.getElementById('event-form-panel')
    if(deleteBtn){
      if(selectedEventId){
        deleteBtn.classList.remove('hidden')
        panel?.classList.remove('creating-event')
      } else {
        deleteBtn.classList.add('hidden')
      }
    }
  // sin resetBtn
  }
  function applySelectionStyles(){
    const all = calEl.querySelectorAll('.fc-daygrid-event')
    all.forEach(a=>a.classList.remove('is-selected'))
    if (!selectedEventId) return
    // Encontrar todos los elementos DOM del evento seleccionado (por si está en varias celdas)
    calendar.getEvents().forEach(ev => {
      const match = (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) === selectedEventId
      if (match) {
        const els = calEl.querySelectorAll(`[data-event-id="${ev._instance?.instanceId}"] .fc-daygrid-event, .fc-daygrid-event`) // fallback simple
        // Más fiable: comparar título y horas si no hay id
        els.forEach(el => {
          if (el.textContent?.includes(ev.title)) el.classList.add('is-selected')
        })
      }
    })
  }
  // (Opcional futuro) función para resetear el formulario y volver a 'Nuevo evento'
  function resetFormTitleIfNeeded(){
    if (!selectedEventId){
      const formTitle = document.getElementById('event-form-title')
      if (formTitle) formTitle.textContent = 'Nuevo evento'
    }
  }
  // Escuchar cambios del checkbox de diseño terminado
  const designChk = document.getElementById('evt-diseno-terminado')
  if (designChk) {
    designChk.addEventListener('change', () => {
      if (!selectedEventId) return
      const ev = calendar.getEvents().find(ev => (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) === selectedEventId)
      if (!ev) return
  // Guardar flag en extendedProps (API adecuada setExtendedProp si existe)
  if (typeof ev.setExtendedProp === 'function') ev.setExtendedProp('designFinished', designChk.checked)
  else ev.setProp('extendedProps', { ...ev.extendedProps, designFinished: designChk.checked })
  calendar.rerenderEvents()
    })
  }
  // resetBtn eliminado
  function clearForm(){
    const nombre = document.getElementById('evt-nombre'); if (nombre) nombre.value = ''
    const fecha = document.getElementById('evt-fecha'); if (fecha) fecha.value = ''
    const ini = document.getElementById('evt-inicio'); if (ini) ini.value = '10:00'
    const fin = document.getElementById('evt-fin'); if (fin) fin.value = '11:00'
    const iniLabel = document.querySelector('[data-time-display="evt-inicio"] .time-value'); if (iniLabel) iniLabel.textContent = '10:00'
    const finLabel = document.querySelector('[data-time-display="evt-fin"] .time-value'); if (finLabel) finLabel.textContent = '11:00'
    const precioT = document.getElementById('evt-precio-total'); if (precioT) precioT.value = ''
    const precioP = document.getElementById('evt-precio-pagado'); if (precioP) precioP.value = ''
    const notas = document.getElementById('evt-notas'); if (notas) notas.value = ''
    if (designChk) designChk.checked = false
  const formTitle = document.getElementById('event-form-title'); if (formTitle) formTitle.textContent = 'Nuevo evento'
  const panel = document.getElementById('event-form-panel');
  if(panel){
    // Salir de modo creación: quitar estilos azules
    panel.classList.remove('creating-event','flash-new')
  }
  }
  if(deleteBtn){
    deleteBtn.addEventListener('click', () => {
      if(!selectedEventId) return
      const ev = calendar.getEvents().find(ev => (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) === selectedEventId)
      if(!ev) return
      const title = ev.title || 'este evento'
      if(!confirm(`¿Eliminar definitivamente "${title}"?`)) return
      if(ev.extendedProps.__persisted){
        authFetch(apiBase + '/data/events/'+encodeURIComponent(ev.id), { method:'DELETE' })
          .then(r=>{ if(!r.ok) throw new Error('delete_failed'); return r.json(); })
          .then(()=>{ try { ev.remove() } catch {}; if(currentRange?.start && currentRange?.end){ refetch(currentRange).catch(()=>{}) } })
          .catch(err=>{ console.error('delete_failed', err); alert('Error eliminando'); })
      } else {
        try { ev.remove() } catch {}
      }
    selectedEventId = null
      applySelectionStyles()
  clearForm()
      updateActionButtons()
      markEmptyDays()
  const panel = document.getElementById('event-form-panel'); if(panel){ panel.classList.remove('creating-event','flash-new') }
    })
  }
  if(saveBtn){
    saveBtn.addEventListener('click', () => {
      const nombre = document.getElementById('evt-nombre')
      const fecha = document.getElementById('evt-fecha')
      const iniHidden = document.getElementById('evt-inicio')
      const finHidden = document.getElementById('evt-fin')
      const precioT = document.getElementById('evt-precio-total')
      const precioP = document.getElementById('evt-precio-pagado')
      const notas = document.getElementById('evt-notas')
      const designChk = document.getElementById('evt-diseno-terminado')
      const title = nombre?.value?.trim() || ''
      const date = fecha?.value
      const startTime = iniHidden?.value || '09:00'
      const endTime = finHidden?.value || startTime
      if(!title){ alert('El nombre es obligatorio'); return }
      if(!date){ alert('La fecha es obligatoria'); return }
      // Construir descripción estructurada para sincronizar con Google
      const parseAmount = (v)=>{
        if(v==null) return null
        const s=String(v).trim(); if(!s) return null
        const n = Number(s.replace(',','.'))
        if(isNaN(n)) return null
        return n
      }
      const fmtAmount = (n)=>{
        if(n==null) return ''
        const hasDecimals = Math.abs(n - Math.trunc(n)) > 0.000001
        return (hasDecimals ? n.toFixed(2) : String(Math.trunc(n))) + ' €'
      }
      const totalRaw = precioT?.value||''
      const pagadoRaw = precioP?.value||''
      const totalParsed = parseAmount(totalRaw)
      const pagadoParsed = parseAmount(pagadoRaw)
      let pendienteParsed = null
      if(totalParsed!=null && pagadoParsed!=null){ pendienteParsed = totalParsed - pagadoParsed }
      const totalStr = fmtAmount(totalParsed)
      const pagadoStr = fmtAmount(pagadoParsed)
      const pendienteStr = fmtAmount(pendienteParsed)
      const notasVal = (notas?.value||'').trim()
      const description = [
        `Nombre: ${title}`,
        `Whatsapp / Instagram:`,
        `Precio total: ${totalStr}`,
        `Pagado: ${pagadoStr}`,
        `Pendiente: ${pendienteStr}`,
        `Notas: ${notasVal}`
      ].join('\n')
      // Construir Date objetos
      const toDate = (d,t)=>{
        const [Y,M,D] = d.split('-').map(Number)
        const [h,m] = t.split(':').map(Number)
        return new Date(Y, M-1, D, h, m, 0, 0)
      }
      let start = toDate(date,startTime)
      let end = toDate(date,endTime)
      if(end <= start){
        // Ajuste automático a +1 hora en lugar de +30min
        end = new Date(start.getTime()+60*60000)
      }
      if(selectedEventId){
        // Editar
        const ev = calendar.getEvents().find(ev => (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) === selectedEventId)
        if(!ev){ selectedEventId = null; updateActionButtons(); return }
        authFetch(apiBase + '/data/events/'+encodeURIComponent(ev.id), {
          method:'PUT',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ title, description, start_at: start.toISOString(), end_at: end.toISOString(), all_day:false })
        }).then(async r=>{
          if(!r.ok) throw new Error('update_failed')
          const data = await r.json()
          ev.setProp('title', data.item.title)
          ev.setStart(data.item.start_at)
          ev.setEnd(data.item.end_at)
          ev.setExtendedProp('__persisted', true)
        }).catch(err=> alert('Error actualizando evento'))
      } else {
        // Crear
        authFetch(apiBase + '/data/events', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ title, description, start_at: start.toISOString(), end_at: end.toISOString(), all_day:false })
        }).then(async r=>{
          if(!r.ok) throw new Error('create_failed')
          const data = await r.json()
          calendar.addEvent({ id: data.item.id, title: data.item.title, start: data.item.start_at, end: data.item.end_at, extendedProps:{ __persisted:true } })
          clearForm()
          // Refetch completo para asegurar etags/google_event_id y coherencia
          if(currentRange?.start && currentRange?.end){
            try { await refetch(currentRange) } catch {}
          }
        }).catch(err=> alert('Error creando evento'))
      }
      try { if(typeof calendar.rerenderEvents === 'function') calendar.rerenderEvents(); else calendar.refetchEvents?.(); } catch {}
      markEmptyDays()
      applySelectionStyles()
      // Mostrar indicador visual de guardado
      const ind = document.getElementById('save-indicator')
      if(ind){
        // Mantener el SVG interno; solo togglear visibilidad
        ind.classList.remove('opacity-0')
        ind.classList.add('opacity-100')
        clearTimeout(ind._tHide)
        ind._tHide = setTimeout(()=>{ ind.classList.add('opacity-0'); ind.classList.remove('opacity-100') }, 1800)
      }
    })
  }
  updateActionButtons()
  
  // ====== Gestión de horarios y validaciones ======
  function addTimeToTime(timeStr, minutesToAdd) {
    const [h, m] = timeStr.split(':').map(Number)
    const totalMinutes = h * 60 + m + minutesToAdd
    const newH = Math.floor(totalMinutes / 60) % 24
    const newM = totalMinutes % 60
    return `${String(newH).padStart(2,'0')}:${String(newM).padStart(2,'0')}`
  }
  
  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number)
    return h * 60 + m
  }

  function validateTimes(showAutoFix=false){
    const ini = document.getElementById('evt-inicio')
    const fin = document.getElementById('evt-fin')
    const finBtn = document.querySelector('[data-time-display="evt-fin"]')
    const err = document.getElementById('time-error')
    if(!ini || !fin || !finBtn) return
    const startMin = timeToMinutes(ini.value)
    const endMin = timeToMinutes(fin.value)
    if(endMin <= startMin){
      finBtn.classList.add('border-red-500','focus:ring-red-400')
      finBtn.classList.remove('border-slate-300')
      if(err) err.classList.remove('hidden')
      if(showAutoFix){
        const corrected = addTimeToTime(ini.value, 60)
        fin.value = corrected
        const finLabel = document.querySelector('[data-time-display="evt-fin"] .time-value'); if(finLabel) finLabel.textContent = corrected
        finBtn.classList.remove('border-red-500','focus:ring-red-400')
        finBtn.classList.add('border-slate-300')
        if(err) err.classList.add('hidden')
      }
      return false
    }
    finBtn.classList.remove('border-red-500','focus:ring-red-400')
    finBtn.classList.add('border-slate-300')
    if(err) err.classList.add('hidden')
    return true
  }

  function rebuildEndHourOptions(){
    // Filtrar horas disponibles en el popover de fin según inicio seleccionado
    const ini = document.getElementById('evt-inicio')
    const pop = document.querySelector('[data-time-popover="evt-fin"]')
    if(!ini || !pop) return
    const startHour = parseInt(ini.value.split(':')[0],10)
    const hourList = pop.querySelector('.time-hours')
    if(!hourList) return
    hourList.querySelectorAll('[data-hour]').forEach(li => {
      const h = parseInt(li.dataset.hour,10)
      if(h < startHour){
        li.classList.add('opacity-30','pointer-events-none')
      } else {
        li.classList.remove('opacity-30','pointer-events-none')
      }
    })
  }
  
  // Listener para hora de inicio: actualizar fin automáticamente
  const iniHidden = document.getElementById('evt-inicio')
  if (iniHidden) {
    iniHidden.addEventListener('change', () => {
      const finHidden = document.getElementById('evt-fin')
      const finLabel = document.querySelector('[data-time-display="evt-fin"] .time-value')
      if (finHidden && !finHidden.dataset.userModified) {
        // Solo auto-actualizar si el usuario no ha tocado la hora de fin manualmente
        const newEnd = addTimeToTime(iniHidden.value, 60) // +1 hora
        finHidden.value = newEnd
        if (finLabel) finLabel.textContent = newEnd
      }
  rebuildEndHourOptions()
  validateTimes(false)
    })
  }
  
  // Listener para hora de fin: validar que no sea <= inicio y marcar como modificado por usuario
  const finHidden = document.getElementById('evt-fin')
  if (finHidden) {
    finHidden.addEventListener('change', () => {
      finHidden.dataset.userModified = 'true'
      const iniHidden = document.getElementById('evt-inicio')
      if (iniHidden) {
        const startMin = timeToMinutes(iniHidden.value)
        const endMin = timeToMinutes(finHidden.value)
  if (endMin <= startMin) validateTimes(false); else validateTimes(false)
      }
    })
  }
  
  // Resetear flag de modificación cuando se limpia el formulario
  const originalClearForm = clearForm
  clearForm = function() {
    originalClearForm()
    if (finHidden) delete finHidden.dataset.userModified
  rebuildEndHourOptions()
  validateTimes(false)
  }
  
  updateActionButtons()
  // ====== Pulsación larga en un día para preseleccionar fecha (iPad / touch) ======
  ;(function(){
  const LONG_PRESS_MS = 600
    let lpTimer = null
    let lpDate = null
    let placeholderEl = null
    function removePlaceholder(){
      if(placeholderEl && placeholderEl.parentElement){ placeholderEl.parentElement.removeChild(placeholderEl) }
      placeholderEl = null
    }
    function cancel(){ if(lpTimer){ clearTimeout(lpTimer); lpTimer=null; lpDate=null } }
    calEl.addEventListener('touchstart', (e)=>{
      const day = e.target.closest('.fc-daygrid-day')
      if(!day) return
      // No activar si se pulsa sobre un evento existente
      if(e.target.closest('.fc-daygrid-event')) return
      lpDate = day.getAttribute('data-date')
      if(!lpDate) return
      cancel()
      lpTimer = setTimeout(()=>{
        // Rellenar fecha
        const fecha = document.getElementById('evt-fecha')
        if(fecha){ fecha.value = lpDate }
        // Reset selección y limpiar formulario
        clearForm()
        if(fecha){ fecha.value = lpDate } // Restaurar fecha después del clear
        selectedEventId = null
        applySelectionStyles()
  const formTitle = document.getElementById('event-form-title'); if (formTitle) formTitle.textContent = 'Nuevo evento'
  const panel = document.getElementById('event-form-panel'); if(panel){ panel.classList.add('creating-event'); panel.classList.remove('flash-new'); void panel.offsetWidth; panel.classList.add('flash-new'); }
        updateActionButtons()
        // Crear placeholder visual persistente
        removePlaceholder()
        const eventsBox = day.querySelector('.fc-daygrid-day-events') || day
  placeholderEl = document.createElement('div')
  placeholderEl.className = 'fc-daygrid-event fc-event fc-placeholder-creating'
  placeholderEl.textContent = 'Nuevo evento…'
        eventsBox.appendChild(placeholderEl)
      }, LONG_PRESS_MS)
    }, { passive:true })
    ;['touchend','touchcancel','touchmove','scroll'].forEach(ev=>{
      calEl.addEventListener(ev, cancel, { passive:true })
    })
    // Limpiar placeholder al guardar o limpiar
  if(saveBtn){ saveBtn.addEventListener('click', removePlaceholder) }
  if(deleteBtn){ deleteBtn.addEventListener('click', removePlaceholder) }
  })()
  
  // ====== Doble click en día vacío para nuevo evento ======
  calEl.addEventListener('dblclick', (e)=>{
    const day = e.target.closest('.fc-daygrid-day')
    if(!day) return
    // No activar si se hace doble click sobre un evento existente
    if(e.target.closest('.fc-daygrid-event')) return
    
    const dayDate = day.getAttribute('data-date')
    if(!dayDate) return
    
    // Limpiar formulario completamente
    clearForm()
    
    // Establecer la fecha del día clickeado
    const fecha = document.getElementById('evt-fecha')
    if(fecha) fecha.value = dayDate
    
    // Reset selección
    selectedEventId = null
    applySelectionStyles()
    updateActionButtons()
    
    // Actualizar título y panel
    const formTitle = document.getElementById('event-form-title')
    if(formTitle) formTitle.textContent = 'Nuevo evento'
    const panel = document.getElementById('event-form-panel')
    if(panel){
      panel.classList.add('creating-event')
      panel.classList.remove('flash-new')
      void panel.offsetWidth
      panel.classList.add('flash-new')
    }
    
    // Enfocar el campo nombre
    const nombre = document.getElementById('evt-nombre')
    if(nombre){
      nombre.focus()
    }
  })
  calendar.render()
  // Inicial
  rebuildEndHourOptions(); validateTimes(false)
  const refreshSize = () => { try { calendar.updateSize() } catch {} }
  // Forzar un par de recalculos tras el render por layout dinámico del sidebar
  requestAnimationFrame(() => { refreshSize(); requestAnimationFrame(refreshSize) })
  let rafId = null
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(refreshSize)
    })
    if (sidebar) ro.observe(sidebar)
    const mainWrapper = document.querySelector('.main-wrapper')
    if (mainWrapper) ro.observe(mainWrapper)
  } else {
    sidebar?.addEventListener('transitionrun', refreshSize)
    sidebar?.addEventListener('transitionend', refreshSize)
  }
  collapseBtn?.addEventListener('click', () => {
    requestAnimationFrame(refreshSize)
    setTimeout(refreshSize, 120)
    setTimeout(refreshSize, 260)
  })
  setTimeout(markEmptyDays, 0)
}
