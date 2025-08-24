// Lógica de filtros de clientes
import { clientes } from './data'
import { formatDate } from './utils-fechas'
import { filtered, columnFilters, setFiltered, setCurrentPage } from './state'
import { renderClientes } from './render'

export function wildcardToRegex(input){
  const raw = input.trim()
  const hasExplicit = raw.includes('*')
  const esc = raw.replace(/[-\/\\^$+?.()|[\]{}]/g,'\\$&')
  let core = esc.replace(/\*/g,'.*')
  if(!hasExplicit) core = '.*' + core + '.*'
  const regexStr = '^'+core+'$'
  try { return new RegExp(regexStr,'i') } catch { return /a^/i }
}
export function buildDateFilterRegex(input){
  const raw = input.trim().toLowerCase()
  if(!raw) return null
  if(raw.includes('*')) return wildcardToRegex(raw)
  const parts = raw.split('/')
  while(parts.length < 3) parts.push('')
  const [pDay, pMonth, pYear] = parts
  const segDay = buildDateSegmentPattern(pDay,'day')
  const segMonth = buildDateSegmentPattern(pMonth,'month')
  const segYear = buildDateSegmentPattern(pYear,'year')
  const full = '^' + segDay + '\\/' + segMonth + '\\/' + segYear + '$'
  try { return new RegExp(full,'i') } catch { return /a^/i }
}
export function buildDateSegmentPattern(segment,type){
  if(!segment || (type==='day' && segment==='dd') || (type==='month' && segment==='mm') || (type==='year' && segment==='aaaa')){
    if(type==='year') return '[0-9]{4}'
    return '[0-9]{2}'
  }
  if(/^[0-9]+$/.test(segment)){
    if(type==='year'){
      if(segment.length===4) return segment
      if(segment.length<4) return segment + '[0-9]{' + (4-segment.length) + '}'
      return segment.slice(0,4)
    } else {
      if(segment.length===2) return segment
      if(segment.length===1) return segment + '[0-9]'
      return segment.slice(0,2)
    }
  }
  const esc = segment.replace(/[-\/\\^$+?.()|[\]{}]/g,'\\$&')
  if(type==='year') return esc + '[0-9]{' + Math.max(0,4-esc.length) + '}'
  return esc + '[0-9]{' + Math.max(0,2-esc.length) + '}'
}

export function aplicarFiltros(){
  const compiled = {}
  for(const k in columnFilters){
    const val = columnFilters[k].trim()
    if(!val) continue
    if(k==='nacimiento' || k==='ultimaCita'){
      const rx = buildDateFilterRegex(val)
      if(rx) compiled[k] = rx
    } else {
      compiled[k] = wildcardToRegex(val)
    }
  }
  if(Object.keys(compiled).length===0){
    setFiltered(clientes.slice())
  } else {
    const result = clientes.filter(c => coincideClienteColumnas(c, compiled))
    setFiltered(result)
  }
  setCurrentPage(1)
  renderClientes(filtered)
}

export function coincideClienteColumnas(c, compiled){
  const stripAccents = (s)=> s.normalize('NFD').replace(/\p{Diacritic}+/gu,'')
  for(const k in compiled){
    let v = c[k]
    if(k==='visitas'){ v = String(c.visitas) }
    else if(k==='dineroTotal'){ v = String(c.dineroTotal) }
    else if(v instanceof Date) v = formatDate(v)
    else if(k==='nacimiento' || k==='ultimaCita') v = formatDate(c[k])
    const valNorm = stripAccents(String(v ?? ''))
    if(!compiled[k].test(valNorm)) return false
  }
  return true
}

