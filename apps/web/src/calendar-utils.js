// Utilidades compartidas para festivos por CCAA usando Nager.Date
import { authFetch, apiBase } from './auth.js'
const APP_SETTINGS_KEY = 'app.settings'
const DEFAULT_CCAA = 'ES-NC'
const holidaysSet = new Set() // YYYY-MM-DD
const loadedYears = new Set()

function getSettings() {
  try { return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY)) || {} } catch { return {} }
}

function getCCAA() {
  const settings = getSettings()
  return settings.ccaa || DEFAULT_CCAA
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

async function loadHolidaysForYear(year) {
  if (loadedYears.has(year)) return
  const CCAA_CODE = getCCAA()
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/ES`)
    if (!res.ok) throw new Error('HTTP '+res.status)
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

async function ensureHolidayYears(startDate, endDate) {
  const y1 = startDate.getFullYear()
  const y2 = endDate.getFullYear()
  await loadHolidaysForYear(y1)
  if (y2 !== y1) await loadHolidaysForYear(y2)
}

function isHoliday(date) {
  return holidaysSet.has(ymd(date))
}

// ----- Eventos de demostración (mismos para semana y mes) -----
function hm(h,m){ return { h, m } }
function makeDate(y, m, d, hm){ return new Date(y, m, d, hm.h, hm.m) }
function getSampleEvents(year, month){
  return [] // Eliminados eventos de prueba; ahora se cargará desde API real
}

async function fetchEvents(fromISO, toISO){
  const params = new URLSearchParams()
  if(fromISO) params.set('from', fromISO)
  if(toISO) params.set('to', toISO)
    // Usar apiBase y authFetch para asegurar Authorization + refresh automático
    const url = apiBase + '/data/events?' + params.toString()
    const res = await authFetch(url, { method:'GET' })
  if(!res.ok){
    console.error('fetch_events_failed_status', res.status)
    throw new Error('fetch_events_failed')
  }
  const data = await res.json().catch(()=>({ items:[] }))
  return (data.items||[]).filter(ev => !ev.deleted).map(ev=>{
      const isAll = !!ev.all_day
      let start = ev.start_at
      let end = ev.end_at
      if(isAll && end){
        // Backend guarda fin inclusivo (último día 23:59:59Z). FullCalendar espera fin exclusivo.
        try {
          const endDate = new Date(end)
          // Si es 23:59:59 (aprox) considerar inclusivo y sumar 1 día a medianoche
            if(endDate.getUTCHours()>=23 && endDate.getUTCMinutes()>=59){
              const excl = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()+1))
              end = excl.toISOString()
            }
        } catch {}
      }
      return {
        id: ev.id,
        title: ev.title,
        start,
        end,
        allDay: isAll,
        extendedProps:{ __persisted:true, google_event_id: ev.google_event_id||null, description: ev.description||null }
      }
    })
}
export async function loadEventsRange(startDate, endDate){
  try {
    return await fetchEvents(startDate.toISOString(), endDate.toISOString())
  } catch(e){ console.error('Error cargando eventos', e); return [] }
}
// Nota: ya exportamos loadEventsRange arriba; evitamos re-export duplicado.
export { ensureHolidayYears, isHoliday, ymd, getSampleEvents }
