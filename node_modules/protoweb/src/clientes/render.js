// Renderizado de tabla y paginación
import { formatDate } from './utils-fechas'
import { clientes } from './data'
import { filtered, sortState, pageSize, currentPage } from './state'

export function applySort(list){
  const { key, dir } = sortState
  if(!key) return list
  return [...list].sort((a,b)=>{
    let va = a[key]
    let vb = b[key]
    if(key==='visitas' || key==='dineroTotal') return (Number(va)-Number(vb)) * dir
    if(va instanceof Date) va = va.getTime()
    if(vb instanceof Date) vb = vb.getTime()
    va = (va ?? '').toString().toLowerCase()
    vb = (vb ?? '').toString().toLowerCase()
    if(va < vb) return -1*dir
    if(va > vb) return 1*dir
    return 0
  })
}
export function totalPages(){ return Math.max(1, Math.ceil(filtered.length / pageSize)) }
export function clampPage(){ if(currentPage>totalPages()) currentPage = totalPages(); if(currentPage<1) currentPage=1 }

export function renderPagination(){
  const pagEl = document.getElementById('clientes-pagination')
  if(!pagEl) return
  clampPage()
  const total = totalPages()
  const mkBtn = (label, page, disabled=false, active=false)=>`<button data-page="${page}" ${disabled?'disabled':''} class="px-2 py-1 rounded border text-xs ${active?'bg-slate-900 text-white border-slate-900':'border-slate-300 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed'}">${label}</button>`
  let html = ''
  html += mkBtn('«',1,currentPage===1)
  html += mkBtn('‹',currentPage-1,currentPage===1)
  const windowSize = 5
  let start = Math.max(1, currentPage - Math.floor(windowSize/2))
  let end = start + windowSize -1
  if(end>total){ end=total; start=Math.max(1,end-windowSize+1) }
  for(let p=start;p<=end;p++){ html += mkBtn(p,p,false,p===currentPage) }
  html += mkBtn('›',currentPage+1,currentPage===total)
  html += mkBtn('»',total,currentPage===total)
  html += `<span class="ml-2">Página ${currentPage} / ${total}</span>`
  pagEl.innerHTML = html
}

function getVisibleColumns(){
  try {
    const saved = JSON.parse(localStorage.getItem('app.settings') || '{}')
    const cols = saved.clientes?.visibleColumns
    if(Array.isArray(cols) && cols.length){
      const set = new Set(cols)
      // Forzar siempre visibles
      set.add('nombre'); set.add('movil')
      return set
    }
  } catch {}
  return null
}

export function renderClientes(list){
  const tbody = document.getElementById('clientes-tbody')
  if(!tbody) return
  const visible = getVisibleColumns()
  const data = applySort(list)
  clampPage()
  const startIdx = (currentPage-1)*pageSize
  const pageItems = data.slice(startIdx, startIdx + pageSize)
  const frag = document.createDocumentFragment()
  pageItems.forEach(c => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td data-col="nombre" class="px-3 py-2"><span class="cell-text" title="${c.nombre}">${c.nombre}</span></td>
      <td data-col="apellidos" class="px-3 py-2"><span class="cell-text" title="${c.apellidos}">${c.apellidos}</span></td>
      <td data-col="movil" class="px-3 py-2"><a class="cell-text cliente-phone-link hover:underline" title="Abrir WhatsApp" href="https://wa.me/34${c.movil}" target="_blank" rel="noopener">${c.movil}</a></td>
      <td data-col="instagram" class="px-3 py-2"><a class="cell-text cliente-ig-link hover:underline" title="${c.instagram}" href="https://instagram.com/${c.instagram.substring(1)}" target="_blank" rel="noopener">${c.instagram}</a></td>
      <td data-col="dni" class="px-3 py-2"><span class="cell-text" title="${c.dni}">${c.dni}</span></td>
      <td data-col="direccion" class="px-3 py-2"><span class="cell-text" title="${c.direccion || ''}">${c.direccion || ''}</span></td>
      <td data-col="codigoPostal" class="px-3 py-2"><span class="cell-text" title="${c.codigoPostal || ''}">${c.codigoPostal || ''}</span></td>
      <td data-col="nacimiento" class="px-3 py-2"><span class="cell-text" title="${formatDate(c.nacimiento)}">${formatDate(c.nacimiento)}</span></td>
      <td data-col="visitas" class="px-3 py-2"><span class="cell-text" title="${c.visitas} citas totales">${c.visitas}</span></td>
      <td data-col="dineroTotal" class="px-3 py-2"><span class="cell-text" title="${c.dineroTotal!=null? c.dineroTotal.toFixed(2)+' €':''}">${c.dineroTotal!=null? c.dineroTotal.toFixed(2)+' €':''}</span></td>
      <td data-col="ultimaCita" class="px-3 py-2"><span class="cell-text" title="${formatDate(c.ultimaCita)}">${formatDate(c.ultimaCita)}</span></td>
      <td data-col="notas" class="px-3 py-2"><span class="cell-text" title="${c.notas || ''}">${c.notas || ''}</span></td>`
    tr.dataset.id = c.id
    tr.classList.add('cliente-row','cursor-pointer','hover:bg-slate-50')
    if(visible){
      tr.querySelectorAll('[data-col]').forEach(td => {
        if(!visible.has(td.getAttribute('data-col'))) td.classList.add('hidden')
      })
    }
    frag.appendChild(tr)
  })
  tbody.textContent = ''
  tbody.appendChild(frag)
  // Ocultar cabeceras según visible
  if(visible){
    document.querySelectorAll('thead tr:first-child th[data-sort]').forEach(th=>{
      const key = th.getAttribute('data-sort')
      if(!visible.has(key)) th.classList.add('hidden')
      else th.classList.remove('hidden')
    })
    // Fila de filtros si existe
    document.querySelectorAll('#clientes-filters-row th').forEach(th=>{
      const input = th.querySelector('input[data-col]')
      if(!input) return
      const key = input.getAttribute('data-col')
      if(!visible.has(key)) th.classList.add('hidden')
      else th.classList.remove('hidden')
    })
  }
  updateSortIndicators()
  renderPagination()
}

export function updateSortIndicators(){
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.classList.remove('sorting-asc','sorting-desc')
    const key = th.getAttribute('data-sort')
    if(key === sortState.key){ th.classList.add(sortState.dir===1?'sorting-asc':'sorting-desc') }
  })
}
export function toggleSort(key){
  if(sortState.key === key){ sortState.dir = -sortState.dir } else { sortState.key = key; sortState.dir = 1 }
  // currentPage se gestiona desde state.js; aquí solo re-render
  renderClientes(filtered)
}
