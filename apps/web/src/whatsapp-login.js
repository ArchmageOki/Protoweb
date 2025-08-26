import './style.css'
import { authFetch } from './auth.js'

const API_BASE = 'http://localhost:4001'
const STATUS_URL = API_BASE + '/whatsapp/status'
const RESET_URL = API_BASE + '/whatsapp/reset'
const START_URL = API_BASE + '/whatsapp/session/start'
const statusText = document.getElementById('statusText')
const qrWrap = document.getElementById('qrWrap')
const resetBtn = document.getElementById('resetBtn')
let lastQrShown = null
let timer = null

async function fetchJSON(url, opts){
  const r = await authFetch(url, opts)
  if(!r.ok) throw new Error('HTTP '+r.status)
  return r.json()
}

function setStatus(msg){ if(statusText) statusText.textContent = msg }

function renderQr(dataUrl){
  if(!qrWrap) return
  if(!dataUrl){ qrWrap.innerHTML = '<span class="text-slate-400 text-xs">Esperando QR…</span>'; return }
  if(lastQrShown === dataUrl) return
  lastQrShown = dataUrl
  qrWrap.innerHTML = `<img src="${dataUrl}" alt="QR" class="w-full h-full object-contain" />`
}

async function poll(){
  try {
    const { status, qr } = await fetchJSON(STATUS_URL)
    switch(status){
      case 'INITIALIZING': setStatus('Inicializando…'); renderQr(null); break
      case 'QR': setStatus('Escanea el código con WhatsApp'); renderQr(qr); break
      case 'CONNECTED': setStatus('Conectado. Redirigiendo…'); setTimeout(()=> window.location.replace('/mensajes.html'), 500); return
      case 'DISCONNECTED': setStatus('Desconectado. Intentando reiniciar…'); break
  case 'NO_SESSION': setStatus('Creando sesión…'); await fetchJSON(START_URL, { method:'POST' }); break
      default: setStatus(status)
    }
  } catch(e){ setStatus('Error consultando estado'); }
  timer = setTimeout(poll, 2500)
}

resetBtn?.addEventListener('click', async ()=>{
  try { setStatus('Reiniciando…'); await fetchJSON(RESET_URL, { method:'POST', headers:{'Content-Type':'application/json'} }); lastQrShown=null } catch(e){ setStatus('Error al reiniciar') }
})

// Inicia primer polling (creará sesión si no existe)
poll()
