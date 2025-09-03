import './style.css'
import { ensureAccessToken } from './auth.js'

// Elementos DOM
const statusText = document.getElementById('statusText')
const qrWrap = document.getElementById('qrWrap')
const resetBtn = document.getElementById('resetBtn')

// Estado del polling
let pollingInterval = null

// Función para hacer requests autenticados
async function apiRequest(url, options = {}) {
  const token = await ensureAccessToken()
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`)
  }
  
  return response.json()
}

// Actualizar el texto de estado
function updateStatus(message) {
  if (statusText) {
    statusText.textContent = message
    console.log('[WhatsApp Login]', message)
  }
}

// Mostrar el código QR
function showQR(qrData) {
  if (!qrWrap) return
  
  if (qrData) {
    qrWrap.innerHTML = `<img src="${qrData}" alt="QR Code" class="w-full h-full object-contain rounded" />`
  } else {
    qrWrap.innerHTML = '<span class="text-slate-400 text-xs">Esperando QR...</span>'
  }
}

// Verificar el estado de WhatsApp
async function checkStatus() {
  try {
    const data = await apiRequest('/data/whatsapp/status')
    const { status, qr } = data
    
    console.log('[WhatsApp] Status:', status)
    
    switch (status) {
      case 'NO_SESSION':
        updateStatus('Iniciando sesión de WhatsApp...')
        showQR(null)
        await apiRequest('/data/whatsapp/start', { method: 'POST' })
        break
        
      case 'INITIALIZING':
        updateStatus('Inicializando WhatsApp...')
        showQR(null)
        break
        
      case 'QR':
        updateStatus('Escanea el código QR con tu WhatsApp')
        showQR(qr)
        break
        
      case 'AUTHENTICATED':
        updateStatus('Autenticado. Ya puedes usar WhatsApp!')
        showQR(null)
        stopPolling()
        setTimeout(() => {
          window.location.href = '/mensajes.html'
        }, 1500)
        break
        
      case 'LOADING':
        updateStatus('Cargando WhatsApp Web...')
        showQR(null)
        break
        
      case 'READY':
        updateStatus('¡Conectado exitosamente! Redirigiendo...')
        showQR(null)
        stopPolling()
        setTimeout(() => {
          window.location.href = '/mensajes.html'
        }, 1500)
        break
        
      case 'DISCONNECTED':
        updateStatus('Desconectado. Reiniciando...')
        showQR(null)
        await apiRequest('/data/whatsapp/start', { method: 'POST' })
        break
      case 'UNAVAILABLE':
        updateStatus('Servicio de WhatsApp no disponible. Arrancando...')
        showQR(null)
        // Intentar iniciar (puede disparar autospawn en backend)
        try { await apiRequest('/data/whatsapp/start', { method: 'POST' }) } catch {}
        break
        
      default:
        updateStatus(`Estado: ${status}`)
        showQR(null)
    }
    
  } catch (error) {
    console.error('[WhatsApp] Error:', error)
    updateStatus('Error de conexión')
    showQR(null)
  }
}

// Iniciar el polling
function startPolling() {
  if (pollingInterval) return
  
  updateStatus('Conectando con WhatsApp...')
  checkStatus() // Primera verificación inmediata
  
  pollingInterval = setInterval(checkStatus, 3000) // Verificar cada 3 segundos
}

// Detener el polling
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}

// Reiniciar sesión
async function resetSession() {
  try {
    updateStatus('Reiniciando sesión...')
    showQR(null)
    
    stopPolling()
    
    await apiRequest('/data/whatsapp/reset', { method: 'POST' })
    
    updateStatus('Sesión reiniciada. Reconectando...')
    
    setTimeout(startPolling, 2000)
    
  } catch (error) {
    console.error('[WhatsApp] Reset error:', error)
    updateStatus('Error al reiniciar sesión')
  }
}

// Event listeners
if (resetBtn) {
  resetBtn.addEventListener('click', resetSession)
}

// Limpiar al salir
window.addEventListener('beforeunload', stopPolling)

// Iniciar
startPolling()
