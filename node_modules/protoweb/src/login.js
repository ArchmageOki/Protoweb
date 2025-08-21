import './style.css'

// Manejo simple de login: cualquier dato es válido por ahora.
const form = document.getElementById('loginForm')
const passwordInput = /** @type {HTMLInputElement|null} */(document.getElementById('password'))
const togglePasswordBtn = document.getElementById('togglePassword')
const iconEye = document.getElementById('iconEye')
const iconEyeOff = document.getElementById('iconEyeOff')

function goToDashboard() {
  // Usamos navegación relativa; Vite sirve los archivos desde raíz del proyecto
  window.location.href = '/dashboard.html'
}

form?.addEventListener('submit', (e) => {
  e.preventDefault()

  // Simular validación exitosa siempre
  const email = /** @type {HTMLInputElement|null} */(document.getElementById('email'))?.value || ''
  const password = /** @type {HTMLInputElement|null} */(document.getElementById('password'))?.value || ''

  // Guardado opcional de "sesión" local para futura lógica
  try {
    localStorage.setItem('auth_demo', JSON.stringify({ email, ts: Date.now() }))
  } catch {}

  goToDashboard()
})

// Toggle mostrar/ocultar contraseña
togglePasswordBtn?.addEventListener('click', () => {
  if (!passwordInput) return
  const isHidden = passwordInput.type === 'password'
  passwordInput.type = isHidden ? 'text' : 'password'
  // Actualizar iconos y aria-pressed
  togglePasswordBtn.setAttribute('aria-pressed', String(isHidden))
  iconEye?.classList.toggle('hidden', !isHidden)
  iconEyeOff?.classList.toggle('hidden', isHidden)
})
