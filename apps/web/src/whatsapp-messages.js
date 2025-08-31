// WhatsApp Messages functionality
import { apiBase, authFetch } from './auth.js'

// Estado de WhatsApp
let waStatusInterval = null
let currentWaStatus = null

// Cache de clientes para búsqueda
let clientCache = []
let clientFetchTs = 0

// Elementos del DOM
const waStatusBadge = document.getElementById('waStatusBadge')
const resetSessionBtn = document.getElementById('resetSessionBtn')

// Elementos del formulario de envío
const waSendForm = document.getElementById('waSendForm')
const waSendClientSearch = document.getElementById('waSendClientSearch')
const waSendClientResults = document.getElementById('waSendClientResults')
const waSendClientId = document.getElementById('waSendClientId')
const waSendClientClear = document.getElementById('waSendClientClear')
const waSendSelectedClient = document.getElementById('waSendSelectedClient')
const waSendMessageText = document.getElementById('waSendMessageText')
const waSendBtn = document.getElementById('waSendBtn')
const waSendStatus = document.getElementById('waSendStatus')
const waSendCharCount = document.getElementById('waSendCharCount')

// Historial de mensajes
const messageHistoryCount = document.getElementById('messageHistoryCount')
const messageHistoryTbody = document.getElementById('messageHistoryTbody')

// Variables de control
let clientSearchDebounce = null
let selectedClient = null

// ===== FUNCIONES PRINCIPALES =====

// Actualizar estado de WhatsApp
async function updateWhatsAppStatus() {
  try {
    const response = await authFetch(apiBase + '/data/whatsapp/status')
    if (!response.ok) {
      throw new Error('No se pudo obtener el estado de WhatsApp')
    }
    
    const data = await response.json()
    currentWaStatus = data.status
    
    // Actualizar badge visual
    updateStatusBadge(data.status, { 
      isFullyReady: data.isFullyReady,
      internalState: data.internalState 
    })
    
    // Habilitar/deshabilitar formulario según el estado
    updateFormAvailability(data.status, data.isFullyReady)
    
  } catch (error) {
    console.error('Error obteniendo estado WhatsApp:', error)
    waStatusBadge.textContent = 'Error'
    waStatusBadge.className = 'text-xs px-2 py-1 rounded bg-red-200 text-red-600'
    updateFormAvailability('ERROR')
  }
}

// Actualizar badge visual de estado
function updateStatusBadge(status, extraInfo = {}) {
  let text, className
  
  switch (status) {
    case 'READY':
      text = extraInfo.isFullyReady ? 'Conectado ✓' : 'Conectado (Limitado)'
      className = extraInfo.isFullyReady 
        ? 'text-xs px-2 py-1 rounded bg-green-200 text-green-600'
        : 'text-xs px-2 py-1 rounded bg-yellow-200 text-yellow-600'
      break
    case 'AUTHENTICATED':
      text = 'Autenticado'
      className = 'text-xs px-2 py-1 rounded bg-blue-200 text-blue-600'
      break
    case 'QR':
      text = 'Esperando QR'
      className = 'text-xs px-2 py-1 rounded bg-yellow-200 text-yellow-600'
      break
    case 'INITIALIZING':
      text = 'Inicializando'
      className = 'text-xs px-2 py-1 rounded bg-blue-200 text-blue-600'
      break
    case 'NO_SESSION':
      text = 'Sin sesión'
      className = 'text-xs px-2 py-1 rounded bg-slate-200 text-slate-600'
      break
    case 'ERROR':
    case 'AUTH_FAILURE':
      text = 'Error'
      className = 'text-xs px-2 py-1 rounded bg-red-200 text-red-600'
      break
    case 'DISCONNECTED':
      text = 'Desconectado'
      className = 'text-xs px-2 py-1 rounded bg-orange-200 text-orange-600'
      break
    default:
      text = 'Desconocido'
      className = 'text-xs px-2 py-1 rounded bg-slate-200 text-slate-600'
  }
  
  waStatusBadge.textContent = text
  waStatusBadge.className = className
}

