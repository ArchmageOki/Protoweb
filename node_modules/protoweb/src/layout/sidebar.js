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
}
