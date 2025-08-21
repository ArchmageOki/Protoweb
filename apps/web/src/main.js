import './style.css'
import { Calendar } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import esLocale from '@fullcalendar/core/locales/es'
import { ensureHolidayYears, isHoliday, ymd, getSampleEvents } from './calendar-utils'

// Toggle sidebar móvil + colapso escritorio
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
  sidebar.classList.remove('-translate-x-full')
  overlay?.classList.remove('hidden')
}

function closeSidebar() {
  sidebar.classList.add('-translate-x-full')
  overlay?.classList.add('hidden')
}

openBtn?.addEventListener('click', openSidebar)
closeBtn?.addEventListener('click', closeSidebar)
overlay?.addEventListener('click', closeSidebar)

// Colapso en escritorio
collapseBtn?.addEventListener('click', () => {
  BODY.classList.toggle('sidebar-collapsed')
  try {
    const prev = JSON.parse(localStorage.getItem(STORAGE_KEY_UI) || '{}')
    const next = { ...prev, sidebarCollapsed: BODY.classList.contains('sidebar-collapsed') }
    localStorage.setItem(STORAGE_KEY_UI, JSON.stringify(next))
  } catch {}
})

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
