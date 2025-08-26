import './style.css'
import { apiBase } from './auth.js'

const form = document.getElementById('registerForm')
const pw = document.getElementById('password')
const pw2 = document.getElementById('password2')
const hint = document.getElementById('pwHint')
const match = document.getElementById('pwMatch')
const msgBox = document.getElementById('regMsg')
const meter = document.getElementById('pwMeter')
const meterFill = document.getElementById('pwMeterFill')
const checklist = document.getElementById('pwChecklist')
const REQS_META = [
  { key:'len', label:'8+ caracteres' },
  { key:'upper', label:'Mayúscula (A-Z)' },
  { key:'lower', label:'Minúscula (a-z)' },
  { key:'digit', label:'Dígito (0-9)' },
  { key:'symbol', label:'Símbolo (!@#$…)' },
  { key:'cats', label:'≥ 3 tipos cumplidos', emphasis:true }
]
if(checklist){
  // Inicialmente vacío: los elementos se crean al cumplirse
  checklist.classList.add('relative')
}

function strength(p){
  let score = 0
  if(p.length >= 8) score++
  if(/[A-Z]/.test(p)) score++
  if(/[a-z]/.test(p)) score++
  if(/\d/.test(p)) score++
  if(/[^A-Za-z0-9]/.test(p)) score++
  return score
}

function meetsPolicy(p){
  if(p.length < 8) return false
  let cats = 0
  if(/[A-Z]/.test(p)) cats++
  if(/[a-z]/.test(p)) cats++
  if(/\d/.test(p)) cats++
  if(/[^A-Za-z0-9]/.test(p)) cats++
  return cats >= 3
}

pw?.addEventListener('input', ()=>{
  const s = strength(pw.value)
  const msgs = ['Muy débil','Débil','Aceptable','Fuerte','Muy fuerte','Excelente']
  const policy = 'Mínimo 8 caracteres y 3 de: mayúscula, minúscula, dígito, símbolo.'
  hint.textContent = pw.value ? (msgs[s] || msgs[msgs.length-1]) + ' · ' + policy : policy
  hint.className = 'mt-1 text-xs ' + (s>=3 ? 'text-green-600' : 'text-slate-500')
  if(meter && meterFill){
    const percent = (s/5)*100
    meterFill.style.width = percent + '%'
    let color = 'bg-red-500'
    if(s>=1) color = 'bg-orange-500'
    if(s>=2) color = 'bg-yellow-500'
    if(s>=3) color = 'bg-lime-500'
    if(s>=4) color = 'bg-green-500'
    if(s>=5) color = 'bg-emerald-600'
    meterFill.className = 'h-full transition-all duration-300 ' + color
  }
  updateChecklist(pw.value)
})

function updateChecklist(p){
  if(!checklist) return
  const reqs = {
    len: p.length >= 8,
    upper: /[A-Z]/.test(p),
    lower: /[a-z]/.test(p),
    digit: /\d/.test(p),
    symbol: /[^A-Za-z0-9]/.test(p)
  }
  const cats = ['upper','lower','digit','symbol'].filter(k=>reqs[k]).length
  reqs.cats = cats >= 3 && reqs.len

  REQS_META.forEach(meta => {
    const ok = reqs[meta.key]
    let li = checklist.querySelector('li[data-req="'+meta.key+'"]')
    if(ok && !li){
      li = document.createElement('li')
      li.dataset.req = meta.key
      li.textContent = meta.label
      // Animación: crecer altura (max-h-0 -> max-h-6) empujando el campo de confirmación hacia abajo
      li.className = 'pwreq text-green-600 flex items-center gap-2 opacity-0 max-h-0 overflow-hidden pl-0'
      const icon = document.createElement('span')
      icon.textContent = '✓'
      icon.className = 'inline-flex items-center justify-center text-[11px] font-bold'
      li.prepend(icon)
      checklist.appendChild(li)
      requestAnimationFrame(()=>{
        li.classList.add('transition-all','duration-300','ease-out','pl-1')
        li.classList.remove('opacity-0')
        li.style.maxHeight = '24px'
      })
    }
    if(!ok && li){
      // Ocultar contrayendo altura hacia arriba (confirm quedará de nuevo más arriba)
      li.classList.add('transition-all','duration-200','ease-in')
      li.style.maxHeight = '0px'
      li.classList.add('opacity-0')
      setTimeout(()=>{ li.remove() }, 210)
    }
  })
}

// Inicializar checklist vacío
updateChecklist('')

pw2?.addEventListener('input', ()=>{
  if(!pw.value || !pw2.value){ match.textContent=''; return }
  const ok = pw.value === pw2.value
  match.textContent = ok ? 'Coinciden' : 'No coinciden'
  match.className = 'mt-1 text-xs ' + (ok ? 'text-green-600' : 'text-red-600')
})

function setMsg(text, type='info'){
  if(!msgBox) return
  const colors = { info:'text-slate-600', error:'text-red-600', success:'text-green-600' }
  msgBox.className = 'text-xs mt-1 ' + (colors[type]||colors.info)
  msgBox.textContent = text
}

form?.addEventListener('submit', async (e)=>{
  e.preventDefault()
  const email = form.email.value.trim()
  const password = pw.value
  const password2 = pw2.value
  if(!meetsPolicy(password)){ setMsg('Contraseña débil: mínimo 8 y 3 tipos (mayúscula, minúscula, dígito, símbolo).', 'error'); return }
  if(password !== password2){ setMsg('Las contraseñas no coinciden','error'); return }
  const btn = form.querySelector('button[type=submit]')
  btn.disabled = true; btn.textContent = 'Creando...'
  try {
    const r = await fetch(apiBase+'/auth/register', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email, password }) })
    const data = await r.json().catch(()=>({}))
    if(r.ok){
      window.location.href = 'index.html?registered=1'
    } else if(data.error === 'email_exists') {
      setMsg('El email ya está registrado', 'error')
    } else if(data.error === 'weak_password') {
      setMsg('Contraseña débil: mínimo 8 y 3 tipos (mayúscula, minúscula, dígito, símbolo).', 'error')
    } else if(data.error === 'invalid_input') {
      setMsg('Datos inválidos', 'error')
    } else {
      setMsg('Error interno', 'error')
    }
  } catch(err){
    setMsg('Fallo de red','error')
  } finally {
    btn.disabled = false; btn.textContent = 'Crear cuenta'
  }
})

// Toggle password
const toggle = document.getElementById('togglePassword')
const iconEye = document.getElementById('iconEye')
const iconEyeOff = document.getElementById('iconEyeOff')

toggle?.addEventListener('click', ()=>{
  const show = pw.type === 'password'
  pw.type = show ? 'text' : 'password'
  toggle.setAttribute('aria-pressed', show ? 'true' : 'false')
  iconEye.classList.toggle('hidden', !show)
  iconEyeOff.classList.toggle('hidden', show)
})
