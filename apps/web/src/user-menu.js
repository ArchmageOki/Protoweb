import { apiBase } from './auth.js'

const btn = document.getElementById('userMenuButton')
const menu = document.getElementById('userMenu')
const logoutBtn = document.getElementById('logoutBtn')
let open = false

function toggle(openState){
  open = openState ?? !open
  if(open){
    menu?.classList.remove('hidden')
    btn?.setAttribute('aria-expanded','true')
    document.addEventListener('click', onDocClick)
  } else {
    menu?.classList.add('hidden')
    btn?.setAttribute('aria-expanded','false')
    document.removeEventListener('click', onDocClick)
  }
}
function onDocClick(e){
  if(!menu || !btn) return
  if(menu.contains(e.target) || btn.contains(e.target)) return
  toggle(false)
}
btn?.addEventListener('click', ()=> toggle())

logoutBtn?.addEventListener('click', async ()=>{
  logoutBtn.disabled = true
  try {
    await fetch(apiBase + '/auth/logout', { method:'POST', credentials:'include' })
  } catch {}
  // Limpia y redirige
  window.location.href = '/index.html'
})
