// Módulo de inicialización de sidebar (móvil + colapso escritorio)
// Expone initSidebar() que puede llamarse desde cualquier página.
// Idempotente: si ya se inicializó, no duplica listeners.
let _initialized = false
const STORAGE_KEY_UI = 'app.ui'

export function initSidebar(){
  if(_initialized) return
  _initialized = true
  const sidebar = document.getElementById('sidebar')
  if(!sidebar){ return }
  const overlay = document.getElementById('overlay')
  const openBtn = document.getElementById('sidebarOpen')
  const closeBtn = document.getElementById('sidebarClose')
  const collapseBtn = document.getElementById('sidebarCollapse')
  const BODY = document.body
  // Restaurar estado colapsado persistente
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_UI) || '{}')
    if(saved.sidebarCollapsed) BODY.classList.add('sidebar-collapsed')
  } catch {}
  const openSidebar = ()=>{ sidebar.classList.remove('-translate-x-full'); overlay?.classList.remove('hidden') }
  const closeSidebar = ()=>{ sidebar.classList.add('-translate-x-full'); overlay?.classList.add('hidden') }
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

  // ---- Submenús (Ajustes) ----
  const triggers = sidebar.querySelectorAll('[data-submenu-trigger]')
  // Helper para recalcular la línea vertical del árbol ajustes
  function adjustAjustesTreeLine(){
    const panel = sidebar.querySelector('[data-submenu="ajustes"]')
    if(!panel || panel.classList.contains('hidden')) return
    try {
      const line = panel.querySelector('.ajustes-tree-line')
      const items = panel.querySelectorAll('li')
      if(line && items.length){
        const last = items[items.length-1].getBoundingClientRect()
        const panelRect = panel.getBoundingClientRect()
        const height = (last.top + last.height/2) - panelRect.top
        if(height>0) line.style.height = height + 'px'
      }
    } catch {}
  }
  triggers.forEach(btn => {
    btn.addEventListener('click', (e)=>{
      const key = btn.getAttribute('data-submenu-trigger')
      const panel = sidebar.querySelector(`[data-submenu="${key}"]`)
      const caret = btn.querySelector('.submenu-caret')
      const expanded = btn.getAttribute('aria-expanded') === 'true'
      const willExpand = !expanded
      btn.setAttribute('aria-expanded', String(willExpand))
      if(panel){ panel.classList.toggle('hidden', !willExpand) }
      if(caret){ caret.classList.toggle('rotate-180', willExpand) }
      // Ajustar altura de la línea vertical del árbol ajustes cuando se expande
      if(willExpand && key==='ajustes' && panel){
        requestAnimationFrame(adjustAjustesTreeLine)
      }
    })
  })

  // Recalcular en resize (cambios de altura por wrap o zoom)
  window.addEventListener('resize', ()=>{ adjustAjustesTreeLine() })

  // Observer para cambios dinámicos en la lista de ajustes
  try {
    const ajustesPanel = sidebar.querySelector('[data-submenu="ajustes"]')
    const ul = ajustesPanel?.querySelector('ul')
    if(ul){
      const mo = new MutationObserver(()=> adjustAjustesTreeLine())
      mo.observe(ul, { childList: true })
    }
  } catch {}

  // Autoabrir si hash coincide
  try {
    if(location.hash.startsWith('#') && location.hash.length>1){
      const target = location.hash.slice(1)
      const link = sidebar.querySelector(`[data-subitem="${target}"]`)
      if(link){
        const parentBtn = sidebar.querySelector('[data-submenu-trigger="ajustes"]')
        parentBtn?.click()
      }
    }
  } catch {}

  // Autoabrir Ajustes si la ruta actual pertenece a uno de sus subitems
  try {
    const path = location.pathname.replace(/\\+/g,'/').toLowerCase()
    const ajustesItems = sidebar.querySelectorAll('[data-submenu="ajustes"] [data-route]')
    ajustesItems.forEach(a=>{
      const route = a.getAttribute('data-route')?.toLowerCase()
      if(route && path.endsWith(route)){
        const parentBtn = sidebar.querySelector('[data-submenu-trigger="ajustes"]')
        if(parentBtn && parentBtn.getAttribute('aria-expanded')!=='true'){
          parentBtn.click()
        }
        a.classList.add('text-slate-900','font-medium')
      }
    })
  } catch {}

  // Modo colapsado: mostrar popover flotante con sub-items al hacer hover del botón Ajustes
  let pop = null
  function ensurePopover(){
    if(pop) return pop
    pop = document.createElement('div')
    pop.className='sidebar-flyout hidden absolute z-50 left-full top-0 ml-1 w-48 rounded-md border border-slate-200 bg-white shadow-lg p-2 text-xs'
    pop.innerHTML = `
      <div class="flex flex-col gap-1">
        <a href="/ajustes.html#general" class="px-2 py-1 rounded hover:bg-slate-100">General</a>
        <a href="/ajustes.html#calendario" class="px-2 py-1 rounded hover:bg-slate-100">Calendario</a>
        <a href="/ajustes.html#clientes" class="px-2 py-1 rounded hover:bg-slate-100">Clientes</a>
        <a href="/ajustes.html#provisional2" class="px-2 py-1 rounded hover:bg-slate-100">Provisional2</a>
      </div>`
    sidebar.appendChild(pop)
    return pop
  }
  const ajustesBtn = sidebar.querySelector('[data-submenu-trigger="ajustes"]')
  function positionPopover(){
    if(!pop || !ajustesBtn) return
    const rect = ajustesBtn.getBoundingClientRect()
    const sRect = sidebar.getBoundingClientRect()
    pop.style.top = (rect.top - sRect.top) + 'px'
  }
  function showPopover(){
    if(!document.body.classList.contains('sidebar-collapsed')) return
    ensurePopover()
    positionPopover()
    pop.classList.remove('hidden')
  }
  function hidePopover(){ if(pop) pop.classList.add('hidden') }
  if(ajustesBtn){
    ajustesBtn.addEventListener('click', (e)=>{
      if(!document.body.classList.contains('sidebar-collapsed')) return // comportamiento normal en expandido
      e.preventDefault()
      if(!pop || pop.classList.contains('hidden')){ showPopover() } else { hidePopover() }
    })
  }
  document.addEventListener('click', (e)=>{
    if(!document.body.classList.contains('sidebar-collapsed')) return
    if(!pop || pop.classList.contains('hidden')) return
    if(pop.contains(e.target) || ajustesBtn.contains(e.target)) return
    hidePopover()
  })
  window.addEventListener('sidebar:toggle', ()=>{ hidePopover() })
}