// Habilitar/deshabilitar formulario
function updateFormAvailability(status, isFullyReady = false) {
  const isReady = status === 'READY' || status === 'AUTHENTICATED'
  
  waSendClientSearch.disabled = !isReady
  waSendMessageText.disabled = !isReady
  waSendBtn.disabled = !isReady
  
  if (!isReady) {
    if (status === 'ERROR' || status === 'AUTH_FAILURE') {
      waSendStatus.textContent = 'Error en WhatsApp. Reinicia la sesión.'
      waSendStatus.className = 'text-xs text-red-500'
    } else if (status === 'DISCONNECTED') {
      waSendStatus.textContent = 'WhatsApp desconectado'
      waSendStatus.className = 'text-xs text-orange-500'
    } else {
      waSendStatus.textContent = 'WhatsApp no está conectado'
      waSendStatus.className = 'text-xs text-red-500'
    }
  } else {
    if (status === 'READY' && !isFullyReady) {
      waSendStatus.textContent = 'Conectado (funcionalidad limitada)'
      waSendStatus.className = 'text-xs text-yellow-600'
    } else {
      waSendStatus.textContent = ''
    }
  }
}

// Cargar clientes del servidor
async function ensureClients() {
  const now = Date.now()
  if (clientCache.length && (now - clientFetchTs < 60000)) return
  
  try {
    const response = await authFetch(apiBase + '/data/clients')
    if (!response.ok) throw new Error('Error cargando clientes')
    
    const data = await response.json()
    clientCache = Array.isArray(data.items) ? data.items : []
    clientFetchTs = now
  } catch (error) {
    console.error('Error cargando clientes:', error)
  }
}

// Formatear fila de cliente para mostrar en resultados
function formatClientRow(client) {
  const name = client.full_name || client.first_name || '(Sin nombre)'
  const vip = client.is_vip ? '<span class="text-[10px] px-1 rounded bg-yellow-100 text-yellow-700 ml-1">VIP</span>' : ''
  const ig = client.instagram ? `<span class="text-slate-500">@${client.instagram}</span>` : ''
  const mobile = client.mobile ? `<span class="text-slate-500">${client.mobile}</span>` : ''
  
  return `<div class="flex flex-col">
    <span class="font-medium truncate">${name}${vip}</span>
    <span class="text-[10px] text-slate-500 flex gap-2">${mobile}${ig ? ' · ' + ig : ''}</span>
  </div>`
}

// Seleccionar cliente
function selectClient(client) {
  selectedClient = client
  waSendClientId.value = client.id
  
  const name = client.full_name || client.first_name || '(Sin nombre)'
  const parts = [name]
  if (client.mobile) parts.push(client.mobile)
  if (client.instagram) parts.push('@' + client.instagram)
  
  waSendClientSearch.value = parts.join(' · ')
  waSendClientSearch.disabled = true
  waSendClientSearch.className += ' cursor-not-allowed bg-slate-100 opacity-70'
  
  waSendSelectedClient.textContent = `Cliente seleccionado: ${name} (${client.mobile})`
  waSendSelectedClient.classList.remove('hidden')
  
  waSendClientResults.classList.add('hidden')
  waSendClientClear.classList.remove('hidden')
}

// Limpiar selección de cliente
function clearClientSelection() {
  selectedClient = null
  waSendClientId.value = ''
  waSendClientSearch.value = ''
  waSendClientSearch.disabled = false
  waSendClientSearch.className = waSendClientSearch.className.replace(' cursor-not-allowed bg-slate-100 opacity-70', '')
  waSendSelectedClient.classList.add('hidden')
  waSendClientResults.classList.add('hidden')
  waSendClientClear.classList.add('hidden')
}

// Normalizar número de teléfono para España
function normalizePhoneNumber(phone) {
  if (!phone) return null
  
  // Eliminar todos los caracteres no numéricos
  let cleaned = phone.replace(/\D/g, '')
  
  // Si tiene 9 dígitos, agregar prefijo de España (+34)
  if (cleaned.length === 9) {
    cleaned = '34' + cleaned
  }
  
  // Agregar '+' al inicio si no lo tiene
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned
  }
  
  return cleaned
}

