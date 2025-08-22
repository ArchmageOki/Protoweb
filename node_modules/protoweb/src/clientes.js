import './style.css'

// Lógica compartida de sidebar (abrir/cerrar + colapso persistente)
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

function openSidebar(){
  sidebar?.classList.remove('-translate-x-full')
  overlay?.classList.remove('hidden')
}
function closeSidebar(){
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

// Interacción botón "Nuevo cliente" (placeholder hasta implementar formulario real)
const addBtn = document.getElementById('cliente-add')
addBtn?.addEventListener('click', () => {
  alert('Formulario de nuevo cliente (por implementar)')
})

// Nota: Columnas actuales: Nombre, Apellidos, Móvil (WhatsApp), Instagram, DNI, Nacimiento, Visitas, Última cita, Notas.

// ====== Datos de prueba (100 clientes) ======
function randomDate(startYear = 1975, endYear = 2005){
  const y = Math.floor(Math.random()*(endYear-startYear+1))+startYear
  const m = Math.floor(Math.random()*12)
  const d = Math.floor(Math.random()*28)+1
  return new Date(y,m,d)
}
function formatDate(d){
  const dd = String(d.getDate()).padStart(2,'0')
  const mm = String(d.getMonth()+1).padStart(2,'0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}
const nombres = ['Laura','Marco','Lucía','Carlos','Sofía','Javier','Marta','Andrés','Elena','Pablo','Clara','David','Nuria','Hugo','Paula','Raúl','Irene','Adrián','Noelia','Sergio','Celia','Iván','Patricia','Gonzalo','Alba','Rubén','Aitana','Diego','Sara']
const apellidos1 = ['García','López','Martínez','Sánchez','Pérez','Gómez','Fernández','Díaz','Ruiz','Hernández','Jiménez','Iglesias','Vargas','Castro','Navarro','Romero','Torres','Domínguez','Vega','Cortés']
const apellidos2 = ['Ruiz','Díaz','López','García','Santos','del Río','Prieto','Lorenzo','Gallardo','Benítez','Suárez','Mendoza','Blanco','León','Marín','Campos','Aguilar','Bravo','Caballero','Fuentes']
const notasPool = ['','Prefiere mañanas','Alergia leve a látex','Color piel II','Tatuaje previo','Sesión larga','Necesita recordatorio','Pago parcial','Revisión pendiente','Traer referencia']

function randomItem(arr){ return arr[Math.floor(Math.random()*arr.length)] }

function makeCliente(i){
  const nombre = randomItem(nombres)
  const a1 = randomItem(apellidos1)
  const a2 = randomItem(apellidos2)
  const movil = String(Math.floor(600000000 + Math.random()*399999999))
  const instaHandle = (nombre+a1).toLowerCase().replace(/[^a-z]/g,'')
  const dni = `${String(Math.floor(10000000 + Math.random()*89999999))}${'TRWAGMYFPDXBNJZSQVHLCKE'[Math.floor(Math.random()*23)]}`
  const nacimiento = randomDate(1975,2005)
  const lastDate = new Date(Date.now() - Math.floor(Math.random()*360)*86400000)
  const nota = randomItem(notasPool)
  return {
    id: 'c'+i,
    nombre,
    apellidos: `${a1} ${a2}`,
    movil,
    instagram: '@'+instaHandle,
  dni,
    nacimiento: nacimiento,
    visitas: Math.floor(Math.random()*15)+1,
    ultimaCita: lastDate,
    notas: nota
  }
}

const clientes = Array.from({length:100}, (_,i)=> makeCliente(i+1))
let filtered = clientes.slice()
// Filtros por columna
const columnFilters = {}

const sortState = { key: null, dir: 1 }
let pageSize = 10
let currentPage = 1

function applySort(list){
  const { key, dir } = sortState
  if(!key) return list
  return [...list].sort((a,b)=>{
    let va = a[key]
    let vb = b[key]
    // Comparación numérica directa para visitas
    if(key==='visitas'){
      return (Number(va)-Number(vb)) * dir
    }
    if(va instanceof Date) va = va.getTime()
    if(vb instanceof Date) vb = vb.getTime()
    va = (va ?? '').toString().toLowerCase()
    vb = (vb ?? '').toString().toLowerCase()
    if(va < vb) return -1*dir
    if(va > vb) return 1*dir
    return 0
  })
}
function totalPages(){ return Math.max(1, Math.ceil(filtered.length / pageSize)) }
function clampPage(){ if(currentPage>totalPages()) currentPage = totalPages(); if(currentPage<1) currentPage=1 }

function renderPagination(){
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

function renderClientes(list){
  const tbody = document.getElementById('clientes-tbody')
  if(!tbody) return
  const data = applySort(list)
  clampPage()
  const startIdx = (currentPage-1)*pageSize
  const pageItems = data.slice(startIdx, startIdx + pageSize)
  const frag = document.createDocumentFragment()
  pageItems.forEach(c => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td class="px-3 py-2"><span class="cell-text" title="${c.nombre}">${c.nombre}</span></td>
      <td class="px-3 py-2"><span class="cell-text" title="${c.apellidos}">${c.apellidos}</span></td>
  <td class="px-3 py-2"><a class="cell-text text-slate-700 hover:underline" title="Abrir WhatsApp" href="https://wa.me/34${c.movil}" target="_blank" rel="noopener">${c.movil}</a></td>
      <td class="px-3 py-2"><a class="cell-text text-slate-700 hover:underline" title="${c.instagram}" href="https://instagram.com/${c.instagram.substring(1)}" target="_blank" rel="noopener">${c.instagram}</a></td>
      <td class="px-3 py-2"><span class="cell-text" title="${c.dni}">${c.dni}</span></td>
      <td class="px-3 py-2"><span class="cell-text" title="${formatDate(c.nacimiento)}">${formatDate(c.nacimiento)}</span></td>
  <td class="px-3 py-2"><span class="cell-text" title="${c.visitas} citas completadas">${c.visitas}</span></td>
  <td class="px-3 py-2"><span class="cell-text" title="${formatDate(c.ultimaCita)}">${formatDate(c.ultimaCita)}</span></td>
      <td class="px-3 py-2"><span class="cell-text" title="${c.notas || ''}">${c.notas || ''}</span></td>`
    tr.dataset.id = c.id
    tr.classList.add('cliente-row','cursor-pointer','hover:bg-slate-50')
    frag.appendChild(tr)
  })
  tbody.textContent = ''
  tbody.appendChild(frag)
  updateSortIndicators()
  renderPagination()
}

function updateSortIndicators(){
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.classList.remove('sorting-asc','sorting-desc')
    const key = th.getAttribute('data-sort')
    if(key === sortState.key){
      th.classList.add(sortState.dir===1?'sorting-asc':'sorting-desc')
    }
  })
}
function toggleSort(key){
  if(sortState.key === key){ sortState.dir = -sortState.dir } else { sortState.key = key; sortState.dir = 1 }
  currentPage = 1
  renderClientes(filtered)
}

// Eventos UI
const thead = document.querySelector('thead')
thead?.addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]')
  if(!th) return
  toggleSort(th.getAttribute('data-sort'))
})

const sizeSel = document.getElementById('clientes-page-size')
sizeSel?.addEventListener('change', () => {
  pageSize = parseInt(sizeSel.value,10) || 50
  currentPage = 1
  renderClientes(filtered)
})

const pagBox = document.getElementById('clientes-pagination')
pagBox?.addEventListener('click', e => {
  const btn = e.target.closest('button[data-page]')
  if(!btn) return
  const p = parseInt(btn.getAttribute('data-page'),10)
  if(!isNaN(p)){ currentPage = p; renderClientes(filtered) }
})

// Estilos de indicadores (si no existen ya)
if(!document.getElementById('clientes-sort-style')){
  const st = document.createElement('style')
  st.id='clientes-sort-style'
  st.textContent = `
    th[data-sort]{
      position:relative;
      white-space:nowrap; /* No partir el texto (Nombre, Apellidos...) */
      padding-right:1.4rem; /* Reservar espacio para la flecha sin solapar */
    }
    th.sorting-asc::after, th.sorting-desc::after{
      position:absolute;
      right:6px;
      top:50%;
      transform:translateY(-50%);
      font-size:0.65em;
      line-height:1;
    }
    th.sorting-asc::after{ content:'▲'; }
    th.sorting-desc::after{ content:'▼'; }
  `
  document.head.appendChild(st)
}

// Render inicial (forzar selector si existe a 10)
const sizeSelInit = document.getElementById('clientes-page-size')
if(sizeSelInit) sizeSelInit.value = String(pageSize)
renderClientes(filtered)

// Interacción de edición: click o Enter/Espacio en la fila
const tbody = document.getElementById('clientes-tbody')
tbody?.addEventListener('click', e => {
  const row = e.target.closest('tr.cliente-row')
  if(row){
  // No editar si el click proviene de un enlace (WhatsApp / Instagram u otro anchor)
  const link = e.target.closest('a')
  if(link) return
    const id = row.dataset.id
    editarCliente(id)
  }
})
tbody?.addEventListener('keydown', e => {
  const row = e.target.closest('tr.cliente-row')
  if(row && (e.key === 'Enter' || e.key === ' ')){
  // Si el foco está en un enlace dentro de la fila, dejar comportamiento nativo
  if(e.target.tagName === 'A') return
    e.preventDefault()
    editarCliente(row.dataset.id)
  }
})

function editarCliente(id){
  alert('Editar cliente '+id+' (por implementar)')
}

// ====== Filtros por columna con comodín * ======
function wildcardToRegex(input){
  const raw = input.trim()
  const hasExplicit = raw.includes('*')
  const esc = raw.replace(/[-\/\\^$+?.()|[\]{}]/g,'\\$&')
  let core = esc.replace(/\*/g,'.*')
  if(!hasExplicit) core = '.*' + core + '.*'
  const regexStr = '^'+core+'$'
  try { return new RegExp(regexStr,'i') } catch { return /a^/i }
}
function aplicarFiltros(){
  const compiled = {}
  for(const k in columnFilters){
    const val = columnFilters[k].trim()
    if(val) compiled[k] = wildcardToRegex(val)
  }
  if(Object.keys(compiled).length===0){
    filtered = clientes.slice()
  } else {
    filtered = clientes.filter(c => coincideClienteColumnas(c, compiled))
  }
  currentPage = 1
  renderClientes(filtered)
}
function coincideClienteColumnas(c, compiled){
  for(const k in compiled){
    let v = c[k]
  if(k==='visitas'){ v = String(c.visitas) }
  else if(v instanceof Date) v = formatDate(v)
  else if(k==='nacimiento' || k==='ultimaCita') v = formatDate(c[k])
    if(!compiled[k].test(String(v ?? ''))) return false
  }
  return true
}
const filterToggleBtn = document.getElementById('clientes-filter-toggle')
const filtersRow = document.getElementById('clientes-filters-row')
let lockedColWidths = []

function lockColumnWidths(){
  const headerMainRow = filtersRow?.previousElementSibling // primera fila de cabecera
  if(!headerMainRow) return
  const ths = headerMainRow.querySelectorAll('th')
  lockedColWidths = Array.from(ths).map(th => th.offsetWidth)
  // Aplicar anchos explícitos
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
    resizeRaf = requestAnimationFrame(()=>{
      unlockColumnWidths(); lockColumnWidths()
    })
  }
})

filterToggleBtn?.addEventListener('click', () => {
  if(!filtersRow) return
  const willShow = filtersRow.classList.contains('hidden')
  if(willShow){
    lockColumnWidths()
    filtersRow.classList.remove('hidden')
    const first = filtersRow.querySelector('input')
    first && first.focus()
  } else {
    filtersRow.classList.add('hidden')
    unlockColumnWidths()
  }
})
document.addEventListener('input', e => {
  const inp = e.target.closest('.clientes-filter-input')
  if(!inp) return
  const col = inp.getAttribute('data-col')
  columnFilters[col] = inp.value
  aplicarFiltros()
})
document.addEventListener('keydown', e => {
  if(e.key==='Escape' && filtersRow && !filtersRow.classList.contains('hidden')){
    filtersRow.classList.add('hidden')
  }
})
