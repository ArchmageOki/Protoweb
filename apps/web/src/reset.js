import './style.css'
import { apiBase } from './auth.js'

const form = document.getElementById('resetForm')
const pw = document.getElementById('password')
const pw2 = document.getElementById('password2')
const match = document.getElementById('pwMatch')
const msgBox = document.getElementById('resetMsg')
function meetsPolicy(p){
  if(p.length < 8) return false
  let cats = 0
  if(/[A-Z]/.test(p)) cats++
  if(/[a-z]/.test(p)) cats++
  if(/\d/.test(p)) cats++
  if(/[^A-Za-z0-9]/.test(p)) cats++
  return cats >= 3
}

function setMsg(text, type='info'){
  if(!msgBox) return
  const colors = { info:'text-slate-600', error:'text-red-600', success:'text-green-600' }
  msgBox.className = 'text-xs mt-1 ' + (colors[type]||colors.info)
  msgBox.textContent = text
}

pw2?.addEventListener('input', ()=>{
  if(!pw.value || !pw2.value){ match.textContent=''; return }
  const ok = pw.value === pw2.value
  match.textContent = ok ? 'Coinciden' : 'No coinciden'
  match.className = 'mt-1 text-xs ' + (ok ? 'text-green-600' : 'text-red-600')
})

function getToken(){
  const params = new URLSearchParams(window.location.search)
  return params.get('token') || ''
}

// Validar token antes de permitir introducir contraseña
;(async function precheck(){
  const token = getToken()
  if(!token){ invalidate(); return }
  try {
    const r = await fetch(apiBase + '/auth/reset-validate', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ token }) })
    const data = await r.json().catch(()=>({}))
    if(!r.ok || !data.ok){ invalidate() }
  } catch { invalidate() }
})()

function invalidate(){
  // Mostrar aviso debajo del título
  const expBox = document.getElementById('expiredMsg')
  if(expBox){
    expBox.textContent = 'El enlace ha caducado o es inválido. Solicita uno nuevo.'
    expBox.classList.remove('hidden')
  }
  setMsg('')
  form?.classList.add('hidden')
  document.getElementById('resetSubtitle')?.classList.add('hidden')
  const back = document.getElementById('backLoginWrap')
  back?.classList.remove('text-slate-500')
  back?.classList.add('text-slate-600')
}

form?.addEventListener('submit', async (e)=>{
  e.preventDefault()
  const token = getToken()
  const password = pw.value
  const password2 = pw2.value
  if(!token){ setMsg('Token ausente','error'); return }
  if(!meetsPolicy(password)){ setMsg('Contraseña débil: mínimo 8 y 3 tipos (mayúscula, minúscula, dígito, símbolo).','error'); return }
  if(password !== password2){ setMsg('No coinciden','error'); return }
  const btn = form.querySelector('button[type=submit]')
  btn.disabled = true; btn.textContent = 'Enviando...'
  try {
    const r = await fetch(apiBase+'/auth/reset', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ token, password }) })
    const data = await r.json().catch(()=>({}))
    if(r.ok){
      setMsg('Contraseña actualizada. Redirigiendo...','success')
      setTimeout(()=>{ window.location.href = 'index.html' }, 1200)
    } else if(data.error === 'invalid_token') {
      setMsg('Token inválido o expirado','error')
    } else if(data.error === 'weak_password') {
      setMsg('Contraseña débil: mínimo 8 y 3 tipos (mayúscula, minúscula, dígito, símbolo).','error')
    } else {
      setMsg('Error interno','error')
    }
  } catch(err){ setMsg('Fallo de red','error') }
  finally { btn.disabled = false; btn.textContent = 'Restablecer' }
})
