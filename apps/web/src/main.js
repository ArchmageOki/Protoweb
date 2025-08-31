import './style.css'
import { Calendar } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import esLocale from '@fullcalendar/core/locales/es'
import { ensureHolidayYears, isHoliday, ymd, getSampleEvents } from './calendar-utils'
import './whatsapp-guard.js' // Importar el guard de WhatsApp

// Toggle sidebar móvil + colapso escritorio
let sidebar = document.getElementById('sidebar')
let overlay = document.getElementById('overlay')
let openBtn = document.getElementById('sidebarOpen')
let closeBtn = document.getElementById('sidebarClose')
let collapseBtn = document.getElementById('sidebarCollapse')
const BODY = document.body
const STORAGE_KEY_UI = 'app.ui'

// Restaurar estado colapsado
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_UI) || '{}')
  if (saved.sidebarCollapsed) BODY.classList.add('sidebar-collapsed')
} catch {}

function openSidebar() {
  sidebar.classList.remove('-translate-x-full')
  overlay?.classList.remove('hidden')
}

function closeSidebar() {
  sidebar.classList.add('-translate-x-full')
  overlay?.classList.add('hidden')
}

function bindSidebarEvents(){
  sidebar = document.getElementById('sidebar')
  overlay = document.getElementById('overlay')
  openBtn = document.getElementById('sidebarOpen')
  closeBtn = document.getElementById('sidebarClose')
  collapseBtn = document.getElementById('sidebarCollapse')
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
    // Forzar recalculo en listeners externos (ej. calendario)
    window.dispatchEvent(new Event('sidebar:toggle'))
  })
}

bindSidebarEvents()
window.addEventListener('sidebar:ready', bindSidebarEvents)

