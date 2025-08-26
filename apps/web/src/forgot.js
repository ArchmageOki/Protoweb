import './style.css'
import { apiBase } from './auth.js'

const form = document.getElementById('forgotForm')
const msgId = 'forgotMsg'

function setMsg(text, type='info'){
  let box = document.getElementById(msgId)
  if(!box){
    box = document.createElement('div')
    box.id = msgId
    form.appendChild(box)
  }
  const colors = { info:'text-slate-600', error:'text-red-600', success:'text-green-600' }
  box.className = 'text-xs mt-2 ' + (colors[type]||colors.info)
  box.textContent = text
}

form?.addEventListener('submit', async (e)=>{
  e.preventDefault()
  const email = form.email.value.trim()
  if(!email){ setMsg('Introduce email','error'); return }
  const btn = form.querySelector('button[type=submit]')
  btn.disabled = true; btn.textContent = 'Enviando...'
  try {
    const r = await fetch(apiBase+'/auth/forgot', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email }) })
    await r.json().catch(()=>({}))
    setMsg('Si el email existe, se ha enviado un enlace (simulado).','success')
  } catch(err){
    setMsg('Fallo de red','error')
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar enlace'
  }
})
