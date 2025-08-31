// Interceptor para verificar sesión WhatsApp antes de acceder a mensajes
import { ensureAccessToken } from './auth.js'

let isCheckingWhatsAppStatus = false

// Función para verificar estado de WhatsApp
async function checkWhatsAppStatus() {
  if (isCheckingWhatsAppStatus) return false
  
  isCheckingWhatsAppStatus = true
  
  try {
    const token = await ensureAccessToken()
    const response = await fetch('/data/whatsapp/status', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (!response.ok) {
      console.warn('[WhatsApp Guard] Error verificando estado:', response.status)
      return false
    }
    
    const data = await response.json()
    const { status } = data
    
    console.log('[WhatsApp Guard] Estado actual:', status)
    
    // Permitir acceso si está conectado completamente o autenticado
    return status === 'READY' || status === 'AUTHENTICATED'
    
  } catch (error) {
    console.error('[WhatsApp Guard] Error:', error)
    return false
  } finally {
    isCheckingWhatsAppStatus = false
  }
}

// Interceptar navegación a mensajes
function interceptMessagesNavigation() {
  // Interceptar clics en enlaces de mensajes
  document.addEventListener('click', async (event) => {
    const link = event.target.closest('a[href="/mensajes.html"]')
    if (!link) return
    
    event.preventDefault()
    
    console.log('[WhatsApp Guard] Verificando sesión WhatsApp...')
    
    const isReady = await checkWhatsAppStatus()
    
    if (isReady) {
      console.log('[WhatsApp Guard] Sesión lista, permitiendo acceso a mensajes')
      window.location.href = '/mensajes.html'
    } else {
      console.log('[WhatsApp Guard] Sesión no lista, redirigiendo a login')
      window.location.href = '/whatsapp-login.html'
    }
  })
  
  // También verificar si estamos ya en mensajes.html sin sesión activa
  if (window.location.pathname === '/mensajes.html') {
    checkWhatsAppStatus().then(isReady => {
      if (!isReady) {
        console.log('[WhatsApp Guard] En mensajes sin sesión, redirigiendo a login')
        window.location.replace('/whatsapp-login.html')
      }
    })
  }
}

// Inicializar cuando el sidebar esté listo
if (document.getElementById('sidebar')) {
  interceptMessagesNavigation()
} else {
  // Esperar a que el sidebar se cargue
  window.addEventListener('sidebar:ready', interceptMessagesNavigation)
  
  // Fallback si el evento no se dispara
  setTimeout(() => {
    if (document.getElementById('sidebar')) {
      interceptMessagesNavigation()
    }
  }, 1000)
}

export { checkWhatsAppStatus }