// Inicializar calendario si existe el contenedor en la página actual
const calendarEl = document.getElementById('calendar')
if (calendarEl) {
  // Helpers
  const hm = (h, m) => ({ h, m })
  const makeDate = (y, m, d, hm) => new Date(y, m, d, hm.h, hm.m)

  // Festivos movidos a utilidades compartidas
  // No necesitamos recorrer el DOM: FullCalendar permite devolver clases por fecha

  // Fechas objetivo segun solicitud (días del mes actual)
  const now = new Date()
  const Y = now.getFullYear()
  const M = now.getMonth()

  const events = getSampleEvents(Y, M)

  const calendar = new Calendar(calendarEl, {
    plugins: [dayGridPlugin],
    initialView: 'dayGridWeek',
    height: 'auto', // crecerá según contenido
  firstDay: 1,
  locale: 'es',
  locales: [esLocale],
    headerToolbar: {
      left: 'prev today',
      center: 'title',
      right: 'next'
    },
    // Añadir clase a celdas del grid si es festivo
  dayCellClassNames(info) { return isHoliday(info.date) ? ['is-holiday'] : [] },
  dayHeaderClassNames(info) { return isHoliday(info.date) ? ['is-holiday'] : [] },
    async datesSet(info) {
      // Actualizar título personalizado: "Mes semana X" según regla de 4+ días
      const start = new Date(info.start)
      const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
      // Contar días por mes
      const counts = new Map()
      for (const d of days) {
        const key = `${d.getFullYear()}-${d.getMonth()}`
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      // Elegir mes con >=4 días (mayoría)
      let chosenYear = start.getFullYear()
      let chosenMonth = start.getMonth()
      let maxCount = -1
      for (const [key, val] of counts.entries()) {
        if (val > maxCount) {
          const [y, m] = key.split('-').map(Number)
          chosenYear = y; chosenMonth = m; maxCount = val
        }
      }
      // Calcular semana X dentro del mes con la misma regla
      const mondayOf = (d) => {
        const nd = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        const day = (nd.getDay() + 6) % 7 // 0=Mon .. 6=Sun
        nd.setDate(nd.getDate() - day)
        nd.setHours(0,0,0,0)
        return nd
      }
      const countDaysInMonth = (weekStart, y, m) => {
        let c = 0
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)
          if (d.getFullYear() === y && d.getMonth() === m) c++
        }
        return c
      }
      const firstOfMonth = new Date(chosenYear, chosenMonth, 1)
      let wStart = mondayOf(firstOfMonth)
      const currentStart = mondayOf(start)
      let weekNum = 0
      while (wStart <= currentStart) {
        if (countDaysInMonth(wStart, chosenYear, chosenMonth) >= 4) weekNum++
        wStart = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + 7)
      }
      // Mes en español capitalizado
      const mes = new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(new Date(chosenYear, chosenMonth, 1))
      const mesCap = mes.charAt(0).toUpperCase() + mes.slice(1)
      const titleEl = calendarEl.querySelector('.fc-toolbar-title')
      if (titleEl) {
        titleEl.innerHTML = `${mesCap} ${chosenYear}<br><span style="font-size:0.9em; font-weight:600">Semana ${weekNum}</span>`
      }
  // Asegurar festivos cargados y re-renderizar
  await ensureHolidayYears(info.start, info.end)
  calendar.rerenderDates()
    },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventContent(arg) {
      const title = arg.event.title || ''
      const start = arg.event.start
      const end = arg.event.end
      const fmt = (d) => d ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
      const timeRange = `${fmt(start)}${end ? ' - ' + fmt(end) : ''}`

      const wrap = document.createElement('div')
      wrap.style.display = 'flex'
      wrap.style.flexDirection = 'column'
      wrap.style.alignItems = 'flex-start'
  wrap.style.gap = '2px'
  wrap.style.width = '100%'

      const time = document.createElement('div')
      time.textContent = timeRange
      time.style.fontSize = '0.75rem'
      time.style.lineHeight = '1rem'
      time.style.color = '#475569' // slate-600
      time.style.width = '100%'
      time.style.whiteSpace = 'normal'

      const t = document.createElement('div')
      t.textContent = title
      t.style.fontSize = '0.8rem'
      t.style.lineHeight = '1rem'
      t.style.width = '100%'
      t.style.whiteSpace = 'normal'
      t.style.wordBreak = 'break-word'
      t.style.overflowWrap = 'anywhere'

      wrap.appendChild(time)
      wrap.appendChild(t)
      return { domNodes: [wrap] }
    },
    events,
    eventDidMount(info) {
      const el = info.el // .fc-daygrid-event
      const harness = el.parentElement // .fc-daygrid-event-harness
      // Altura fija por cita (X = 41px)
      const BOX_HEIGHT = 41
      el.style.boxSizing = 'border-box'
      el.style.height = BOX_HEIGHT + 'px'
      el.style.minHeight = BOX_HEIGHT + 'px'
      el.style.marginTop = '0'
      el.style.marginBottom = '0'
      el.style.padding = '4px 6px'
      el.style.overflow = 'hidden'
      if (harness) {
        harness.style.marginTop = '0'
        harness.style.marginBottom = '0'
      }
      // Separador visual sin alterar el alto
      const hasPrev = !!(harness && harness.previousElementSibling)
      el.style.borderTop = 'none'
      el.style.boxShadow = hasPrev ? 'inset 0 1px 0 #e2e8f0' : 'none'
      // Quitar hueco inferior del contenedor de eventos del día
      const dayEl = el.closest('.fc-daygrid-day')
      const eventsContainer = dayEl?.querySelector('.fc-daygrid-day-events')
      if (eventsContainer) {
        eventsContainer.style.marginBottom = '0'
        eventsContainer.style.paddingBottom = '0'
      }
    },
  dayCellDidMount(info) {
      const eventsContainer = info.el.querySelector('.fc-daygrid-day-events')
      if (eventsContainer) {
        eventsContainer.style.marginBottom = '0'
        eventsContainer.style.paddingBottom = '0'
      }
    },
  })
  calendar.render()
  // Recalcular tamaño: inicial + durante transición usando ResizeObserver
  const refreshSize = () => { try { calendar.updateSize() } catch {} }
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
    // Fallback: eventos de transición
    sidebar?.addEventListener('transitionrun', refreshSize)
    sidebar?.addEventListener('transitionend', refreshSize)
  }
  // Al cambiar estado colapsado, forzar un par de recalculos adicionales como respaldo
  collapseBtn?.addEventListener('click', () => {
    requestAnimationFrame(refreshSize)
    setTimeout(refreshSize, 120)
    setTimeout(refreshSize, 260)
  })
}

// ---------- CLIENTES ----------
import { authFetch, apiBase } from './auth.js'

