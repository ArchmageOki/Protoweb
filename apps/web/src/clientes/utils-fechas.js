// Utilidades de fechas y formato para clientes
export function randomDate(startYear = 1975, endYear = 2005){
  const y = Math.floor(Math.random()*(endYear-startYear+1))+startYear
  const m = Math.floor(Math.random()*12)
  const d = Math.floor(Math.random()*28)+1
  return new Date(y,m,d)
}
export function formatDate(d){
  if(!(d instanceof Date) || isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2,'0')
  const mm = String(d.getMonth()+1).padStart(2,'0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}
export function toInputDate(d){
  if(!(d instanceof Date)) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth()+1).padStart(2,'0')
  const dd = String(d.getDate()).padStart(2,'0')
  return `${yyyy}-${mm}-${dd}`
}
export function toDisplayDate(d){
  if(!(d instanceof Date)) return ''
  const dd = String(d.getDate()).padStart(2,'0')
  const mm = String(d.getMonth()+1).padStart(2,'0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}
export function parseDisplayDate(str){
  if(!/^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/.test(str)) return null
  const [dd,mm,yyyy] = str.split('/')
  const d = new Date(Number(yyyy), Number(mm)-1, Number(dd))
  return isNaN(d.getTime()) ? null : d
}
