import jwt from 'jsonwebtoken'
import fetch from 'node-fetch'
import { JWT_ACCESS_SECRET } from './config.js'
import { 
  pgOutboxListDue, pgOutboxMarkSending, pgOutboxMarkResult 
} from './db/pg.js'

const WHATSAPP_SERVICE_BASE = process.env.WHATSAPP_SERVICE_BASE || 'http://localhost:4001'
const ENABLED = process.env.WHATSAPP_OUTBOX_WORKER !== 'false'
const INTERVAL_MS = parseInt(process.env.WHATSAPP_OUTBOX_INTERVAL_MS||'5000',10)
let running = false

async function processOne(msg){
  // Intentar marcar como sending para bloqueo competitivo
  const locked = await pgOutboxMarkSending(msg.id)
  if(!locked) return // otro worker lo tomó
  try {
    const nowSec = Math.floor(Date.now()/1000)
    const token = jwt.sign({ sub: locked.user_id, ver: 1, iat: nowSec }, JWT_ACCESS_SECRET, { algorithm:'HS256', expiresIn:'10m' })
    const body = {
      phone: locked.phone.startsWith('+') ? locked.phone : '+' + locked.phone,
      message: locked.message_text,
      clientId: locked.client_id,
      clientName: locked.client_name,
      clientInstagram: locked.instagram
    }
    const resp = await fetch(WHATSAPP_SERVICE_BASE + '/whatsapp/send', {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    })
    const data = await resp.json().catch(()=>({}))
    if(resp.ok && data.success){
      await pgOutboxMarkResult(locked.id, { ok:true })
      // Historial se registra dentro del microservicio ya
      console.log('[outbox] enviado', locked.id, 'user', locked.user_id)
    } else {
      const errMsg = data.error || ('http_'+resp.status)
      await pgOutboxMarkResult(locked.id, { ok:false, error: errMsg })
      console.warn('[outbox] fallo envio', locked.id, errMsg)
    }
  } catch(e){
    await pgOutboxMarkResult(msg.id, { ok:false, error: e.message })
    console.error('[outbox] exception', msg.id, e.message)
  }
}

async function cycle(){
  if(!ENABLED){ return }
  if(running){ return }
  running = true
  try {
    const due = await pgOutboxListDue(20)
    for(const msg of due){
      // Procesar secuencialmente para no saturar; se puede paralelizar limitadamente si hace falta
      // eslint-disable-next-line no-await-in-loop
      await processOne(msg)
    }
  } catch(e){
    console.error('[outbox] ciclo error', e.message)
  } finally {
    running = false
  }
}

export function startOutboxWorker(){
  if(!ENABLED){ console.log('[outbox] desactivado') ; return }
  console.log('[outbox] worker iniciado interval', INTERVAL_MS+'ms')
  setInterval(cycle, INTERVAL_MS)
  // Kick inicial tras breve delay
  setTimeout(cycle, 1500)
}