async function clientsInit(){
  const tbody = document.getElementById('clientsTbody')
  if(!tbody) return // no está en esta página
  const emptyMsg = document.getElementById('clientsEmpty')
  const addBtn = document.getElementById('clientAddBtn')
  const formWrap = document.getElementById('clientFormWrap')
  const form = document.getElementById('clientForm')
  const cancelBtn = document.getElementById('clientCancelBtn')
  const reloadBtn = document.getElementById('clientReloadBtn')
  const searchInput = document.getElementById('clientSearch')
  let items = []
  let filtered = []

  function render(){
    tbody.innerHTML = ''
    filtered.forEach(c => {
      const tr = document.createElement('tr')
      tr.innerHTML = `
        <td class="px-3 py-2 align-top">
          <div class="font-medium text-slate-800">${escapeHtml(c.name)}</div>
          ${c.notes ? `<div class="text-xs text-slate-500 mt-0.5 line-clamp-2">${escapeHtml(c.notes)}</div>`:''}
        </td>
        <td class="px-3 py-2 align-top">${c.email ? `<a class="underline text-indigo-600" href="mailto:${escapeAttr(c.email)}">${escapeHtml(c.email)}</a>`:''}</td>
        <td class="px-3 py-2 align-top">${c.phone?escapeHtml(c.phone):''}</td>
        <td class="px-3 py-2 align-top">
          <div class="flex gap-2">
            <button data-act="edit" data-id="${c.id}" class="px-2 py-1 rounded border border-slate-300 text-xs hover:bg-slate-100">Editar</button>
            <button data-act="del" data-id="${c.id}" class="px-2 py-1 rounded border border-rose-300 text-xs text-rose-600 hover:bg-rose-50">Borrar</button>
          </div>
        </td>`
      tbody.appendChild(tr)
    })
    emptyMsg.classList.toggle('hidden', filtered.length>0)
  }

  function applyFilter(){
    const q = (searchInput.value||'').toLowerCase().trim()
    if(!q){ filtered = items.slice() }
    else {
      filtered = items.filter(c => [c.name,c.email,c.phone,c.notes].some(v => (v||'').toLowerCase().includes(q)))
    }
    render()
  }

  async function load(){
    tbody.innerHTML = '<tr><td colspan="4" class="px-3 py-6 text-center text-xs text-slate-500">Cargando...</td></tr>'
    emptyMsg.classList.add('hidden')
    try {
      const r = await authFetch(apiBase + '/data/clients')
      if(!r.ok) throw new Error('fail')
      const data = await r.json()
      items = data.items||[]
    } catch(e){
      items = []
    }
    applyFilter()
  }

  addBtn?.addEventListener('click', ()=>{
    form.reset()
    form.id.value = ''
    formWrap.classList.remove('hidden')
    form.querySelector('[name=name]').focus()
  })
  cancelBtn?.addEventListener('click', ()=>{
    formWrap.classList.add('hidden')
  })
  reloadBtn?.addEventListener('click', load)
  searchInput?.addEventListener('input', applyFilter)

  form?.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const fd = new FormData(form)
    const id = fd.get('id')
    const payload = {
      name: fd.get('name').trim(),
      email: fd.get('email')?.trim()||null,
      phone: fd.get('phone')?.trim()||null,
      notes: fd.get('notes')?.trim()||null
    }
    let method = 'POST'
    let url = apiBase + '/data/clients'
    if(id){ method='PUT'; url += '/' + encodeURIComponent(id) }
    const btn = document.getElementById('clientSaveBtn')
    btn.disabled = true
    btn.textContent = 'Guardando...'
    try {
      const r = await authFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
      if(!r.ok) throw new Error('fail')
      await load()
      formWrap.classList.add('hidden')
    } catch(e){
      alert('Error guardando')
    } finally {
      btn.disabled = false
      btn.textContent = 'Guardar'
    }
  })

  tbody.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-act]')
    if(!btn) return
    const id = btn.getAttribute('data-id')
    const act = btn.getAttribute('data-act')
    if(act==='edit'){
      const item = items.find(c=>c.id===id)
      if(!item) return
      form.name.value = item.name
      form.email.value = item.email||''
      form.phone.value = item.phone||''
      form.notes.value = item.notes||''
      form.id.value = item.id
      formWrap.classList.remove('hidden')
      form.name.focus()
    } else if(act==='del'){
      if(!confirm('¿Borrar este cliente?')) return
      const r = await authFetch(apiBase + '/data/clients/' + encodeURIComponent(id), { method:'DELETE' })
      if(r.ok){
        items = items.filter(c=>c.id!==id)
        applyFilter()
      } else {
        alert('No se pudo borrar')
      }
    }
  })

  load()
}

function escapeHtml(s){
  return (''+s).replace(/[&<>"']/g, ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[ch]))
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;') }

clientsInit()
