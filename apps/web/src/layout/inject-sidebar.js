// Inyecta la barra lateral desde el parcial HTML y marca el enlace activo
import { initSidebar } from './sidebar.js'

const CURRENT = window.location.pathname.replace(/\/index\.html$/, '/').toLowerCase()

async function loadSidebar(){
  try {
    const res = await fetch('/src/layout/sidebar.html')
    if(!res.ok) throw new Error('No se pudo cargar sidebar.html')
    const html = await res.text()
    // Insertar al inicio del contenedor #app
    const app = document.getElementById('app') || document.body
    // Evitar doble inserción
    if(!document.getElementById('sidebar')){
      app.insertAdjacentHTML('afterbegin', html)
    }
    // Marcar activo
    const links = Array.from(document.querySelectorAll('#sidebar nav a[data-route]'))
    const active = links.find(a => a.getAttribute('href')?.toLowerCase() === CURRENT)
    links.forEach(a => {
      const isActive = a === active
      a.classList.toggle('font-medium', isActive)
      a.classList.toggle('bg-slate-100', isActive)
    })
  initSidebar()
  try { window.dispatchEvent(new CustomEvent('sidebar:ready')) } catch {}

    // Fallback: si main.js no ha hecho binding aún, lo hacemos aquí
    if(!window.__SIDEBAR_BOUND__){
      const BODY = document.body
      const STORAGE_KEY_UI = 'app.ui'
      const sidebar = document.getElementById('sidebar')
      const overlay = document.getElementById('overlay')
      const openBtn = document.getElementById('sidebarOpen')
      const closeBtn = document.getElementById('sidebarClose')
      const collapseBtn = document.getElementById('sidebarCollapse')

      function openSidebar(){ sidebar?.classList.remove('-translate-x-full'); overlay?.classList.remove('hidden') }
      function closeSidebar(){ sidebar?.classList.add('-translate-x-full'); overlay?.classList.add('hidden') }

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
        window.dispatchEvent(new Event('sidebar:toggle'))
      })
      window.__SIDEBAR_BOUND__ = true
    }
  } catch (e) {
    console.error('Sidebar: error al cargar', e)
  }
}

loadSidebar()
