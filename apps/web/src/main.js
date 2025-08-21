import './style.css'
import { Calendar } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import esLocale from '@fullcalendar/core/locales/es'

// Toggle sidebar en móvil
const sidebar = document.getElementById('sidebar')
const overlay = document.getElementById('overlay')
const openBtn = document.getElementById('sidebarOpen')
const closeBtn = document.getElementById('sidebarClose')

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

// Inicializar calendario si existe el contenedor en la página actual
const calendarEl = document.getElementById('calendar')
if (calendarEl) {
  // Helpers
  const hm = (h, m) => ({ h, m })
  const makeDate = (y, m, d, hm) => new Date(y, m, d, hm.h, hm.m)

  // Festivos automáticos vía Nager.Date según comunidad autónoma (CCAA)
  // Se lee de localStorage (app.settings.ccaa); por defecto ES-NC (Navarra)
  const APP_SETTINGS_KEY = 'app.settings'
  const DEFAULT_CCAA = 'ES-NC'
  const getAppSettings = () => {
    try { return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY)) || {} } catch { return {} }
  }
  const appSettings = getAppSettings()
  const CCAA_CODE = appSettings.ccaa || DEFAULT_CCAA
  const holidaysSet = new Set() // YYYY-MM-DD
  const loadedYears = new Set()
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  async function loadHolidaysForYear(year) {
    if (loadedYears.has(year)) return
    try {
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/ES`)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      for (const h of data) {
        const isNational = !h.counties || h.counties.length === 0
        const isCCAA = Array.isArray(h.counties) && h.counties.includes(CCAA_CODE)
        if (isNational || isCCAA) holidaysSet.add(h.date)
      }
      loadedYears.add(year)
    } catch (e) {
      console.error('Error cargando festivos', year, e)
    }
  }
  // No necesitamos recorrer el DOM: FullCalendar permite devolver clases por fecha

  // Fechas objetivo segun solicitud (días del mes actual)
  const now = new Date()
  const Y = now.getFullYear()
  const M = now.getMonth()

  const events = [
    // Semana actual
    { d: 19, title: 'Cita 1', from: hm(9, 0), to: hm(9, 45) },
    { d: 20, title: 'Cita A', from: hm(9, 0), to: hm(9, 30) },
    { d: 20, title: 'Cita B', from: hm(10, 0), to: hm(10, 45) },
    { d: 20, title: 'Cita C', from: hm(12, 0), to: hm(13, 0) },
    { d: 20, title: 'Cita D', from: hm(16, 0), to: hm(16, 30) },
    { d: 21, title: 'Cita 1', from: hm(11, 0), to: hm(11, 30) },
    { d: 21, title: 'Cita 2', from: hm(15, 0), to: hm(16, 0) },
    { d: 22, title: 'Cita única', from: hm(8, 30), to: hm(9, 15) },
    // Semana siguiente
    { d: 25, title: 'Cita próxima', from: hm(10, 30), to: hm(11, 15) },
    { d: 27, title: 'Cita 1', from: hm(9, 0), to: hm(9, 30) },
    { d: 27, title: 'Cita 2', from: hm(12, 30), to: hm(13, 15) },
  ].map(e => ({
    title: e.title,
    start: makeDate(Y, M, e.d, e.from),
    end: makeDate(Y, M, e.d, e.to),
  }))

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
    dayCellClassNames(info) {
      return holidaysSet.has(ymd(info.date)) ? ['is-holiday'] : []
    },
    // Añadir clase a cabeceras (vie 15/08) si es festivo
    dayHeaderClassNames(info) {
      return holidaysSet.has(ymd(info.date)) ? ['is-holiday'] : []
    },
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
  // Asegurar festivos cargados para los años visibles y luego re-renderizar para aplicar clases
  const y1 = info.start.getFullYear()
  const y2 = info.end.getFullYear()
  await loadHolidaysForYear(y1)
  if (y2 !== y1) await loadHolidaysForYear(y2)
  // Recalcular clases de celdas/cabecera sin re-crear eventos
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
}
