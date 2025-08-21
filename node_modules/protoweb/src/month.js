import './style.css'
import { Calendar } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import esLocale from '@fullcalendar/core/locales/es'
import { ensureHolidayYears, isHoliday, ymd, getSampleEvents } from './calendar-utils'

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
  // Reutilizar mismos eventos de demostración que el dashboard
  const now = new Date()
  const Y = now.getFullYear()
  const M = now.getMonth()
  const events = getSampleEvents(Y, M)

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
      calendar.rerenderDates()
  queueMicrotask(markEmptyDays)
    },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventContent(arg){
      // Una sola línea: HH:MM Título
      const start = arg.event.start
      const title = arg.event.title || ''
      const fmt = (d) => d ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
      const text = `${fmt(start)} ${title}`.trim()
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
    events,
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
  const resetBtn = document.getElementById('evt-reset')

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
    if(resetBtn){
      if(selectedEventId){ resetBtn.classList.add('hidden') } else { resetBtn.classList.remove('hidden') }
    }
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
  // Botón reset formulario
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if(selectedEventId) return
  if(!confirm('¿Limpiar el formulario? Se perderán los datos actuales.')) return
  clearForm()
  // Eliminar placeholder de creación si existe
  document.querySelectorAll('.fc-placeholder-creating').forEach(el=> el.remove())
  selectedEventId = null
  applySelectionStyles()
  updateActionButtons()
    })
  }
  function clearForm(){
    const nombre = document.getElementById('evt-nombre'); if (nombre) nombre.value = ''
    const fecha = document.getElementById('evt-fecha'); if (fecha) fecha.value = ''
    const ini = document.getElementById('evt-inicio'); if (ini) ini.value = '09:00'
    const fin = document.getElementById('evt-fin'); if (fin) fin.value = '10:00'
    const iniLabel = document.querySelector('[data-time-display="evt-inicio"] .time-value'); if (iniLabel) iniLabel.textContent = '09:00'
    const finLabel = document.querySelector('[data-time-display="evt-fin"] .time-value'); if (finLabel) finLabel.textContent = '10:00'
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
      try { ev.remove() } catch {}
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
      // Construir Date objetos
      const toDate = (d,t)=>{
        const [Y,M,D] = d.split('-').map(Number)
        const [h,m] = t.split(':').map(Number)
        return new Date(Y, M-1, D, h, m, 0, 0)
      }
      let start = toDate(date,startTime)
      let end = toDate(date,endTime)
      if(end <= start){
        // Ajuste automático a +30min
        end = new Date(start.getTime()+30*60000)
      }
      if(selectedEventId){
        // Editar
        const ev = calendar.getEvents().find(ev => (ev.id || ev._def?.publicId || ev._instance?.instanceId || ev) === selectedEventId)
        if(!ev){ selectedEventId = null; updateActionButtons(); return }
  try {
          ev.setProp('title', title)
          ev.setStart(start)
          ev.setEnd(end)
          if(typeof ev.setExtendedProp === 'function'){
            ev.setExtendedProp('designFinished', designChk?.checked || false)
            ev.setExtendedProp('priceTotal', precioT?.value || '')
            ev.setExtendedProp('pricePaid', precioP?.value || '')
            ev.setExtendedProp('notes', notas?.value || '')
          }
        } catch {}
  } else {
        // Crear nuevo evento
        calendar.addEvent({
          id: 'evt-'+Date.now(),
          title,
          start,
          end,
          extendedProps: {
            designFinished: designChk?.checked || false,
            priceTotal: precioT?.value || '',
            pricePaid: precioP?.value || '',
            notes: notas?.value || ''
          }
        })
        // Reset después de crear
  if(nombre) nombre.value=''
        if(fecha) fecha.value=''
        if(iniHidden) iniHidden.value='09:00'
        if(finHidden) finHidden.value='10:00'
        const iniLabel = document.querySelector('[data-time-display="evt-inicio"] .time-value'); if (iniLabel) iniLabel.textContent = '09:00'
        const finLabel = document.querySelector('[data-time-display="evt-fin"] .time-value'); if (finLabel) finLabel.textContent = '10:00'
        if(precioT) precioT.value=''
        if(precioP) precioP.value=''
        if(notas) notas.value=''
  if(designChk) designChk.checked=false
  const panel = document.getElementById('event-form-panel'); if(panel){ panel.classList.add('creating-event'); panel.classList.remove('flash-new'); void panel.offsetWidth; panel.classList.add('flash-new'); }
  // Salir del modo creación tras guardar el nuevo evento
  if(panel){ panel.classList.remove('creating-event','flash-new') }
      }
      calendar.rerenderEvents()
      markEmptyDays()
      applySelectionStyles()
    })
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
        // Reset selección
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
    if(resetBtn){ resetBtn.addEventListener('click', removePlaceholder) }
    if(deleteBtn){ deleteBtn.addEventListener('click', removePlaceholder) }
  })()
  calendar.render()
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
