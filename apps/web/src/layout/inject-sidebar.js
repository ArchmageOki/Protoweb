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
  } catch (e) {
    console.error('Sidebar: error al cargar', e)
  }
}

loadSidebar()
