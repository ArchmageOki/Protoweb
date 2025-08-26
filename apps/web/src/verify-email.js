import { apiBase } from './auth.js'
import './style.css'

function qs(id){ return document.getElementById(id) }
const msg = qs('statusMsg')
const actions = qs('actions')

async function run(){
  const params = new URLSearchParams(location.search)
  const token = params.get('token')
  if(!token){ msg.textContent = 'Token faltante'; msg.className='text-sm text-red-600'; return }
  msg.textContent = 'Verificando…'
  try {
    const r = await fetch(apiBase + '/auth/verify-email', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ token }) })
    const data = await r.json().catch(()=>({}))
    if(r.ok){
      msg.textContent = 'Email verificado correctamente. Ya puedes iniciar sesión.'
      msg.className='text-sm text-green-600'
      actions.classList.remove('hidden')
    } else if(data.error === 'invalid_token') {
      msg.textContent = 'Token inválido o expirado. Solicita un nuevo enlace.'
      msg.className='text-sm text-red-600'
    } else {
      msg.textContent = 'Error interno.'
      msg.className='text-sm text-red-600'
    }
  } catch {
    msg.textContent = 'Fallo de red.'
    msg.className='text-sm text-red-600'
  }
}

run()