// Enviar mensaje de WhatsApp
async function sendWhatsAppMessage() {
  if (!selectedClient) {
    waSendStatus.textContent = 'Selecciona un cliente primero'
    waSendStatus.className = 'text-xs text-red-500'
    return
  }
  
  const messageText = waSendMessageText.value.trim()
  if (!messageText) {
    waSendStatus.textContent = 'Escribe un mensaje'
    waSendStatus.className = 'text-xs text-red-500'
    return
  }
  
  if (!selectedClient.mobile) {
    waSendStatus.textContent = 'El cliente no tiene número de teléfono'
    waSendStatus.className = 'text-xs text-red-500'
    return
  }
  
  const phoneNumber = normalizePhoneNumber(selectedClient.mobile)
  if (!phoneNumber) {
    waSendStatus.textContent = 'Número de teléfono inválido'
    waSendStatus.className = 'text-xs text-red-500'
    return
  }
  
  try {
    waSendBtn.disabled = true
    waSendBtn.textContent = 'Enviando...'
    waSendStatus.textContent = 'Enviando mensaje...'
    waSendStatus.className = 'text-xs text-blue-500'
    
    const response = await authFetch(apiBase + '/data/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: phoneNumber,
        message: messageText,
        clientId: selectedClient.id,
        clientName: selectedClient.full_name || selectedClient.first_name || '(Sin nombre)',
        clientInstagram: selectedClient.instagram
      })
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const error = new Error(errorData.error || 'Error enviando mensaje')
      error.needsRestart = errorData.needsRestart
      error.details = errorData.details
      error.currentStatus = errorData.currentStatus
      throw error
    }
    
    const result = await response.json()
    
    waSendStatus.textContent = 'Mensaje enviado correctamente'
    waSendStatus.className = 'text-xs text-green-500'
    
    // Limpiar formulario
    waSendMessageText.value = ''
    clearClientSelection()
    updateCharCounter()
    
    // Recargar historial
    loadMessageHistory()
    
  } catch (error) {
    console.error('Error enviando mensaje:', error)
    
    let errorMessage = 'Error enviando mensaje'
    
    if (error.needsRestart) {
      errorMessage = 'Error de WhatsApp. Reinicia la sesión e inténtalo de nuevo.'
      
      // Actualizar estado para mostrar que necesita reinicio
      waStatusBadge.textContent = 'Necesita reinicio'
      waStatusBadge.className = 'text-xs px-2 py-1 rounded bg-red-200 text-red-600'
      updateFormAvailability('ERROR')
      
    } else if (error.message) {
      errorMessage = error.message
    }
    
    waSendStatus.textContent = errorMessage
    waSendStatus.className = 'text-xs text-red-500'
  } finally {
    const currentStatus = currentWaStatus || 'NO_SESSION'
    waSendBtn.disabled = currentStatus !== 'READY' && currentStatus !== 'AUTHENTICATED'
    waSendBtn.textContent = 'Enviar'
  }
}

// Actualizar contador de caracteres
function updateCharCounter() {
  const count = waSendMessageText.value.length
  waSendCharCount.textContent = count
  
  if (count > 900) {
    waSendCharCount.className = 'text-red-500 font-medium'
  } else if (count > 800) {
    waSendCharCount.className = 'text-yellow-600'
  } else {
    waSendCharCount.className = ''
  }
}

// Cargar historial de mensajes
async function loadMessageHistory() {
  try {
    const response = await authFetch(apiBase + '/data/whatsapp/history')
    if (!response.ok) throw new Error('Error cargando historial')
    
    const data = await response.json()
    const messages = Array.isArray(data.messages) ? data.messages : []
    
    messageHistoryCount.textContent = `${messages.length} registros`
    
    if (messages.length === 0) {
      messageHistoryTbody.innerHTML = '<tr class="empty-row"><td colspan="6" class="py-6 text-center text-slate-400">Sin mensajes todavía</td></tr>'
    } else {
      messageHistoryTbody.innerHTML = messages.map(msg => `
        <tr>
          <td class="py-2 pr-4 text-slate-900">${msg.phone || '-'}</td>
          <td class="py-2 pr-4 text-slate-900">${msg.client_name || '-'}</td>
          <td class="py-2 pr-4 text-slate-500">${msg.instagram ? '@' + msg.instagram : '-'}</td>
          <td class="py-2 pr-4 text-slate-500">-</td>
          <td class="py-2 pr-4 text-slate-500">${msg.sent_at ? new Date(msg.sent_at).toLocaleString('es-ES') : '-'}</td>
          <td class="py-2 pr-4 text-slate-700 max-w-xs truncate" title="${msg.message_text || ''}">${msg.message_text || '-'}</td>
        </tr>
      `).join('')
    }
  } catch (error) {
    console.error('Error cargando historial:', error)
  }
}

