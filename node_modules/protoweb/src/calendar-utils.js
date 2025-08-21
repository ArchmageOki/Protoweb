// Utilidades compartidas para festivos por CCAA usando Nager.Date
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
  const base = [
    { d: 19, title: 'Cita 1', from: hm(9,0), to: hm(9,45) },
    { d: 20, title: 'Cita A', from: hm(9,0), to: hm(9,30) },
    { d: 20, title: 'Cita B', from: hm(10,0), to: hm(10,45) },
    { d: 20, title: 'Cita C', from: hm(12,0), to: hm(13,0) },
    { d: 20, title: 'Cita D', from: hm(16,0), to: hm(16,30) },
    { d: 21, title: 'Cita 1', from: hm(11,0), to: hm(11,30) },
    { d: 21, title: 'Cita 2', from: hm(15,0), to: hm(16,0) },
    { d: 22, title: 'Cita única', from: hm(8,30), to: hm(9,15) },
    { d: 25, title: 'Cita próxima', from: hm(10,30), to: hm(11,15) },
    { d: 27, title: 'Cita 1', from: hm(9,0), to: hm(9,30) },
    { d: 27, title: 'Cita 2', from: hm(12,30), to: hm(13,15) },
  ]
  // Eventos de prueba específicos solicitados (29 agosto 2025)
  // Se añaden siempre para que aparezcan al navegar a esa fecha aunque el calendario
  // se haya inicializado en otro mes.
  const testDateYear = 2025
  const testDateMonth = 7 // Agosto (0-based)
  if (true) {
    const testEvents = [
      { title: 'Test 1', start: makeDate(testDateYear, testDateMonth, 29, hm(9,0)), end: makeDate(testDateYear, testDateMonth, 29, hm(9,20)) },
      { title: 'Test 2', start: makeDate(testDateYear, testDateMonth, 29, hm(9,30)), end: makeDate(testDateYear, testDateMonth, 29, hm(9,50)) },
      { title: 'Test 3', start: makeDate(testDateYear, testDateMonth, 29, hm(10,0)), end: makeDate(testDateYear, testDateMonth, 29, hm(10,20)) },
      { title: 'Test 4', start: makeDate(testDateYear, testDateMonth, 29, hm(11,0)), end: makeDate(testDateYear, testDateMonth, 29, hm(11,30)) },
      { title: 'Test 5', start: makeDate(testDateYear, testDateMonth, 29, hm(12,0)), end: makeDate(testDateYear, testDateMonth, 29, hm(12,30)) },
    ]
    // Convertimos base actual al mes solicitado y luego concatenamos los tests fijos.
    const monthEvents = base.map(e => ({
      title: e.title,
      start: makeDate(year, month, e.d, e.from),
      end: makeDate(year, month, e.d, e.to),
    }))
    return monthEvents.concat(testEvents)
  }
  // (Nunca se alcanza por el if anterior, pero dejamos estructura por claridad.)
}

export { ensureHolidayYears, isHoliday, ymd, getSampleEvents }
