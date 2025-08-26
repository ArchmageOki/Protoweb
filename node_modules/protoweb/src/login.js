import './style.css'
import { setAccess, apiBase, ensureRefreshed } from './auth.js'

const form = document.getElementById('loginForm')
const emailInput = /** @type {HTMLInputElement|null} */(document.getElementById('email'))
const passwordInput = /** @type {HTMLInputElement|null} */(document.getElementById('password'))
const togglePasswordBtn = document.getElementById('togglePassword')
const iconEye = document.getElementById('iconEye')
const iconEyeOff = document.getElementById('iconEyeOff')
let submitting = false
// Banner registro
function showBanner(){
  const params = new URLSearchParams(window.location.search)
  if(params.get('registered')==='1'){
    const wrap = document.querySelector('section .rounded-xl') || document.querySelector('main')
    if(wrap){
      const div = document.createElement('div')
      div.className = 'mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700'
      div.textContent = 'Cuenta creada. Ahora inicia sesión.'
      wrap.prepend(div)
    }
  }
}
showBanner()

// Si ya hay sesión (refresh cookie válida) redirigir directamente
;(async () => {
  const ok = await ensureRefreshed()
  if(ok){
    window.location.replace('/dashboard.html')
  }
})()

async function apiLogin(email, password){
  const r = await fetch(apiBase + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password })
  })
  const data = await r.json().catch(()=>({}))
  if(!r.ok){
    const err = new Error(data.error || 'login_failed')
    err.code = data.error
    throw err
  }
  return data
}

function saveAccess(token, exp){ setAccess(token, exp) }

function goToDashboard(){ window.location.href = '/dashboard.html' }

function showError(msg){
  let box = document.getElementById('loginError')
  if(!box){
    box = document.createElement('div')
    box.id = 'loginError'
    box.className = 'mt-2 text-xs'
    form.appendChild(box)
  }
  if(!msg){ box.textContent=''; return }
  box.textContent = msg
  box.className = 'mt-2 text-xs text-red-600'
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  if(submitting) return
  const email = emailInput?.value.trim() || ''
  const password = passwordInput?.value || ''
  if(!email || !password){ showError('Introduce email y contraseña'); return }
  submitting = true
  showError('')
  try {
    const { accessToken, accessExp } = await apiLogin(email, password)
    saveAccess(accessToken, accessExp)
    goToDashboard()
  } catch(err){
    if(err.code === 'email_not_verified'){
      showError('Email no verificado. Revisa el enlace o reenvía la verificación.')
      addResend(email)
    } else if(err.code === 'inactive_account') {
      showError('Cuenta no activa, contacta con el administrador')
    } else {
      showError('Credenciales inválidas o cuenta bloqueada')
    }
  } finally { submitting = false }
})

function addResend(email){
  if(document.getElementById('resendBox')) return
  const box = document.createElement('div')
  box.id = 'resendBox'
  box.className = 'mt-3 text-xs text-slate-600'
  box.innerHTML = `<button type="button" class="underline text-slate-700" id="resendBtn">Reenviar verificación</button>`
  form.appendChild(box)
  document.getElementById('resendBtn')?.addEventListener('click', async ()=>{
    const btn = document.getElementById('resendBtn')
    btn.disabled = true
    btn.textContent = 'Enviando...'
    try {
      await fetch(apiBase + '/auth/resend-verification', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email }) })
      btn.textContent = 'Enlace reenviado (ver consola API)'
    } catch { btn.textContent = 'Fallo, reintenta' }
    setTimeout(()=>{ btn.disabled=false; }, 4000)
  })
}

togglePasswordBtn?.addEventListener('click', () => {
  if (!passwordInput) return
  const isHidden = passwordInput.type === 'password'
  passwordInput.type = isHidden ? 'text' : 'password'
  togglePasswordBtn.setAttribute('aria-pressed', String(isHidden))
  iconEye?.classList.toggle('hidden', !isHidden)
  iconEyeOff?.classList.toggle('hidden', isHidden)
})