// UI / eventos
const filterToggleBtn = document.getElementById('clientes-filter-toggle')
const filtersRow = document.getElementById('clientes-filters-row')
let lockedColWidths = []
function lockColumnWidths(){
  const headerMainRow = filtersRow?.previousElementSibling
  if(!headerMainRow) return
  const ths = headerMainRow.querySelectorAll('th')
  lockedColWidths = Array.from(ths).map(th => th.offsetWidth)
  ths.forEach((th,i)=>{ th.style.width = lockedColWidths[i]+'px'; th.style.minWidth = lockedColWidths[i]+'px' })
  if(filtersRow){
    const filterThs = filtersRow.querySelectorAll('th')
    filterThs.forEach((th,i)=>{ th.style.width = lockedColWidths[i]+'px'; th.style.minWidth = lockedColWidths[i]+'px' })
  }
}
function unlockColumnWidths(){
  const allHeaderThs = document.querySelectorAll('thead th')
  allHeaderThs.forEach(th => { th.style.width=''; th.style.minWidth='' })
  lockedColWidths = []
}
let resizeRaf = null
window.addEventListener('resize', () => {
  if(filtersRow && !filtersRow.classList.contains('hidden')){
    if(resizeRaf) cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(()=>{ unlockColumnWidths(); lockColumnWidths() })
  }
})
filterToggleBtn?.addEventListener('click', () => {
  if(!filtersRow) return
  const willShow = filtersRow.classList.contains('hidden')
  if(willShow){
    lockColumnWidths(); filtersRow.classList.remove('hidden')
    const first = filtersRow.querySelector('input'); first && first.focus()
  } else { filtersRow.classList.add('hidden'); unlockColumnWidths() }
})

document.addEventListener('input', e => {
  const inp = e.target.closest('.clientes-filter-input')
  if(!inp) return
  const col = inp.getAttribute('data-col')
  if(col==='nacimiento' || col==='ultimaCita'){
    const isDelete = e.inputType && e.inputType.startsWith('delete')
    if(isDelete){
      let val = inp.value.toLowerCase().replace(/[^0-9dma\/]/g,'')
      const parts = val.split('/').slice(0,3)
      parts[0] = parts[0].slice(0,2)
      parts[1] = (parts[1]||'').slice(0,2)
      parts[2] = (parts[2]||'').slice(0,4)
      let out = parts[0]
      if(val.includes('/') && parts[0].length===2) out += '/'+parts[1]
      if(val.split('/').length>2 && parts[1].length===2) out = parts[0] + '/' + parts[1] + '/' + parts[2]
      if(!val.endsWith('/') && out.endsWith('/') && isDelete){ out = out.replace(/\/$/,'') }
      if(out !== inp.value){ const pos = out.length; inp.value = out; try { inp.setSelectionRange(pos,pos) } catch{} }
    } else {
      const rawAll = inp.value.toLowerCase().replace(/[^0-9dma]/g,'')
      const day=[]; const month=[]; const year=[]
      for(const ch of rawAll){
        if(day.length<2) day.push(ch)
        else if(month.length<2) month.push(ch)
        else if(year.length<4) year.push(ch)
        if(day.length===2 && month.length===2 && year.length===4) break
      }
      if(day.length===1 && day[0]==='d') day.push('d')
      if(month.length===1 && month[0]==='m') month.push('m')
      if(year.length===1 && year[0]==='a') year.push('a','a','a')
      const dayStr=day.join(''); const monthStr=month.join(''); const yearStr=year.join('')
      let out=''
      if(dayStr.length<2){ out=dayStr } else { out=dayStr + '/'; if(monthStr.length===0){} else if(monthStr.length<2){ out+=monthStr } else { out+=monthStr + '/' + yearStr } }
      if(!dayStr && (monthStr||yearStr)) out = rawAll
      if(out !== inp.value){ const pos = out.length; inp.value = out; try { inp.setSelectionRange(pos,pos) } catch{} }
    }
  }
  columnFilters[col] = inp.value
  aplicarFiltros()
})

document.addEventListener('keydown', e => {
  if(e.key==='Escape' && filtersRow && !filtersRow.classList.contains('hidden')){ filtersRow.classList.add('hidden') }
  const inp = e.target.closest?.('.clientes-filter-input')
  if(!inp) return
  const col = inp.getAttribute('data-col')
  if((col==='nacimiento' || col==='ultimaCita') && e.key==='Backspace'){
    const start = inp.selectionStart, end = inp.selectionEnd
    if(start===end && start>0){
      const val = inp.value
      if(val[start-1] === '/'){
        e.preventDefault()
        const removeFrom = Math.max(0, start-2)
        const newVal = val.slice(0, removeFrom) + val.slice(start)
        inp.value = newVal
        const newPos = removeFrom
        try { inp.setSelectionRange(newPos,newPos) } catch{}
        columnFilters[col] = inp.value
        aplicarFiltros()
      }
    }
  }
})