// Reiniciar sesión de WhatsApp
async function resetWhatsAppSession() {
  if (!confirm('¿Estás seguro de que quieres cerrar la sesión de WhatsApp?')) {
    return
  }
  
  try {
    resetSessionBtn.disabled = true
    resetSessionBtn.textContent = 'Cerrando...'
    
    const response = await authFetch(apiBase + '/data/whatsapp/reset', {
      method: 'POST'
    })
    
    if (response.ok) {
      waStatusBadge.textContent = 'Sesión cerrada'
      waStatusBadge.className = 'text-xs px-2 py-1 rounded bg-slate-200 text-slate-600'
      updateFormAvailability('NO_SESSION')
    }
    
  } catch (error) {
    console.error('Error cerrando sesión:', error)
  } finally {
    resetSessionBtn.disabled = false
    resetSessionBtn.textContent = 'Cerrar sesión'
  }
}

// ===== EVENT LISTENERS =====

// Inicializar polling de estado
function startStatusPolling() {
  updateWhatsAppStatus()
  waStatusInterval = setInterval(updateWhatsAppStatus, 5000) // cada 5 segundos
}

// Búsqueda de clientes con debounce
waSendClientSearch?.addEventListener('input', () => {
  if (clientSearchDebounce) clearTimeout(clientSearchDebounce)
  
  clientSearchDebounce = setTimeout(async () => {
    const query = waSendClientSearch.value.trim().toLowerCase()
    
    if (!query) {
      waSendClientResults.classList.add('hidden')
      return
    }
    
    await ensureClients()
    
    const filtered = clientCache.filter(client => {
      return [client.full_name, client.first_name, client.last_name, client.mobile, client.instagram]
        .some(field => field && String(field).toLowerCase().includes(query))
    }).slice(0, 20)
    
    if (filtered.length === 0) {
      waSendClientResults.innerHTML = '<div class="px-3 py-2 text-slate-500 text-xs">No se encontraron clientes</div>'
    } else {
      waSendClientResults.innerHTML = filtered.map(client => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2'
        button.innerHTML = formatClientRow(client)
        button.addEventListener('click', () => selectClient(client))
        return button.outerHTML
      }).join('')
      
      // Re-agregar event listeners después de actualizar innerHTML
      waSendClientResults.querySelectorAll('button').forEach((btn, index) => {
        btn.addEventListener('click', () => selectClient(filtered[index]))
      })
    }
    
    waSendClientResults.classList.remove('hidden')
  }, 200)
})

// Cerrar resultados al hacer clic fuera
document.addEventListener('click', (e) => {
  if (!e.target.closest('#waClientPicker')) {
    waSendClientResults?.classList.add('hidden')
  }
})

// Contador de caracteres en tiempo real
waSendMessageText?.addEventListener('input', updateCharCounter)

// Envío del formulario
waSendForm?.addEventListener('submit', (e) => {
  e.preventDefault()
  sendWhatsAppMessage()
})

// Botón de reset de sesión
resetSessionBtn?.addEventListener('click', resetWhatsAppSession)

// Botón para limpiar selección de cliente
waSendClientClear?.addEventListener('click', () => {
  clearClientSelection()
  waSendClientSearch?.focus()
})

// ===== INICIALIZACIÓN =====

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
  startStatusPolling()
  loadMessageHistory()
  updateCharCounter()
})

// Limpiar interval al salir
window.addEventListener('beforeunload', () => {
  if (waStatusInterval) {
    clearInterval(waStatusInterval)
  }
})